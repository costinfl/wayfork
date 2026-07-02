import { describe, expect, it } from "vitest";
import { computeBalances, expenseShares, settle } from "./ledger";
import type { ExpenseItem, Participant, Trip } from "./types";

const participants: Participant[] = [
  { id: "a", name: "Ana" },
  { id: "b", name: "Bogdan" },
  { id: "c", name: "Cristi" },
];

const expense = (over: Partial<ExpenseItem>): ExpenseItem => ({
  id: "e",
  phase: "mid-trip",
  label: "x",
  payerId: "a",
  amount: 90,
  currency: "EUR",
  split: { type: "equal" },
  ...over,
});

describe("expenseShares", () => {
  it("splits equally among all participants", () => {
    expect(expenseShares(expense({}), participants)).toEqual({ a: 30, b: 30, c: 30 });
  });

  it("splits by percent, defaulting missing participants to 0", () => {
    const shares = expenseShares(
      expense({ amount: 100, split: { type: "percent", shares: { a: 0.6, b: 0.4 } } }),
      participants
    );
    expect(shares).toEqual({ a: 60, b: 40, c: 0 });
  });

  it("uses fixed amounts as-is", () => {
    const shares = expenseShares(
      expense({ split: { type: "fixed", shares: { b: 25, c: 65 } } }),
      participants
    );
    expect(shares).toEqual({ a: 0, b: 25, c: 65 });
  });
});

describe("computeBalances", () => {
  const trip = (expenses: ExpenseItem[]): Trip => ({
    id: "t",
    name: "t",
    participants,
    currencies: { home: "RON", local: "EUR", intl: "USD" },
    days: [],
    expenses,
  });

  it("credits the payer and debits every share, in EUR", () => {
    const bal = computeBalances(trip([expense({ payerId: "a", amount: 90 })]));
    expect(bal.a).toBeCloseTo(60); // paid 90, owes 30
    expect(bal.b).toBeCloseTo(-30);
    expect(bal.c).toBeCloseTo(-30);
  });

  it("converts native currencies through the EUR pivot", () => {
    // 4.97 RON = 1 EUR → 497 RON = 100 EUR
    const bal = computeBalances(trip([expense({ payerId: "b", amount: 497, currency: "RON" })]));
    expect(bal.b).toBeCloseTo(100 - 100 / 3);
    expect(bal.a).toBeCloseTo(-100 / 3);
  });

  it("is always zero-sum", () => {
    const bal = computeBalances(
      trip([
        expense({ payerId: "a", amount: 90 }),
        expense({ id: "e2", payerId: "b", amount: 1240, currency: "RON" }),
        expense({ id: "e3", payerId: "c", amount: 62, split: { type: "percent", shares: { a: 0.6, b: 0.4 } } }),
      ])
    );
    const sum = Object.values(bal).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(0);
  });
});

describe("settle", () => {
  it("returns no transactions when everyone is square", () => {
    expect(settle({ a: 0, b: 0.005, c: -0.005 })).toEqual([]);
  });

  it("settles a simple two-person debt", () => {
    expect(settle({ a: 40, b: -40 })).toEqual([{ from: "b", to: "a", amountEUR: 40 }]);
  });

  it("nets three-party debts with at most n-1 transactions", () => {
    const txns = settle({ a: 70, b: -50, c: -20 });
    expect(txns).toHaveLength(2);
    expect(txns[0]).toEqual({ from: "b", to: "a", amountEUR: 50 });
    expect(txns[1]).toEqual({ from: "c", to: "a", amountEUR: 20 });
  });

  it("produces transactions that exactly clear the balances", () => {
    const balances: Record<string, number> = { a: 33.4, b: -12.15, c: -21.25, d: 0 };
    const after = { ...balances };
    for (const t of settle(balances)) {
      after[t.from] += t.amountEUR;
      after[t.to] -= t.amountEUR;
    }
    for (const v of Object.values(after)) expect(v).toBeCloseTo(0, 1);
  });
});
