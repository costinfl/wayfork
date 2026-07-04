# Trip generation contract

Wayfork trips are plain JSON. Rather than hand-authoring them, you generate one
with any AI assistant using a fixed **prompt contract** — and an assistant with
web/API access can fill it with *real* flights, stations, opening hours and
prices, not mock data.

**The canonical prompt lives in [`trip-prompt.md`](./trip-prompt.md)** and is
also shown, copy-ready, **inside the app** (open **+ Add trip** → "Generate a
trip with any AI"). That in-app copy is the public contract; this file is the
how-to around it.

## How to use it

1. Copy the prompt (from the app, or `docs/trip-prompt.md`).
2. Replace the three placeholders at the top: `{DESTINATION}`, `{START_DATE}`,
   `{END_DATE}`.
3. Run it in any capable AI assistant. Ask it to use real data if it can browse
   or call travel APIs.
4. Paste the returned JSON into **+ Add trip** (or upload it as a `.json` file).
   The app validates it in the browser (`src/domain/parse.ts` structural +
   `src/domain/validate.ts` semantic): valid → it joins the trip picker and is
   remembered (in your account when signed in, else this browser); invalid →
   you get the list of problems. Uploaded trips are removable with ✕.

## Committing one as a built-in example (optional)

Save it as `src/data/trips/<destination>.json` and register it in the `TRIPS`
array in `src/data/index.ts`. `npm test` validates every registered trip
against the same invariants. A reference output produced with this contract
lives at `src/data/trips/lisbon.json`.

## Note on pacing

The scheduler chains slots back-to-back (each starts when the previous ends),
advancing the clock only by micro-step durations. The contract therefore
requires modelling dwell/free time with `wait` steps and anchoring meals to
real wall-clock windows — otherwise a day collapses into the morning and a
"dinner" slot lands at noon. See the "Realistic full-day pacing" section of the
prompt.
