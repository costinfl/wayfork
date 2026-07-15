// Nearby points of interest via the Overpass API (keyless, per-user-IP fair
// use; primary instance with one mirror fallback), optionally enriched with a
// Wikipedia extract + thumbnail. Same adapter conventions as geocode.ts:
// injectable fetchFn, and [] / null on any failure — callers just show an
// empty state.

export type PoiCategoryId = "sights" | "museums" | "food" | "parks";

export interface PoiCategory {
  id: PoiCategoryId;
  label: string;
  // Overpass tag filters, each rendered as nwr[<filter>](around:...);
  filters: string[];
}

export const POI_CATEGORIES: PoiCategory[] = [
  {
    id: "sights",
    label: "Sights",
    filters: ['"tourism"~"^(attraction|viewpoint|artwork)$"', '"historic"'],
  },
  { id: "museums", label: "Museums", filters: ['"tourism"~"^(museum|gallery)$"'] },
  { id: "food", label: "Food & drink", filters: ['"amenity"~"^(restaurant|cafe)$"'] },
  { id: "parks", label: "Parks", filters: ['"leisure"~"^(park|garden)$"'] },
];

export interface Poi {
  id: string; // "node/123" — stable across queries, usable as a React key
  name: string;
  lat: number;
  lon: number;
  category: PoiCategoryId;
  distanceM: number; // from the search center
  openingHours?: string;
  wikipedia?: string; // e.g. "en:Colosseum"
  wikidata?: string; // e.g. "Q10285"
  website?: string;
}

export interface PoiSummary {
  extract: string;
  thumbnailUrl?: string;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const MAX_RESULTS = 40;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

// Distance in metres between two WGS84 points (haversine).
export function distanceM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Category attribution happens client-side against the returned tags, so one
// union query serves any category mix. Museums win over sights because
// tourism=museum would otherwise never match (sights checks tourism too).
export function categorize(tags: Record<string, string>): PoiCategoryId | null {
  const tourism = tags["tourism"] ?? "";
  const amenity = tags["amenity"] ?? "";
  const leisure = tags["leisure"] ?? "";
  if (/^(museum|gallery)$/.test(tourism)) return "museums";
  if (/^(attraction|viewpoint|artwork)$/.test(tourism) || tags["historic"]) return "sights";
  if (/^(park|garden)$/.test(leisure)) return "parks";
  if (/^(restaurant|cafe)$/.test(amenity)) return "food";
  return null;
}

export function buildPoiQuery(
  center: { lat: number; lon: number },
  radiusM: number,
  categories: PoiCategoryId[]
): string {
  const around = `(around:${Math.round(radiusM)},${center.lat},${center.lon})`;
  const wanted = POI_CATEGORIES.filter((c) => categories.includes(c.id));
  const clauses = wanted
    .flatMap((c) => c.filters)
    .map((f) => `nwr[${f}]["name"]${around};`)
    .join("");
  return `[out:json][timeout:25];(${clauses});out tags center ${MAX_RESULTS * 3};`;
}

export async function fetchPois(
  center: { lat: number; lon: number },
  radiusM: number,
  categories: PoiCategoryId[],
  fetchFn: typeof fetch = fetch
): Promise<Poi[]> {
  if (categories.length === 0) return [];
  const query = buildPoiQuery(center, radiusM, categories);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue; // 429/504 → try the mirror
      const body = (await res.json()) as { elements?: OverpassElement[] };
      if (!Array.isArray(body?.elements)) continue;
      return parseElements(body.elements, center, categories);
    } catch {
      // network/parse failure → try the mirror
    }
  }
  return [];
}

function parseElements(
  elements: OverpassElement[],
  center: { lat: number; lon: number },
  categories: PoiCategoryId[]
): Poi[] {
  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags["name"];
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lon = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (!name || typeof lat !== "number" || typeof lon !== "number") continue;
    const category = categorize(tags);
    if (!category || !categories.includes(category)) continue;
    const id = `${el.type ?? "node"}/${el.id ?? `${lat},${lon}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    pois.push({
      id,
      name,
      lat,
      lon,
      category,
      distanceM: Math.round(distanceM(center, { lat, lon })),
      ...(tags["opening_hours"] ? { openingHours: tags["opening_hours"] } : {}),
      ...(tags["wikipedia"] ? { wikipedia: tags["wikipedia"] } : {}),
      ...(tags["wikidata"] ? { wikidata: tags["wikidata"] } : {}),
      ...(tags["website"] ? { website: tags["website"] } : {}),
    });
  }
  return pois.sort((a, b) => a.distanceM - b.distanceM).slice(0, MAX_RESULTS);
}

// Wikipedia REST summary for a POI carrying a wikipedia (lang:Title) or
// wikidata (QID → enwiki sitelink) tag. null when the POI has neither tag or
// anything fails.
export async function fetchPoiSummary(
  poi: Pick<Poi, "wikipedia" | "wikidata">,
  fetchFn: typeof fetch = fetch
): Promise<PoiSummary | null> {
  try {
    let lang = "en";
    let title: string | null = null;
    if (poi.wikipedia) {
      const idx = poi.wikipedia.indexOf(":");
      if (idx > 0) {
        lang = poi.wikipedia.slice(0, idx);
        title = poi.wikipedia.slice(idx + 1);
      } else {
        title = poi.wikipedia;
      }
    } else if (poi.wikidata) {
      const res = await fetchFn(
        `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(poi.wikidata)}.json`
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
      };
      title = body?.entities?.[poi.wikidata]?.sitelinks?.["enwiki"]?.title ?? null;
    }
    if (!title) return null;
    const res = await fetchFn(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      extract?: string;
      thumbnail?: { source?: string };
    };
    if (typeof body?.extract !== "string" || body.extract === "") return null;
    return {
      extract: body.extract,
      ...(body.thumbnail?.source ? { thumbnailUrl: body.thumbnail.source } : {}),
    };
  } catch {
    return null;
  }
}
