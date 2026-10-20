import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/motis-one-to-all.json";
import { distanceM } from "./poi";
import {
  fetchReachableStops,
  parseOneToAll,
  reachBands,
  reachMinutes,
  reachRadiusM,
  TRANSITOUS_ONE_TO_ALL_URL,
  WALK_KMH,
  type ReachBand,
} from "./reach";

// The fixture is a trimmed, real /api/v6/one-to-all response from central
// Bucharest (Piața Universității, 30-minute budget), recorded 2026-10-19.

const origin = { name: "Universitate", lat: 44.4355, lon: 26.1025 };

// Does any rect of the band contain the point?
const covers = (band: ReachBand, lat: number, lon: number) =>
  band.rects.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
const bandAt = (bands: ReachBand[], lat: number, lon: number) =>
  bands.findIndex((b) => covers(b, lat, lon));

describe("parseOneToAll", () => {
  it("parses the recorded response's reachable stops", () => {
    const stops = parseOneToAll(fixture);
    expect(stops).toHaveLength(40);
    expect(stops[0]).toEqual({ lat: 44.4473, lon: 26.073153, durationMin: 25 });
  });

  it("skips malformed entries", () => {
    expect(parseOneToAll({ all: [{ place: { lat: 1 } , duration: 3 }, { duration: 2 }, { place: { lat: 1, lon: 2 }, duration: 4 }] })).toEqual([
      { lat: 1, lon: 2, durationMin: 4 },
    ]);
    expect(parseOneToAll(null)).toEqual([]);
  });
});

describe("reachBands", () => {
  it("walking only: concentric bands at walking speed", () => {
    const bands = reachBands(origin, [], [15, 30], 60);
    const mPerMin = (WALK_KMH * 1000) / 60;
    const north = (m: number) => origin.lat + m / 111_320;
    expect(bandAt(bands, north(10 * mPerMin), origin.lon)).toBe(0); // 10 min walk
    expect(bandAt(bands, north(22 * mPerMin), origin.lon)).toBe(1); // 22 min walk
    expect(bandAt(bands, north(40 * mPerMin), origin.lon)).toBe(-1); // out of reach
  });

  it("transit stops extend reach beyond walking distance", () => {
    // A stop ~5 km away reached in 10 min: nearby points fall in the 15-min band.
    const far = { lat: origin.lat + 0.045, lon: origin.lon, durationMin: 10 };
    expect(distanceM(origin, far)).toBeGreaterThan(4900);
    const walkOnly = reachBands(origin, [], [15, 30], 80);
    const withStop = reachBands(origin, [far], [15, 30], 80);
    expect(bandAt(walkOnly, far.lat, far.lon)).toBe(-1);
    expect(bandAt(withStop, far.lat, far.lon)).toBe(0);
  });

  it("cells never overlap across bands", () => {
    const bands = reachBands(origin, parseOneToAll(fixture), [15, 30], 40);
    for (let i = 0; i < 50; i++) {
      const lat = origin.lat + (Math.random() - 0.5) * 0.1;
      const lon = origin.lon + (Math.random() - 0.5) * 0.1;
      expect(bands.filter((b) => covers(b, lat, lon)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("reachMinutes / reachRadiusM", () => {
  const bands = reachBands(origin, [], [15, 30], 60);
  const mPerMin = (WALK_KMH * 1000) / 60;
  const north = (m: number) => ({ lat: origin.lat + m / 111_320, lon: origin.lon });

  it("gives the band a point falls in, or null outside", () => {
    expect(reachMinutes(bands, north(5 * mPerMin))).toBe(15);
    expect(reachMinutes(bands, north(22 * mPerMin))).toBe(30);
    expect(reachMinutes(bands, north(40 * mPerMin))).toBeNull();
  });

  it("covers every band up to the limit, and grows with it", () => {
    const r15 = reachRadiusM(origin, bands, 15);
    const r30 = reachRadiusM(origin, bands, 30);
    expect(r15).toBeGreaterThanOrEqual(15 * mPerMin);
    expect(r15).toBeLessThan(15 * mPerMin * 1.6);
    expect(r30).toBeGreaterThan(r15);
    expect(reachRadiusM(origin, bands, 10)).toBe(0);
  });
});

describe("fetchReachableStops", () => {
  it("queries one-to-all for the origin and budget", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    const stops = await fetchReachableStops(origin, 45, new Date("2026-10-19T16:47:00Z"), fetchFn as unknown as typeof fetch);
    expect(stops).toHaveLength(40);
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(`${url.origin}${url.pathname}`).toBe(TRANSITOUS_ONE_TO_ALL_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      one: "44.4355,26.1025",
      maxTravelTime: "45",
      time: "2026-10-19T16:47:00Z",
    });
  });

  it("returns null when the service fails", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await fetchReachableStops(origin, 30, new Date(), boom as unknown as typeof fetch)).toBeNull();
  });
});
