# Wayfork — Status

> The only file to read when resuming. Conventions & commands: `CLAUDE.md`
> (repo root). Full history & shipped designs: `docs/CHANGELOG.md`.

## Current version: v1.1.0 — 236 tests green

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
**POI discovery (v1.0.0):** free-API strategy documented in
`docs/INTEGRATIONS.md` (keyless-first — client-side app means per-user IP
quotas); Discover panel beside the day map (`domain/poi.ts` Overpass QL with
mirror fallback + Wikipedia/Wikidata enrichment, `ui/DiscoverPanel.tsx`
category chips/radius/add-to-day → placed starter slot); day-map ⛶
fullscreen toggle (CSS overlay); owner-only Admin panel (`ui/AdminPanel.tsx`
+ `supabase/functions/admin-users` edge function gated on ADMIN_EMAIL —
list/disable/enable/revoke-invites/delete-with-trips).
**v1.0.1 + v1.1.0 (field feedback):** admin-function CORS preflight fixed
(apikey allow-listed, verify_jwt off — the handler self-gates); Overpass
hardened (narrow selectors, 12 s server+client timeouts, third mirror,
failure ≠ empty + Retry); explicit 🧭 Discover button (no auto-fetch);
desktop wide view (~92 %, default on, persisted, `wayfork.wideView`);
search circle + ⌖ center + POI pins drawn on the day map; "Start from"
anchor select — added places insert right after the anchor
(`insertSlotAfter`), connect with a real estimated leg (`estimateLeg`:
OSRM foot ≤2.5 km / driving beyond, haversine fallback, `estimated` flag),
and the anchor advances to each added slot.

## NEXT TASK — Transit micro-steps via Transitous (v1.2.0)

Per `docs/INTEGRATIONS.md`: a `domain/transit.ts` adapter for the Transitous
MOTIS 2 `plan` endpoint (`api.transitous.org`) that routes between two placed
slots and maps the returned legs (walk/metro/train/bus, times, polylines)
onto a new `VariantNode` with per-leg micro-steps; UI entry point on the
variant card / between consecutive placed slots. Honour their fair-use note
(user-initiated requests only, no prefetch). This also unlocks real transit
geometry on the day map (open item since v0.28).

## Open items (after v1.2.0)
- Component/UI test coverage for the big components (deferred from v0.28):
  `WayforkApp` store wiring, the sync poll, the `saveTrip` conflict →
  `mergeTrip` → retry path (stub `TripStore` throwing `TripConflictError`),
  the CRUD forms, and `TripView`. Harness pattern: `src/ui/*.test.tsx`.
- Admin panel: re-test live after the v1.0.1 CORS fix (magic-link sign-in
  as costinfl@gmail.com on the deployed site) — the sandbox can't do auth
  emails; the preflight fix is deployed (admin-users v2, verify_jwt off).
- Day map — tiles move to OpenFreeMap (keyless, unlimited) in v1.3.0 per
  `docs/INTEGRATIONS.md`.
- Day map — geometry is per-slot (a variant's segment routes into the slot's
  place). Per-micro-step waypoints (route through each leg's intermediate
  points) would be richer but needs a place per step, not per slot.
- Day map — the first located slot of a day is the map origin, so its own
  segment is degenerate (marker only); its ⌖ pans to the marker. A distinct
  day-origin point (e.g. the hotel, or the prior day's last place) would give
  it a real leg.
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
open items, and prepend the session's details to `docs/CHANGELOG.md` (newest
first) — never here.
