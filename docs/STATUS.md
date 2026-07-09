# Wayfork — Status

> The only file to read when resuming. Conventions & commands: `CLAUDE.md`
> (repo root). Full history & shipped designs: `docs/CHANGELOG.md`.

## Current version: v0.28 — 207 tests green

Shipped: full domain model + ripple scheduler (timezone shifts, opening-hour
checkpoints, weather badges); tri-currency with live ECB rates + fallback;
ledger with equal/percent/fixed splits, projection, greedy settlement; full
CRUD (trips/days/participants/slots/variants/steps/expenses); Supabase
persistence with magic-link auth, per-user RLS, local→account migration,
poll-based multi-device sync (15s / on focus); collaboration Phases 1–6 (invite
editor/viewer, in-app inbox, co-edit, viewer read-only, roster + remove, leave;
trips keyed by surrogate `uid`, rows by `(owner, id)`; and an optimistic
concurrency guard — per-row `version` token, version-guarded saves, 3-way
re-merge on conflict). **Plan-a-trip wizard (v0.27):** a `PlanTripForm`
(starting point + ordered destinations via Open-Meteo place autocomplete,
start date + number of days, return-to-start toggle) builds a validated
**scaffold trip** (`domain/scaffold.ts`) plus a tailored, scaffold-bound AI
prompt (`domain/prompt.ts` + `docs/trip-prompt.md`); the paste/upload path
replaces a matching scaffold in place and flags any drift from it. New
`estimated` provenance flag on variants/expenses (muted badge + form checkbox).
**Day-journey map (v0.28):** Leaflet + OSM (first runtime dep, lazy-loaded)
beside the selected day's timeline — the active variant chain as a solid route
(OSRM road/foot geometry via `domain/route.ts`, straight-line fallback),
forked alternatives as dashed schematic arcs (`domain/geometry.ts`) that are
clickable to activate; a ⌖ button on each variant card focuses its segment.
Slots gained an optional `place` (built-in Rome/Lisbon/Neptun backfilled).

## NEXT TASK — Component/UI test coverage for the big components

The pure domain and store layers are well unit-tested; `PlanTripForm`,
`VariantCard`, and `DayMap` (wiring, Leaflet mocked) now have jsdom coverage
too, but the other large React components do not: `WayforkApp`
(store wiring, the sync poll, and the `saveTrip` conflict → `mergeTrip` → retry
path — browser-verified in v0.25 but not unit-tested), the CRUD forms, and
`TripView`. The harness already exists (jsdom + @testing-library, opt-in per
file via a `/** @vitest-environment jsdom */` docblock + `src/test/setup-dom.ts`;
see `src/ui/*.test.tsx` for the pattern). Add coverage for the conflict/merge
wiring first (inject a stub `TripStore` that throws `TripConflictError`), then
the forms and `TripView`.

## Open items (after the test-coverage task)
- Day map — no real transit geometry: metro/train/tram (and same-endpoint
  forks) draw schematic arcs, because no free worldwide transit-routing API
  exists. Transitous (transitous.org) is the candidate for real rail/transit
  shapes — future work.
- Day map — geometry is per-slot (a variant's segment routes into the slot's
  place). Per-micro-step waypoints (route through each leg's intermediate
  points) would be richer but needs a place per step, not per slot.
- Day map — the first located slot of a day is the map origin, so its own
  segment is degenerate (marker only); its ⌖ pans to the marker. A distinct
  day-origin point (e.g. the hotel, or the prior day's last place) would give
  it a real leg.
- Day map — OSRM public demo server + OSM tiles are courtesy services with no
  SLA; before any real traffic, self-host/route through a keyed provider and
  honour the OSM tile usage policy.
- Scaffold replace is automatic: pasting a trip whose id matches an existing
  scaffold overwrites that row in place and surfaces day/date/location drift as
  a warning list — but there is no explicit "Replace scaffold" confirmation step
  before it happens (the Step-4 cut). Add a confirm gate if in-place overwrite
  ever feels too eager.
- Place names carry their disambiguation (e.g. "Rome, Lazio, Italy"), so scaffold
  trip names and travel-slot titles read verbosely ("Bucharest, Romania → Rome,
  Lazio, Italy"). Fine per spec (coords are user-selected truth) but a shorter
  display label could be split out later.
- No UI to author `fixed` splits (engine + one mock exercise them).
- Variant costs are projection-only, not netted into settlement (deliberate —
  no payer yet; spec ambiguous, revisit).
- Optional: swap the sync poll for Supabase Realtime WebSocket (would make the
  concurrency guard's re-merge fire near-instantly instead of after the 15s poll).
- Invites are in-app only: `createInvite` inserts a `trip_invites` row that the
  recipient sees in the inbox after signing in with that email — no email is
  ever sent (the only email the app sends is the magic-link sign-in). Delivering
  invites by email would need a Supabase Edge Function (or trigger→SMTP) on
  invite insert, plus a sending domain — not verifiable in this sandbox.
- Future feature: trip export/share as PDF (own workstream — POI photos, map
  thumbnails, render pipeline).

## Update rule
After each session: bump the version line, rewrite NEXT TASK, prune finished
open items, and append the session's details to `docs/CHANGELOG.md` — never
here.
