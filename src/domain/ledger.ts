import { convert, RATES_EUR } from "./currency";
import type { RateMatrix } from "./currency";
import type { ExpenseItem, Participant, Trip } from "./types";

// Per-participant shares of one expense, in the expense's native currency.
export function expenseShares(
  exp: ExpenseItem,
  participants: Participant[]
): Record<string, number> {
  const ids = participants.map((p) => p.id);
  if (exp.split.type === "equal") {
    const each = exp.amount / ids.length;
    return Object.fromEntries(ids.map((id) => [id, each]));
  }
  if (exp.split.type === "percent") {
    const { shares } = exp.split;
    return Object.fromEntries(ids.map((id) => [id, exp.amount * (shares[id] || 0)]));
  }
  const { shares } = exp.split; // fixed
  return Object.fromEntries(ids.map((id) => [id, shares[id] || 0]));
}

// Net balances in EUR (positive = is owed money), from paid expenses only.
export function computeBalances(trip: Trip, rates: RateMatrix = RATES_EUR): Record<string, number> {
  const bal = Object.fromEntries(trip.participants.map((p) => [p.id, 0]));
  for (const exp of trip.expenses) {
    bal[exp.payerId] += convert(exp.amount, exp.currency, "EUR", rates);
    const shares = expenseShares(exp, trip.participants);
    for (const [pid, share] of Object.entries(shares))
      bal[pid] -= convert(share, exp.currency, "EUR", rates);
  }
  return bal;
}

export interface SettlementTxn {
  from: string;
  to: string;
  amountEUR: number;
}

// Greedy debt netting → minimal transaction list.
export function settle(balances: Record<string, number>): SettlementTxn[] {
  const eps = 0.01;
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < -eps)
    .map(([id, v]) => ({ id, amt: -v }));
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > eps)
    .map(([id, v]) => ({ id, amt: v }));
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const txns: SettlementTxn[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    txns.push({ from: debtors[i].id, to: creditors[j].id, amountEUR: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < eps) i++;
    if (creditors[j].amt < eps) j++;
  }
  return txns;
}
