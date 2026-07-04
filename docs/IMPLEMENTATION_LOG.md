# Wayfork — Implementation Log

> Living handoff document. Update the status matrix and session history after
> every working session. Product spec:
> `Wayfork_Product_Specification_AI_Engineering_Blueprint.pdf` (in this folder).
> The original v0.1 log (pre-repo, PDF export) is `IMPLEMENTATION_LOG.pdf`.

## Resuming in a new session (read this first)

- **Repo:** `costinfl/wayfork`. **Work branch:** `claude/wayfork-setup-github-pages-3pgqfw`
  (also the default branch). Develop, commit, and push there. Live site:
  https://costinfl.github.io/wayfork/
- **To get oriented:** read this whole file (status matrix + session history),
  then `src/domain/types.ts` (the model) and `src/ui/WayforkApp.tsx` (wires
  everything). The original product spec is the PDF in this folder.
- **Commands:** `npm install`, `npm test` (Vitest, must stay green — CI runs it
  before deploy), `npm run build` (tsc + vite), `npm run preview` for a local
  server on :4173.
- **Deploy:** pushing to the work branch triggers `.github/workflows/deploy.yml`
  (test → build → publish `dist/` to the `gh-pages` branch → GitHub Pages). No
  manual step. The GitHub MCP tools observe runs (`actions_list` on
  `deploy.yml`); their output is large — slice via python if it exceeds limits.
- **Tagging:** direct tag pushes are blocked for the session token. Use the
  `tag-release.yml` workflow via `actions_run_trigger` (`run_workflow`, inputs
  `{tag, sha}`). Tag each shipped version `vX.Y.0` after CI is green.
- **Persistence:** all trip edits go through the `TripStore` interface
  (`src/data/repository.ts`). Live adapter is Supabase (`src/data/supabaseStore.ts`,
  config in `src/data/supabaseConfig.ts`, schema in `supabase/migrations/`),
  falling back to `localStorageStore` when unreachable. **Trips are per-user
  (v0.13):** signed in via email magic link (`src/data/supabaseAuth.ts`), the
  remote store carries the user's JWT so row-level security scopes trips to
  their account; signed out, the app runs on localStorage and never touches
  the remote table. On sign-in, trips created while signed out are offered for
  import into the account (v0.14, `migrateLocalTrips` + `MigrationBanner`).
- **Verification discipline:** every user-visible change is screenshot-verified
  with Playwright against `npm run preview` (chromium at
  `/opt/pw-browsers/chromium`). This sandbox blocks external APIs, so stub
  Supabase/Open-Meteo/Frankfurter routes when driving the browser.
- **Model conventions:** pure logic lives in `src/domain/` (framework-free,
  unit-tested); React in `src/ui/`; trip data as JSON in `src/data/trips/`
  registered in `src/data/index.ts`. Untrusted trip JSON is checked by
  `parse.ts` (structure) then `validate.ts` (semantics); mutations are pure
  functions in `mutate.ts`; every edit is re-validated before it is saved.
- **NEXT TASK:** component/UI tests (only the pure engines + data adapters are
  unit-tested; needs jsdom + @testing-library/react wired into Vitest). Auth
  (v0.13), local→account migration (v0.14), the public trip prompt + dinner
  pacing fix (v0.15), and background multi-device sync (v0.16) are all done.
  Possible follow-up: swap the sync poll for a Supabase Realtime WebSocket.

## Current state — v0.16

- Vite + React 19 + Tailwind CSS v4 + **TypeScript**, deployed to GitHub Pages
  (https://costinfl.github.io/wayfork/) via `.github/workflows/deploy.yml`
  (builds and pushes `dist/` to the `gh-pages` branch; CI runs unit tests first).
- Source layout:
  - `src/domain/` — framework-free types + pure engines (`time`, `currency`,
    `schedule`, `ledger`) with Vitest unit tests alongside (`*.test.ts`).
  - `src/data/trips/` — example trips as **JSON** (Rome, Lisbon, Neptun),
    registered in `src/data/index.ts`. New trips are AI-generated from the
    **public prompt contract** `docs/trip-prompt.md`, shown copy-ready in the
    app (`+ Add trip` → "Generate a trip with any AI", v0.15) and loaded via
    upload or paste, validated by `src/domain/parse.ts` (structural) +
    `src/domain/validate.ts` (semantic); valid uploads persist, invalid ones
    show the reasons.
  - `src/ui/` — React components (`WayforkApp`, `VariantCard`,
    `CheckpointBanner`, `Chip`, `theme`).
- Full CRUD (expenses v0.6, itinerary v0.7, trips/days/participants v0.8);
  edits persist through the `TripStore` repository boundary
  (`src/data/repository.ts`) to **Supabase** (`wayfork-db`, table
  `public.trips`, one jsonb document per trip — see `supabase/migrations/`),
  degrading to localStorage when the database is unreachable. The ledger
  footnote shows the active storage. **Per-user (v0.13):** email magic-link
  sign-in (`supabaseAuth.ts` + `AuthBar`) scopes trips to an account via
  row-level security; signed-out visitors stay on localStorage.
- Live ECB rates at load with built-in fallback (v0.5).

## Status matrix

### ✅ Implemented

| Spec section | Feature | Where |
| --- | --- | --- |
| Domain model | TRIP / DAY / ITINERARY_SLOT / VARIANT_NODE / MICRO_STEP / EXPENSE_ITEM as TS interfaces | `src/domain/types.ts` |
| A. Ripple engine | Day start editable; slot start = previous end; recalculates on any change | `src/domain/schedule.ts` |
| A. Variants | 2 slots with 2 variants each; toggle sets ACTIVE and ripples downstream | `activeVariants` state in `src/ui/WayforkApp.tsx` |
| A. Hard checkpoints | ok / amber / red states with computed margin | `computeSchedule` + `src/ui/CheckpointBanner.tsx` |
| B. Tri-currency | RON / EUR / USD UI-wide toggle; EUR-pivot matrix; client-side conversion | `src/domain/currency.ts` |
| C. Ledger | Pre/mid-trip phases; payer attribution; native input currency preserved | `src/data/mock.ts` expenses |
| C. Splits | `equal`, `percent`, `fixed` | `expenseShares` in `src/domain/ledger.ts` |
| C. Variant cost sync | Active variant costs → "Projected total" card | `variantCostEUR` in `WayforkApp` |
| C. Settlement | Net balances + greedy minimal-transaction list | `computeBalances`, `settle` |
| — | Unit tests for all pure engines (28 tests) | `src/domain/*.test.ts` |
| Auth | Email magic-link sign-in (hand-rolled GoTrue client); session persisted + auto-refreshed | `src/data/supabaseAuth.ts`, `src/ui/AuthBar.tsx` |
| Auth | Per-user trips: signed-in requests carry the user JWT; per-user RLS policies; signed-out → localStorage | `supabase/migrations/0002_auth_rls.sql`, `supabaseStore.ts` |
| Auth | Local→account migration: on sign-in, browser trips are offered for import (moved, skipping id collisions) | `migrateLocalTrips` (`repository.ts`), `src/ui/MigrationBanner.tsx` |
| Trip gen | Public AI prompt contract shown copy-ready in-app; real-data framing + full-day pacing rules | `docs/trip-prompt.md`, `src/ui/TripPromptCard.tsx` |
| Sync | Background multi-device sync: signed-in poll (visibility-aware) + signed-out cross-tab `storage` events; reconciled by `tripsEqual` | sync effect in `src/ui/WayforkApp.tsx`, `tripsEqual` (`repository.ts`) |

### 🟡 Partially implemented

- **Fixed-share splits**: engine supports and unit-tests `{type:'fixed'}`, and
  the Lisbon mock now exercises it in the UI — but there is still no UI to
  author splits.
- **Variant cost → balances**: variant costs appear in the *projection* only.
  Design decision: unpaid projected costs are NOT netted into settlement
  (they have no payer yet). Spec was ambiguous here — revisit.
- ~~Micro-step model: has `distanceKm` but distance is not rendered~~ —
  **done in v0.5** (shown on step chips).
- ~~Weather state~~ — **done in v0.10**: `Day.location` drives an Open-Meteo
  forecast per day (badge in the day header); variants are flagged for rain
  exposure by their outdoor (walking) minutes.
- ~~Multi-day: model supports `trip.days[]` but UI renders `days[0]` only~~ —
  **done in v0.3** (day tabs; per-day departure time; projection sums active
  variants across all days).

### ❌ Not implemented yet

- Realtime push sync (v0.16 sync is poll-based every 15s / on tab focus, not a
  Supabase Realtime WebSocket — near-real-time, not instant).
- Component/UI tests (only the pure engines + data adapters are tested; needs
  jsdom + @testing-library/react wired into Vitest).

## Key algorithms & decisions

1. **Time** = integer minutes since midnight. `fmtTime`/`fmtDur` for display.
2. **Ripple**: fold over slots; slot duration = Σ active variant micro-step
   durations; checkpoint `margin = checkpoint.time − slot.start`;
   status: `ok` if margin ≥ buffer, `amber` if 0 ≤ margin < buffer, `red` if late.
3. **Currency**: EUR-pivot matrix; `convert(a,from,to) = a / rate[from] *
   rate[to]`. Live ECB rates fetched once at app load (Frankfurter API,
   `src/domain/rates.ts`); the hardcoded `{EUR:1, RON:4.97, USD:1.08}`
   snapshot is the offline fallback. The ledger footnote shows which is active.
4. **Balances**: all expenses converted to EUR; payer credited full amount,
   every participant debited their share; greedy debtor↔creditor matching
   yields the minimal transaction list.
5. **Active variant** is UI state (`{slotId: variantId}`), not mutated into the
   data model — keeps mock data immutable and makes undo/URL-state trivial later.
6. **Timezones**: a micro-step may carry `tzShiftMin` (clock change during that
   step, e.g. a flight = -60). The ripple scheduler folds shifts into the
   wall-clock — a slot's `end = start + duration + slotShift`, so downstream
   times display in the arrival zone. `duration` stays real elapsed minutes;
   checkpoints compare against the slot's local `start`, so they remain correct
   on both sides of a crossing.

## Suggested next steps (priority order, simplest → complex)

1. ~~Scaffold real repo (IntelliJ): Vite + React + TS; split into `domain/`,
   `data/`, `ui/`~~ — **done in v0.2**.
2. ~~Unit-test `computeSchedule`, `expenseShares`, `settle`~~ — **done in v0.2**.
3. ~~CRUD forms: expenses (v0.6), slots/variants/steps (v0.7), days,
   participants & trip metadata (v0.8)~~ — **complete**; trips can now be
   created from scratch in the app.
4. ~~Persistence: localStorage adapter (v0.6); Supabase adapter (v0.9);
   Supabase Auth + per-user row-level security (v0.13); local→account trip
   migration (v0.14)~~ — **complete**. Next tier: realtime multi-device sync.
5. ~~ECB rate fetch (v0.5); weather (v0.10); timezones (v0.11); auth (v0.13)~~
   — done. Remaining: component/UI test harness (jsdom + testing-library).

## Session history

- **v0.1.0** (tag) — single-file prototype (`wayforkprototype1.jsx`) wrapped in
  a Vite + React + Tailwind repo; GitHub Pages deployment via `gh-pages` branch.
- **v0.2.0** — TypeScript conversion; split into `domain/` (pure engines),
  `data/`, `ui/`; 28 Vitest unit tests over schedule/ledger/currency/time
  engines; CI runs tests before deploying. UI behavior unchanged
  (screenshot-verified against v0.1).
- **v0.3.0** — mock-data pipeline: `docs/MOCK_TRIP_PROMPT.md` prompt template
  (inputs: destination + start/end date) for AI-generating new trips;
  `validateTrip` domain validator wired into the test suite; trip picker and
  day tabs in the UI (multi-day support); Lisbon 3-day / 3-participant trip
  added as the template's reference output (exercises fixed splits, USD
  expenses, zero-cost variants, 3-way settlement, per-day checkpoints).
- **v0.4.0** — in-app trip upload: trip data format unified on JSON (built-in
  trips converted; prompt template now emits JSON); `parseTrip` defensive
  runtime parser in front of `validateTrip`; `+ Add trip` UI (file upload +
  paste) with error reporting, localStorage persistence, and ✕ removal;
  50 tests. E2E-verified with a template-generated Vienna trip (valid upload,
  invalid rejection, reload persistence, removal). The contributed Neptun
  trip was integrated as the third built-in trip; its offset-style checkpoint
  times prompted a new validator rule (checkpoint before day start rejected).
- **v0.6.0** — expense CRUD + repository layer: async `TripStore` interface
  (`src/data/repository.ts`) as the persistence boundary for a future
  database/API, with `createLocalStorageStore` (validated reads, legacy-key
  migration) as the current adapter; edits to built-in trips are
  copy-on-write overrides ("(edited)" in the picker, ↺ resets); add/edit/
  delete expenses with split authoring (equal/percent/fixed) validated
  through `validateTrip` before saving; pure trip mutations in
  `src/domain/mutate.ts`; 66 tests.
- **v0.7.0** — itinerary CRUD: "Edit" mode on the timeline with add/edit/
  delete/reorder for slots (title + checkpoint editor), add/edit/delete for
  variants (name, cost, ordered micro-step editor with type/label/duration/
  distance). New slots ship with a starter variant so schema invariants hold.
  Pure mutations in `src/domain/mutate.ts` (slot/variant helpers incl.
  defaultVariantId fixup and last-variant guard); every change validated via
  `validateTrip` before persisting through the TripStore; 74 tests.
- **v0.8.0** — trip/day/participant CRUD completes roadmap item 3:
  "+ New trip" creates a valid trip from scratch (name, first day,
  participants, currencies); "⚙" trip settings edits name/currencies/
  participants; day tabs gain ✎/+/✕ in edit mode (dates kept sorted, date
  and persisted departure time editable); starterSlot/newTrip factories keep
  schema invariants intact; 79 tests.
- **v0.9.0** — Supabase persistence: `createSupabaseStore` implements
  `TripStore` over PostgREST (project `wayfork-db`, table `public.trips`,
  one validated jsonb document per trip; publishable key + permissive anon
  RLS policies, see `supabase/migrations/0001_trips.sql`). The app prefers
  the remote store at startup and degrades to localStorage when unreachable;
  storage source shown in the ledger footnote. 83 tests.
- **v0.10.0** — weather per day: added optional `Day.location`
  (name/lat/lon) to the model, parser, and validator; `fetchDayWeather`
  (`src/domain/weather.ts`) pulls a daily forecast from the free Open-Meteo
  API (no key), null on out-of-range dates or errors. Day header shows a
  forecast badge (amber when rain risk >= 40%); exposed variants (by walking
  minutes) are flagged "☔ outdoors — rain likely" so weather informs the
  fork choice. Locations added to all built-in trips; DayForm edits them;
  prompt template updated. 89 tests.
- **v0.11.0** — timezones: micro-steps carry an optional `tzShiftMin` (clock
  change during the step); the ripple scheduler applies it so all times after a
  flight display in the arrival zone (Rome day now reads 08:27→10:17 across the
  −1h hop, elapsed still 2h50m). Timeline shows a "clocks −1h" badge on the
  crossing and a local-offset badge on shifted slots; checkpoints stay in their
  local zone. `fmtOffset` helper; parser/validator accept the field; Rome
  (−60) and Lisbon (−120) flights annotated; prompt template documents it.
  93 tests.
- **v0.12.0** — opening-hours checkpoints: `Checkpoint.opensMin` (optional)
  turns a deadline into a window [opensMin, timeMin]. Scheduler computes a
  `waitMin` when you arrive before opening; the banner shows the window and a
  "you'd wait Nm" note; SlotForm gains an optional "Opens" input; parser and
  validator accept it (opensMin ≤ timeMin). Lisbon's Jerónimos slot is now a
  window (11:00–11:30). 97 tests. Closes the "checkpoint types" roadmap item.
- **v0.13.0** — auth: per-user trips. A hand-rolled GoTrue client
  (`src/data/supabaseAuth.ts`, library-free like the PostgREST adapter) does
  email magic-link sign-in — request a link (`/auth/v1/otp`), exchange the
  redirect-fragment tokens for a session, persist it, and auto-refresh the
  access JWT near expiry. `createSupabaseStore` gained a token provider so
  signed-in reads/writes send the user's JWT as the bearer; the anon key stays
  the API-gateway key. `AuthBar` (sign-in field / signed-in identity) sits atop
  `WayforkApp`, which now selects the store by auth state: per-user Supabase
  when signed in, localStorage when signed out (the remote table is never
  touched anonymously). Migration `0002_auth_rls.sql` adds an `owner uuid`
  column (default `auth.uid()`) and replaces the shared-sandbox anon policies
  with per-user `authenticated` RLS. 107 tests; signed-out and signed-in states
  screenshot-verified (JWT bearer confirmed on the REST call).
- **v0.14.0** — local→account trip migration. `migrateLocalTrips`
  (`src/data/repository.ts`) moves browser-stored trips into the signed-in
  user's account store, skipping any id already in the account (never
  overwrites the account copy) and removing the rest from localStorage so each
  trip lives in one place. On sign-in `WayforkApp` computes the trips still in
  the browser and, when any exist, shows `MigrationBanner` ("N trips saved in
  this browser — Import?"): Import runs the move and folds the results into the
  account list; "Not now" dismisses. 110 tests (move + collision-skip +
  no-op unit-tested); banner and the import round-trip screenshot-verified
  (POST to the account, localStorage cleared).
- **v0.15.0** — public trip-generation contract in-app + dinner-timing fix.
  The generator prompt is now `docs/trip-prompt.md`, reframed from "mock data"
  to a real-data contract (use real flights/stations/prices when the assistant
  can browse) and shown copy-ready in the app (`TripPromptCard`, imported
  `?raw` so the in-app prompt and repo doc never drift) under `+ Add trip`.
  **Dinner-at-noon investigation:** not a scheduler bug — slots chain
  back-to-back advancing the clock only by micro-step durations, so trips that
  don't model dwell/free time collapse into the morning and a "dinner" slot
  lands at midday (worst in the contributed Neptun trip: 12:30 & 13:35). Fixed
  at the content level: the contract now mandates realistic full-day pacing
  (model dwell/free time with `wait` steps; anchor meals to wall-clock windows;
  no "dinner" before 18:00), and the offending Neptun (×2) and Lisbon (×1)
  trips gained free-afternoon `wait` slots so dinners land ~18:30–19:00. No
  model/scheduler change. 110 tests; prompt card and fixed timeline
  screenshot-verified (Neptun dinner now 18:30–20:00).
- **v0.16.0** — background multi-device sync. A signed-in session keeps its
  trip list fresh without a manual reload: a visibility-aware poll of the
  account store every 15s (and immediately when the tab regains focus) pulls
  edits made on another device; signed-out, a `storage` event listener syncs
  changes across tabs in the same browser. Poll results are reconciled with
  `tripsEqual` (`repository.ts`) — an order- and key-order-independent compare
  (jsonb round-trips don't preserve key order) — so state (and re-renders) only
  change when the content actually did. A short post-write grace window
  (`markLocalWrite`) suppresses polls so an in-flight save's stale read can't
  momentarily revert an optimistic update. Deliberately poll-based, not a
  Supabase Realtime WebSocket, to stay library-free and testable. 113 tests;
  E2E-verified (a remote rename appears on a focus tick with no reload).
- **v0.5.0** — live ECB exchange rates via the Frankfurter API, fetched once
  at load with the built-in matrix as offline fallback (`src/domain/rates.ts`,
  unit-tested with a stubbed fetch); rates threaded through all conversions
  and `computeBalances`; ledger footnote shows the active source ("ECB <date>"
  vs "built-in snapshot"). Micro-step distances now render on step chips.
