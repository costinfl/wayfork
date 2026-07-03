# Wayfork — Implementation Log

> Living handoff document. Update the status matrix and session history after
> every working session. Product spec:
> `Wayfork_Product_Specification_AI_Engineering_Blueprint.pdf` (in this folder).
> The original v0.1 log (pre-repo, PDF export) is `IMPLEMENTATION_LOG.pdf`.

## Current state — v0.7

- Vite + React 19 + Tailwind CSS v4 + **TypeScript**, deployed to GitHub Pages
  (https://costinfl.github.io/wayfork/) via `.github/workflows/deploy.yml`
  (builds and pushes `dist/` to the `gh-pages` branch; CI runs unit tests first).
- Source layout:
  - `src/domain/` — framework-free types + pure engines (`time`, `currency`,
    `schedule`, `ledger`) with Vitest unit tests alongside (`*.test.ts`).
  - `src/data/trips/` — mock trips as **JSON** (Rome 1-day, Lisbon 3-day),
    registered in `src/data/index.ts`. New trips are AI-generated via
    `docs/MOCK_TRIP_PROMPT.md` (JSON output) and can be loaded **in the app**
    (`+ Add trip`: file upload or paste), validated by
    `src/domain/parse.ts` (structural) + `src/domain/validate.ts` (semantic);
    valid uploads persist in localStorage, invalid ones show the reasons.
  - `src/ui/` — React components (`WayforkApp`, `VariantCard`,
    `CheckpointBanner`, `Chip`, `theme`).
- CRUD for expenses (v0.6) and slots/variants/steps (v0.7); all edits persist
  to localStorage through the `TripStore` repository boundary
  (`src/data/repository.ts`) — swap the adapter for an API/database later.
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

### 🟡 Partially implemented

- **Fixed-share splits**: engine supports and unit-tests `{type:'fixed'}`, and
  the Lisbon mock now exercises it in the UI — but there is still no UI to
  author splits.
- **Variant cost → balances**: variant costs appear in the *projection* only.
  Design decision: unpaid projected costs are NOT netted into settlement
  (they have no payer yet). Spec was ambiguous here — revisit.
- ~~Micro-step model: has `distanceKm` but distance is not rendered~~ —
  **done in v0.5** (shown on step chips).
- **Weather state on VariantNode**: field exists in spec, omitted from the
  domain types to stay lean. Add `weather` to `VariantNode` next.
- ~~Multi-day: model supports `trip.days[]` but UI renders `days[0]` only~~ —
  **done in v0.3** (day tabs; per-day departure time; projection sums active
  variants across all days).

### ❌ Not implemented yet

- CRUD for days, participants, and trip metadata (expenses done in v0.6;
  slots/variants/steps done in v0.7).
- API/database-backed TripStore adapter (the interface exists as of v0.6;
  localStorage is the only implementation).
- Timezones (OTP→FCO day is computed in one clock; real flight crosses TZ).
- Auth / multi-user sync / sharing.
- Checkpoint types other than time (e.g., opening hours).
- Component/UI tests (only the pure engines are tested).

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

## Suggested next steps (priority order, simplest → complex)

1. ~~Scaffold real repo (IntelliJ): Vite + React + TS; split into `domain/`,
   `data/`, `ui/`~~ — **done in v0.2**.
2. ~~Unit-test `computeSchedule`, `expenseShares`, `settle`~~ — **done in v0.2**.
3. CRUD forms: ~~expenses~~ (**v0.6**), ~~slots/variants/steps~~ (**v0.7**),
   then days, participants & trip metadata (name, dates, currencies).
4. ~~Persistence: localStorage adapter behind a repository interface~~
   (**done in v0.6**) — next: API/database adapter implementing `TripStore`.
5. ~~ECB rate fetch with cached fallback~~ (**done in v0.5**); then weather
   per variant; then timezones.

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
- **v0.5.0** — live ECB exchange rates via the Frankfurter API, fetched once
  at load with the built-in matrix as offline fallback (`src/domain/rates.ts`,
  unit-tested with a stubbed fetch); rates threaded through all conversions
  and `computeBalances`; ledger footnote shows the active source ("ECB <date>"
  vs "built-in snapshot"). Micro-step distances now render on step chips.
