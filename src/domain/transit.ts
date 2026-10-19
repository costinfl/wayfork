import { newId } from "./mutate";
import { distanceM } from "./poi";
import type { Day, Place, StepType, VariantNode } from "./types";

// Real transit routing via Transitous (a keyless, worldwide MOTIS instance —
// see docs/INTEGRATIONS.md). One-shot "add this itinerary as a variant"
// adapter, mirroring route.ts's conventions: injectable fetchFn, null on any
// failure, and the caller decides what to show for null.
//
// The MOTIS /plan response schema is only partially confirmed from the public
// OpenAPI spec (both interactive doc UIs 403'd during research, and this
// sandbox cannot reach the live endpoint at all — same constraint every other
// external adapter here already has). Every field read below is guarded and
// falls back to a haversine estimate, so an unexpected shape degrades to a
// rough-but-usable variant instead of breaking the add action.

const TRANSITOUS_PLAN_URL = "https://api.transitous.org/api/v6/plan";
const REQUEST_TIMEOUT_MS = 8000;

export interface TransitLeg {
  type: StepType;
  label: string;
  durationMin: number;
  distanceKm: number | null;
  line: [number, number][] | null;
  from: Place | null;
  to: Place | null;
}

export interface TransitItinerary {
  legs: TransitLeg[];
  durationMin: number;
}

// MOTIS/OTP-family mode strings → the app's fixed StepType set. Anything
// unrecognized falls back to "transfer" rather than being dropped, so a leg
// the app doesn't have a specific icon for still shows up with a duration.
const MODE_TO_STEP: Record<string, StepType> = {
  WALK: "walk",
  CAR: "car",
  BUS: "bus",
  COACH: "bus",
  TRAM: "metro",
  SUBWAY: "metro",
  METRO: "metro",
  SUBURBAN: "train",
  RAIL: "train",
  REGIONAL_RAIL: "train",
  HIGHSPEED_RAIL: "train",
  LONG_DISTANCE: "train",
  NIGHT_RAIL: "train",
  FERRY: "shuttle",
  FUNICULAR: "shuttle",
  GONDOLA: "shuttle",
  AIRPLANE: "flight",
};

// Google encoded-polyline decoder (the format MOTIS returns for leg
// geometry). Precision 6 matches MOTIS 2 / v2+; pass 5 for older instances.
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / factor, lon / factor]);
  }
  return points;
}

// The place the transit variant should originate from: the previous slot's
// place (every slot is placed since schema v2). Null for the day's first slot
// or an unknown id — the caller uses this to decide whether "add transit
// option" makes sense.
export function previousPlace(day: Day, slotId: string): Place | null {
  const idx = day.slots.findIndex((s) => s.id === slotId);
  return idx > 0 ? day.slots[idx - 1].place : null;
}

interface RawPlace {
  name?: string;
  lat?: number;
  lon?: number;
}

interface RawLeg {
  mode?: string;
  duration?: number; // seconds (OTP/MOTIS convention, matches OSRM's in route.ts)
  distance?: number; // metres
  from?: RawPlace;
  to?: RawPlace;
  legGeometry?: { points?: string };
  routeShortName?: string;
  displayName?: string;
  headsign?: string;
}

interface RawItinerary {
  legs?: RawLeg[];
  duration?: number;
}

const fmt = (n: number): number => Math.round(n * 10) / 10;

function parseLeg(raw: RawLeg): TransitLeg | null {
  const type = MODE_TO_STEP[raw.mode ?? ""] ?? "transfer";
  const from = raw.from;
  const to = raw.to;
  const haveCoords =
    typeof from?.lat === "number" &&
    typeof from?.lon === "number" &&
    typeof to?.lat === "number" &&
    typeof to?.lon === "number";

  const fallbackKm = haveCoords
    ? distanceM({ lat: from!.lat!, lon: from!.lon! }, { lat: to!.lat!, lon: to!.lon! }) / 1000
    : null;
  const distanceKm =
    typeof raw.distance === "number" ? fmt(raw.distance / 1000) : fallbackKm !== null ? fmt(fallbackKm) : null;
  const durationMin =
    typeof raw.duration === "number"
      ? Math.max(1, Math.round(raw.duration / 60))
      : distanceKm !== null
        ? Math.max(1, Math.round((distanceKm / (type === "walk" ? 5 : 25)) * 60))
        : null;
  if (durationMin === null) return null; // nothing usable to show

  const routeName = raw.routeShortName || raw.displayName;
  const label =
    type === "walk"
      ? `Walk${to?.name ? ` to ${to.name}` : ""}`
      : routeName
        ? `${routeName}${raw.headsign ? ` → ${raw.headsign}` : ""}`
        : `${raw.mode ?? "Transit"}${to?.name ? ` → ${to.name}` : ""}`;

  let line: [number, number][] | null = null;
  const points = raw.legGeometry?.points;
  if (typeof points === "string" && points.length > 0) {
    try {
      const decoded = decodePolyline(points);
      if (decoded.length > 0) line = decoded;
    } catch {
      line = null; // malformed polyline — the map falls back to a straight line
    }
  }

  const place = (p: RawPlace | undefined, fallback: string): Place | null =>
    typeof p?.lat === "number" && typeof p?.lon === "number"
      ? { name: p.name || fallback, lat: p.lat, lon: p.lon }
      : null;
  return {
    type,
    label,
    durationMin,
    distanceKm,
    line,
    from: place(from, "Start"),
    to: place(to, "End"),
  };
}

function parseItinerary(raw: RawItinerary): TransitItinerary | null {
  const rawLegs = Array.isArray(raw.legs) ? raw.legs : [];
  const legs = rawLegs.map(parseLeg).filter((l): l is TransitLeg => l !== null);
  if (legs.length === 0) return null;
  const durationMin =
    typeof raw.duration === "number"
      ? Math.max(1, Math.round(raw.duration / 60))
      : legs.reduce((s, l) => s + l.durationMin, 0);
  return { legs, durationMin };
}

// Every transit mode except AIRPLANE: a slot's transit option is never a
// flight. Without this, MOTIS happily answers FCO → Trastevere with
// "fly to Cagliari, then Brussels, then trains back to Rome" (verified live).
export const GROUND_TRANSIT_MODES = [
  "TRAM",
  "SUBWAY",
  "METRO",
  "FERRY",
  "BUS",
  "COACH",
  "RAIL",
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_FAST_RAIL",
  "REGIONAL_RAIL",
  "SUBURBAN",
  "FUNICULAR",
  "AERIAL_LIFT",
  "CABLE_CAR",
] as const;

export interface TransitPlanOptions {
  time?: Date; // departure; default: tomorrow 10:00 local (a leg's track barely depends on it)
  maxTravelTime?: number; // minutes
}

const tomorrowAt10 = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
};

// Whether an itinerary is a believable way between two places: no flight
// legs, no wild detour (total distance ≤ 3× the straight line, or +5 km for
// short hops), and within the travel-time cap when one is given.
export function plausibleItinerary(it: TransitItinerary, from: Place, to: Place, maxMin?: number): boolean {
  if (it.legs.some((l) => l.type === "flight")) return false;
  if (maxMin !== undefined && it.durationMin > maxMin) return false;
  const crowKm = distanceM(from, to) / 1000;
  const totalKm = it.legs.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0);
  return totalKm <= Math.max(3 * crowKm, crowKm + 5);
}

// The first plausible itinerary between two places, or null when the service
// is unreachable, times out, or returns nothing believable.
export async function fetchTransitPlan(
  from: Place,
  to: Place,
  fetchFn: typeof fetch = fetch,
  opts: TransitPlanOptions = {}
): Promise<TransitItinerary | null> {
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    time: (opts.time ?? tomorrowAt10()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    transitModes: GROUND_TRANSIT_MODES.join(","),
  });
  if (opts.maxTravelTime !== undefined) params.set("maxTravelTime", String(Math.round(opts.maxTravelTime)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${TRANSITOUS_PLAN_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { itineraries?: RawItinerary[]; plan?: { itineraries?: RawItinerary[] } };
    const itineraries = body?.itineraries ?? body?.plan?.itineraries;
    if (!Array.isArray(itineraries) || itineraries.length === 0) return null;
    for (const raw of itineraries) {
      const parsed = parseItinerary(raw);
      if (parsed && plausibleItinerary(parsed, from, to, opts.maxTravelTime)) return parsed;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Turns a fetched itinerary into a savable variant: one micro-step per leg,
// each carrying its own endpoints and route line (schema v2), so the map draws
// the real path leg by leg in place of a schematic arc. Always `estimated` —
// real-world schedule/fare still need the user's confirmation.
export function transitItineraryToVariant(
  itinerary: TransitItinerary,
  currency: string,
  name = "Public transit"
): VariantNode {
  return {
    id: newId("v"),
    name,
    cost: { amount: 0, currency },
    microSteps: itinerary.legs.map((l) => ({
      id: newId("ms"),
      type: l.type,
      label: l.label,
      durationMin: l.durationMin,
      distanceKm: l.distanceKm,
      ...(l.from ? { from: l.from } : {}),
      ...(l.to ? { to: l.to } : {}),
      ...(l.line ? { geometry: l.line } : {}),
    })),
    estimated: true,
  };
}
