import { RATES_EUR } from "./currency";
import type { Trip } from "./types";

// Structural invariants for trip data (hand-written or AI-generated mocks).
// Returns a list of human-readable problems; empty = valid.
export function validateTrip(trip: Trip): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  const dupes = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  const knownCcy = (ccy: string, where: string) => {
    if (!(ccy in RATES_EUR)) err(`${where}: currency "${ccy}" is not in the rate matrix`);
  };

  if (trip.participants.length === 0) err("trip has no participants");
  dupes(trip.participants.map((p) => p.id), "participant");
  const pids = new Set(trip.participants.map((p) => p.id));

  for (const view of ["home", "local", "intl"] as const) {
    knownCcy(trip.currencies[view], `currencies.${view}`);
  }

  if (trip.days.length === 0) err("trip has no days");
  dupes(trip.days.map((d) => d.id), "day");
  dupes(trip.days.flatMap((d) => d.slots.map((s) => s.id)), "slot");
  dupes(trip.days.flatMap((d) => d.slots.flatMap((s) => s.variants.map((v) => v.id))), "variant");
  dupes(
    trip.days.flatMap((d) =>
      d.slots.flatMap((s) => s.variants.flatMap((v) => v.microSteps.map((ms) => ms.id)))
    ),
    "micro-step"
  );
  dupes(trip.expenses.map((e) => e.id), "expense");

  let prevDate = "";
  for (const day of trip.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || Number.isNaN(Date.parse(day.date))) {
      err(`day ${day.id}: date "${day.date}" is not a valid ISO date`);
    } else if (day.date <= prevDate) {
      err(`day ${day.id}: date ${day.date} is not after the previous day`);
    } else {
      prevDate = day.date;
    }
    if (day.startTimeMin < 0 || day.startTimeMin >= 1440 || !Number.isInteger(day.startTimeMin)) {
      err(`day ${day.id}: startTimeMin ${day.startTimeMin} must be an integer in [0, 1440)`);
    }
    if (day.slots.length === 0) err(`day ${day.id} has no slots`);

    for (const slot of day.slots) {
      if (slot.variants.length === 0) {
        err(`slot ${slot.id} has no variants`);
        continue;
      }
      if (!slot.variants.some((v) => v.id === slot.defaultVariantId)) {
        err(`slot ${slot.id}: defaultVariantId "${slot.defaultVariantId}" is not one of its variants`);
      }
      if (slot.checkpoint) {
        if (slot.checkpoint.timeMin < 0 || !Number.isInteger(slot.checkpoint.timeMin)) {
          err(`slot ${slot.id}: checkpoint timeMin must be a non-negative integer`);
        } else if (slot.checkpoint.timeMin < day.startTimeMin) {
          err(
            `slot ${slot.id}: checkpoint timeMin ${slot.checkpoint.timeMin} is before the day starts (${day.startTimeMin}) — ` +
              `timeMin is absolute minutes since midnight (e.g. 12:00 → 720), not an offset from the day start`
          );
        }
        if (slot.checkpoint.bufferMin < 0) err(`slot ${slot.id}: checkpoint bufferMin must be >= 0`);
      }
      for (const v of slot.variants) {
        if (v.microSteps.length === 0) err(`variant ${v.id} has no micro-steps`);
        if (v.cost.amount < 0) err(`variant ${v.id}: cost must be >= 0`);
        knownCcy(v.cost.currency, `variant ${v.id}`);
        for (const ms of v.microSteps) {
          if (ms.durationMin <= 0 || !Number.isInteger(ms.durationMin)) {
            err(`micro-step ${ms.id}: durationMin ${ms.durationMin} must be a positive integer`);
          }
        }
      }
    }
  }

  for (const exp of trip.expenses) {
    if (exp.amount <= 0) err(`expense ${exp.id}: amount must be > 0`);
    knownCcy(exp.currency, `expense ${exp.id}`);
    if (!pids.has(exp.payerId)) err(`expense ${exp.id}: payer "${exp.payerId}" is not a participant`);
    if (exp.split.type !== "equal") {
      const shares = exp.split.shares;
      for (const pid of Object.keys(shares)) {
        if (!pids.has(pid)) err(`expense ${exp.id}: split share for unknown participant "${pid}"`);
      }
      const sum = Object.values(shares).reduce((s, v) => s + v, 0);
      if (exp.split.type === "percent" && Math.abs(sum - 1) > 0.001) {
        err(`expense ${exp.id}: percent shares sum to ${sum}, expected 1`);
      }
      if (exp.split.type === "fixed" && Math.abs(sum - exp.amount) > 0.01) {
        err(`expense ${exp.id}: fixed shares sum to ${sum}, expected the amount ${exp.amount}`);
      }
    }
  }

  return errors;
}
