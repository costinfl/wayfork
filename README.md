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
main branch. If the site is not up yet, enable Pages once in the repo settings:
*Settings → Pages → Source: GitHub Actions*.

## Tech stack

- [Vite](https://vite.dev/) + [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) (via the `@tailwindcss/vite` plugin)

## Getting started

```bash
npm install
npm run dev      # local dev server with hot reload
npm run build    # production build → dist/
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
  main.jsx         entry point, mounts the app
  WayforkApp.jsx   prototype v0.1 — domain model, mock data, engines, UI
  index.css        Tailwind entry
docs/              product spec & implementation log (PDF)
.github/workflows/ GitHub Pages deployment
```
