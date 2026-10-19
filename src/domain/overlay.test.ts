import { describe, expect, it } from "vitest";
import { RATES_EUR } from "./currency";
import { ACTIVE_COLOR, ALT_COLORS, deltaLabel, tripOverlay } from "./overlay";
import type { ItinerarySlot, Place, StepType, Trip, VariantNode } from "./types";

const P = (name: string, lat: number, lon: number, estimated?: boolean): Place => ({
  name,
  lat,
  lon,
  ...(estimated ? { estimated } : {}),
});
const variant = (
  id: string,
  type: StepType,
  durationMin: number,
  cost: number,
  extra: Partial<VariantNode> = {}
): VariantNode => ({
  id,
  name: id,
  cost: { amount: cost, currency: "EUR" },
  microSteps: [{ id: `${id}-m`, type, label: id, durationMin, distanceKm: 2 }],
  ...extra,
});
const slot = (id: string, place: Place, variants: VariantNode[]): ItinerarySlot => ({
  id,
  title: id,
  place,
  checkpoint: null,
  defaultVariantId: variants[0].id,
  variants,
});
const A = P("A", 0, 0);
const B = P("B", 1, 1);
const C = P("C", 2, 2, true);

const trip: Trip = {
  schemaVersion: 2,
  id: "t",
  name: "t",
  participants: [{ id: "p", name: "P" }],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [
    {
      id: "d1",
      date: "2026-05-01",
      startTimeMin: 540,
      slots: [
        slot("s1", A, [variant("s1v", "walk", 5, 0)]),
        slot("s2", B, [
          variant("metro", "metro", 30, 2),
          variant("taxi", "car", 15, 20, { estimated: true }),
          variant("bike", "walk", 40, 0),
        ]),
      ],
    },
    { id: "d2", date: "2026-05-02", startTimeMin: 540, slots: [slot("s3", C, [variant("s3v", "train", 60, 30)])] },
  ],
  expenses: [],
};

const overlay = (active: Record<string, string> = {}, ccy = "EUR") =>
  tripOverlay(trip, active, { rates: RATES_EUR, ccy });

describe("tripOverlay", () => {
  it("draws every variant of every day, skipping the degenerate origin", () => {
    const { tracks } = overlay();
    expect(tracks.map((t) => t.key)).toEqual(["s2:metro", "s2:taxi", "s2:bike", "s3:s3v"]);
    expect(tracks.map((t) => t.dayIdx)).toEqual([0, 0, 0, 1]);
  });

  it("connects a day's first slot from the previous day's last place", () => {
    const s3 = overlay().tracks.find((t) => t.slotId === "s3")!;
    expect(s3.from).toEqual(B);
    expect(s3.to).toEqual(C);
  });

  it("computes Δtime and Δcost against the active variant", () => {
    const byKey = Object.fromEntries(overlay().tracks.map((t) => [t.key, t]));
    expect(byKey["s2:metro"]).toMatchObject({ active: true, deltaMin: 0, deltaCost: 0, color: ACTIVE_COLOR });
    expect(byKey["s2:taxi"]).toMatchObject({ active: false, deltaMin: -15, deltaCost: 18, color: ALT_COLORS[0] });
    expect(byKey["s2:bike"]).toMatchObject({ deltaMin: 10, deltaCost: -2, color: ALT_COLORS[1] });
  });

  it("follows the UI's active selection, re-basing the deltas", () => {
    const byKey = Object.fromEntries(overlay({ s2: "taxi" }).tracks.map((t) => [t.key, t]));
    expect(byKey["s2:taxi"]).toMatchObject({ active: true, deltaMin: 0 });
    expect(byKey["s2:metro"]).toMatchObject({ active: false, deltaMin: 15, deltaCost: -18 });
  });

  it("converts costs into the view currency", () => {
    const taxi = overlay({}, "RON").tracks.find((t) => t.key === "s2:taxi")!;
    expect(taxi.cost).toBeCloseTo(20 * RATES_EUR.RON);
  });

  it("builds every variant's line from its micro-step legs — arcs only for flights", () => {
    const stored: [number, number][] = [
      [0, 0],
      [0.5, 0.2],
      [1, 1],
    ];
    const t2: Trip = structuredClone(trip);
    t2.days[0].slots[1].variants[2].microSteps[0].geometry = stored;
    t2.days[0].slots[1].variants.push(variant("fly", "flight", 60, 90));
    const byKey = Object.fromEntries(
      tripOverlay(t2, { s2: "taxi" }, { rates: RATES_EUR, ccy: "EUR" }).tracks.map((t) => [t.key, t])
    );
    const straight = [
      [0, 0],
      [1, 1],
    ];
    expect(byKey["s2:bike"]).toMatchObject({ line: stored, labelAt: [0.5, 0.2] });
    expect(byKey["s2:bike"].legs[0]).toMatchObject({ profile: "foot", stored });
    // Ground and transit legs — active or not — start straight; the map routes them.
    expect(byKey["s2:taxi"]).toMatchObject({ line: straight, legs: [{ profile: "driving" }] });
    expect(byKey["s2:metro"]).toMatchObject({ line: straight, legs: [{ profile: "transit" }] });
    // A flight is the only arc.
    expect(byKey["s2:fly"].legs[0].profile).toBe("arc");
    expect(byKey["s2:fly"].line.length).toBeGreaterThan(2);
    expect(byKey["s2:metro"].altIndex).toBe(0);
    expect(byKey["s2:taxi"].altIndex).toBe(-1);
  });

  it("flags estimated variants and estimated endpoints", () => {
    const byKey = Object.fromEntries(overlay().tracks.map((t) => [t.key, t]));
    expect(byKey["s2:taxi"].estimated).toBe(true); // variant flag
    expect(byKey["s2:metro"].estimated).toBe(false);
    expect(byKey["s3:s3v"].estimated).toBe(true); // C is an estimated place
  });

  it("lists every stop with its day-local marker number", () => {
    expect(overlay().stops.map((s) => [s.slotId, s.dayIdx, s.number, s.estimated])).toEqual([
      ["s1", 0, 1, false],
      ["s2", 0, 2, false],
      ["s3", 1, 1, true],
    ]);
  });
});

describe("ALT_COLORS", () => {
  it("never uses the map's 'estimated' orange/amber for an alternative", () => {
    expect(ALT_COLORS).not.toContain("#f59e0b");
    expect(ALT_COLORS).not.toContain(ACTIVE_COLOR);
    expect(new Set(ALT_COLORS).size).toBe(ALT_COLORS.length);
  });
});

describe("deltaLabel", () => {
  it("formats signed minutes and money, or 'same'", () => {
    expect(deltaLabel({ deltaMin: 25, deltaCost: 12.4 }, "EUR")).toBe("+25 min · +€12");
    expect(deltaLabel({ deltaMin: -10, deltaCost: 0 }, "EUR")).toBe("−10 min");
    expect(deltaLabel({ deltaMin: 0, deltaCost: -3 }, "USD")).toBe("−$3");
    expect(deltaLabel({ deltaMin: 0, deltaCost: 0.2 }, "EUR")).toBe("same");
  });
});
