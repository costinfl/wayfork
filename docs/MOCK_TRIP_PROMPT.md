# Mock trip generator — prompt template

Use this template to have any AI assistant generate a new mock trip for Wayfork.
Fill in the three placeholders at the top of the prompt, paste the whole prompt,
and you get back a JSON document ready to load into the app.

**Using the result — primary path (no code changes):**

Open the live app, click **+ Add trip** (top right), then either paste the JSON
into the text box or upload it as a `.json` file. The app validates it in the
browser: if it is valid it appears in the trip picker (and is remembered in
your browser); otherwise you get the list of problems. Uploaded trips can be
removed again with the ✕ button.

**Using the result — committing it to the repo:**

Save it as `src/data/trips/<destination>.json` and register it in the `TRIPS`
array in `src/data/index.ts`. Run `npm test` — the suite validates every
registered trip against the same invariants (`src/domain/parse.ts` +
`src/domain/validate.ts`).

A reference output produced with this template lives at
`src/data/trips/lisbon.json` (inputs: Lisbon, 2026-09-10 → 2026-09-12).

---

## The prompt

Copy everything below, replacing `{DESTINATION}`, `{START_DATE}` and `{END_DATE}`.

````text
You are generating mock data for Wayfork, a multi-variant travel planner and
shared expense engine. Produce ONE JSON document and nothing else — no
commentary before or after it, no markdown code fences, no comments inside
(JSON does not allow them). It must parse with JSON.parse.

## Inputs

- Destination: {DESTINATION}
- Trip start date: {START_DATE}   (ISO, e.g. 2026-09-10; this is the outbound travel day)
- Trip end date: {END_DATE}       (ISO; inclusive — generate one Day per calendar date)

Everything else (participants, itinerary, variants, costs, expenses) you invent:
realistic, specific to the destination (real stations, tram lines, landmarks,
plausible durations and prices), departing from Bucharest, Romania.

## The schema (TypeScript notation; your output is the JSON form of `Trip`)

```ts
type StepType = "walk" | "metro" | "bus" | "train" | "car" | "shuttle"
              | "flight" | "wait" | "transfer";

interface MicroStep {
  id: string;
  type: StepType;
  label: string;
  durationMin: number;        // positive integer
  distanceKm: number | null;  // only for walk/car/train legs where it makes sense
}

interface VariantNode {
  id: string;
  name: string;                // e.g. "Public transit", "Taxi (flat rate)"
  microSteps: MicroStep[];     // ordered; durations sum to the variant duration
  cost: { amount: number; currency: string }; // estimated; 0 renders as "—"
}

interface ItinerarySlot {
  id: string;
  title: string;               // e.g. "Hotel → Otopeni Airport"
  variants: VariantNode[];     // >= 1; the UI forks when there are 2+
  defaultVariantId: string;    // must be one of the variants' ids
  checkpoint: { label: string; timeMin: number; bufferMin: number } | null;
}

interface Day {
  id: string;
  date: string;                // ISO date; strictly increasing across days
  startTimeMin: number;        // minutes since midnight, integer in [0, 1440)
  slots: ItinerarySlot[];
}

type SplitDef =
  | { type: "equal" }
  | { type: "percent"; shares: Record<string, number> } // fractions summing to 1
  | { type: "fixed"; shares: Record<string, number> };  // amounts summing to the expense amount

interface ExpenseItem {
  id: string;
  phase: "pre-trip" | "mid-trip";
  label: string;
  payerId: string;             // a participant id
  amount: number;              // > 0, in the native currency it was paid in
  currency: string;
  split: SplitDef;
}

interface Trip {
  id: string;                  // e.g. "trip-lisbon-0926"
  name: string;                // e.g. "Lisbon · Sep 2026"
  participants: { id: string; name: string }[];
  currencies: { home: string; local: string; intl: string };
  days: Day[];
  expenses: ExpenseItem[];
}
```

Every field shown is required. Use `null` (not omission) for absent
`checkpoint` and `distanceKm`.

## Hard invariants (machine-checked — the file is rejected if violated)

1. Every id in the file is unique. Prefix all ids with a short destination
   slug (e.g. "lx-") so trips never collide with each other.
2. `defaultVariantId` exists among that slot's variants.
3. Every variant has >= 1 micro-step; every `durationMin` is a positive integer.
4. `startTimeMin` is an integer in [0, 1440); day dates are strictly increasing,
   one Day per calendar date from start to end inclusive.
5. ONLY these currency codes anywhere: "RON", "EUR", "USD" (the app's cached
   rate matrix). Set currencies to { "home": "RON", "local": <the destination's
   currency if it is EUR or USD, otherwise "EUR">, "intl": "USD" }.
6. Percent shares sum to 1; fixed shares sum to the expense amount; all share
   keys and payerId are participant ids.
7. Variant costs are >= 0; expense amounts are > 0.

## Content requirements (so every UI path gets exercised)

- 2–4 participants with Romanian first names.
- Day 1 is the outbound travel day (hotel → Otopeni airport → flight →
  arrival transfer); the last day or the day before includes some return or
  farewell element. Middle days are sightseeing/day-trip days.
- 3–5 slots per day.
- At least HALF of all slots must have exactly 2 variants (a fork: e.g. public
  transit vs taxi, walk vs bus, bus vs hike); the rest single-variant.
- At least one variant with cost 0 (e.g. walking) so the "—" cost renders.
- At least one checkpoint per day on a plausible slot (flight boarding, timed
  museum entry, train departure), with `bufferMin` 10–30. Tune the preceding
  durations so the DEFAULT variants leave a comfortable margin (status ok),
  but switching to the slower variant of an earlier fork can push it into
  amber or red — that is the demo's point.
- Micro-steps: 1–4 per variant, concrete labels ("Metro M2 → Pipera",
  "Tram 28 → Alfama"), and across the whole trip use at least 7 of the 9
  step types.
- 5–8 expenses total: at least 2 pre-trip (flights, accommodation) and
  3 mid-trip; at least one "equal", one "percent", and one "fixed" split;
  at least 3 different payers (if 3+ participants) and at least 2 different
  currencies, with amounts plausible for the destination.
- Flights and prepaid entry tickets get variant cost 0 — their money belongs
  in the pre-trip ledger as expenses instead.

## Style reference (excerpt of a valid document)

```json
{
  "id": "lx-slot-otp",
  "title": "Hotel → Otopeni Airport",
  "defaultVariantId": "lx-v-otp-public",
  "checkpoint": null,
  "variants": [
    {
      "id": "lx-v-otp-public",
      "name": "Public transit",
      "microSteps": [
        { "id": "lx-otp-pub-1", "type": "walk", "label": "Walk to Piața Romană", "durationMin": 8, "distanceKm": 0.6 },
        { "id": "lx-otp-pub-2", "type": "metro", "label": "Metro M2 → Pipera", "durationMin": 26, "distanceKm": null }
      ],
      "cost": { "amount": 36, "currency": "RON" }
    }
  ]
}
```

Now generate the complete JSON document for the inputs above.
````
