import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/motis-map-trips.json";
import {
  fetchLiveSegments,
  MODE_COLORS,
  parseTripSegments,
  positionAt,
  TRANSITOUS_TRIPS_URL,
  vehicleFootprint,
  vehiclePositions,
  type LiveSegment,
} from "./liveTransit";

// The fixture is a trimmed, real /api/v6/map/trips response for central
// Bucharest (metro M3, tram 23, bus 73), recorded 2026-10-19.

const seg = (over: Partial<LiveSegment> = {}): LiveSegment => ({
  id: "t1@0",
  tripId: "t1",
  name: "1",
  mode: "tram",
  color: "#ff0000",
  departure: 1000,
  arrival: 3000,
  realTime: true,
  line: [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  cumM: [0, 100, 200],
  ...over,
});

describe("parseTripSegments", () => {
  it("parses the recorded MOTIS response", () => {
    const segs = parseTripSegments(fixture);
    expect(segs).toHaveLength(6);
    expect(segs.map((s) => [s.mode, s.name])).toEqual([
      ["metro", "M3"],
      ["metro", "M3"],
      ["metro", "M3"],
      ["metro", "M3"],
      ["tram", "23"],
      ["bus", "73"],
    ]);
    const tram = segs[4];
    expect(tram.color).toBe("#be1622");
    expect(tram.realTime).toBe(true);
    expect(tram.departure).toBe(Date.parse("2026-10-19T16:45:00Z"));
    expect(tram.line.length).toBeGreaterThan(1);
    // Decoded at precision 5 → coordinates land in Bucharest.
    expect(tram.line[0][0]).toBeGreaterThan(44.3);
    expect(tram.line[0][0]).toBeLessThan(44.6);
    expect(tram.line[0][1]).toBeGreaterThan(25.9);
    expect(tram.cumM[0]).toBe(0);
    expect(tram.cumM[tram.cumM.length - 1]).toBeGreaterThan(0);
  });

  it("drops malformed segments and maps unknown modes to 'other'", () => {
    const segs = parseTripSegments([
      { trips: [], departure: "2026-01-01T00:00:00Z", arrival: "2026-01-01T00:01:00Z", polyline: "_p~iF~ps|U_ulLnnqC" },
      { trips: [{ tripId: "x" }], departure: "nope", arrival: "2026-01-01T00:01:00Z", polyline: "_p~iF~ps|U_ulLnnqC" },
      { trips: [{ tripId: "y" }], departure: "2026-01-01T00:00:00Z", arrival: "2026-01-01T00:01:00Z" },
      {
        trips: [{ tripId: "z", displayName: "Z" }],
        mode: "HOVERCRAFT",
        departure: "2026-01-01T00:00:00Z",
        arrival: "2026-01-01T00:01:00Z",
        polyline: "_p~iF~ps|U_ulLnnqC",
      },
    ]);
    expect(segs.map((s) => [s.tripId, s.mode, s.color])).toEqual([["z", "other", MODE_COLORS.other]]);
    expect(parseTripSegments({ not: "an array" })).toEqual([]);
  });
});

describe("positionAt / vehiclePositions", () => {
  it("interpolates along the polyline by distance, with a heading", () => {
    expect(positionAt(seg(), 1000)).toMatchObject({ lat: 0, lon: 0 });
    const mid = positionAt(seg(), 2000)!; // halfway in time = 100 m = end of first leg
    expect(mid.lat).toBeCloseTo(0);
    expect(mid.lon).toBeCloseTo(1);
    const late = positionAt(seg(), 2500)!; // 150 m → halfway up the second leg
    expect(late.lat).toBeCloseTo(0.5);
    expect(late.bearing).toBeCloseTo(0, 0); // heading north
    expect(positionAt(seg(), 999)).toBeNull();
    expect(positionAt(seg(), 3001)).toBeNull();
  });

  it("returns one vehicle per running trip, preferring its later segment", () => {
    const vs = vehiclePositions(
      [
        seg(),
        seg({ id: "t1@3000", departure: 3000, arrival: 4000 }),
        seg({ id: "t2@0", tripId: "t2", departure: 5000, arrival: 6000 }), // not running yet
      ],
      3000
    );
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ id: "t1", lat: 0, lon: 0 }); // start of the later segment
  });
});

describe("fetchLiveSegments", () => {
  const bbox = { min: { lat: 44.42, lon: 26.08 }, max: { lat: 44.45, lon: 26.13 } };

  it("queries the bbox and time window and parses the response", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    const now = new Date("2026-10-19T16:47:00Z");
    const segs = await fetchLiveSegments(bbox, 14.6, now, 2, fetchFn as unknown as typeof fetch);
    expect(segs).toHaveLength(6);
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(`${url.origin}${url.pathname}`).toBe(TRANSITOUS_TRIPS_URL);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      zoom: "15",
      min: "44.42000,26.08000",
      max: "44.45000,26.13000",
      startTime: "2026-10-19T16:47:00Z",
      endTime: "2026-10-19T16:49:00Z",
    });
  });

  it("returns null on HTTP errors and network failures", async () => {
    const bad = vi.fn(async () => new Response("", { status: 500 }));
    expect(await fetchLiveSegments(bbox, 14, new Date(), 2, bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await fetchLiveSegments(bbox, 14, new Date(), 2, boom as unknown as typeof fetch)).toBeNull();
  });
});

describe("vehicleFootprint", () => {
  const v = { id: "b", name: "73", color: "#0f0", realTime: true, lat: 44.43, lon: 26.1 };
  it("orients a closed box along the heading, sized by mode", () => {
    const ring = vehicleFootprint({ ...v, mode: "bus", bearing: 0 })!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    const lats = ring.map((p) => p[0]);
    const lons = ring.map((p) => p[1]);
    const lenM = (Math.max(...lats) - Math.min(...lats)) * 111_320;
    const widM = (Math.max(...lons) - Math.min(...lons)) * 111_320 * Math.cos((44.43 * Math.PI) / 180);
    expect(lenM).toBeCloseTo(12, 1); // heading north: the long side runs north–south
    expect(widM).toBeCloseTo(2.6, 1);
  });

  it("draws metro (underground) as a dot, not a box", () => {
    expect(vehicleFootprint({ ...v, mode: "metro", bearing: 90 })).toBeNull();
  });
});
