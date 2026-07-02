# Wayfork — Implementation Log

> Living handoff document. Update the status matrix and session history after
> every working session. Product spec:
> `Wayfork_Product_Specification_AI_Engineering_Blueprint.pdf` (in this folder).
> The original v0.1 log (pre-repo, PDF export) is `IMPLEMENTATION_LOG.pdf`.

## Current state — v0.2

- Vite + React 19 + Tailwind CSS v4 + **TypeScript**, deployed to GitHub Pages
  (https://costinfl.github.io/wayfork/) via `.github/workflows/deploy.yml`
  (builds and pushes `dist/` to the `gh-pages` branch; CI runs unit tests first).
- Source layout:
  - `src/domain/` — framework-free types + pure engines (`time`, `currency`,
    `schedule`, `ledger`) with Vitest unit tests alongside (`*.test.ts`).
  - `src/data/mock.ts` — the Rome mock trip (typed literal, stable ids).
  - `src/ui/` — React components (`WayforkApp`, `VariantCard`,
    `CheckpointBanner`, `Chip`, `theme`).
- Still in-memory only: no persistence, no CRUD, no live rates.

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

- **Fixed-share splits**: engine supports and now unit-tests `{type:'fixed'}`,
  but no mock expense exercises it and there is no UI to author splits.
- **Variant cost → balances**: variant costs appear in the *projection* only.
  Design decision: unpaid projected costs are NOT netted into settlement
  (they have no payer yet). Spec was ambiguous here — revisit.
- **Micro-step model**: has `distanceKm` but distance is not rendered.
- **Weather state on VariantNode**: field exists in spec, omitted from the
  domain types to stay lean. Add `weather` to `VariantNode` next.
- **Multi-day**: model supports `trip.days[]` but UI renders `days[0]` only.

### ❌ Not implemented yet

- CRUD: adding/editing trips, slots, variants, steps, expenses (all data is mock).
- Persistence (localStorage adapter behind a repository interface, then API).
- Live ECB rate fetch (rates are a hardcoded EUR-pivot constant).
- Timezones (OTP→FCO day is computed in one clock; real flight crosses TZ).
- Auth / multi-user sync / sharing.
- Checkpoint types other than time (e.g., opening hours).
- Component/UI tests (only the pure engines are tested).

## Key algorithms & decisions

1. **Time** = integer minutes since midnight. `fmtTime`/`fmtDur` for display.
2. **Ripple**: fold over slots; slot duration = Σ active variant micro-step
   durations; checkpoint `margin = checkpoint.time − slot.start`;
   status: `ok` if margin ≥ buffer, `amber` if 0 ≤ margin < buffer, `red` if late.
3. **Currency**: EUR-pivot matrix `{EUR:1, RON:4.97, USD:1.08}`;
   `convert(a,from,to) = a / rate[from] * rate[to]`. Fetch once at init in prod.
4. **Balances**: all expenses converted to EUR; payer credited full amount,
   every participant debited their share; greedy debtor↔creditor matching
   yields the minimal transaction list.
5. **Active variant** is UI state (`{slotId: variantId}`), not mutated into the
   data model — keeps mock data immutable and makes undo/URL-state trivial later.

## Suggested next steps (priority order, simplest → complex)

1. ~~Scaffold real repo (IntelliJ): Vite + React + TS; split into `domain/`,
   `data/`, `ui/`~~ — **done in v0.2**.
2. ~~Unit-test `computeSchedule`, `expenseShares`, `settle`~~ — **done in v0.2**.
3. CRUD forms + state management (Context or Zustand): start with expenses
   (add/edit/delete), then variants/steps.
4. Persistence: localStorage adapter behind a repository interface, then API.
5. ECB rate fetch with cached fallback; then weather per variant; then timezones.

## Session history

- **v0.1.0** (tag) — single-file prototype (`wayforkprototype1.jsx`) wrapped in
  a Vite + React + Tailwind repo; GitHub Pages deployment via `gh-pages` branch.
- **v0.2.0** — TypeScript conversion; split into `domain/` (pure engines),
  `data/`, `ui/`; 28 Vitest unit tests over schedule/ledger/currency/time
  engines; CI runs tests before deploying. UI behavior unchanged
  (screenshot-verified against v0.1).
