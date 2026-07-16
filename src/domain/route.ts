import type { RouteProfile } from "./geometry";
import { distanceM } from "./poi";
import type { Place } from "./types";

// Best-effort routing via the OSRM public demo server. It is a courtesy
// service with no SLA, so every call is wrapped: a ~4s timeout, an in-memory
// cache keyed by endpoints+profile, and `null` on any failure so callers can
// fall back (straight line on the map, haversine estimate for legs). Never
// called for the "arc" profile.

type RoutableProfile = Exclude<RouteProfile, "arc">;

interface RouteInfo {
  line: [number, number][];
  durationMin: number;
  distanceKm: number;
}

const cache = new Map<string, RouteInfo>();

const keyFor = (from: Place, to: Place, profile: RoutableProfile): string =>
  `${profile}:${from.lat},${from.lon};${to.lat},${to.lon}`;

const round1 = (n: number): number => Math.round(n * 10) / 10;

async function fetchRouteInfo(
  from: Place,
  to: Place,
  profile: RoutableProfile,
  fetchFn: typeof fetch
): Promise<RouteInfo | null> {
  const key = keyFor(from, to, profile);
  const cached = cache.get(key);
  if (cached) return cached;

  // OSRM wants lon,lat and returns GeoJSON coordinates as [lon, lat].
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      routes?: {
        geometry?: { coordinates?: [number, number][] };
        duration?: number; // seconds
        distance?: number; // metres
      }[];
    };
    const route = body?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const info: RouteInfo = {
      line: coords.map(([lon, lat]) => [lat, lon] as [number, number]),
      durationMin: Math.max(1, Math.round((route?.duration ?? 0) / 60)),
      distanceKm: round1((route?.distance ?? 0) / 1000),
    };
    cache.set(key, info); // cache successes only, so transient errors can retry
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRoute(
  from: Place,
  to: Place,
  profile: RouteProfile,
  fetchFn: typeof fetch = fetch
): Promise<[number, number][] | null> {
  if (profile === "arc") return null; // schematic — never routed
  return (await fetchRouteInfo(from, to, profile, fetchFn))?.line ?? null;
}

// A realistic connecting leg between two places, for slots added from the
// Discover panel. Walkable (≤2.5 km as the crow flies) → walk step; further →
// car step. Distances come from the routed geometry when OSRM answers, else a
// haversine × 1.3 detour estimate. Walk durations are always derived from the
// distance (12 min/km): the demo OSRM routes every profile as driving, so its
// duration is only trusted for the car leg.
export interface PoiLeg {
  type: "walk" | "car";
  durationMin: number;
  distanceKm: number;
}

const WALK_MAX_KM = 2.5;
const WALK_MIN_PER_KM = 12;
const CAR_KMH = 30;

export async function estimateLeg(
  from: Place,
  to: Place,
  fetchFn: typeof fetch = fetch
): Promise<PoiLeg> {
  const crowKm = distanceM(from, to) / 1000;
  const walk = crowKm <= WALK_MAX_KM;
  const info = await fetchRouteInfo(from, to, walk ? "foot" : "driving", fetchFn);
  const distanceKm = info?.distanceKm || round1(crowKm * 1.3);
  const durationMin = walk
    ? Math.max(1, Math.round(distanceKm * WALK_MIN_PER_KM))
    : (info?.durationMin ?? Math.max(1, Math.round((distanceKm / CAR_KMH) * 60)));
  return { type: walk ? "walk" : "car", durationMin, distanceKm };
}
