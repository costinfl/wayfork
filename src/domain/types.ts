/* =====================================================================
   WAYFORK domain model
   TRIP > DAY > ITINERARY_SLOT > VARIANT_NODE > MICRO_STEP
   EXPENSE_ITEM hangs off TRIP.
   ===================================================================== */

export const STEP_TYPES = [
  "walk",
  "metro",
  "bus",
  "train",
  "car",
  "shuttle",
  "flight",
  "wait",
  "transfer",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

export type CurrencyCode = string; // ISO 4217, e.g. "EUR"

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export interface MicroStep {
  id: string;
  type: StepType;
  label: string;
  durationMin: number;
  distanceKm: number | null;
  // Change in local-clock offset that occurs during this step, in minutes
  // (e.g. a flight Bucharest→Rome loses an hour: -60). Absent/0 = no change.
  tzShiftMin?: number;
}

export interface VariantNode {
  id: string;
  name: string;
  microSteps: MicroStep[]; // ordered — durations sum to variant duration
  cost: Money; // estimated, injected into projection
  // Provenance: true marks data that is a placeholder or approximation (e.g. a
  // scaffold slot the user has not yet verified). Absent = not claimed either
  // way, so this stays backward compatible with existing trips.
  estimated?: boolean;
}

// Hard guardrail: absolute time milestone the active chain must respect.
// timeMin is the deadline (boarding time / closing time). opensMin, when set,
// makes it a window [opensMin, timeMin] — e.g. a museum's opening hours — so
// arriving before it opens means waiting rather than being on time.
export interface Checkpoint {
  label: string;
  timeMin: number;
  bufferMin: number;
  opensMin?: number | null;
}

// A named geographic point (city, landmark, station). The canonical shape used
// by geocoding, the plan-a-trip scaffold, and per-slot map coordinates.
export interface Place {
  name: string;
  lat: number;
  lon: number;
  country?: string;
}

export interface ItinerarySlot {
  id: string;
  title: string;
  variants: VariantNode[]; // >= 1; active one tracked in UI state
  defaultVariantId: string;
  checkpoint: Checkpoint | null;
  // Where the slot ends / takes place, for the day-journey map. Optional and
  // absent-by-default so old trips stay valid; the map connects across slots
  // that have none.
  place?: Place | null;
}

// Where the day happens, for weather lookups. Optional — days without a
// location simply show no forecast.
export interface DayLocation {
  name: string; // e.g. "Rome"
  lat: number;
  lon: number;
}

export interface Day {
  id: string;
  date: string; // ISO date anchor
  startTimeMin: number; // minutes since midnight, in the day's starting local zone
  slots: ItinerarySlot[];
  location?: DayLocation | null;
  tz?: string | null; // optional label for the starting local zone, e.g. "Bucharest"
}

export interface Participant {
  id: string;
  name: string;
}

export type ExpensePhase = "pre-trip" | "mid-trip";

export type SplitDef =
  | { type: "equal" }
  | { type: "percent"; shares: Record<string, number> } // participantId -> fraction
  | { type: "fixed"; shares: Record<string, number> }; // participantId -> amount

export interface ExpenseItem {
  id: string;
  phase: ExpensePhase;
  label: string;
  payerId: string;
  amount: number;
  currency: CurrencyCode; // stored natively in input currency
  split: SplitDef;
  // Provenance: true marks an approximated/placeholder amount the user has not
  // yet verified. Absent = not claimed either way (backward compatible).
  estimated?: boolean;
}

export interface TripCurrencies {
  home: CurrencyCode;
  local: CurrencyCode;
  intl: CurrencyCode;
}

export type CurrencyView = keyof TripCurrencies;

export interface Trip {
  // Globally-unique surrogate identity, threaded through the client so trips
  // never collide even when shared across accounts (a shared trip belongs to
  // another owner and may reuse a logical `id`). Ensured by parseTrip/newTrip;
  // `id` stays a human/slug label. Optional in the type only so hand-built test
  // fixtures need not set it — every trip that reaches the app carries one.
  uid?: string;
  // The account that owns this trip's row (auth user id), injected by the
  // remote store on read. Absent for local/built-in trips and for a brand-new
  // trip until first saved. Writes route to this owner so a member editing a
  // shared trip updates the owner's row rather than forking a copy of their own.
  owner?: string;
  // Optimistic-concurrency token: the row's monotonic version, injected by the
  // store on read and echoed back on write so a stale save (one whose expected
  // version has moved under it, e.g. a co-editor saved first) is rejected rather
  // than silently clobbering. The server increments it on every update. Absent
  // for a brand-new trip until first saved (its first save creates version 0).
  version?: number;
  id: string;
  name: string;
  participants: Participant[];
  currencies: TripCurrencies;
  days: Day[];
  expenses: ExpenseItem[];
}
