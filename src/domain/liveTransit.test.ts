import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/motis-map-trips.json";
import nycTrip from "./__fixtures__/motis-trip-nyc-qm32.json";
import {
  fetchLiveSegments,
  fetchTripDetails,
  MODE_COLORS,
  parseTripDetails,
  TRANSITOUS_TRIP_URL,
  tripProgress,
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

describe("trip details (tap a vehicle)", () => {
  // Real /api/v6/trip answer for NYC bus QM32 (2026-10-19), trimmed to 6 stops.
  // The alert was added for this test; the real trip had none.
  const tripId = "20261019_16:35_us-ny-MTA-BusCompany_47351415-CPPD6-CP_D6-Weekday-04-SDon";

  it("parses headsign, route, agency, stops, accessibility and shape", () => {
    const d = parseTripDetails(tripId, nycTrip)!;
    expect(d).toMatchObject({
      tripId,
      name: "QM32",
      longName: "Bay Terrace - Midtown Express",
      headsign: "BAY TERRACE BELL BL via WHITESTONE EXPWY",
      agency: "MTA Bus Company",
      mode: "bus",
      realTime: true,
      cancelled: false,
      wheelchair: false,
      bikes: false,
      alerts: ["Buses detoured at E 57 St due to street fair"],
    });
    expect(d.stops.map((s) => s.name)).toEqual([
      "3 AV/E 39 ST",
      "3 AV/E 43 ST",
      "3 AV/E 48 ST",
      "3 AV/E 55 ST",
      expect.any(String),
      "212 ST/15 AV",
    ]);
    expect(d.stops[0]).toMatchObject({ tz: "America/New_York", departure: Date.parse("2026-10-19T20:35:00Z") });
    expect(d.stops[5]).toMatchObject({
      arrival: Date.parse("2026-10-19T22:00:00Z"),
      scheduledArrival: Date.parse("2026-10-19T22:01:00Z"),
    });
    // Shape decoded at the response's precision (6) → lands in New York.
    expect(d.line.length).toBeGreaterThan(100);
    expect(d.line[0][0]).toBeCloseTo(40.749, 2);
    expect(d.line[0][1]).toBeCloseTo(-73.976, 2);
  });

  it("returns null for an itinerary without a transit leg", () => {
    expect(parseTripDetails("x", { legs: [{ mode: "WALK" }] })).toBeNull();
    expect(parseTripDetails("x", null)).toBeNull();
  });

  it("fetches by tripId, caches successes, and returns null on failure", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(nycTrip), { status: 200 }));
    const a = await fetchTripDetails("cache-me", fetchFn as unknown as typeof fetch);
    const b = await fetchTripDetails("cache-me", fetchFn as unknown as typeof fetch);
    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL((fetchFn.mock.calls[0] as unknown as [string])[0]);
    expect(`${url.origin}${url.pathname}`).toBe(TRANSITOUS_TRIP_URL);
    expect(url.searchParams.get("tripId")).toBe("cache-me");

    const bad = vi.fn(async () => new Response("", { status: 404 }));
    expect(await fetchTripDetails("missing", bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await fetchTripDetails("offline", boom as unknown as typeof fetch)).toBeNull();
  });

  it("tracks progress: next stop, delay and arrival", () => {
    const d = parseTripDetails(tripId, nycTrip)!;
    const at = (iso: string) => Date.parse(iso);
    expect(tripProgress(d, at("2026-10-19T20:36:00Z"))).toMatchObject({ nextIndex: 1, delayMin: 0, finished: false });
    // Between the last intermediate stop and the end: the end stop is 1 min early.
    const nearEnd = tripProgress(d, d.stops[4].arrival! + 60_000);
    expect(nearEnd).toMatchObject({ nextIndex: 5, delayMin: -1, finished: false });
    expect(tripProgress(d, at("2026-10-19T23:00:00Z"))).toMatchObject({ nextIndex: 6, finished: true });
    // Without real-time data there is no delay to report.
    expect(tripProgress({ ...d, realTime: false }, at("2026-10-19T20:36:00Z")).delayMin).toBeNull();
  });
});
