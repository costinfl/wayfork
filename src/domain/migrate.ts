import { distanceM } from "./poi";
import { SCHEMA_VERSION } from "./types";
import type { Place, Trip } from "./types";

// v1 → v2 trip-document migration. v1 trips may have slots without a place and
// keep a transit route line on the variant; v2 requires a place on every slot
// (the map-first canvas draws every slot) and keeps geometry on micro-steps.
//
// `migrateTrip` is synchronous and deterministic: a missing place is backfilled
// from the nearest placed neighbour (earlier slot in the day, then later slot,
// then the day's location, then any place in the trip), marked
// `estimated: true` so the UI asks the user to confirm it. `migrateTripWithGeocode`
// is the optional async refinement: it tries to geocode each backfilled slot's
// title near its guess before the trip is written back (see data/migrateStore.ts).

export type BackfillSource = "prev-slot" | "next-slot" | "day-location" | "trip" | "geocoded";

export interface MigrationIssue {
  dayId: string;
  slotId: string;
  kind: "place-backfilled" | "geometry-moved";
  source?: BackfillSource;
}

export interface MigrationReport {
  fromVersion: number;
  raw: string; // the original document, JSON-serialised — for the v1 backup
  issues: MigrationIssue[];
}

// Which in-memory trips were produced by a migration (so the store-wide pass
// knows what to write back) — kept off the document so nothing leaks into
// saved JSON. Keyed by the migrated trip object.
const reports = new WeakMap<object, MigrationReport>();

export const migrationReport = (trip: object): MigrationReport | undefined => reports.get(trip);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPlace = (v: unknown): v is Place =>
  isObj(v) && typeof v.name === "string" && typeof v.lat === "number" && typeof v.lon === "number";

export const schemaVersionOf = (raw: unknown): number =>
  isObj(raw) && typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;

const guess = (p: Place): Place => ({
  name: p.name,
  lat: p.lat,
  lon: p.lon,
  ...(p.country ? { country: p.country } : {}),
  estimated: true,
});

// A document needs (re-)migration when it is v1, or when it claims v2 but still
// has v1 traits — e.g. the v1 site (which preserves unknown keys) edited a
// migrated trip and added an unplaced slot. Repairing those on read keeps such
// mixed-version edits from ever failing validation.
function needsMigration(raw: Obj): boolean {
  if (schemaVersionOf(raw) < SCHEMA_VERSION) return true;
  return (raw.days as unknown[]).some(
    (d) =>
      isObj(d) &&
      Array.isArray(d.slots) &&
      d.slots.some(
        (s) =>
          isObj(s) &&
          (s.place === undefined ||
            s.place === null ||
            (Array.isArray(s.variants) && s.variants.some((v) => isObj(v) && v.geometry !== undefined)))
      )
  );
}

// Returns a migrated deep copy (the input is never mutated) plus the issues it
// resolved. Input that is already v2 — or too malformed to walk — is returned
// unchanged with no issues; parse/validate report the actual problems. A
// `version` is preserved, so the write-back stays version-guarded.
export function migrateTrip(raw: unknown): { trip: unknown; issues: MigrationIssue[] } {
  if (!isObj(raw) || !Array.isArray(raw.days) || !needsMigration(raw)) {
    return { trip: raw, issues: [] };
  }
  const rawJson = JSON.stringify(raw);
  const doc = JSON.parse(rawJson) as Obj;
  const issues: MigrationIssue[] = [];
  const days = (doc.days as unknown[]).filter(isObj);

  // Any place in the trip, as a last-resort anchor.
  let tripAnchor: Place | null = null;
  for (const d of days) {
    if (isPlace(d.location)) {
      tripAnchor ??= d.location;
    }
    for (const s of Array.isArray(d.slots) ? d.slots : []) {
      if (isObj(s) && isPlace(s.place)) tripAnchor ??= s.place;
    }
  }

  let carry: Place | null = null; // last place of the previous day
  for (const d of days) {
    const slots = (Array.isArray(d.slots) ? d.slots : []).filter(isObj);
    const dayId = String(d.id);
    slots.forEach((s, i) => {
      if (Array.isArray(s.variants)) {
        for (const v of s.variants.filter(isObj)) {
          if (v.geometry === undefined) continue;
          const geo = v.geometry;
          delete v.geometry;
          const steps = Array.isArray(v.microSteps) ? v.microSteps.filter(isObj) : [];
          if (Array.isArray(geo) && geo.length >= 2 && steps.length) {
            const target = steps.find((m) => m.type !== "wait") ?? steps[0];
            target.geometry = geo;
            issues.push({ dayId, slotId: String(s.id), kind: "geometry-moved" });
          }
        }
      }
      // Only an absent place is backfilled; a malformed one is left for
      // parseTrip to report rather than silently replaced.
      if (s.place !== undefined && s.place !== null) return;
      let src: Place | null = null;
      let source: BackfillSource = "trip";
      for (let j = i - 1; j >= 0 && !src; j--) {
        if (isPlace(slots[j].place)) [src, source] = [slots[j].place as Place, "prev-slot"];
      }
      for (let j = i + 1; j < slots.length && !src; j++) {
        if (isPlace(slots[j].place)) [src, source] = [slots[j].place as Place, "next-slot"];
      }
      if (!src && isPlace(d.location)) [src, source] = [d.location, "day-location"];
      if (!src && (carry ?? tripAnchor)) [src, source] = [(carry ?? tripAnchor)!, "trip"];
      if (!src) return; // nothing to anchor on — validate reports the missing place
      s.place = guess(src);
      issues.push({ dayId, slotId: String(s.id), kind: "place-backfilled", source });
    });
    const lastPlaced = [...slots].reverse().find((s) => isPlace(s.place));
    if (lastPlaced) carry = lastPlaced.place as Place;
    else if (isPlace(d.location)) carry = d.location;
  }

  doc.schemaVersion = SCHEMA_VERSION;
  reports.set(doc, { fromVersion: schemaVersionOf(raw), raw: rawJson, issues });
  return { trip: doc, issues };
}

// Turn a slot title into a geocoder query: "IC 562: Taranto → Bari Centrale"
// → "Bari Centrale" (the slot's place is where it ends), parentheticals dropped.
export function geocodeQuery(title: string): string {
  let q = title;
  const arrow = q.split(/→|->/);
  if (arrow.length > 1) q = arrow[arrow.length - 1];
  else if (q.includes(":")) q = q.slice(q.indexOf(":") + 1);
  return q.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export type NearGeocoder = (query: string, near: Place) => Promise<Place | null>;

// Hits further than this from the backfilled guess are rejected: a slot title
// like "Free time" can match a namesake village anywhere.
export const GEOCODE_MAX_KM = 50;

// Refines a migrated trip's backfilled places with a geocoder (best effort,
// sequential to respect keyless-API quotas). Geocoded places stay `estimated`
// — still the user's to confirm — but are usually far closer than the guess.
// Returns a new trip; the migration report follows it with updated sources.
export async function migrateTripWithGeocode(trip: Trip, geocode: NearGeocoder): Promise<Trip> {
  const report = reports.get(trip);
  const backfilled = new Set(
    (report?.issues ?? []).filter((i) => i.kind === "place-backfilled").map((i) => i.slotId)
  );
  if (backfilled.size === 0) return trip;
  const next: Trip = JSON.parse(JSON.stringify(trip));
  const issues = (report?.issues ?? []).map((i) => ({ ...i }));
  for (const day of next.days) {
    for (const slot of day.slots) {
      if (!backfilled.has(slot.id)) continue;
      const q = geocodeQuery(slot.title);
      if (q.length < 2) continue;
      let hit: Place | null = null;
      try {
        hit = await geocode(q, slot.place);
      } catch {
        hit = null;
      }
      if (!hit || distanceM(hit, slot.place) > GEOCODE_MAX_KM * 1000) continue;
      slot.place = { ...hit, estimated: true };
      const issue = issues.find((i) => i.slotId === slot.id && i.kind === "place-backfilled");
      if (issue) issue.source = "geocoded";
    }
  }
  if (report) reports.set(next, { ...report, issues });
  return next;
}
