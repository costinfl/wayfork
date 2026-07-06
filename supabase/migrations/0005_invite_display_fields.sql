-- Denormalize a little context onto the invite so the invitee's in-app inbox
-- can show "<inviter> invited you to <trip>" before they have access to the
-- trip row (RLS hides it until they accept). Run after 0004_trip_collaboration.sql.
alter table public.trip_invites
  add column if not exists trip_name text,
  add column if not exists invited_by_email text;
