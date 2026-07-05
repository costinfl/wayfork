-- Make trip identity per-user. Until now public.trips had a global
-- `id text primary key`, so two accounts editing the same logical id (e.g. a
-- built-in trip override) would collide on the primary key and the second
-- account's upsert would hit the first's row — blocked by RLS. The identity is
-- now (owner, id): each account has its own namespace of trip ids.
--
-- Prerequisite: no rows with a null owner (pre-auth sandbox rows were removed
-- when auth landed). Run in the wayfork-db SQL Editor after 0002_auth_rls.sql.

alter table public.trips alter column owner set not null;

alter table public.trips drop constraint trips_pkey;
alter table public.trips add constraint trips_pkey primary key (owner, id);

-- The standalone owner index is redundant now: the composite primary key's
-- leading column already serves owner-scoped lookups.
drop index if exists public.trips_owner_idx;
