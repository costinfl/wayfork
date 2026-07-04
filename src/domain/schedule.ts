import type { Checkpoint, Day, ItinerarySlot, VariantNode } from "./types";

export type CheckpointStatus = "ok" | "amber" | "red";

export interface CheckpointResult extends Checkpoint {
  margin: number;
  status: CheckpointStatus;
}

export interface ScheduleRow {
  slot: ItinerarySlot;
  variant: VariantNode;
  start: number; // wall-clock in the local zone at the slot's start
  end: number; // wall-clock in the local zone after this slot (shift applied)
  duration: number; // real elapsed minutes (Σ micro-step durations)
  tzOffsetMin: number; // local offset at slot start, relative to the day's start zone
  tzShiftMin: number; // clock change occurring within this slot (sum of step shifts)
  checkpoint: CheckpointResult | null;
}

export const variantDuration = (v: VariantNode): number =>
  v.microSteps.reduce((s, ms) => s + ms.durationMin, 0);

export const variantTzShift = (v: VariantNode): number =>
  v.microSteps.reduce((s, ms) => s + (ms.tzShiftMin ?? 0), 0);

// Ripple-effect scheduler: fold over slots, each start = previous end.
// Wall-clock times carry timezone shifts (e.g. a flight): a slot's end is
// start + elapsed duration + the slot's net clock shift, so all downstream
// times display in the arrival zone. Checkpoints compare against the slot's
// local start time, so they stay correct on both sides of a crossing.
// Checkpoint status: ok (margin ≥ buffer) / amber (0 ≤ margin < buffer) / red (late).
export function computeSchedule(
  day: Day,
  activeVariantBySlot: Record<string, string>
): ScheduleRow[] {
  let cursor = day.startTimeMin;
  let tzOffset = 0;
  return day.slots.map((slot) => {
    const variant =
      slot.variants.find((v) => v.id === activeVariantBySlot[slot.id]) || slot.variants[0];
    const duration = variantDuration(variant);
    const tzShiftMin = variantTzShift(variant);
    const start = cursor;
    const tzOffsetMin = tzOffset;
    const end = start + duration + tzShiftMin;
    cursor = end;
    tzOffset += tzShiftMin;
    let checkpoint: CheckpointResult | null = null;
    if (slot.checkpoint) {
      const margin = slot.checkpoint.timeMin - start;
      const status: CheckpointStatus =
        margin >= slot.checkpoint.bufferMin ? "ok" : margin >= 0 ? "amber" : "red";
      checkpoint = { ...slot.checkpoint, margin, status };
    }
    return { slot, variant, start, end, duration, tzOffsetMin, tzShiftMin, checkpoint };
  });
}
