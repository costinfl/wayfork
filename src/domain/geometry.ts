import type { Day, Place, VariantNode } from "./types";

// Pure geometry for the day-journey map: turn a day's slots + the active-variant
// selection into drawable track segments, plus a schematic arc helper. No fetch,
// no Leaflet — the UI resolves real road/foot geometry separately (see route.ts).

export type RouteProfile = "foot" | "driving" | "arc";

export interface TrackSegment {
  slotId: string;
  variantId: string;
  from: Place; // previous located slot's place (or this slot's own, for the first)
  to: Place; // this slot's place
  active: boolean;
  profile: RouteProfile;
}

export interface DayTrack {
  segments: TrackSegment[];
  unmapped: string[]; // ids of slots that carry no place (the track skips them)
}

// A variant's dominant travel profile = its first non-wait step. Roads
// (car/bus/shuttle/transfer) route as driving, walking as foot; rail/air and
// anything with no movement fall back to the schematic arc (no free routing).
export function variantProfile(v: VariantNode): RouteProfile {
  const step = v.microSteps.find((m) => m.type !== "wait");
  switch (step?.type) {
    case "walk":
      return "foot";
    case "car":
    case "bus":
    case "shuttle":
    case "transfer":
      return "driving";
    default:
      // metro, train, flight, all-wait, or unknown → schematic
      return "arc";
  }
}

// Walk the day's slots in schedule order, emitting one segment per variant of
// each located slot. Slots without a place are skipped (the track connects
// across them) and collected in `unmapped`.
export function dayTrack(day: Day, activeVariants: Record<string, string>): DayTrack {
  const segments: TrackSegment[] = [];
  const unmapped: string[] = [];
  let prev: Place | null = null;

  for (const slot of day.slots) {
    if (!slot.place) {
      unmapped.push(slot.id);
      continue;
    }
    const to = slot.place;
    const from = prev ?? to; // first located slot: degenerate origin at its own place
    const activeId = activeVariants[slot.id] ?? slot.defaultVariantId;
    for (const variant of slot.variants) {
      segments.push({
        slotId: slot.id,
        variantId: variant.id,
        from,
        to,
        active: variant.id === activeId,
        profile: variantProfile(variant),
      });
    }
    prev = to;
  }

  return { segments, unmapped };
}

// A quadratic-bézier polyline bowed perpendicular to the from→to chord. `bend`
// is a signed fraction of the chord length; its sign flips the bow to the other
// side (so sibling alternatives fork apart). bend=0 degenerates to the straight
// chord. Endpoints are always exactly `from` and `to`.
export function offsetArc(
  from: Place,
  to: Place,
  bend: number,
  steps = 24
): [number, number][] {
  const midLat = (from.lat + to.lat) / 2;
  const midLon = (from.lon + to.lon) / 2;
  const dLat = to.lat - from.lat;
  const dLon = to.lon - from.lon;
  // Control point: midpoint pushed along the chord's perpendicular (−dLon, dLat).
  const cLat = midLat + -dLon * bend;
  const cLon = midLon + dLat * bend;

  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const lat = mt * mt * from.lat + 2 * mt * t * cLat + t * t * to.lat;
    const lon = mt * mt * from.lon + 2 * mt * t * cLon + t * t * to.lon;
    pts.push([lat, lon]);
  }
  return pts;
}

// A closed ring of `[lat, lon]` points approximating a geographic circle of
// `radiusM` metres around `center` — MapLibre has no metres-accurate circle
// primitive (its `circle` paint sizes in pixels), so the day map's Discover
// search-radius is drawn as this polygon instead. Uses the destination-point-
// given-bearing-and-distance formula on a spherical earth; the first point is
// repeated last so the ring closes (length = points + 1).
const EARTH_R = 6371000;

export function circlePolygon(
  center: { lat: number; lon: number },
  radiusM: number,
  points = 64
): [number, number][] {
  const rad = Math.PI / 180;
  const lat1 = center.lat * rad;
  const lon1 = center.lon * rad;
  const dR = radiusM / EARTH_R; // angular distance
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const brng = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
        Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([lat2 / rad, lon2 / rad]);
  }
  return ring;
}
