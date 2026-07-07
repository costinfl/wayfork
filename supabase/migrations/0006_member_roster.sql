-- Collaboration phase 5: show who has access, and let members leave a trip.
-- Run after 0005_invite_display_fields.sql.

-- Record the member's email so the owner's roster reads nicely.
alter table public.trip_members add column if not exists email text;

-- A member may remove their own membership (leave the trip). The owner still
-- manages everyone via the "owner manages members" policy from 0004.
create policy "member leaves" on public.trip_members
  for delete to authenticated using (user_id = auth.uid());

-- accept_invite now also stores the member's email. Same body/security as 0004.
create or replace function public.accept_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.trip_invites;
begin
  select * into inv from public.trip_invites
    where id = p_invite and status = 'pending' and lower(email) = lower(auth.email());
  if inv.id is null then
    raise exception 'invite not found or not addressed to you';
  end if;
  insert into public.trip_members (trip_owner, trip_id, user_id, role, email)
    values (inv.trip_owner, inv.trip_id, auth.uid(), inv.role, inv.email)
    on conflict (trip_owner, trip_id, user_id) do update set role = excluded.role, email = excluded.email;
  update public.trip_invites set status = 'accepted' where id = inv.id;
end;
$$;

grant execute on function public.accept_invite(uuid) to authenticated;
revoke execute on function public.accept_invite(uuid) from public, anon;
