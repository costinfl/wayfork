-- Wayfork auth: make trips per-user. Adds an owner column defaulting to the
-- authenticated user and replaces the shared-sandbox anon policies with
-- per-user row-level security. Run in the wayfork-db SQL Editor (or via
-- supabase db push) after 0001_trips.sql.

-- Own trips by the signed-in user. New rows default owner = auth.uid(), so the
-- client never has to send it; RLS below rejects any attempt to set it to
-- someone else.
alter table public.trips
  add column if not exists owner uuid references auth.users (id) on delete cascade default auth.uid();

create index if not exists trips_owner_idx on public.trips (owner);

-- Retire the prototype policies that let the anon key read and write everything.
drop policy if exists "anon select" on public.trips;
drop policy if exists "anon insert" on public.trips;
drop policy if exists "anon update" on public.trips;
drop policy if exists "anon delete" on public.trips;

-- Per-user policies: an authenticated user sees and edits only their own trips.
-- Anonymous (signed-out) requests match no policy and therefore see nothing —
-- signed-out visitors use localStorage, never this table.
create policy "owner select" on public.trips
  for select to authenticated using (owner = auth.uid());
create policy "owner insert" on public.trips
  for insert to authenticated with check (owner = auth.uid());
create policy "owner update" on public.trips
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "owner delete" on public.trips
  for delete to authenticated using (owner = auth.uid());
