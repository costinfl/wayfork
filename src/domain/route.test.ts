import { describe, expect, it, vi } from "vitest";
import { fetchRoute } from "./route";
import type { Place } from "./types";

const P = (lat: number, lon: number): Place => ({ name: `${lat},${lon}`, lat, lon });

const okResponse = (coords: [number, number][]) =>
  ({ ok: true, status: 200, json: async () => ({ routes: [{ geometry: { coordinates: coords } }] }) }) as Response;

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
