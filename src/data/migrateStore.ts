import { migrateTripWithGeocode, migrationReport, type NearGeocoder } from "../domain/migrate";
import type { Trip } from "../domain/types";
import { validateTrip } from "../domain/validate";
import { TripConflictError, type TripStore } from "./repository";

// Store-wide v1 → v2 write-back. parseTrip already migrates every v1 document
// in memory as it is read (domain/migrate.ts); this pass makes it durable: each
// trip that arrived as v1 is backed up (raw v1 JSON, in this browser), refined
// with a geocoder where its places were guessed, re-validated and saved as v2
// through the normal version-guarded save. It is idempotent by construction —
// a saved trip reads back as v2 and carries no migration report — so it simply
// runs after every load and does nothing once the store is upgraded.
//
// Only trips this user may write are saved: their own (or local) ones. Trips
// shared in by someone else stay migrated in memory only; the owner's client
// writes them back.

export interface StoreMigrationResult {
  upgraded: Trip[]; // the saved v2 trips, carrying their new versions
  estimatedPlaces: number; // slot places in `upgraded` still awaiting confirmation
  readOnly: string[]; // ids migrated in memory only (shared in, not ours to write)
  failed: { id: string; error: string }[];
}

export const V1_BACKUP_PREFIX = "wayfork.v1backup.";

// Keep the original v1 document in this browser before overwriting it, so a
// migration can always be undone by hand (the banner offers a download).
// Never overwrites an existing backup: the first v1 copy seen is the original.
export function backupV1(uid: string, raw: string, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    const key = V1_BACKUP_PREFIX + uid;
    if (storage.getItem(key) === null) storage.setItem(key, raw);
  } catch {
    /* quota / privacy mode — the migration still proceeds */
  }
}

// Every backup held in this browser, as uid → raw v1 JSON.
export function listV1Backups(storage: Storage | null = safeStorage()): Record<string, string> {
  const out: Record<string, string> = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(V1_BACKUP_PREFIX)) {
        out[key.slice(V1_BACKUP_PREFIX.length)] = storage.getItem(key) ?? "";
      }
    }
  } catch {
    /* unreadable storage — no backups to offer */
  }
  return out;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const countEstimated = (t: Trip): number =>
  t.days.reduce((n, d) => n + d.slots.filter((s) => s.place.estimated).length, 0);

export async function migrateStoredTrips(
  store: TripStore,
  trips: Trip[],
  opts: {
    myId: string | null; // signed-in user id; null = local store (all writable)
    geocode?: NearGeocoder;
    backup?: (uid: string, raw: string) => void;
  }
): Promise<StoreMigrationResult> {
  const result: StoreMigrationResult = { upgraded: [], estimatedPlaces: 0, readOnly: [], failed: [] };
  const backup = opts.backup ?? backupV1;

  const prepare = async (t: Trip): Promise<Trip> => {
    const refined = opts.geocode ? await migrateTripWithGeocode(t, opts.geocode) : t;
    const errors = validateTrip(refined);
    if (errors.length) throw new Error(errors[0]);
    return refined;
  };

  for (const trip of trips) {
    const report = migrationReport(trip);
    if (!report) continue; // already v2 in the store
    if (opts.myId && trip.owner && trip.owner !== opts.myId) {
      result.readOnly.push(trip.id);
      continue;
    }
    try {
      backup(trip.uid ?? trip.id, report.raw);
      let saved: Trip;
      try {
        saved = await store.save(await prepare(trip));
      } catch (e) {
        // A co-editor (or another tab) saved first. Their copy is what we
        // migrate now — re-read via the conflict, re-migrate, retry once. If
        // they already wrote v2 there is nothing left to do.
        if (!(e instanceof TripConflictError)) throw e;
        if (!e.remote) throw new Error("trip was deleted while migrating");
        if (!migrationReport(e.remote)) {
          saved = e.remote;
        } else {
          saved = await store.save(await prepare(e.remote));
        }
      }
      result.upgraded.push(saved);
      result.estimatedPlaces += countEstimated(saved);
    } catch (e) {
      result.failed.push({ id: trip.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

// Spaces geocoder calls at least `gapMs` apart — Photon asks keyless clients
// for ~1 request/second, and a migration may look up dozens of slots.
export function pacedGeocoder(geocode: NearGeocoder, gapMs = 1100): NearGeocoder {
  let next = 0;
  return async (q, near) => {
    const wait = next - Date.now();
    next = Math.max(Date.now(), next) + gapMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return geocode(q, near);
  };
}
