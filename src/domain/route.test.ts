import { describe, expect, it, vi } from "vitest";
import { estimateLeg, fetchRoute } from "./route";
import type { Place } from "./types";

const P = (lat: number, lon: number): Place => ({ name: `${lat},${lon}`, lat, lon });

const okResponse = (coords: [number, number][], duration = 0, distance = 0) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ routes: [{ geometry: { coordinates: coords }, duration, distance }] }),
  }) as Response;

describe("fetchRoute", () => {
  it("returns null for the arc profile without fetching", async () => {
    const fetchFn = vi.fn();
    expect(await fetchRoute(P(1, 2), P(3, 4), "arc", fetchFn as unknown as typeof fetch)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("requests lon,lat order and flips the GeoJSON coordinates back to lat,lon", async () => {
    let url = "";
    const fetchFn = (async (u: string) => {
      url = String(u);
      // OSRM returns [lon, lat].
      return okResponse([
        [12.5, 41.9],
        [12.6, 42.0],
      ]);
    }) as unknown as typeof fetch;

    const line = await fetchRoute(P(41.9, 12.5), P(42.0, 12.6), "driving", fetchFn);
    expect(url).toContain("/driving/12.5,41.9;12.6,42");
    expect(line).toEqual([
      [41.9, 12.5],
      [42.0, 12.6],
    ]);
  });

  it("returns null on HTTP errors and on thrown errors", async () => {
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await fetchRoute(P(10, 10), P(11, 11), "foot", bad)).toBeNull();

    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchRoute(P(20, 20), P(21, 21), "foot", boom)).toBeNull();
  });

  it("caches a successful result so the same route is not fetched twice", async () => {
    const fetchFn = vi.fn(async () => okResponse([[1, 2]])) as unknown as typeof fetch;
    const from = P(50, 60);
    const to = P(51, 61);

    const first = await fetchRoute(from, to, "driving", fetchFn);
    const second = await fetchRoute(from, to, "driving", fetchFn);
    expect(first).toEqual(second);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("estimateLeg", () => {
  it("walks short hops, deriving the duration from the routed distance", async () => {
    // ~1 km apart; OSRM says 1.2 km — walk time comes from distance (12 min/km),
    // never from the demo server's driving-profile duration.
    const fetchFn = (async (u: string) => {
      expect(String(u)).toContain("/foot/");
      return okResponse([[12.5, 41.9]], 99, 1200);
    }) as unknown as typeof fetch;
    const leg = await estimateLeg(P(41.9, 12.5), P(41.909, 12.5), fetchFn);
    expect(leg).toEqual({ type: "walk", durationMin: 14, distanceKm: 1.2 });
  });

  it("drives beyond 2.5 km using OSRM duration and distance", async () => {
    const fetchFn = (async (u: string) => {
      expect(String(u)).toContain("/driving/");
      return okResponse([[12.5, 41.9]], 1200, 12000);
    }) as unknown as typeof fetch;
    const leg = await estimateLeg(P(41.9, 12.5), P(42.0, 12.5), fetchFn);
    expect(leg).toEqual({ type: "car", durationMin: 20, distanceKm: 12 });
  });

  it("falls back to a haversine ×1.3 estimate when OSRM is down", async () => {
    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const walk = await estimateLeg(P(10, 10), P(10.009, 10), boom); // ~1.0 km
    expect(walk.type).toBe("walk");
    expect(walk.distanceKm).toBeCloseTo(1.3, 1);
    expect(walk.durationMin).toBe(Math.round(walk.distanceKm * 12));

    const drive = await estimateLeg(P(10, 10), P(10.09, 10), boom); // ~10 km
    expect(drive.type).toBe("car");
    expect(drive.durationMin).toBe(Math.round((drive.distanceKm / 30) * 60));
  });
});
