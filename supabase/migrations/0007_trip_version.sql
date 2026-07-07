-- Concurrency guard (Phase 6): an optimistic-concurrency token on public.trips.
-- Saves used to be blind last-write-wins upserts, so two co-editors of a shared
-- trip could silently clobber each other. `version` is a monotonic counter the
-- client reads on load and echoes back on write (PATCH … where version = expected);
-- a stale save matches no row and is rejected so the client can re-merge. Run in
-- the wayfork-db SQL Editor after 0006_member_roster.sql.

alter table public.trips add column if not exists version integer not null default 0;

-- The version is bumped server-side alongside updated_at so the client can never
-- forge it. The trips_set_updated_at trigger (0001) already runs this function
-- BEFORE UPDATE; redefining it adds the increment. INSERTs keep the default 0.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;
