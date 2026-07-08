import type { RouteProfile } from "./geometry";
import type { Place } from "./types";

// Best-effort road/foot geometry from the OSRM public demo server. It is a
// courtesy service with no SLA, so every call is wrapped: a ~4s timeout, an
// in-memory cache keyed by endpoints+profile, and `null` on any failure so the
// caller can fall back to a straight line. Never called for the "arc" profile.

type RoutableProfile = Exclude<RouteProfile, "arc">;

const cache = new Map<string, [number, number][]>();

const keyFor = (from: Place, to: Place, profile: RoutableProfile): string =>
  `${profile}:${from.lat},${from.lon};${to.lat},${to.lon}`;

export async function fetchRoute(
  from: Place,
  to: Place,
  profile: RouteProfile,
  fetchFn: typeof fetch = fetch
): Promise<[number, number][] | null> {
  if (profile === "arc") return null; // schematic — never routed

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
      routes?: { geometry?: { coordinates?: [number, number][] } }[];
    };
    const coords = body?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const line = coords.map(([lon, lat]) => [lat, lon] as [number, number]);
    cache.set(key, line); // cache successes only, so transient errors can retry
    return line;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
