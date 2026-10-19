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
