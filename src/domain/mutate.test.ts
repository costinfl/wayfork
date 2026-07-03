import { describe, expect, it } from "vitest";
import { TRIPS } from "../data";
import {
  moveSlot,
  newExpenseId,
  newId,
  newTrip,
  nextDate,
  removeDay,
  removeExpense,
  removeSlot,
  removeVariant,
  starterSlot,
  upsertDay,
  upsertExpense,
  upsertSlot,
  upsertVariant,
} from "./mutate";
import { validateTrip } from "./validate";
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

describe("day mutations", () => {
  const lisbon = TRIPS[1]; // 3 days

  it("upsertDay appends and keeps days sorted by date", () => {
    const middle = {
      id: newId("day"),
      date: "2026-09-11", // between day 1 and 2? equal dates rejected by validator; use sorting check
      startTimeMin: 600,
      slots: [starterSlot("EUR")],
    };
    // use a date after the last day for a clean append
    const appended = upsertDay(lisbon, { ...middle, date: "2026-09-13" });
    expect(appended.days.at(-1)?.date).toBe("2026-09-13");
    // and an early date sorts to the front
    const front = upsertDay(lisbon, { ...middle, id: newId("day"), date: "2026-09-09" });
    expect(front.days[0].date).toBe("2026-09-09");
  });

  it("upsertDay replaces by id", () => {
    const edited = { ...lisbon.days[0], startTimeMin: 300 };
    const next = upsertDay(lisbon, edited);
    expect(next.days[0].startTimeMin).toBe(300);
    expect(next.days).toHaveLength(lisbon.days.length);
  });

  it("removeDay removes by id", () => {
    const next = removeDay(lisbon, lisbon.days[1].id);
    expect(next.days.map((d) => d.date)).toEqual(["2026-09-10", "2026-09-12"]);
  });
});

describe("newTrip", () => {
  it("creates a minimal valid trip", () => {
    const t = newTrip(
      "Weekend in Brașov",
      "2026-08-01",
      [{ id: newId("p"), name: "Andrei" }],
      { home: "RON", local: "EUR", intl: "USD" }
    );
    expect(validateTrip(t)).toEqual([]);
    expect(t.days).toHaveLength(1);
    expect(t.days[0].slots[0].variants[0].microSteps).toHaveLength(1);
    expect(t.expenses).toEqual([]);
  });
});

describe("nextDate", () => {
  it("advances one calendar day, across month ends", () => {
    expect(nextDate("2026-09-10")).toBe("2026-09-11");
    expect(nextDate("2026-09-30")).toBe("2026-10-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
  });
});
