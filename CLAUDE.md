# Wayfork

Multi-variant travel planner: itineraries fork into alternative variants; a
ripple scheduler, tri-currency layer, and a shared-expense ledger recalculate
on every change. Vite + React 19 + Tailwind v4 + TypeScript, Supabase backend.

**Read `docs/STATUS.md` for the current version and NEXT TASK. Do not read
`docs/CHANGELOG.md` or the product-spec PDF unless debugging a regression.**

## Repo & deploy
- Repo `costinfl/wayfork`; work + default branch: `claude/wayfork-setup-github-pages-3pgqfw`.
- Live: https://costinfl.github.io/wayfork/
- Push to the work branch → `.github/workflows/deploy.yml` (test → build →
  publish `dist/` to `gh-pages`). No manual deploy step.
- Tagging: direct tag pushes are blocked for the session token. Trigger the
  `tag-release.yml` workflow (`run_workflow`, inputs `{tag, sha}`) after CI is
  green. Tag shipped versions `vX.Y.0`.

## Commands
- `npm install` · `npm test` (Vitest, must stay green) · `npm run build`
  (tsc + vite) · `npm run preview` (:4173)

## Architecture conventions
- Pure logic in `src/domain/` — framework-free, unit-tested (`*.test.ts`).
  React in `src/ui/`. Trip JSON in `src/data/trips/`, registered in
  `src/data/index.ts`.
- All persistence goes through the `TripStore` interface
  (`src/data/repository.ts`). Live adapter: Supabase
  (`supabaseStore.ts` / `supabaseAuth.ts`, schema in `supabase/migrations/`);
  falls back to localStorage when unreachable or signed out.
- Untrusted trip JSON: `parse.ts` (structure) → `validate.ts` (semantics).
  Mutations are pure functions in `mutate.ts`; re-validate before every save.
- Time = integer minutes since midnight; currency = EUR-pivot conversion;
  active variant is UI state, never mutated into trip data.

## Verification
- UI-touching changes: screenshot-verify with Playwright against
  `npm run preview` (chromium at `/opt/pw-browsers/chromium`) — **once, at the
  end of the task**, not after every edit. Non-UI changes: `npm test` suffices.
- The sandbox blocks external APIs — stub Supabase / Open-Meteo / Frankfurter
  routes when driving the browser.

## Token discipline (applies to subagents too)
- Read files lazily: only what the current task touches. Never front-load
  `WayforkApp.tsx`, the spec PDF, or `docs/CHANGELOG.md` for orientation.
- Do not spawn subagents for tasks touching fewer than ~3 files. A subagent
  reads only its task's files and does not re-verify sibling agents' work;
  verification happens once, by the main session, at the end.
- GitHub MCP output (`actions_list` etc.) is large — slice it via python
  instead of loading it whole.

## After every session
Update `docs/STATUS.md` (version + NEXT TASK) and append one entry to
`docs/CHANGELOG.md`. Keep this file (CLAUDE.md) stable — edit it only when a
convention actually changes, so prompt caching keeps working.
