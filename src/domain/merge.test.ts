import { describe, expect, it } from "vitest";
import { mergeTrip } from "./merge";
import type { Day, ExpenseItem, Participant, Trip } from "./types";

// Compact fixtures — mergeTrip only reads name/currencies/participants/days/
// expenses, so these need only enough shape to be distinguishable by id.
const day = (id: string, date: string, extra: Partial<Day> = {}): Day => ({
  id,
  date,
  startTimeMin: 540,
  slots: [],
  ...extra,
});
const expense = (id: string, amount: number): ExpenseItem => ({
  id,
  phase: "mid-trip",
  label: id,
  payerId: "p1",
  amount,
  currency: "EUR",
  split: { type: "equal" },
});
const person = (id: string, name: string): Participant => ({ id, name });

const base: Trip = {
  uid: "u-1",
  owner: "owner-1",
  version: 5,
  id: "trip",
  name: "Rome",
  participants: [person("p1", "Ana"), person("p2", "Bo")],
  currencies: { home: "USD", local: "EUR", intl: "USD" },
  days: [day("d1", "2026-05-01"), day("d2", "2026-05-02")],
  expenses: [expense("e1", 10), expense("e2", 20)],
};
const clone = (t: Trip): Trip => JSON.parse(JSON.stringify(t));

describe("mergeTrip", () => {
  it("keeps non-overlapping edits from both sides (different day and expense)", () => {
    const local = clone(base);
    local.days = [...local.days, day("d3", "2026-05-03")]; // local adds a day
    const remote = clone(base);
    remote.expenses = remote.expenses.map((e) => (e.id === "e1" ? { ...e, amount: 99 } : e)); // remote edits an expense

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.days.map((d) => d.id)).toEqual(["d1", "d2", "d3"]); // local's new day survives
    expect(merged.expenses.find((e) => e.id === "e1")?.amount).toBe(99); // remote's edit survives
  });

  it("resolves a same-item clash local-wins and records the conflict", () => {
    const local = clone(base);
    local.expenses = local.expenses.map((e) => (e.id === "e1" ? { ...e, amount: 111 } : e));
    const remote = clone(base);
    remote.expenses = remote.expenses.map((e) => (e.id === "e1" ? { ...e, amount: 222 } : e));

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(merged.expenses.find((e) => e.id === "e1")?.amount).toBe(111); // local wins
    expect(conflicts).toEqual(['expense "e1"']);
  });

  it("keeps additions made independently on both sides (add/add)", () => {
    const local = clone(base);
    local.days = [...local.days, day("dL", "2026-05-10")];
    const remote = clone(base);
    remote.days = [...remote.days, day("dR", "2026-05-11")];

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.days.map((d) => d.id)).toEqual(["d1", "d2", "dL", "dR"]);
  });

  it("honors a delete when the other side left the item untouched", () => {
    const local = clone(base);
    local.days = local.days.filter((d) => d.id !== "d2"); // local deletes d2
    const remote = clone(base); // remote untouched

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.days.map((d) => d.id)).toEqual(["d1"]);
  });

  it("keeps an edit that clashes with the other side's delete (edit vs delete)", () => {
    const local = clone(base);
    local.days = local.days.map((d) => (d.id === "d2" ? { ...d, startTimeMin: 600 } : d)); // local edits d2
    const remote = clone(base);
    remote.days = remote.days.filter((d) => d.id !== "d2"); // remote deletes d2

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(merged.days.find((d) => d.id === "d2")?.startTimeMin).toBe(600); // edit preserved
    expect(conflicts).toEqual(["day 2026-05-02"]);
  });

  it("flags a scalar clash (both rename the trip) and keeps local", () => {
    const local = clone(base);
    local.name = "Roma";
    const remote = clone(base);
    remote.name = "Rome trip";

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(merged.name).toBe("Roma");
    expect(conflicts).toEqual(["trip name"]);
  });

  it("returns remote's changes untouched when local made none (pure remote)", () => {
    const local = clone(base); // no local edits
    const remote = clone(base);
    remote.name = "Rome 2";
    remote.days = [...remote.days, day("d3", "2026-05-03")];

    const { merged, conflicts } = mergeTrip(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.name).toBe("Rome 2");
    expect(merged.days.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("keeps local identity (uid/owner/id) and does not mutate inputs", () => {
    const local = clone(base);
    local.days = local.days.filter((d) => d.id !== "d1");
    const remote = clone(base);
    const frozenBaseDays = base.days.length;

    const { merged } = mergeTrip(base, local, remote);
    expect(merged.uid).toBe("u-1");
    expect(merged.owner).toBe("owner-1");
    expect(merged.id).toBe("trip");
    expect(base.days).toHaveLength(frozenBaseDays); // inputs untouched
  });

  it("re-sorts merged days into ascending date order", () => {
    const local = clone(base);
    local.days = [...local.days, day("dEarly", "2026-04-01")]; // out-of-order addition
    const remote = clone(base);

    const { merged } = mergeTrip(base, local, remote);
    expect(merged.days.map((d) => d.date)).toEqual(["2026-04-01", "2026-05-01", "2026-05-02"]);
  });
});
