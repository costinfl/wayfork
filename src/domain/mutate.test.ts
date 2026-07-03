import { describe, expect, it } from "vitest";
import { TRIPS } from "../data";
import {
  moveSlot,
  newExpenseId,
  newId,
  removeExpense,
  removeSlot,
  removeVariant,
  upsertExpense,
  upsertSlot,
  upsertVariant,
} from "./mutate";
import type { ExpenseItem, ItinerarySlot, VariantNode } from "./types";

const trip = TRIPS[0];
const expense: ExpenseItem = {
  id: "e-test",
  phase: "mid-trip",
  label: "Gelato",
  payerId: trip.participants[0].id,
  amount: 12,
  currency: "EUR",
  split: { type: "equal" },
};

describe("upsertExpense", () => {
  it("appends a new expense without mutating the input", () => {
    const next = upsertExpense(trip, expense);
    expect(next.expenses).toHaveLength(trip.expenses.length + 1);
    expect(next.expenses.at(-1)).toEqual(expense);
    expect(trip.expenses.some((e) => e.id === "e-test")).toBe(false);
  });

  it("replaces an existing expense in place", () => {
    const withNew = upsertExpense(trip, expense);
    const edited = { ...expense, amount: 20 };
    const next = upsertExpense(withNew, edited);
    expect(next.expenses).toHaveLength(withNew.expenses.length);
    expect(next.expenses.find((e) => e.id === "e-test")?.amount).toBe(20);
  });
});

describe("removeExpense", () => {
  it("removes by id without mutating the input", () => {
    const withNew = upsertExpense(trip, expense);
    const next = removeExpense(withNew, "e-test");
    expect(next.expenses).toEqual(trip.expenses);
    expect(withNew.expenses.some((e) => e.id === "e-test")).toBe(true);
  });
});

describe("newExpenseId", () => {
  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newExpenseId));
    expect(ids.size).toBe(50);
  });
});

const day = trip.days[0];
const slot = day.slots[0]; // "slot-otp", 2 variants

const newSlot: ItinerarySlot = {
  id: newId("slot"),
  title: "Espresso stop",
  defaultVariantId: "v-espresso",
  checkpoint: null,
  variants: [
    {
      id: "v-espresso",
      name: "Only option",
      microSteps: [{ id: newId("ms"), type: "wait", label: "Espresso", durationMin: 10, distanceKm: null }],
      cost: { amount: 3, currency: "EUR" },
    },
  ],
};

describe("slot mutations", () => {
  it("upsertSlot appends a new slot to the given day", () => {
    const next = upsertSlot(trip, day.id, newSlot);
    expect(next.days[0].slots.at(-1)?.id).toBe(newSlot.id);
    expect(trip.days[0].slots.some((s) => s.id === newSlot.id)).toBe(false);
  });

  it("upsertSlot replaces an existing slot in place", () => {
    const next = upsertSlot(trip, day.id, { ...slot, title: "Renamed" });
    expect(next.days[0].slots[0].title).toBe("Renamed");
    expect(next.days[0].slots).toHaveLength(day.slots.length);
  });

  it("removeSlot removes by id", () => {
    const next = removeSlot(trip, slot.id);
    expect(next.days[0].slots.some((s) => s.id === slot.id)).toBe(false);
  });

  it("moveSlot swaps neighbours and clamps at the edges", () => {
    const down = moveSlot(trip, slot.id, 1);
    expect(down.days[0].slots[1].id).toBe(slot.id);
    const clamped = moveSlot(trip, slot.id, -1);
    expect(clamped.days[0].slots.map((s) => s.id)).toEqual(day.slots.map((s) => s.id));
  });
});

describe("variant mutations", () => {
  const variant: VariantNode = {
    id: "v-bike",
    name: "Bike",
    microSteps: [{ id: "ms-bike", type: "walk", label: "Ride", durationMin: 40, distanceKm: 12 }],
    cost: { amount: 4, currency: "EUR" },
  };

  it("upsertVariant appends to the slot", () => {
    const next = upsertVariant(trip, slot.id, variant);
    expect(next.days[0].slots[0].variants.at(-1)?.id).toBe("v-bike");
  });

  it("upsertVariant replaces by id", () => {
    const next = upsertVariant(trip, slot.id, { ...slot.variants[0], name: "Renamed" });
    expect(next.days[0].slots[0].variants[0].name).toBe("Renamed");
    expect(next.days[0].slots[0].variants).toHaveLength(slot.variants.length);
  });

  it("removeVariant reassigns the default when it was deleted", () => {
    const next = removeVariant(trip, slot.id, slot.defaultVariantId);
    const s = next.days[0].slots[0];
    expect(s.variants).toHaveLength(slot.variants.length - 1);
    expect(s.defaultVariantId).toBe(s.variants[0].id);
  });

  it("removeVariant refuses to delete the last variant", () => {
    const single = trip.days[0].slots[1]; // "slot-sec" has one variant
    const next = removeVariant(trip, single.id, single.variants[0].id);
    expect(next.days[0].slots[1].variants).toHaveLength(1);
  });
});
