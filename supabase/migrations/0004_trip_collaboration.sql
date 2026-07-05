-- Collaboration phase 2: trip membership + in-app invites. Lets several
-- signed-in users view/edit one trip. Run in the wayfork-db SQL Editor after
-- 0003_per_user_trip_pk.sql.
--
-- Model: a trip is still one public.trips row keyed (owner, id). trip_members
-- lists who else may touch it; trip_invites are pending invitations matched to
-- the invitee by email (an in-app inbox — no email is sent). The trip owner
-- keeps full access without needing a membership row.

create table if not exists public.trip_members (
  trip_owner uuid not null,
  trip_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (trip_owner, trip_id, user_id),
  foreign key (trip_owner, trip_id) references public.trips (owner, id) on delete cascade
);
alter table public.trip_members enable row level security;

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_owner uuid not null,
  trip_id text not null,
  email text not null,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  foreign key (trip_owner, trip_id) references public.trips (owner, id) on delete cascade
);
alter table public.trip_invites enable row level security;
create index if not exists trip_invites_email_idx on public.trip_invites (lower(email)) where status = 'pending';

grant select, insert, update, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.trip_invites to authenticated;

-- Membership predicates as SECURITY DEFINER so the trips <-> trip_members
-- policies don't recurse (their reads run as the table owner, bypassing RLS).
-- They only ever reveal whether the caller (auth.uid()) is a member/editor.
create or replace function public.is_trip_member(p_owner uuid, p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_owner = p_owner and m.trip_id = p_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_editor(p_owner uuid, p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_owner = p_owner and m.trip_id = p_id
      and m.user_id = auth.uid() and m.role in ('owner', 'editor')
  );
$$;

-- trips: owner keeps full access; members may read, editors may also update.
-- (0002's "owner insert"/"owner delete" stay: only the owner creates/deletes.)
drop policy if exists "owner select" on public.trips;
drop policy if exists "owner update" on public.trips;
create policy "read own or shared" on public.trips
  for select to authenticated
  using (owner = auth.uid() or public.is_trip_member(owner, id));
create policy "update own or editor" on public.trips
  for update to authenticated
  using (owner = auth.uid() or public.is_trip_editor(owner, id))
  with check (owner = auth.uid() or public.is_trip_editor(owner, id));

-- trip_members: members read the roster; only the trip owner manages it.
create policy "member reads roster" on public.trip_members
  for select to authenticated
  using (trip_owner = auth.uid() or public.is_trip_member(trip_owner, trip_id));
create policy "owner manages members" on public.trip_members
  for all to authenticated
  using (trip_owner = auth.uid())
  with check (trip_owner = auth.uid());

-- trip_invites: the invitee (by email) sees their invites; the owner manages them.
create policy "invitee or owner reads invites" on public.trip_invites
  for select to authenticated
  using (trip_owner = auth.uid() or lower(email) = lower(auth.email()));
create policy "owner creates invites" on public.trip_invites
  for insert to authenticated
  with check (trip_owner = auth.uid() and invited_by = auth.uid());
create policy "owner updates invites" on public.trip_invites
  for update to authenticated using (trip_owner = auth.uid()) with check (trip_owner = auth.uid());
create policy "owner deletes invites" on public.trip_invites
  for delete to authenticated using (trip_owner = auth.uid());

-- Accept an invite addressed to the caller's email: create the membership and
-- mark it accepted. SECURITY DEFINER so the invitee (not the owner) may insert
-- the membership despite the owner-only manage policy.
create or replace function public.accept_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.trip_invites;
begin
  select * into inv from public.trip_invites
    where id = p_invite and status = 'pending' and lower(email) = lower(auth.email());
  if inv.id is null then
    raise exception 'invite not found or not addressed to you';
  end if;
  insert into public.trip_members (trip_owner, trip_id, user_id, role)
    values (inv.trip_owner, inv.trip_id, auth.uid(), inv.role)
    on conflict (trip_owner, trip_id, user_id) do update set role = excluded.role;
  update public.trip_invites set status = 'accepted' where id = inv.id;
end;
$$;

grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.is_trip_member(uuid, text) to authenticated;
grant execute on function public.is_trip_editor(uuid, text) to authenticated;

-- New functions are granted to PUBLIC by default; keep them off the anon role.
-- authenticated retains EXECUTE (the predicates are invoked by the trips RLS
-- policies, and accept_invite is the invitee-facing RPC).
revoke execute on function public.accept_invite(uuid) from public, anon;
revoke execute on function public.is_trip_member(uuid, text) from public, anon;
revoke execute on function public.is_trip_editor(uuid, text) from public, anon;
