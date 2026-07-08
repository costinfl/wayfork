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
