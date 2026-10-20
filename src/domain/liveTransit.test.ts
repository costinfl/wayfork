import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/motis-map-trips.json";
import nycTrip from "./__fixtures__/motis-trip-nyc-qm32.json";
import lisbonStops from "./__fixtures__/motis-map-stops-lisbon.json";
import lisbonStopTimes from "./__fixtures__/motis-stoptimes-lisbon.json";
import {
  countByCategory,
  fetchDepartures,
  filterVehicles,
  isTrolleybusRouteType,
  lineKey,
  vehicleCategory,
  type Vehicle,
  fetchLiveSegments,
  fetchStopsInView,
  fetchTripDetails,
  parseDepartures,
  parseStops,
  TRANSITOUS_STOPS_URL,
  TRANSITOUS_STOPTIMES_URL,
  MODE_COLORS,
  parseTripDetails,
  TRANSITOUS_TRIP_URL,
  tripProgress,
  tripSegmentLine,
  tripSlotTitle,
  tripToVariant,
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

describe("use a live trip in the plan", () => {
  const d = parseTripDetails("qm32", nycTrip)!;

  it("turns a ride between two stops into an estimated variant with its real line", () => {
    const v = tripToVariant(d, 1, 5, { currency: "USD" });
    expect(v).toMatchObject({
      name: "Bus QM32 3 AV/E 43 ST → 212 ST/15 AV",
      estimated: true,
      cost: { amount: 0, currency: "USD" },
    });
    expect(v.microSteps).toHaveLength(1);
    const ride = v.microSteps[0];
    expect(ride).toMatchObject({
      type: "bus",
      label: "Bus QM32 → BAY TERRACE BELL BL via WHITESTONE EXPWY",
      durationMin: 83, // 20:37Z → 22:00Z
      from: { name: "3 AV/E 43 ST" },
      to: { name: "212 ST/15 AV" },
    });
    expect(ride.distanceKm).toBeGreaterThan(5);
    expect(ride.geometry!.length).toBeGreaterThan(2);
    expect(tripSlotTitle(d, 1, 5)).toBe("Bus QM32: 3 AV/E 43 ST → 212 ST/15 AV");
  });

  it("cuts the route shape to the ride, in travel order", () => {
    const whole = tripSegmentLine(d, 0, 5);
    const part = tripSegmentLine(d, 1, 3);
    expect(part.length).toBeLessThan(whole.length);
    const first = d.stops[1];
    const last = d.stops[3];
    const near = (p: [number, number], s: { lat: number; lon: number }) =>
      Math.abs(p[0] - s.lat) < 0.002 && Math.abs(p[1] - s.lon) < 0.002;
    expect(near(part[0], first)).toBe(true);
    expect(near(part[part.length - 1], last)).toBe(true);
    // Without a shape: straight stop → stop.
    expect(tripSegmentLine({ ...d, line: [] }, 1, 3)).toEqual([
      [first.lat, first.lon],
      [last.lat, last.lon],
    ]);
  });

  it("adds walks to the boarding stop and on to the slot, only for gaps of 100 m – 3 km", () => {
    const board = d.stops[1];
    const farAway = { name: "Hotel", lat: board.lat + 0.005, lon: board.lon }; // ~550 m
    const nextDoor = { name: "Kiosk", lat: board.lat + 0.0005, lon: board.lon }; // ~55 m
    const v = tripToVariant(d, 1, 3, { currency: "USD", walkFrom: farAway, walkTo: farAway });
    expect(v.microSteps.map((m) => [m.type, m.label])).toEqual([
      ["walk", "Walk to 3 AV/E 43 ST"],
      ["bus", "Bus QM32 → BAY TERRACE BELL BL via WHITESTONE EXPWY"],
      ["walk", "Walk to Hotel"],
    ]);
    expect(v.microSteps[0].durationMin).toBe(7); // ~555 m at 4.8 km/h
    expect(tripToVariant(d, 1, 3, { currency: "USD", walkFrom: nextDoor }).microSteps).toHaveLength(1);
    const otherCity = { name: "Newark", lat: 40.73, lon: -74.17 }; // ~16 km: not a walk
    expect(tripToVariant(d, 1, 3, { currency: "USD", walkFrom: otherCity }).microSteps).toHaveLength(1);
  });
});

describe("stops and departures board", () => {
  // Real Lisbon responses (2026-10-20), trimmed; the stops list ends with a
  // repeat of its first stop to exercise de-duplication.

  it("parses stops in view, de-duplicated, with their modes", () => {
    const stops = parseStops(lisbonStops);
    expect(stops.map((s) => [s.name, s.modes])).toEqual([
      ["Sul e Sueste", ["bus"]],
      ["Sul e Sueste", ["bus"]],
      ["Costa Castelo", ["bus"]],
      ["Terreiro do Paço", ["metro"]],
      ["Lisboa Rossio", ["rail"]],
    ]);
    expect(new Set(stops.map((s) => s.stopId)).size).toBe(5);
    expect(stops[0]).toMatchObject({ tz: "Europe/Lisbon" });
    expect(parseStops({ nope: true })).toEqual([]);
  });

  it("parses departures, sorted, with delay only when real-time", () => {
    const deps = parseDepartures(lisbonStopTimes);
    expect(deps).toHaveLength(6);
    expect(deps[0]).toMatchObject({
      name: "711",
      mode: "bus",
      headsign: "Alto Damaia",
      departure: Date.parse("2026-10-20T05:00:00Z"),
      realTime: false,
      delayMin: null,
      cancelled: false,
      tz: "Europe/Lisbon",
    });
    expect(deps.map((d) => d.departure)).toEqual([...deps.map((d) => d.departure)].sort((a, b) => a - b));
    const late = parseDepartures({
      stopTimes: [
        {
          tripId: "t",
          mode: "TRAM",
          realTime: true,
          routeShortName: "28E",
          place: { departure: "2026-10-20T10:04:00Z", scheduledDeparture: "2026-10-20T10:00:00Z", track: "2" },
        },
      ],
    });
    expect(late[0]).toMatchObject({ mode: "tram", delayMin: 4, track: "2" });
    expect(parseDepartures(null)).toEqual([]);
  });

  it("requests the bbox and the stop's next departures; null on failure", async () => {
    const stopsFetch = vi.fn(async () => new Response(JSON.stringify(lisbonStops), { status: 200 }));
    await fetchStopsInView({ min: { lat: 38.705, lon: -9.145 }, max: { lat: 38.715, lon: -9.13 } }, stopsFetch as unknown as typeof fetch);
    const su = new URL((stopsFetch.mock.calls[0] as unknown as [string])[0]);
    expect(`${su.origin}${su.pathname}`).toBe(TRANSITOUS_STOPS_URL);
    expect(su.searchParams.get("min")).toBe("38.70500,-9.14500");

    const depFetch = vi.fn(async () => new Response(JSON.stringify(lisbonStopTimes), { status: 200 }));
    expect(await fetchDepartures("pt-Carris_4509", depFetch as unknown as typeof fetch, { n: 8 })).toHaveLength(6);
    const du = new URL((depFetch.mock.calls[0] as unknown as [string])[0]);
    expect(`${du.origin}${du.pathname}`).toBe(TRANSITOUS_STOPTIMES_URL);
    expect(Object.fromEntries(du.searchParams)).toEqual({ stopId: "pt-Carris_4509", n: "8" });

    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await fetchDepartures("x", boom as unknown as typeof fetch)).toBeNull();
    expect(await fetchStopsInView({ min: { lat: 0, lon: 0 }, max: { lat: 1, lon: 1 } }, boom as unknown as typeof fetch)).toBeNull();
  });

  it("keeps stop ids on a trip's stops, so they can open the board", () => {
    const d = parseTripDetails("x", {
      legs: [
        {
          mode: "BUS",
          from: { stopId: "a", name: "A", lat: 1, lon: 1 },
          to: { stopId: "b", name: "B", lat: 2, lon: 2 },
        },
      ],
    })!;
    expect(d.stops.map((s) => s.stopId)).toEqual(["a", "b"]);
  });
});

describe("filter by transport type", () => {
  const v = (id: string, name: string, mode: Vehicle["mode"]): Vehicle => ({
    id,
    name,
    mode,
    color: "#000",
    lat: 44.43,
    lon: 26.1,
    bearing: 0,
    realTime: true,
  });
  const bus = v("20261020_16:30_ro-Bucuresti-Ilfov_TRIP_A", "100", "bus");
  const trolley = v("20261020_16:30_ro-Bucuresti-Ilfov_TRIP_B", "66", "bus");
  const tram = v("20261020_16:31_ro-Bucuresti-Ilfov_TRIP_C", "23", "tram");
  const metro = v("20261020_16:32_ro-Bucuresti-Ilfov_TRIP_D", "M3", "metro");
  const all = [bus, trolley, tram, metro];
  const trolleyLines = new Map([[lineKey(trolley.id, "66"), true], [lineKey(bus.id, "100"), false]]);

  it("recognises trolleybus route types (GTFS 11 and extended 800–899)", () => {
    expect([11, 800, 899].map(isTrolleybusRouteType)).toEqual([true, true, true]);
    expect([3, 700, 900, undefined].map(isTrolleybusRouteType)).toEqual([false, false, false, false]);
  });

  it("keys lines by dataset and name", () => {
    expect(lineKey(trolley.id, "66")).toBe("ro-Bucuresti-Ilfov|66");
    expect(lineKey("weird-id", "66")).toBe("|66");
  });

  it("splits trolleybuses from buses and counts each type", () => {
    expect(vehicleCategory(trolley, trolleyLines)).toBe("trolleybus");
    expect(vehicleCategory(trolley, new Map())).toBe("bus"); // not looked up yet → bus
    expect(countByCategory(all, trolleyLines)).toEqual({ bus: 1, trolleybus: 1, tram: 1, metro: 1 });
  });

  it("filters additively: none = all, one = only it, two = both", () => {
    expect(filterVehicles(all, new Set(), trolleyLines)).toHaveLength(4);
    expect(filterVehicles(all, new Set(["tram"]), trolleyLines)).toEqual([tram]);
    expect(filterVehicles(all, new Set(["tram", "trolleybus"]), trolleyLines)).toEqual([trolley, tram]);
  });

  it("marks a trip with a trolleybus route type as a trolleybus", () => {
    const d = parseTripDetails("t", {
      legs: [{ mode: "BUS", routeType: 11, routeShortName: "66", from: { name: "A", lat: 1, lon: 1 }, to: { name: "B", lat: 2, lon: 2 } }],
    })!;
    expect(d).toMatchObject({ mode: "trolleybus", routeType: 11, color: MODE_COLORS.trolleybus });
    expect(tripSlotTitle(d, 0, 1)).toBe("Trolleybus 66: A → B");
  });
});
