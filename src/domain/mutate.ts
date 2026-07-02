import type { ExpenseItem, Trip } from "./types";

// Immutable trip mutations — return a new Trip, never touch the input.

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

export const newExpenseId = (): string =>
  `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
