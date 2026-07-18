import { describe, expect, it, vi } from "vitest";
import {
  decodePolyline,
  fetchTransitPlan,
  previousPlace,
  transitItineraryToVariant,
} from "./transit";
import type { TransitItinerary } from "./transit";
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
      { id: "s2", title: "B", variants: [], defaultVariantId: "", checkpoint: null },
      { id: "s3", title: "C", variants: [], defaultVariantId: "", checkpoint: null, place: { name: "C", lat: 3, lon: 3 } },
    ],
  });

  it("finds the nearest earlier placed slot, skipping unplaced ones", () => {
    expect(previousPlace(day(), "s2")?.name).toBe("A");
    expect(previousPlace(day(), "s3")?.name).toBe("A");
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
        { type: "walk", label: "Walk to Unirii M1", durationMin: 5, distanceKm: 0.4, line: null },
        {
          type: "metro",
          label: "M2 → Pipera",
          durationMin: 30,
          distanceKm: 12,
          line: decodePolyline("_p~iF~ps|U_ulLnnqC"),
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
      { type: "walk", label: "Walk to Unirii M1", durationMin: 5, distanceKm: 0.4, line: null },
      {
        type: "metro",
        label: "M2 → Pipera",
        durationMin: 30,
        distanceKm: 12,
        line: [
          [44.43, 26.1],
          [44.5, 26.09],
        ],
      },
    ],
  };

  it("builds an estimated variant with one micro-step per leg and concatenated geometry", () => {
    const variant = transitItineraryToVariant(itinerary, "RON");
    expect(variant.name).toBe("Public transit");
    expect(variant.estimated).toBe(true);
    expect(variant.cost).toEqual({ amount: 0, currency: "RON" });
    expect(variant.microSteps.map((m) => [m.type, m.label, m.durationMin, m.distanceKm])).toEqual([
      ["walk", "Walk to Unirii M1", 5, 0.4],
      ["metro", "M2 → Pipera", 30, 12],
    ]);
    expect(variant.geometry).toEqual([
      [44.43, 26.1],
      [44.5, 26.09],
    ]);
  });

  it("omits geometry entirely when no leg carries a line", () => {
    const noLine: TransitItinerary = {
      durationMin: 5,
      legs: [{ type: "walk", label: "Walk", durationMin: 5, distanceKm: 0.4, line: null }],
    };
    const variant = transitItineraryToVariant(noLine, "EUR");
    expect(variant.geometry).toBeUndefined();
  });
});
