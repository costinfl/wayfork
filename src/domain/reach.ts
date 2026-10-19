import { distanceM } from "./poi";
import type { Place } from "./types";

// Reachability rings: what is reachable from a slot within 15/30/45 minutes,
// on foot or by public transport + foot. Transit times come from
// Transitous/MOTIS `GET /api/v6/one-to-all` (every stop reachable within a
// budget, with its travel time); the rings are then a travel-time field —
// for any point, the fastest of "walk straight there" and "ride to a stop,
// walk the rest" — sampled on a grid and cut into bands. Grid cells (merged
// into runs per row) never overlap, so the translucent bands render evenly.

export interface ReachStop {
  lat: number;
  lon: number;
  durationMin: number;
}

export type ReachMode = "walk" | "transit";

export const REACH_BANDS = [15, 30, 45] as const;
export const WALK_KMH = 4.8;
const WALK_M_PER_MIN = (WALK_KMH * 1000) / 60;

export const TRANSITOUS_ONE_TO_ALL_URL = "https://api.transitous.org/api/v6/one-to-all";
const REQUEST_TIMEOUT_MS = 15000;

interface RawReachable {
  place?: { lat?: number; lon?: number };
  duration?: number; // minutes
}

export function parseOneToAll(body: unknown): ReachStop[] {
  const all = (body as { all?: RawReachable[] } | null)?.all;
  if (!Array.isArray(all)) return [];
  const out: ReachStop[] = [];
  for (const r of all) {
    const lat = r?.place?.lat;
    const lon = r?.place?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || typeof r.duration !== "number") continue;
    if (!(r.duration >= 0)) continue;
    out.push({ lat, lon, durationMin: r.duration });
  }
  return out;
}

// Stops reachable by transit from `origin` within `maxMin`, departing at
// `time`; null when the service is unreachable (the UI falls back to walking).
export async function fetchReachableStops(
  origin: Place,
  maxMin: number,
  time: Date = new Date(),
  fetchFn: typeof fetch = fetch
): Promise<ReachStop[] | null> {
  const params = new URLSearchParams({
    one: `${origin.lat},${origin.lon}`,
    maxTravelTime: String(maxMin),
    time: time.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${TRANSITOUS_ONE_TO_ALL_URL}?${params}`, { signal: controller.signal });
    if (!res.ok) return null;
    return parseOneToAll(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ReachBand {
  maxMin: number; // the band covers travel times in (previous band, maxMin]
  // Axis-aligned cells as [south, west, north, east] (degrees).
  rects: [number, number, number, number][];
}

// Sample the travel-time field on a grid around the origin and cut it into
// bands. `cells` is the grid resolution across the area's longest side.
export function reachBands(
  origin: Place,
  stops: ReachStop[],
  bands: readonly number[] = REACH_BANDS,
  cells = 120
): ReachBand[] {
  const max = Math.max(...bands);
  const sources: ReachStop[] = [{ lat: origin.lat, lon: origin.lon, durationMin: 0 }, ...stops].filter(
    (s) => s.durationMin < max
  );
  // Extent: every source's leftover walking radius, as a lat/lon box.
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  let [s, w, n, e] = [origin.lat, origin.lon, origin.lat, origin.lon];
  for (const src of sources) {
    const r = (max - src.durationMin) * WALK_M_PER_MIN;
    s = Math.min(s, src.lat - r / mPerDegLat);
    n = Math.max(n, src.lat + r / mPerDegLat);
    w = Math.min(w, src.lon - r / mPerDegLon);
    e = Math.max(e, src.lon + r / mPerDegLon);
  }
  const step = Math.max((n - s) * mPerDegLat, (e - w) * mPerDegLon) / cells; // metres
  const dLat = step / mPerDegLat;
  const dLon = step / mPerDegLon;
  const rows = Math.ceil((n - s) / dLat);
  const cols = Math.ceil((e - w) / dLon);

  const bandOf = (t: number): number => bands.findIndex((b) => t <= b);
  const out: ReachBand[] = bands.map((b) => ({ maxMin: b, rects: [] }));
  for (let r = 0; r < rows; r++) {
    const lat = s + (r + 0.5) * dLat;
    // Only sources whose north–south distance alone still fits the budget can
    // matter for this row — prunes most of a large one-to-all response.
    const rowSources = sources.filter(
      (src) => src.durationMin + (Math.abs(src.lat - lat) * mPerDegLat) / WALK_M_PER_MIN <= max
    );
    let runStart = -1;
    let runBand = -1;
    const flush = (endCol: number) => {
      if (runBand >= 0) {
        out[runBand].rects.push([s + r * dLat, w + runStart * dLon, s + (r + 1) * dLat, w + endCol * dLon]);
      }
    };
    for (let c = 0; c <= cols; c++) {
      let band = -1;
      if (c < cols) {
        const lon = w + (c + 0.5) * dLon;
        let best = Infinity;
        for (const src of rowSources) {
          const t = src.durationMin + distanceM(src, { lat, lon }) / WALK_M_PER_MIN;
          if (t < best) best = t;
        }
        band = bandOf(best);
      }
      if (band !== runBand) {
        flush(c);
        runStart = c;
        runBand = band;
      }
    }
  }
  return out;
}
