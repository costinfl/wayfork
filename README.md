# Wayfork

Multi-variant travel planner & shared expense engine — prototype v0.1 (formerly "Vario").

The app lets a group plan a travel day as a timeline of slots, where each slot can hold
alternative route **variants** (public transit vs. taxi, etc.). Switching a variant or the
departure time ripples through every downstream slot and re-checks hard checkpoints
(e.g. boarding time). A shared ledger tracks multi-currency expenses, net balances, and a
minimal settle-up transaction list.

This first iteration is in-memory only (no persistence, no backend). See `docs/` for the
product specification and the implementation log of this iteration.

## Live demo

Deployed via GitHub Pages: **https://costinfl.github.io/wayfork/**

Deployment runs automatically from `.github/workflows/deploy.yml` on every push to the
main branch: it builds the app and publishes `dist/` to the `gh-pages` branch, which
GitHub Pages serves (*Settings → Pages → Source: Deploy from a branch, `gh-pages`*).

## Tech stack

- [Vite](https://vite.dev/) + [React 19](https://react.dev/) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/) (via the `@tailwindcss/vite` plugin)
- [Vitest](https://vitest.dev/) for unit tests
- [Supabase](https://supabase.com/) (`wayfork-db` project) for shared trip
  storage behind the `TripStore` repository interface, with localStorage as
  the offline fallback — schema in `supabase/migrations/`

## Getting started

```bash
npm install
npm run dev      # local dev server with hot reload
npm test         # unit tests (Vitest)
npm run build    # typecheck + production build → dist/
npm run preview  # serve the production build locally
```

Requires Node.js 20+.

## Opening in IntelliJ

Open the repository folder directly (*File → Open…*). IntelliJ IDEA Ultimate (or WebStorm)
detects the `package.json` and offers to install dependencies; the `dev`, `build`, and
`preview` scripts appear as run configurations in the npm tool window. The `.idea/` folder
is git-ignored.

## Project layout

```
src/
  main.tsx         entry point, mounts the app
  index.css        Tailwind entry
  domain/          framework-free types + pure engines (schedule, ledger,
                   currency, time, parse, validate) with unit tests alongside
  data/trips/      mock trips as JSON (Rome, Lisbon); register in data/index.ts
  ui/              React components (WayforkApp, VariantCard, …)
docs/              product spec (PDF), living implementation log, and
                   MOCK_TRIP_PROMPT.md — a prompt template for generating
                   new mock trips with any AI assistant
.github/workflows/ GitHub Pages deployment + tag-release
```

## Generating more mock data

`docs/MOCK_TRIP_PROMPT.md` is a fill-in prompt template (destination, start
date, end date) that any AI assistant can use to generate a new, schema-valid
mock trip as JSON. To test it, open the live app, click **+ Add trip**, and
paste the JSON (or upload it as a `.json` file): it is validated in the
browser — valid trips join the picker and are remembered in localStorage,
invalid ones get a list of reasons. To ship a trip permanently, commit it
under `src/data/trips/` and register it in `src/data/index.ts`; `npm test`
validates every registered trip against the same invariants.
