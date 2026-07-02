import { describe, expect, it } from "vitest";
import { computeSchedule, variantDuration } from "./schedule";
import type { Day, MicroStep, VariantNode } from "./types";

const step = (id: string, durationMin: number): MicroStep => ({
  id,
  type: "walk",
  label: id,
  durationMin,
  distanceKm: null,
});

const variant = (id: string, ...durations: number[]): VariantNode => ({
  id,
  name: id,
  microSteps: durations.map((d, i) => step(`${id}-${i}`, d)),
  cost: { amount: 0, currency: "EUR" },
});

const day: Day = {
  id: "d",
  date: "2026-05-14",
  startTimeMin: 8 * 60, // 08:00
  slots: [
    {
      id: "s1",
      title: "First",
      defaultVariantId: "fast",
      checkpoint: null,
      variants: [variant("fast", 10, 20), variant("slow", 60, 30)],
    },
    {
      id: "s2",
      title: "Second",
      defaultVariantId: "only",
      checkpoint: { label: "Boarding", timeMin: 9 * 60, bufferMin: 20 }, // 09:00
      variants: [variant("only", 15)],
    },
  ],
};

describe("variantDuration", () => {
  it("sums micro-step durations", () => {
    expect(variantDuration(variant("v", 9, 30, 3, 20))).toBe(62);
  });
});

describe("computeSchedule (ripple engine)", () => {
  it("chains each slot's start to the previous slot's end", () => {
    const rows = computeSchedule(day, { s1: "fast", s2: "only" });
    expect(rows[0].start).toBe(480);
    expect(rows[0].end).toBe(510); // 480 + 30
    expect(rows[1].start).toBe(510);
    expect(rows[1].end).toBe(525);
  });

  it("ripples downstream when the active variant changes", () => {
    const rows = computeSchedule(day, { s1: "slow", s2: "only" });
    expect(rows[0].end).toBe(570); // 480 + 90
    expect(rows[1].start).toBe(570);
  });

  it("falls back to the first variant for unknown active ids", () => {
    const rows = computeSchedule(day, {});
    expect(rows[0].variant.id).toBe("fast");
  });

  it("flags checkpoint ok when margin >= buffer", () => {
    // s1 fast: s2 starts 08:30, checkpoint 09:00 → margin 30 >= buffer 20
    const rows = computeSchedule(day, { s1: "fast", s2: "only" });
    expect(rows[1].checkpoint).toMatchObject({ margin: 30, status: "ok" });
  });

  it("flags checkpoint amber when 0 <= margin < buffer", () => {
    // start 08:45 → s2 starts 09:15... use slow variant: s2 starts 09:30 → late.
    // Shift day start instead: start 08:15, fast → s2 starts 08:45, margin 15.
    const rows = computeSchedule({ ...day, startTimeMin: 8 * 60 + 15 }, { s1: "fast", s2: "only" });
    expect(rows[1].checkpoint).toMatchObject({ margin: 15, status: "amber" });
  });

  it("flags checkpoint red when the slot starts after the checkpoint", () => {
    const rows = computeSchedule(day, { s1: "slow", s2: "only" });
    // s2 starts 09:30, checkpoint 09:00 → margin -30
    expect(rows[1].checkpoint).toMatchObject({ margin: -30, status: "red" });
  });

  it("treats margin exactly at the buffer as ok and at zero as amber", () => {
    const at = (startMin: number) =>
      computeSchedule({ ...day, startTimeMin: startMin }, { s1: "fast", s2: "only" })[1]
        .checkpoint!.status;
    expect(at(8 * 60 + 10)).toBe("ok"); // margin 20 == buffer
    expect(at(8 * 60 + 30)).toBe("amber"); // margin 0
  });
});
