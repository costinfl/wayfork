# Wayfork — Status

> The only file to read when resuming. Conventions & commands: `CLAUDE.md`
> (repo root). Full history & shipped designs: `docs/CHANGELOG.md`.

## Current version: v0.25 — 156 tests green

Shipped: full domain model + ripple scheduler (timezone shifts, opening-hour
checkpoints, weather badges); tri-currency with live ECB rates + fallback;
ledger with equal/percent/fixed splits, projection, greedy settlement; full
CRUD (trips/days/participants/slots/variants/steps/expenses); AI trip-generation
prompt contract (`docs/trip-prompt.md`, shown in-app); Supabase persistence with
magic-link auth, per-user RLS, local→account migration, poll-based multi-device
sync (15s / on focus); collaboration Phases 1–6 (invite editor/viewer, in-app
inbox, co-edit, viewer read-only, roster + remove, leave; trips keyed by
surrogate `uid`, rows by `(owner, id)`; and an optimistic concurrency guard —
per-row `version` token, version-guarded saves, 3-way re-merge on conflict).

## NEXT TASK — Component/UI test coverage for the big components

The pure domain and store layers are well unit-tested, but the large React
components are not: `WayforkApp` (store wiring, the sync poll, and the new
`saveTrip` conflict → `mergeTrip` → retry path — browser-verified in v0.25 but
not unit-tested), the CRUD forms, and `TripView`. The harness already exists
(jsdom + @testing-library, opt-in per file via a `/** @vitest-environment jsdom
*/` docblock + `src/test/setup-dom.ts`; see `src/ui/*.test.tsx` for the pattern).
Add coverage for the conflict/merge wiring first (inject a stub `TripStore` that
throws `TripConflictError`), then the forms and `TripView`.

## Open items (after the test-coverage task)
- No UI to author `fixed` splits (engine + one mock exercise them).
- Variant costs are projection-only, not netted into settlement (deliberate —
  no payer yet; spec ambiguous, revisit).
- Optional: swap the sync poll for Supabase Realtime WebSocket (would make the
  concurrency guard's re-merge fire near-instantly instead of after the 15s poll).
- Future feature: trip export/share as PDF (own workstream — POI photos, map
  thumbnails, render pipeline).

## Update rule
After each session: bump the version line, rewrite NEXT TASK, prune finished
open items, and append the session's details to `docs/CHANGELOG.md` — never
here.
