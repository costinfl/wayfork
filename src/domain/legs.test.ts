import { describe, expect, it, vi } from "vitest";
import {
  legKey,
  limiter,
  provisionalLine,
  resolveLegLine,
  transitBudgetMin,
  variantLegs,
  type VariantLeg,
} from "./legs";
import type { MicroStep, Place, StepType, VariantNode } from "./types";

const P = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });
const A = P("A", 41.9, 12.5);
const B = P("B", 41.95, 12.55);
const step = (type: StepType, extra: Partial<MicroStep> = {}): MicroStep => ({
  id: `${type}-${Math.random()}`,
  type,
  label: type,
  durationMin: 10,
  distanceKm: null,
  ...extra,
});
const v = (...microSteps: MicroStep[]): VariantNode => ({
  id: "v",
  name: "v",
  cost: { amount: 0, currency: "EUR" },
  microSteps,
});
const profiles = (legs: VariantLeg[]) => legs.map((l) => l.profile);

describe("variantLegs", () => {
  it("sums the merged steps' minutes into the leg's budget", () => {
    const S = P("Station", 41.92, 12.52);
    const legs = variantLegs(
      v(step("walk", { durationMin: 8, to: S }), step("wait", { durationMin: 5 }), step("metro", { durationMin: 20 })),
      A,
      B
    );
    expect(legs.map((l) => l.durationMin)).toEqual([8, 20]); // waits don't travel
  });

  it("merges steps without endpoints into one leg with a combined profile", () => {
    expect(profiles(variantLegs(v(step("walk")), A, B))).toEqual(["foot"]);
    expect(profiles(variantLegs(v(step("walk"), step("metro"), step("walk")), A, B))).toEqual(["transit"]);
    expect(profiles(variantLegs(v(step("wait"), step("car")), A, B))).toEqual(["driving"]);
    expect(profiles(variantLegs(v(step("train")), A, B))).toEqual(["transit"]);
    expect(profiles(variantLegs(v(step("walk"), step("flight"), step("bus")), A, B))).toEqual(["arc"]);
  });

  it("splits at step endpoints, so each part gets its own profile", () => {
    const S = P("Station", 41.92, 12.52);
    const legs = variantLegs(v(step("walk", { to: S }), step("metro")), A, B);
    expect(legs.map((l) => [l.from.name, l.to.name, l.profile])).toEqual([
      ["A", "Station", "foot"],
      ["Station", "B", "transit"],
    ]);
  });

  it("uses a step's stored geometry as an exact leg, bridging to where it starts", () => {
    const S = P("Stop", 41.91, 12.51);
    const geo: [number, number][] = [
      [41.91, 12.51],
      [41.93, 12.53],
      [41.95, 12.55],
    ];
    const legs = variantLegs(v(step("walk"), step("bus", { from: S, geometry: geo })), A, B);
    expect(legs.map((l) => [l.from.name, l.profile, !!l.stored])).toEqual([
      ["A", "foot", false], // the walk to the stop
      ["Stop", "transit", true],
    ]);
    expect(legs[1].to).toMatchObject({ lat: 41.95, lon: 12.55 }); // ends at B → no extra leg
  });

  it("infers walking vs driving for movement no step describes", () => {
    const near = P("near", 41.905, 12.505);
    expect(profiles(variantLegs(v(step("wait")), A, near))).toEqual(["foot"]);
    expect(profiles(variantLegs(v(step("wait")), A, B))).toEqual(["driving"]); // ~7 km
    expect(variantLegs(v(step("walk")), A, A)).toEqual([]); // stayed put
  });
});

describe("provisionalLine", () => {
  it("is the stored line, an arc for flights, or straight", () => {
    const leg = (profile: VariantLeg["profile"], stored: [number, number][] | null = null): VariantLeg => ({
      from: A,
      to: B,
      profile,
      stored,
      durationMin: 10,
    });
    expect(provisionalLine(leg("foot", [[1, 2], [3, 4]]), 0.1)).toEqual([[1, 2], [3, 4]]);
    expect(provisionalLine(leg("arc"), 0.1).length).toBeGreaterThan(2);
    expect(provisionalLine(leg("transit"), 0.1)).toEqual([
      [A.lat, A.lon],
      [B.lat, B.lon],
    ]);
  });
});

describe("resolveLegLine", () => {
  const leg = (profile: VariantLeg["profile"], durationMin = 20): VariantLeg => ({
    from: A,
    to: B,
    profile,
    stored: null,
    durationMin,
  });
  const routers = (over: Partial<Parameters<typeof resolveLegLine>[1]> = {}) => ({
    route: vi.fn(async () => [[0, 0], [1, 1]] as [number, number][]),
    transit: vi.fn(async () => null),
    ...over,
  });

  it("routes foot and driving legs with their own profile", async () => {
    const r = routers();
    await resolveLegLine(leg("foot"), r);
    expect(r.route).toHaveBeenCalledWith(A, B, "foot");
    expect(r.transit).not.toHaveBeenCalled();
  });

  it("draws transit legs along a trip plan, bridging legs without a shape", async () => {
    const S = P("S", 41.93, 12.53);
    const r = routers({
      transit: vi.fn(async () => ({
        durationMin: 20,
        legs: [
          { type: "walk" as const, label: "w", durationMin: 5, distanceKm: 0.3, line: null, from: A, to: S },
          { type: "metro" as const, label: "M", durationMin: 15, distanceKm: 4, line: [[41.93, 12.53], [41.95, 12.55]] as [number, number][], from: S, to: B },
        ],
      })),
    });
    expect(await resolveLegLine(leg("transit"), r)).toEqual([
      [A.lat, A.lon],
      [S.lat, S.lon],
      [41.93, 12.53],
      [41.95, 12.55],
    ]);
    expect(r.route).not.toHaveBeenCalled();
  });

  it("caps the transit plan at ~3× the leg's own budget, between 1 and 10 hours", async () => {
    const r = routers();
    await resolveLegLine(leg("transit", 57), r); // Leonardo Express 32′ + tram 25′
    expect(r.transit).toHaveBeenCalledWith(A, B, { maxTravelTime: 201 });
    expect(transitBudgetMin(leg("transit", 5))).toBe(60);
    expect(transitBudgetMin(leg("transit", 400))).toBe(600);
  });

  it("falls back to a road route when no transit plan exists", async () => {
    const r = routers();
    await resolveLegLine(leg("transit"), r);
    expect(r.route).toHaveBeenCalledWith(A, B, "driving");
  });

  it("never routes flights or stored legs", async () => {
    const r = routers();
    expect(await resolveLegLine(leg("arc"), r)).toBeNull();
    expect(await resolveLegLine({ ...leg("foot"), stored: [[1, 1], [2, 2]] }, r)).toBeNull();
    expect(r.route).not.toHaveBeenCalled();
  });
});

describe("legKey / limiter", () => {
  it("keys legs by profile and endpoints", () => {
    expect(legKey({ from: A, to: B, profile: "foot", stored: null, durationMin: 5 })).toBe("foot:41.9,12.5;41.95,12.55");
  });

  it("runs at most n jobs at once", async () => {
    const run = limiter(2);
    let active = 0;
    let peak = 0;
    const job = () =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
  });
});
