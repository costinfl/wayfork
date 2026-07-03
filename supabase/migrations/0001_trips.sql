-- Wayfork trips table: one jsonb document per trip, matching the TripStore
-- granularity (src/data/repository.ts). Run this in the Supabase SQL Editor
-- of the wayfork-db project (or via supabase db push).

create table if not exists public.trips (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint trips_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint trips_data_size check (pg_column_size(data) < 262144)
);

alter table public.trips enable row level security;

-- Prototype policies: the app has no auth yet, so the publishable key may
-- read and write all trips (a shared testing sandbox). Tighten these to
-- per-user policies when Supabase Auth lands.
create policy "anon select" on public.trips
  for select to anon using (true);
create policy "anon insert" on public.trips
  for insert to anon with check (true);
create policy "anon update" on public.trips
  for update to anon using (true) with check (true);
create policy "anon delete" on public.trips
  for delete to anon using (true);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();
