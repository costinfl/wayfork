import type { Checkpoint, Day, ItinerarySlot, VariantNode } from "./types";

export type CheckpointStatus = "ok" | "amber" | "red";

export interface CheckpointResult extends Checkpoint {
  margin: number;
  status: CheckpointStatus;
}

export interface ScheduleRow {
  slot: ItinerarySlot;
  variant: VariantNode;
  start: number;
  end: number;
  duration: number;
  checkpoint: CheckpointResult | null;
}

export const variantDuration = (v: VariantNode): number =>
  v.microSteps.reduce((s, ms) => s + ms.durationMin, 0);

// Ripple-effect scheduler: fold over slots, each start = previous end.
// Checkpoint status: ok (margin ≥ buffer) / amber (0 ≤ margin < buffer) / red (late).
export function computeSchedule(
  day: Day,
  activeVariantBySlot: Record<string, string>
): ScheduleRow[] {
  let cursor = day.startTimeMin;
  return day.slots.map((slot) => {
    const variant =
      slot.variants.find((v) => v.id === activeVariantBySlot[slot.id]) || slot.variants[0];
    const duration = variantDuration(variant);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    let checkpoint: CheckpointResult | null = null;
    if (slot.checkpoint) {
      const margin = slot.checkpoint.timeMin - start;
      const status: CheckpointStatus =
        margin >= slot.checkpoint.bufferMin ? "ok" : margin >= 0 ? "amber" : "red";
      checkpoint = { ...slot.checkpoint, margin, status };
    }
    return { slot, variant, start, end, duration, checkpoint };
  });
}
