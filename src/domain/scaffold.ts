import { newId, newUid } from "./mutate";
import type { Day, ItinerarySlot, Trip } from "./types";

// Build a valid, editable *scaffold* trip from a small plan (starting point,
// ordered destinations, dates, return flag). The scaffold is the contract the
// generated AI prompt must respect: days, dates and locations are user-selected
// truth; every placeholder slot is marked `estimated` so it reads as unverified
// until enriched. Pure and framework-free — no fetch, no React.

export interface Place {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

export interface PlanInput {
  startPoint: Place;
  destinations: Place[];
  startDate: string; // ISO date anchor for day 1
  numDays: number;
  returnToStart: boolean;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// startDate + n calendar days, in UTC, as an ISO date.
const addDays = (isoDate: string, n: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Spread `total` days across `buckets` destinations: floor base for all, the
// remainder handed to the earliest destinations (in order).
const distribute = (total: number, buckets: number): number[] => {
  const base = Math.floor(total / buckets);
  const rem = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
};

type StepSpec = { type: "transfer" | "wait"; label: string; durationMin: number };

// A single-variant placeholder slot whose one variant is flagged `estimated`,
// carrying wait/transfer micro-steps of realistic durations so the pacing
// conventions still hold before the AI (or the user) fills in real data.
const placeholderSlot = (
  title: string,
  variantName: string,
  steps: StepSpec[]
): ItinerarySlot => {
  const vid = newId("v");
  return {
    id: newId("slot"),
    title,
    checkpoint: null,
    defaultVariantId: vid,
    variants: [
      {
        id: vid,
        name: variantName,
        estimated: true,
        cost: { amount: 0, currency: "EUR" },
        microSteps: steps.map((s) => ({
          id: newId("ms"),
          type: s.type,
          label: s.label,
          durationMin: s.durationMin,
          distanceKm: null,
        })),
      },
    ],
  };
};

const travelSlot = (from: Place, to: Place): ItinerarySlot =>
  placeholderSlot(`${from.name} → ${to.name}`, "Transfer", [
    { type: "transfer", label: `Travel to ${to.name}`, durationMin: 180 },
    { type: "wait", label: "Check in & settle", durationMin: 45 },
  ]);

const arrivalFreeTimeSlot = (dest: Place): ItinerarySlot =>
  placeholderSlot(`Free time in ${dest.name}`, "Free time", [
    { type: "wait", label: `Get your bearings in ${dest.name}`, durationMin: 120 },
  ]);

const exploreSlot = (dest: Place): ItinerarySlot =>
  placeholderSlot(`Explore ${dest.name}`, "Free time", [
    { type: "wait", label: `A day in ${dest.name}`, durationMin: 240 },
  ]);

const returnSlot = (from: Place, startPoint: Place): ItinerarySlot =>
  placeholderSlot(`Return to ${startPoint.name}`, "Transfer", [
    { type: "transfer", label: `Travel from ${from.name} to ${startPoint.name}`, durationMin: 180 },
    { type: "wait", label: "Buffer at the gate", durationMin: 45 },
  ]);

const tripName = (destinations: Place[], startDate: string): string => {
  const d = new Date(`${startDate}T00:00:00Z`);
  const stamp = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const first = destinations[0].name;
  if (destinations.length === 1) return `${first} · ${stamp}`;
  return `${first} – ${destinations[destinations.length - 1].name} · ${stamp}`;
};

// Build the scaffold trip. Throws a descriptive error when the plan is
// under-specified (no destinations, or too few days to cover them + return).
export function scaffoldTrip(input: PlanInput): Trip {
  const { startPoint, destinations, startDate, numDays, returnToStart } = input;

  if (destinations.length === 0) {
    throw new Error("A trip needs at least one destination.");
  }
  const returnDays = returnToStart ? 1 : 0;
  const minDays = destinations.length + returnDays;
  if (numDays < minDays) {
    throw new Error(
      `${numDays} day(s) is not enough for ${destinations.length} destination(s)` +
        `${returnToStart ? " plus a return day" : ""} — need at least ${minDays}.`
    );
  }

  const perDest = distribute(numDays - returnDays, destinations.length);

  const days: Day[] = [];
  let dayIdx = 0;
  let prevPlace: Place = startPoint;

  destinations.forEach((dest, di) => {
    const count = perDest[di];
    for (let k = 0; k < count; k++) {
      const first = dayIdx === 0;
      const slots =
        k === 0
          ? [travelSlot(prevPlace, dest), arrivalFreeTimeSlot(dest)]
          : [exploreSlot(dest)];
      days.push({
        id: newId("day"),
        date: addDays(startDate, dayIdx),
        startTimeMin: first ? 360 : 540,
        location: { name: dest.name, lat: dest.lat, lon: dest.lon },
        slots,
      });
      dayIdx++;
    }
    prevPlace = dest;
  });

  if (returnToStart) {
    days.push({
      id: newId("day"),
      date: addDays(startDate, dayIdx),
      startTimeMin: 360,
      location: { name: startPoint.name, lat: startPoint.lat, lon: startPoint.lon },
      slots: [returnSlot(prevPlace, startPoint)],
    });
    dayIdx++;
  }

  return {
    uid: newUid(),
    id: newId("trip"),
    name: tripName(destinations, startDate),
    participants: [{ id: newId("p"), name: "Traveller 1" }],
    currencies: { home: "RON", local: "EUR", intl: "USD" },
    days,
    expenses: [],
  };
}
