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
}

export interface VariantNode {
  id: string;
  name: string;
  microSteps: MicroStep[]; // ordered — durations sum to variant duration
  cost: Money; // estimated, injected into projection
}

// Hard guardrail: absolute time milestone the active chain must respect.
export interface Checkpoint {
  label: string;
  timeMin: number;
  bufferMin: number;
}

export interface ItinerarySlot {
  id: string;
  title: string;
  variants: VariantNode[]; // >= 1; active one tracked in UI state
  defaultVariantId: string;
  checkpoint: Checkpoint | null;
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
  startTimeMin: number; // minutes since midnight
  slots: ItinerarySlot[];
  location?: DayLocation | null;
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
}

export interface TripCurrencies {
  home: CurrencyCode;
  local: CurrencyCode;
  intl: CurrencyCode;
}

export type CurrencyView = keyof TripCurrencies;

export interface Trip {
  id: string;
  name: string;
  participants: Participant[];
  currencies: TripCurrencies;
  days: Day[];
  expenses: ExpenseItem[];
}
