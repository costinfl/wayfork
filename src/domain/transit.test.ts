import { describe, expect, it, vi } from "vitest";
import {
  decodePolyline,
  fetchTransitPlan,
  previousPlace,
  transitItineraryToVariant,
} from "./transit";
import { GROUND_TRANSIT_MODES, plausibleItinerary, type TransitItinerary } from "./transit";
import fcoDetour from "./__fixtures__/motis-plan-fco-detour.json";
import { variantGeometry } from "./geometry";
import type { Day } from "./types";

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("decodePolyline", () => {
  it("decodes the canonical Google polyline example (precision 5)", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    // This reference example is precision-5; MOTIS 2 (precision 6, the
    // module default) is exercised separately via fetchTransitPlan below.
    const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(decoded).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("previousPlace", () => {
  const day = (): Day => ({
    id: "d1",
    date: "2026-08-01",
    startTimeMin: 540,
    slots: [
      { id: "s1", title: "A", variants: [], defaultVariantId: "", checkpoint: null, place: { name: "A", lat: 1, lon: 1 } },
      { id: "s2", title: "B", variants: [], defaultVariantId: "", checkpoint: null, place: { name: "B", lat: 2, lon: 2 } },
      { id: "s3", title: "C", variants: [], defaultVariantId: "", checkpoint: null, place: { name: "C", lat: 3, lon: 3 } },
    ],
  });

  it("returns the previous slot's place", () => {
    expect(previousPlace(day(), "s2")?.name).toBe("A");
    expect(previousPlace(day(), "s3")?.name).toBe("B");
  });

  it("returns null for the first slot or an unknown id", () => {
    expect(previousPlace(day(), "s1")).toBeNull();
    expect(previousPlace(day(), "nope")).toBeNull();
  });
});

describe("fetchTransitPlan", () => {
  const from = { name: "Piata Unirii", lat: 44.43, lon: 26.1 };
  const to = { name: "Otopeni", lat: 44.57, lon: 26.08 };

  it("parses legs with mode mapping, duration/distance conversion, and geometry", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        itineraries: [
          {
            duration: 2700,
            legs: [
              {
                mode: "WALK",
                duration: 300,
                distance: 400,
                from: { name: "Piata Unirii", lat: 44.43, lon: 26.1 },
                to: { name: "Unirii M1", lat: 44.431, lon: 26.101 },
              },
              {
                mode: "SUBWAY",
                duration: 1800,
                distance: 12000,
                routeShortName: "M2",
                headsign: "Pipera",
                from: { name: "Unirii M1", lat: 44.431, lon: 26.101 },
                to: { name: "Pipera", lat: 44.5, lon: 26.09 },
                legGeometry: { points: "_p~iF~ps|U_ulLnnqC" },
              },
            ],
          },
        ],
      })
    );
    const itinerary = await fetchTransitPlan(from, to, fetchFn as unknown as typeof fetch);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain("fromPlace=44.43%2C26.1");
    expect(url).toContain("toPlace=44.57%2C26.08");

    // legGeometry.points is decoded at the module's precision (6, MOTIS 2's
    // convention) — decodePolyline's own correctness is covered above, so
    // here we only confirm the raw string is threaded through and decoded.
    expect(itinerary).toEqual({
      durationMin: 45,
      legs: [
        {
          type: "walk",
          label: "Walk to Unirii M1",
          durationMin: 5,
          distanceKm: 0.4,
          line: null,
          from: { name: "Piata Unirii", lat: 44.43, lon: 26.1 },
          to: { name: "Unirii M1", lat: 44.431, lon: 26.101 },
        },
        {
          type: "metro",
          label: "M2 → Pipera",
          durationMin: 30,
          distanceKm: 12,
          line: decodePolyline("_p~iF~ps|U_ulLnnqC"),
          from: { name: "Unirii M1", lat: 44.431, lon: 26.101 },
          to: { name: "Pipera", lat: 44.5, lon: 26.09 },
        },
      ],
    });
  });

  it("falls back to haversine distance/duration when a leg omits them", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        itineraries: [
          {
            legs: [
              {
                mode: "WALK",
                from: { lat: 44.43, lon: 26.1 },
                to: { lat: 44.431, lon: 26.101 },
              },
            ],
          },
        ],
      })
    );
    const itinerary = await fetchTransitPlan(from, to, fetchFn as unknown as typeof fetch);
    expect(itinerary?.legs).toHaveLength(1);
    expect(itinerary!.legs[0].distanceKm).toBeGreaterThan(0);
    expect(itinerary!.legs[0].durationMin).toBeGreaterThan(0);
  });

  it("maps an unrecognized mode to transfer instead of dropping the leg", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        itineraries: [
          { legs: [{ mode: "GONDOLA_LIFT_XYZ", duration: 600, distance: 1000 }] },
        ],
      })
    );
    const itinerary = await fetchTransitPlan(from, to, fetchFn as unknown as typeof fetch);
    expect(itinerary?.legs[0].type).toBe("transfer");
  });

  it("tries the plan.itineraries wrapper when top-level itineraries is absent", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        plan: {
          itineraries: [{ legs: [{ mode: "BUS", duration: 600, distance: 2000 }] }],
        },
      })
    );
    const itinerary = await fetchTransitPlan(from, to, fetchFn as unknown as typeof fetch);
    expect(itinerary?.legs[0].type).toBe("bus");
  });

  it("skips an itinerary with no usable legs and falls through to the next", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({
        itineraries: [
          { legs: [] },
          { legs: [{ mode: "WALK", duration: 60, distance: 80 }] },
        ],
      })
    );
    const itinerary = await fetchTransitPlan(from, to, fetchFn as unknown as typeof fetch);
    expect(itinerary?.legs).toHaveLength(1);
  });

  it("returns null on HTTP failure, empty itineraries, or a thrown error", async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    expect(await fetchTransitPlan(from, to, bad as unknown as typeof fetch)).toBeNull();

    const empty = vi.fn(async () => okJson({ itineraries: [] }));
    expect(await fetchTransitPlan(from, to, empty as unknown as typeof fetch)).toBeNull();

    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await fetchTransitPlan(from, to, boom as unknown as typeof fetch)).toBeNull();
  });
});

describe("transitItineraryToVariant", () => {
  const itinerary: TransitItinerary = {
    durationMin: 35,
    legs: [
      { type: "walk", label: "Walk to Unirii M1", durationMin: 5, distanceKm: 0.4, line: null, from: null, to: null },
      {
        type: "metro",
        label: "M2 → Pipera",
        durationMin: 30,
        distanceKm: 12,
        from: { name: "Unirii", lat: 44.43, lon: 26.1 },
        to: { name: "Pipera", lat: 44.5, lon: 26.09 },
        line: [
          [44.43, 26.1],
          [44.5, 26.09],
        ],
      },
    ],
  };

  it("builds an estimated variant with one micro-step per leg, geometry and endpoints on the steps", () => {
    const variant = transitItineraryToVariant(itinerary, "RON");
    expect(variant.name).toBe("Public transit");
    expect(variant.estimated).toBe(true);
    expect(variant.cost).toEqual({ amount: 0, currency: "RON" });
    expect(variant.microSteps.map((m) => [m.type, m.label, m.durationMin, m.distanceKm])).toEqual([
      ["walk", "Walk to Unirii M1", 5, 0.4],
      ["metro", "M2 → Pipera", 30, 12],
    ]);
    expect(variant.microSteps[0].geometry).toBeUndefined();
    expect(variant.microSteps[1]).toMatchObject({
      from: { name: "Unirii" },
      to: { name: "Pipera" },
      geometry: [
        [44.43, 26.1],
        [44.5, 26.09],
      ],
    });
    expect(variantGeometry(variant)).toEqual([
      [44.43, 26.1],
      [44.5, 26.09],
    ]);
  });

  it("omits geometry entirely when no leg carries a line", () => {
    const noLine: TransitItinerary = {
      durationMin: 5,
      legs: [{ type: "walk", label: "Walk", durationMin: 5, distanceKm: 0.4, line: null, from: null, to: null }],
    };
    const variant = transitItineraryToVariant(noLine, "EUR");
    expect(variant.microSteps[0].geometry).toBeUndefined();
    expect(variantGeometry(variant)).toBeNull();
  });
});

describe("fetchTransitPlan — sanity (FCO → Trastevere regression)", () => {
  // Trimmed, real /api/v6/plan answer for Rome Fiumicino → Trastevere with no
  // mode filter: both itineraries fly FCO → Cagliari → Brussels/Munich and take
  // 20–24 h. Drawing the first one sent the "Leonardo Express" through Europe.
  const fco = { name: "Rome Fiumicino (FCO)", lat: 41.8003, lon: 12.2389 };
  const trastevere = { name: "Trastevere, Rome", lat: 41.889, lon: 12.4693 };
  const plan = (body: unknown) => vi.fn(async () => okJson(body));

  it("asks for ground transit only, departing at a daytime hour", async () => {
    const fetchFn = plan({ itineraries: [] });
    await fetchTransitPlan(fco, trastevere, fetchFn as unknown as typeof fetch, { maxTravelTime: 201 });
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    const modes = url.searchParams.get("transitModes")!.split(",");
    expect(modes).toEqual([...GROUND_TRANSIT_MODES]);
    expect(modes).not.toContain("AIRPLANE");
    expect(url.searchParams.get("maxTravelTime")).toBe("201");
    const time = new Date(url.searchParams.get("time")!);
    expect(time.getTime()).toBeGreaterThan(Date.now());
    expect(time.getHours()).toBe(10);
  });

  it("rejects the recorded flight-and-detour itineraries", async () => {
    expect(await fetchTransitPlan(fco, trastevere, plan(fcoDetour) as unknown as typeof fetch)).toBeNull();
  });

  it("skips implausible itineraries and keeps the first believable one", async () => {
    const leonardo = {
      duration: 57 * 60,
      legs: [
        { mode: "REGIONAL_RAIL", duration: 32 * 60, from: fco, to: { name: "Roma Termini", lat: 41.901, lon: 12.5016 }, routeShortName: "FL1" },
        { mode: "TRAM", duration: 25 * 60, from: { name: "Roma Termini", lat: 41.901, lon: 12.5016 }, to: trastevere, routeShortName: "8" },
      ],
    };
    const it = await fetchTransitPlan(
      fco,
      trastevere,
      plan({ itineraries: [...fcoDetour.itineraries, leonardo] }) as unknown as typeof fetch
    );
    expect(it?.legs.map((l) => l.type)).toEqual(["train", "metro"]);
    expect(it?.durationMin).toBe(57);
  });

  it("enforces the travel-time cap on the client too", async () => {
    const slow = {
      duration: 300 * 60,
      legs: [{ mode: "BUS", duration: 300 * 60, from: fco, to: trastevere }],
    };
    expect(
      await fetchTransitPlan(fco, trastevere, plan({ itineraries: [slow] }) as unknown as typeof fetch, { maxTravelTime: 200 })
    ).toBeNull();
  });
});

describe("plausibleItinerary", () => {
  const a = { name: "a", lat: 41.9, lon: 12.5 };
  const b = { name: "b", lat: 41.91, lon: 12.51 }; // ~1.4 km
  const leg = (type: TransitItinerary["legs"][number]["type"], distanceKm: number) => ({
    type,
    label: type,
    durationMin: 10,
    distanceKm,
    line: null,
    from: null,
    to: null,
  });
  it("allows modest detours, short-hop slack, and rejects flights and wild detours", () => {
    expect(plausibleItinerary({ durationMin: 20, legs: [leg("metro", 4)] }, a, b)).toBe(true); // within +5 km
    expect(plausibleItinerary({ durationMin: 20, legs: [leg("metro", 9)] }, a, b)).toBe(false);
    expect(plausibleItinerary({ durationMin: 20, legs: [leg("flight", 1)] }, a, b)).toBe(false);
    expect(plausibleItinerary({ durationMin: 90, legs: [leg("bus", 2)] }, a, b, 60)).toBe(false);
  });
});
