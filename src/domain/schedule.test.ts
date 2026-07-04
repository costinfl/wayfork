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

  it("reports zero timezone offset/shift when no step crosses zones", () => {
    const rows = computeSchedule(day, { s1: "fast", s2: "only" });
    expect(rows.every((r) => r.tzOffsetMin === 0 && r.tzShiftMin === 0)).toBe(true);
  });
});

describe("computeSchedule (timezones)", () => {
  const cross: Day = {
    id: "d",
    date: "2026-05-14",
    startTimeMin: 8 * 60, // 08:00 in the start zone
    slots: [
      {
        id: "flight",
        title: "Flight",
        defaultVariantId: "vf",
        checkpoint: null,
        variants: [
          {
            id: "vf",
            name: "Booked",
            cost: { amount: 0, currency: "EUR" },
            microSteps: [
              { id: "board", type: "wait", label: "Boarding", durationMin: 30, distanceKm: null },
              { id: "fly", type: "flight", label: "A → B", durationMin: 120, distanceKm: null, tzShiftMin: -60 },
            ],
          },
        ],
      },
      {
        id: "arrive",
        title: "To hotel",
        defaultVariantId: "va",
        checkpoint: null,
        variants: [
          {
            id: "va",
            name: "Taxi",
            cost: { amount: 0, currency: "EUR" },
            microSteps: [{ id: "ride", type: "car", label: "Ride", durationMin: 30, distanceKm: 20 }],
          },
        ],
      },
    ],
  };

  it("applies the clock shift to the crossing slot's end and downstream", () => {
    const [flight, arrive] = computeSchedule(cross, {});
    // 08:00 + 150 elapsed - 60 tz = 09:30 local at destination
    expect(flight.start).toBe(8 * 60);
    expect(flight.duration).toBe(150);
    expect(flight.tzShiftMin).toBe(-60);
    expect(flight.end).toBe(9 * 60 + 30);
    // downstream slot runs in the arrival zone
    expect(arrive.tzOffsetMin).toBe(-60);
    expect(arrive.start).toBe(9 * 60 + 30);
    expect(arrive.end).toBe(10 * 60);
  });

  it("keeps a pre-crossing checkpoint in the departure zone", () => {
    const withCp: Day = {
      ...cross,
      slots: [
        {
          ...cross.slots[0],
          checkpoint: { label: "Boarding 08:20", timeMin: 8 * 60 + 20, bufferMin: 15 },
        },
        cross.slots[1],
      ],
    };
    const [flight] = computeSchedule(withCp, {});
    // margin measured against the slot's local start (08:00), not the shifted end
    expect(flight.checkpoint).toMatchObject({ margin: 20, status: "ok" });
  });
});
