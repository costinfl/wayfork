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

// The place the transit variant should originate from: the nearest earlier
// slot (in day order) that carries a map place. Null when there is none —
// the caller uses this to decide whether "add transit option" makes sense.
export function previousPlace(day: Day, slotId: string): Place | null {
  const idx = day.slots.findIndex((s) => s.id === slotId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const place = day.slots[i].place;
    if (place) return place;
  }
  return null;
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

  return { type, label, durationMin, distanceKm, line };
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

// The best (first-returned) itinerary between two places, or null when the
// service is unreachable, times out, or returns no usable itinerary.
export async function fetchTransitPlan(
  from: Place,
  to: Place,
  fetchFn: typeof fetch = fetch
): Promise<TransitItinerary | null> {
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
  });
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
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Turns a fetched itinerary into a savable variant: one micro-step per leg,
// and a whole-route line (legs concatenated in order) for the day map to draw
// in place of a schematic arc. Always `estimated` — real-world schedule/fare
// still need the user's confirmation.
export function transitItineraryToVariant(
  itinerary: TransitItinerary,
  currency: string,
  name = "Public transit"
): VariantNode {
  const geometry = itinerary.legs.some((l) => l.line)
    ? itinerary.legs.flatMap((l) => l.line ?? [])
    : null;
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
    })),
    estimated: true,
    ...(geometry ? { geometry } : {}),
  };
}
