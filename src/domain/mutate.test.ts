import { describe, expect, it } from "vitest";
import { TRIPS } from "../data";
import { newExpenseId, removeExpense, upsertExpense } from "./mutate";
import type { ExpenseItem } from "./types";

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
