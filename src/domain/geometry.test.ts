import { describe, expect, it } from "vitest";
import { dayTrack, offsetArc, variantProfile } from "./geometry";
import type { Day, ItinerarySlot, MicroStep, Place, StepType, VariantNode } from "./types";

const P = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

const step = (type: StepType): MicroStep => ({
  id: `ms-${type}-${Math.random()}`,
  type,
  label: type,
  durationMin: 10,
  distanceKm: null,
});

const variant = (id: string, ...types: StepType[]): VariantNode => ({
  id,
  name: id,
  cost: { amount: 0, currency: "EUR" },
  microSteps: types.length ? types.map(step) : [step("wait")],
});

const slot = (id: string, place: Place | null, variants: VariantNode[]): ItinerarySlot => ({
  id,
  title: id,
  variants,
  defaultVariantId: variants[0].id,
  checkpoint: null,
  place,
});

const day = (slots: ItinerarySlot[]): Day => ({
  id: "d1",
  date: "2026-07-08",
  startTimeMin: 540,
  slots,
});

describe("variantProfile", () => {
  it("maps the first non-wait step to a routing profile", () => {
    expect(variantProfile(variant("v", "walk"))).toBe("foot");
    expect(variantProfile(variant("v", "car"))).toBe("driving");
    expect(variantProfile(variant("v", "bus"))).toBe("driving");
    expect(variantProfile(variant("v", "shuttle"))).toBe("driving");
    expect(variantProfile(variant("v", "transfer"))).toBe("driving");
    expect(variantProfile(variant("v", "train"))).toBe("arc");
    expect(variantProfile(variant("v", "metro"))).toBe("arc");
    expect(variantProfile(variant("v", "flight"))).toBe("arc");
  });

  it("skips leading wait steps and falls back to arc when all are waits", () => {
    expect(variantProfile(variant("v", "wait", "walk"))).toBe("foot");
    expect(variantProfile(variant("v", "wait"))).toBe("arc");
  });
});

describe("dayTrack", () => {
  it("emits one active + N-1 alternative segments for a forked slot", () => {
    const a = variant("a", "metro");
    const b = variant("b", "car");
    const d = day([slot("s1", P("Rome", 41.9, 12.5), [a, b])]);

    const { segments } = dayTrack(d, { s1: "b" });
    expect(segments).toHaveLength(2);
    expect(segments.filter((s) => s.active)).toHaveLength(1);
    expect(segments.find((s) => s.active)?.variantId).toBe("b");
    expect(segments.find((s) => s.variantId === "a")?.active).toBe(false);
  });

  it("chains `from` across located slots and starts degenerate", () => {
    const A = P("A", 0, 0);
    const B = P("B", 1, 1);
    const d = day([
      slot("s1", A, [variant("v1", "walk")]),
      slot("s2", B, [variant("v2", "car")]),
    ]);
    const { segments } = dayTrack(d, {});
    // First slot: origin at its own place; second: origin at the previous place.
    expect(segments[0].from).toEqual(A);
    expect(segments[0].to).toEqual(A);
    expect(segments[1].from).toEqual(A);
    expect(segments[1].to).toEqual(B);
  });

  it("skips slots without a place, connecting across them, and collects unmapped", () => {
    const A = P("A", 0, 0);
    const C = P("C", 2, 2);
    const d = day([
      slot("s1", A, [variant("v1", "walk")]),
      slot("s2", null, [variant("v2", "walk")]),
      slot("s3", C, [variant("v3", "car")]),
    ]);
    const { segments, unmapped } = dayTrack(d, {});
    expect(unmapped).toEqual(["s2"]);
    expect(segments.map((s) => s.slotId)).toEqual(["s1", "s3"]);
    // s3 connects back to the last located place (A), skipping s2.
    expect(segments[1].from).toEqual(A);
    expect(segments[1].to).toEqual(C);
  });

  it("falls back to the slot's defaultVariantId when no active is given", () => {
    const d = day([slot("s1", P("X", 5, 5), [variant("a", "walk"), variant("b", "car")])]);
    const { segments } = dayTrack(d, {});
    expect(segments.find((s) => s.active)?.variantId).toBe("a");
  });
});

describe("offsetArc", () => {
  const from = P("F", 0, 0);
  const to = P("T", 0, 10);

  it("keeps the exact endpoints", () => {
    const pts = offsetArc(from, to, 0.3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([0, 10]);
  });

  it("degenerates to the straight chord when bend is 0", () => {
    const pts = offsetArc(from, to, 0);
    // The chord runs along the equator (lat 0) — every point stays on it.
    for (const [lat] of pts) expect(Math.abs(lat)).toBeLessThan(1e-9);
  });

  it("mirrors across the chord when the sign of bend flips", () => {
    const up = offsetArc(from, to, 0.4);
    const down = offsetArc(from, to, -0.4);
    for (let i = 0; i < up.length; i++) {
      expect(up[i][0]).toBeCloseTo(-down[i][0], 9); // lat mirrored
      expect(up[i][1]).toBeCloseTo(down[i][1], 9); // lon shared
    }
    // The midpoint actually bows away from the chord.
    const mid = up[Math.floor(up.length / 2)];
    expect(Math.abs(mid[0])).toBeGreaterThan(0.1);
  });
});
