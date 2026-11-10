import type { Place } from "./scaffold";

// Place autocomplete via Open-Meteo's Geocoding API (keyless, CORS-friendly,
// same provider as the weather adapter). Returns [] on any failure or on a
// query too short to be meaningful — callers just show no suggestions.

interface GeoResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  admin1?: string; // region/state, for disambiguating same-named places
}

// "Rome, Lazio, Italy" — name plus region/country, adjacent duplicates dropped
// (e.g. "Bucharest, Bucharest, Romania" → "Bucharest, Romania").
const displayName = (r: GeoResult): string => {
  const parts = [r.name, r.admin1, r.country].filter(
    (p): p is string => typeof p === "string" && p !== ""
  );
  return parts.filter((p, i) => i === 0 || p !== parts[i - 1]).join(", ");
};

export async function searchPlaces(
  query: string,
  fetchFn: typeof fetch = fetch
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
    `&count=6&language=en&format=json`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: GeoResult[] };
    const results = body?.results;
    if (!Array.isArray(results)) return [];
    return results
      .filter(
        (r) =>
          typeof r.name === "string" &&
          typeof r.latitude === "number" &&
          typeof r.longitude === "number"
      )
      .map((r) => ({
        name: displayName(r),
        lat: r.latitude as number,
        lon: r.longitude as number,
        ...(typeof r.country === "string" ? { country: r.country } : {}),
      }));
  } catch {
    return [];
  }
}

// POI-aware lookup biased toward a point, for refining migrated slot places
// (migrate.ts). Photon (komoot) is keyless and CORS-open, indexes OSM POIs —
// unlike Open-Meteo's city-level index — and takes a lat/lon location bias.
// Best effort: any failure or empty result is null.
interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; city?: string; country?: string };
}

export async function searchNear(
  query: string,
  near: { lat: number; lon: number },
  fetchFn: typeof fetch = fetch
): Promise<Place | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&lat=${near.lat}&lon=${near.lon}&limit=1&lang=en`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { features?: PhotonFeature[] };
    const f = body?.features?.[0];
    const c = f?.geometry?.coordinates;
    const name = f?.properties?.name;
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number" || !name) {
      return null;
    }
    const city = f?.properties?.city;
    return {
      name: city && city !== name ? `${name}, ${city}` : name,
      lat: c[1],
      lon: c[0],
      ...(f?.properties?.country ? { country: f.properties.country } : {}),
    };
  } catch {
    return null;
  }
}

// ---- Photon search and reverse lookup (map search box, tap-to-add) --------

// A search hit: the place to store (name qualified with its city), a short
// title to show, and a one-line description ("archaeological site · Rome").
export interface PlaceHit {
  place: Place;
  title: string;
  detail: string;
}

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  country?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

const humanize = (s: string) => s.replace(/_/g, " ");

function photonHit(f: { geometry?: { coordinates?: unknown }; properties?: PhotonProps } | undefined): PlaceHit | null {
  const c = f?.geometry?.coordinates;
  const p = f?.properties ?? {};
  if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  const street = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : "";
  const title = p.name || street || p.city;
  if (!title) return null;
  // Areas say what they are ("city", "district"); everything else its OSM value.
  const kind = p.osm_key === "place" || p.osm_key === "boundary" ? p.type : p.osm_value;
  const where = [p.city !== title ? p.city : null, p.country].filter(Boolean).join(", ");
  return {
    place: { name: p.city && p.city !== title ? `${title}, ${p.city}` : title, lat: c[1], lon: c[0] },
    title,
    detail: [kind && kind !== "yes" ? humanize(kind) : null, where || null].filter(Boolean).join(" · "),
  };
}

// Hits from a Photon response, near-duplicates (same title within 300 m —
// e.g. a monument and the square named after it) collapsed to the first.
export function parsePhoton(body: unknown): PlaceHit[] {
  const features = (body as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceHit[] = [];
  for (const f of features) {
    const hit = photonHit(f as Parameters<typeof photonHit>[0]);
    if (!hit) continue;
    const dup = out.some(
      (o) =>
        o.title === hit.title &&
        Math.abs(o.place.lat - hit.place.lat) < 0.003 &&
        Math.abs(o.place.lon - hit.place.lon) < 0.004
    );
    if (!dup) out.push(hit);
  }
  return out;
}

// POIs, streets and towns matching `query`, nearest to `near` first when
// given. [] on failure, on a short query, or when aborted.
export async function searchPhoton(
  query: string,
  near: { lat: number; lon: number } | null,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const bias = near ? `&lat=${near.lat.toFixed(4)}&lon=${near.lon.toFixed(4)}` : "";
  try {
    const res = await fetchFn(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}${bias}&limit=8&lang=en`, { signal });
    if (!res.ok) return [];
    return parsePhoton(await res.json());
  } catch {
    return [];
  }
}

// What is at a tapped point: the nearest named feature, or null.
export async function reversePlace(
  at: { lat: number; lon: number },
  fetchFn: typeof fetch = fetch
): Promise<PlaceHit | null> {
  try {
    const res = await fetchFn(
      `https://photon.komoot.io/reverse?lat=${at.lat.toFixed(6)}&lon=${at.lon.toFixed(6)}&limit=1&lang=en`
    );
    if (!res.ok) return null;
    return parsePhoton(await res.json())[0] ?? null;
  } catch {
    return null;
  }
}
