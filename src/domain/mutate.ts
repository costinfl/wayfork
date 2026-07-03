import type { ExpenseItem, ItinerarySlot, Trip, VariantNode } from "./types";

// Immutable trip mutations — return a new Trip, never touch the input.

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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
