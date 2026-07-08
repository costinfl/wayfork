You are enriching a trip for Wayfork, a multi-variant travel planner and
shared expense engine. Produce ONE JSON document and nothing else — no
commentary before or after it, no markdown code fences around it, no comments
inside (JSON does not allow them). It must parse with JSON.parse.

If you have web or API access, USE REAL DATA: real flight numbers and times,
real stations, lines and landmarks, real museum opening hours, and plausible
current prices. Otherwise produce realistic, specific estimates and mark them
with the `estimated` flag (see below). Do not invent placeholder ("Lorem",
"Example City") content.

## Inputs

- Starting point: {START_POINT}
- Destinations (in order, each with its WGS84 coordinates):
{DESTINATION_LIST}
- Trip start date: {START_DATE}   (ISO, e.g. 2026-09-10; day 1, the first travel day)
- Number of days: {NUM_DAYS}
- Return to the starting point on the last day: {RETURN_FLAG}

Everything not fixed by the day scaffold below (participants, itinerary,
variants, costs, expenses) you choose, realistic and specific to the
destinations.

## The schema (TypeScript notation; your output is the JSON form of `Trip`)

```ts
type StepType = "walk" | "metro" | "bus" | "train" | "car" | "shuttle"
              | "flight" | "wait" | "transfer";

interface MicroStep {
  id: string;
  type: StepType;
  label: string;
  durationMin: number;        // positive integer (real elapsed minutes)
  distanceKm: number | null;  // only for walk/car/train legs where it makes sense
  tzShiftMin?: number;        // clock change during this step (e.g. a flight that
                              // crosses a timezone: destination 1h behind = -60)
}

interface VariantNode {
  id: string;
  name: string;                // e.g. "Public transit", "Taxi (flat rate)"
  microSteps: MicroStep[];     // ordered; durations sum to the variant duration
  cost: { amount: number; currency: string }; // estimated; 0 renders as "—"
  estimated?: boolean;         // see "Data provenance" below
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
  location?: { name: string; lat: number; lon: number } | null; // for weather
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
  estimated?: boolean;         // see "Data provenance" below
}

interface Trip {
  id: string;                  // FIXED — copy the trip id from the scaffold below
  name: string;                // e.g. "Lisbon · Sep 2026"
  participants: { id: string; name: string }[];
  currencies: { home: string; local: string; intl: string };
  days: Day[];
  expenses: ExpenseItem[];
}
```

Every field shown is required (except the optional `estimated` and
`tzShiftMin`). Use `null` (not omission) for absent `checkpoint` and
`distanceKm`.

## Day scaffold — copy verbatim

The skeleton below is FIXED input — the traveller chose these destinations,
dates and coordinates. It is NOT yours to redesign. The returned JSON MUST:

- use this exact trip `id`: `{TRIP_ID}`
- contain exactly one Day per row below, in this order, with each day's `date`
  and `location` (name, lat, lon) EXACTLY as given. These coordinates are
  user-selected truth: never change, reorder, add, or drop a day, and never
  alter a `location`'s name or lat/lon.
- only ENRICH each day: replace the placeholder slots with real, specific slots,
  variants, micro-steps and checkpoints, and add the trip's expenses.

| # | date | place | lat | lon |
|---|------|-------|-----|-----|
{DAY_SCAFFOLD}

## Data provenance — the `estimated` flag

Both `VariantNode` and `ExpenseItem` accept an optional `"estimated": boolean`.

- Real, verified data (a looked-up flight price, a published museum fee, a
  scheduled train time): OMIT the flag entirely.
- Anything you guessed or approximated: set `"estimated": true` so the traveller
  knows to double-check and edit it in-app afterwards.

## Hard invariants (machine-checked — the file is rejected if violated)

1. Every id in the file is unique. Prefix all ids with a short trip slug
   (e.g. "lx-") so trips never collide with each other. The trip `id` itself is
   fixed by the scaffold — copy it exactly.
2. `defaultVariantId` exists among that slot's variants.
3. Every variant has >= 1 micro-step; every `durationMin` is a positive integer.
4. `startTimeMin` is an integer in [0, 1440); day dates are strictly increasing.
   The days, their dates and their `location` coordinates come from the scaffold
   and must be reproduced exactly — the app fetches a forecast per day from each
   `location`.
5. ALL times are absolute minutes since midnight — `checkpoint.timeMin` for
   10:00 AM is 600, NEVER an offset from the day start. A checkpoint must be
   at or after its day's `startTimeMin`. Times are wall-clock in that day's
   local zone.
6. If a flight (or other step) crosses a timezone, set `tzShiftMin` on that
   step to the offset difference (destination minus origin, in minutes — e.g.
   Bucharest→Rome is -60, Bucharest→Lisbon -120). Downstream slot times then
   display in the arrival zone. Optionally set the day's `tz` to a short label
   for its starting zone. Keep `durationMin` the real elapsed flight time
   regardless of the shift.
7. ONLY these currency codes anywhere: "RON", "EUR", "USD" (the app's cached
   rate matrix). Keep the scaffold's currencies as given:
   { "home": "RON", "local": "EUR", "intl": "USD" }.
8. Percent shares sum to 1; fixed shares sum to the expense amount; all share
   keys and payerId are participant ids.
9. Variant costs are >= 0; expense amounts are > 0.

## Realistic full-day pacing (READ THIS — it is the most common mistake)

The scheduler chains slots back-to-back: each slot starts exactly when the
previous one ends, and the clock advances ONLY by the durations of your
micro-steps. There are no automatic gaps. So you must model every hour that
actually passes — sightseeing, meals, rest, free time — or the whole day
collapses into the late morning and an activity you labelled "dinner" ends up
at noon.

- Use `wait` micro-steps for time spent in one place rather than moving:
  a museum or palace visit, a sit-down lunch or dinner, a beach or pool
  afternoon, a nap, unstructured free time. Give them realistic durations
  (a lunch ~60–90 min, a dinner ~90–120 min, a free afternoon 120–300 min).
- Anchor meals to real wall-clock windows: breakfast 07:30–09:00, lunch
  12:30–14:00, dinner 18:30–20:30. NEVER place a slot or step labelled
  "dinner" before 18:00, or "lunch" before 12:00.
- A normal sightseeing day starts in the morning and its LAST slot should end
  in the evening (roughly 20:00–22:00). If a non-travel day ends before about
  17:00, you forgot to model dwell/free time — add it. Mentally sum
  `startTimeMin` + all default-variant durations for each day and check where
  the day lands before you finish.
- Travel/departure days are the exception: they can legitimately end in the
  afternoon around the outbound, inter-city, or return leg.

## Content requirements (so every UI path gets exercised)

- 2–4 participants with first names appropriate to the travellers.
- The first day of each destination block is its arrival/travel day (transfer
  from the previous place → arrival → settling in); a return day (if present)
  is the journey back to the starting point. Other days are sightseeing/day-trip
  days paced morning-to-evening.
- 3–6 slots per day (including the meal/free-time slots the pacing rules need).
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
  currencies, with amounts plausible for the destinations.
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

Now enrich the scaffold above into the complete JSON document, keeping every
day, date and location exactly as given.
