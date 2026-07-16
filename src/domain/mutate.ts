import type {
  Day,
  ExpenseItem,
  ItinerarySlot,
  Participant,
  Trip,
  TripCurrencies,
  VariantNode,
} from "./types";

// Immutable trip mutations — return a new Trip, never touch the input.

// Monotonic per-session counter so ids never collide even when many are minted
// in the same millisecond (Date.now + a short random suffix alone collide at a
// few-percent rate over ~50 rapid calls — enough to corrupt a trip and to make
// the uniqueness test flaky). The counter guarantees uniqueness within the
// session; Date.now keeps ids distinct across sessions.
let idSeq = 0;
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// A trip's globally-unique surrogate identity (see Trip.uid). Prefer a real
// UUID; fall back to newId where crypto.randomUUID is unavailable.
export const newUid = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : newId("uid");

export const newExpenseId = (): string => newId("e");

export const upsertExpense = (trip: Trip, expense: ExpenseItem): Trip => ({
  ...trip,
  expenses: trip.expenses.some((e) => e.id === expense.id)
    ? trip.expenses.map((e) => (e.id === expense.id ? expense : e))
    : [...trip.expenses, expense],
});

export const removeExpense = (trip: Trip, expenseId: string): Trip => ({
  ...trip,
  expenses: trip.expenses.filter((e) => e.id !== expenseId),
});

const mapSlot = (trip: Trip, slotId: string, fn: (s: ItinerarySlot) => ItinerarySlot): Trip => ({
  ...trip,
  days: trip.days.map((d) => ({
    ...d,
    slots: d.slots.map((s) => (s.id === slotId ? fn(s) : s)),
  })),
});

// Adds the slot to the given day, or replaces it wherever it lives.
export const upsertSlot = (trip: Trip, dayId: string, slot: ItinerarySlot): Trip => {
  const exists = trip.days.some((d) => d.slots.some((s) => s.id === slot.id));
  if (exists) return mapSlot(trip, slot.id, () => slot);
  return {
    ...trip,
    days: trip.days.map((d) => (d.id === dayId ? { ...d, slots: [...d.slots, slot] } : d)),
  };
};

// Inserts a new slot right after the given one (both in dayId); a null/absent
// or unknown afterSlotId appends, matching upsertSlot for a new slot.
export const insertSlotAfter = (
  trip: Trip,
  dayId: string,
  afterSlotId: string | null,
  slot: ItinerarySlot
): Trip => ({
  ...trip,
  days: trip.days.map((d) => {
    if (d.id !== dayId) return d;
    const i = afterSlotId ? d.slots.findIndex((s) => s.id === afterSlotId) : -1;
    const slots = [...d.slots];
    slots.splice(i >= 0 ? i + 1 : slots.length, 0, slot);
    return { ...d, slots };
  }),
});

export const removeSlot = (trip: Trip, slotId: string): Trip => ({
  ...trip,
  days: trip.days.map((d) => ({ ...d, slots: d.slots.filter((s) => s.id !== slotId) })),
});

export const moveSlot = (trip: Trip, slotId: string, dir: -1 | 1): Trip => ({
  ...trip,
  days: trip.days.map((d) => {
    const i = d.slots.findIndex((s) => s.id === slotId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.slots.length) return d;
    const slots = [...d.slots];
    [slots[i], slots[j]] = [slots[j], slots[i]];
    return { ...d, slots };
  }),
});

export const upsertVariant = (trip: Trip, slotId: string, variant: VariantNode): Trip =>
  mapSlot(trip, slotId, (s) => ({
    ...s,
    variants: s.variants.some((v) => v.id === variant.id)
      ? s.variants.map((v) => (v.id === variant.id ? variant : v))
      : [...s.variants, variant],
  }));

// Refuses to delete the last variant; reassigns defaultVariantId if needed.
export const removeVariant = (trip: Trip, slotId: string, variantId: string): Trip =>
  mapSlot(trip, slotId, (s) => {
    const variants = s.variants.filter((v) => v.id !== variantId);
    if (variants.length === 0) return s;
    return {
      ...s,
      variants,
      defaultVariantId: variants.some((v) => v.id === s.defaultVariantId)
        ? s.defaultVariantId
        : variants[0].id,
    };
  });

// A slot with one starter variant — keeps the >=1-variant/-step invariants
// intact for freshly created slots, days, and trips.
export const starterSlot = (localCurrency: string, title = "New slot"): ItinerarySlot => {
  const vid = newId("v");
  return {
    id: newId("slot"),
    title,
    checkpoint: null,
    defaultVariantId: vid,
    variants: [
      {
        id: vid,
        name: "Option A",
        cost: { amount: 0, currency: localCurrency },
        microSteps: [
          { id: newId("ms"), type: "walk", label: "New step", durationMin: 15, distanceKm: null },
        ],
      },
    ],
  };
};

// Replaces the day by id or appends it; days are kept sorted by date so a
// day can be inserted in the middle of a trip.
export const upsertDay = (trip: Trip, day: Day): Trip => {
  const days = trip.days.some((d) => d.id === day.id)
    ? trip.days.map((d) => (d.id === day.id ? day : d))
    : [...trip.days, day];
  return { ...trip, days: [...days].sort((a, b) => a.date.localeCompare(b.date)) };
};

export const removeDay = (trip: Trip, dayId: string): Trip => ({
  ...trip,
  days: trip.days.filter((d) => d.id !== dayId),
});

export const setTripMeta = (
  trip: Trip,
  meta: { name: string; currencies: TripCurrencies; participants: Participant[] }
): Trip => ({ ...trip, ...meta });

export const newTrip = (
  name: string,
  startDate: string,
  participants: Participant[],
  currencies: TripCurrencies
): Trip => ({
  uid: newUid(),
  id: newId("trip"),
  name,
  participants,
  currencies,
  days: [
    {
      id: newId("day"),
      date: startDate,
      startTimeMin: 9 * 60,
      slots: [starterSlot(currencies.local)],
    },
  ],
  expenses: [],
});

// The calendar day after an ISO date, for "add day" defaults.
export const nextDate = (isoDate: string): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
