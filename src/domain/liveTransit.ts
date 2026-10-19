import { distanceM } from "./poi";
import { decodePolyline } from "./transit";

// Live public-transport vehicles around the trip, from Transitous/MOTIS
// `GET /api/v6/map/trips` — the endpoint behind transitous.org's moving-vehicle
// map. Given a bounding box and a time window it returns every trip *segment*
// (stop → next stop, with departure/arrival and the polyline travelled) that
// runs in it; a vehicle's position is then an interpolation along its current
// segment. Keyless, CORS-open, worldwide where GTFS(-RT) feeds exist — the same
// fair-use service the 🚆 Transit button already relies on.
//
// Parsing is defensive like transit.ts: malformed segments are dropped, unknown
// modes become "other", a missing routeColor falls back to the mode colour.

export type LiveMode = "metro" | "tram" | "bus" | "rail" | "ferry" | "other";

export interface LiveSegment {
  id: string; // tripId + departure: unique per segment
  tripId: string;
  name: string; // route short name, e.g. "M3", "23"
  mode: LiveMode;
  color: string; // "#rrggbb"
  departure: number; // epoch ms
  arrival: number;
  realTime: boolean;
  line: [number, number][]; // [lat, lon]
  cumM: number[]; // cumulative distance along `line`, metres (cumM[0] = 0)
}

export interface Vehicle {
  id: string; // tripId — stable across polls, so markers can glide
  name: string;
  mode: LiveMode;
  color: string;
  lat: number;
  lon: number;
  bearing: number; // degrees clockwise from north
  realTime: boolean;
}

export const MODE_COLORS: Record<LiveMode, string> = {
  metro: "#e11d48",
  tram: "#f59e0b",
  bus: "#22c55e",
  rail: "#60a5fa",
  ferry: "#06b6d4",
  other: "#a1a1aa",
};

const MODE_MAP: Record<string, LiveMode> = {
  SUBWAY: "metro",
  METRO: "metro",
  TRAM: "tram",
  CABLE_CAR: "tram",
  FUNICULAR: "tram",
  BUS: "bus",
  COACH: "bus",
  TROLLEYBUS: "bus",
  RAIL: "rail",
  SUBURBAN: "rail",
  REGIONAL_RAIL: "rail",
  REGIONAL_FAST_RAIL: "rail",
  LONG_DISTANCE: "rail",
  HIGHSPEED_RAIL: "rail",
  NIGHT_RAIL: "rail",
  FERRY: "ferry",
};

export const TRANSITOUS_TRIPS_URL = "https://api.transitous.org/api/v6/map/trips";
// MOTIS only returns buses/trams at high zoom; below this the layer stays off.
export const LIVE_MIN_ZOOM = 12;
const REQUEST_TIMEOUT_MS = 12000;

interface RawSegment {
  trips?: { tripId?: string; displayName?: string }[];
  routeColor?: string;
  mode?: string;
  departure?: string;
  arrival?: string;
  realTime?: boolean;
  polyline?: string;
}

const hexColor = (c: unknown): string | null =>
  typeof c === "string" && /^#?[0-9a-fA-F]{6}$/.test(c) ? `#${c.replace("#", "").toLowerCase()}` : null;

function cumulative(line: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    out.push(out[i - 1] + distanceM({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }));
  }
  return out;
}

export function parseTripSegments(body: unknown): LiveSegment[] {
  if (!Array.isArray(body)) return [];
  const out: LiveSegment[] = [];
  for (const raw of body as RawSegment[]) {
    const trip = raw?.trips?.[0];
    const departure = Date.parse(raw?.departure ?? "");
    const arrival = Date.parse(raw?.arrival ?? "");
    if (!trip?.tripId || !Number.isFinite(departure) || !Number.isFinite(arrival) || arrival < departure) continue;
    if (typeof raw.polyline !== "string" || raw.polyline === "") continue;
    let line: [number, number][];
    try {
      line = decodePolyline(raw.polyline, 5);
    } catch {
      continue;
    }
    if (line.length < 2) continue;
    const mode = MODE_MAP[raw.mode ?? ""] ?? "other";
    out.push({
      id: `${trip.tripId}@${departure}`,
      tripId: trip.tripId,
      name: trip.displayName || raw.mode || "",
      mode,
      color: hexColor(raw.routeColor) ?? MODE_COLORS[mode],
      departure,
      arrival,
      realTime: raw.realTime === true,
      line,
      cumM: cumulative(line),
    });
  }
  return out;
}

export interface Bbox {
  min: { lat: number; lon: number }; // south-west
  max: { lat: number; lon: number }; // north-east
}

// Segments running in [now, now + windowMin] inside the box, or null when the
// service is unreachable / errors (callers keep the last good set).
export async function fetchLiveSegments(
  bbox: Bbox,
  zoom: number,
  now: Date = new Date(),
  windowMin = 2,
  fetchFn: typeof fetch = fetch
): Promise<LiveSegment[] | null> {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    zoom: String(Math.round(zoom)),
    min: `${bbox.min.lat.toFixed(5)},${bbox.min.lon.toFixed(5)}`,
    max: `${bbox.max.lat.toFixed(5)},${bbox.max.lon.toFixed(5)}`,
    startTime: iso(now),
    endTime: iso(new Date(now.getTime() + windowMin * 60_000)),
    precision: "5",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${TRANSITOUS_TRIPS_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    return parseTripSegments(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const bearingDeg = (a: [number, number], b: [number, number]): number => {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x =
    Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
    Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
};

// Where a segment's vehicle is at `t`: linear in time between departure and
// arrival, measured along the polyline's length. Null outside its window.
export function positionAt(seg: LiveSegment, t: number): { lat: number; lon: number; bearing: number } | null {
  if (t < seg.departure || t > seg.arrival) return null;
  const total = seg.cumM[seg.cumM.length - 1];
  const f = seg.arrival === seg.departure ? 1 : (t - seg.departure) / (seg.arrival - seg.departure);
  const target = f * total;
  let i = 1;
  while (i < seg.cumM.length - 1 && seg.cumM[i] < target) i++;
  const [a, b] = [seg.line[i - 1], seg.line[i]];
  const span = seg.cumM[i] - seg.cumM[i - 1];
  const k = span > 0 ? (target - seg.cumM[i - 1]) / span : 1;
  return { lat: a[0] + (b[0] - a[0]) * k, lon: a[1] + (b[1] - a[1]) * k, bearing: bearingDeg(a, b) };
}

// One vehicle per trip currently on one of its segments. A trip briefly
// matching two segments (arrival == next departure) keeps the later one.
export function vehiclePositions(segments: LiveSegment[], t: number): Vehicle[] {
  const byTrip = new Map<string, Vehicle & { dep: number }>();
  for (const seg of segments) {
    const p = positionAt(seg, t);
    if (!p) continue;
    const prev = byTrip.get(seg.tripId);
    if (prev && prev.dep > seg.departure) continue;
    byTrip.set(seg.tripId, {
      id: seg.tripId,
      name: seg.name,
      mode: seg.mode,
      color: seg.color,
      realTime: seg.realTime,
      dep: seg.departure,
      ...p,
    });
  }
  return [...byTrip.values()].map(({ dep: _dep, ...v }) => v);
}

// Street-level vehicle footprints (metres) for the 3D layer. Metro runs
// underground, so it stays a dot — a box on the street would be misleading.
const FOOTPRINT_M: Partial<Record<LiveMode, [number, number]>> = {
  bus: [12, 2.6],
  tram: [30, 2.5],
  rail: [60, 3],
  ferry: [30, 8],
  other: [10, 2.5],
};

// A vehicle's footprint as a closed [lat, lon] ring, oriented along its
// bearing — extruded into a box on the map. Null for vehicles drawn as dots.
export function vehicleFootprint(v: Vehicle): [number, number][] | null {
  const dims = FOOTPRINT_M[v.mode];
  if (!dims) return null;
  const [len, wid] = dims;
  const rad = (v.bearing * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((v.lat * Math.PI) / 180);
  // Unit vectors along (forward) and across (right of) the heading, in metres (east, north).
  const fwd = [Math.sin(rad), Math.cos(rad)];
  const right = [Math.cos(rad), -Math.sin(rad)];
  const corner = (a: number, b: number): [number, number] => {
    const east = fwd[0] * a + right[0] * b;
    const north = fwd[1] * a + right[1] * b;
    return [v.lat + north / mPerDegLat, v.lon + east / mPerDegLon];
  };
  const ring = [
    corner(len / 2, -wid / 2),
    corner(len / 2, wid / 2),
    corner(-len / 2, wid / 2),
    corner(-len / 2, -wid / 2),
  ];
  return [...ring, ring[0]];
}

// ---- trip details (tap a vehicle) -----------------------------------------
// MOTIS `GET /api/v6/trip?tripId=` returns the vehicle's whole trip as an
// itinerary: headsign, route names, agency, every stop with real-time and
// scheduled times, accessibility, alerts and the route shape.

export const TRANSITOUS_TRIP_URL = "https://api.transitous.org/api/v6/trip";

export interface TripStop {
  name: string;
  lat: number;
  lon: number;
  tz?: string;
  arrival?: number; // epoch ms (real-time when available)
  departure?: number;
  scheduledArrival?: number;
  scheduledDeparture?: number;
  track?: string;
  cancelled: boolean;
}

export interface TripDetails {
  tripId: string;
  name: string; // route short name, e.g. "QM32"
  longName?: string;
  headsign?: string;
  agency?: string;
  mode: LiveMode;
  color: string;
  realTime: boolean;
  cancelled: boolean;
  wheelchair: boolean | null;
  bikes: boolean | null;
  alerts: string[];
  stops: TripStop[];
  line: [number, number][];
}

interface RawStop {
  name?: string;
  lat?: number;
  lon?: number;
  tz?: string;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  track?: string;
  scheduledTrack?: string;
  cancelled?: boolean;
}

interface RawTripLeg {
  mode?: string;
  headsign?: string;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  agencyName?: string;
  routeColor?: string;
  realTime?: boolean;
  cancelled?: boolean;
  wheelchairAccessible?: string;
  bikesAllowed?: boolean;
  alerts?: { headerText?: string; descriptionText?: string }[] | null;
  from?: RawStop;
  to?: RawStop;
  intermediateStops?: RawStop[];
  legGeometry?: { points?: string; precision?: number };
}

const ms = (iso: string | undefined): number | undefined => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : undefined;
};

function parseStop(s: RawStop | undefined): TripStop | null {
  if (!s || typeof s.lat !== "number" || typeof s.lon !== "number") return null;
  return {
    name: s.name || "Stop",
    lat: s.lat,
    lon: s.lon,
    ...(s.tz ? { tz: s.tz } : {}),
    arrival: ms(s.arrival),
    departure: ms(s.departure),
    scheduledArrival: ms(s.scheduledArrival),
    scheduledDeparture: ms(s.scheduledDeparture),
    ...((s.track ?? s.scheduledTrack) ? { track: s.track ?? s.scheduledTrack } : {}),
    cancelled: s.cancelled === true,
  };
}

export function parseTripDetails(tripId: string, body: unknown): TripDetails | null {
  const legs = ((body as { legs?: RawTripLeg[] } | null)?.legs ?? []).filter(
    (l) => l && l.mode && l.mode !== "WALK"
  );
  if (legs.length === 0) return null;
  const first = legs[0];
  const stops: TripStop[] = [];
  const line: [number, number][] = [];
  legs.forEach((l, i) => {
    // Interlined legs share their boundary stop; keep it once.
    const legStops = [...(i === 0 ? [l.from] : []), ...(l.intermediateStops ?? []), l.to];
    for (const s of legStops.map(parseStop)) if (s) stops.push(s);
    const pts = l.legGeometry?.points;
    if (typeof pts === "string" && pts) {
      try {
        line.push(...decodePolyline(pts, l.legGeometry?.precision ?? 6));
      } catch {
        /* no shape — the card still works */
      }
    }
  });
  if (stops.length < 2) return null;
  const mode = MODE_MAP[first.mode ?? ""] ?? "other";
  const access = first.wheelchairAccessible;
  return {
    tripId,
    name: first.routeShortName || first.displayName || first.mode || "",
    ...(first.routeLongName ? { longName: first.routeLongName } : {}),
    ...(first.headsign ? { headsign: first.headsign } : {}),
    ...(first.agencyName ? { agency: first.agencyName } : {}),
    mode,
    color: hexColor(first.routeColor) ?? MODE_COLORS[mode],
    realTime: legs.some((l) => l.realTime === true),
    cancelled: legs.every((l) => l.cancelled === true),
    wheelchair: access === "ACCESSIBLE" ? true : access === "NOT_ACCESSIBLE" ? false : null,
    bikes: typeof first.bikesAllowed === "boolean" ? first.bikesAllowed : null,
    alerts: legs
      .flatMap((l) => l.alerts ?? [])
      .map((a) => a?.headerText || a?.descriptionText || "")
      .filter((t, i, all) => t && all.indexOf(t) === i),
    stops,
    line,
  };
}

const tripCache = new Map<string, TripDetails>();

// The vehicle's trip, or null when the service fails or knows nothing about
// it. Successful lookups are cached for the session.
export async function fetchTripDetails(tripId: string, fetchFn: typeof fetch = fetch): Promise<TripDetails | null> {
  const hit = tripCache.get(tripId);
  if (hit) return hit;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${TRANSITOUS_TRIP_URL}?${new URLSearchParams({ tripId })}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const details = parseTripDetails(tripId, await res.json());
    if (details) tripCache.set(tripId, details);
    return details;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface TripProgress {
  nextIndex: number; // first stop not yet reached (stops.length when finished)
  delayMin: number | null; // real − scheduled at that stop; null without real-time data
  finished: boolean;
}

// Where the vehicle is in its trip at `now`: the next stop is the first whose
// arrival (real-time, else scheduled) is still ahead.
export function tripProgress(d: TripDetails, now: number): TripProgress {
  const at = (s: TripStop) => s.arrival ?? s.departure ?? s.scheduledArrival ?? s.scheduledDeparture;
  let nextIndex = d.stops.findIndex((s) => {
    const t = at(s);
    return t !== undefined && t > now;
  });
  const finished = nextIndex === -1;
  if (finished) nextIndex = d.stops.length;
  const ref = d.stops[Math.min(nextIndex, d.stops.length - 1)];
  const real = ref.arrival ?? ref.departure;
  const sched = ref.scheduledArrival ?? ref.scheduledDeparture;
  const delayMin = d.realTime && real !== undefined && sched !== undefined ? Math.round((real - sched) / 60_000) : null;
  return { nextIndex, delayMin, finished };
}
