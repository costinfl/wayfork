import type { Trip } from "../domain/types";

// Persistence boundary. The UI only talks to this interface; swapping
// localStorage for a REST/database-backed adapter later means implementing
// these three methods and changing nothing else. Methods are async for that
// reason even though the current adapter is synchronous underneath.
export interface TripStore {
  list(): Promise<Trip[]>;
  save(trip: Trip): Promise<void>;
  remove(id: string): Promise<void>;
}

// Stored trips override built-ins with the same id (copy-on-write edits of
// shipped trips) and extend the list otherwise (uploads).
export function mergeWithBuiltins(builtins: Trip[], stored: Trip[]): Trip[] {
  const extras = stored.filter((s) => !builtins.some((b) => b.id === s.id));
  return [...builtins.map((b) => stored.find((s) => s.id === b.id) ?? b), ...extras];
}

// Deterministic stringify (keys sorted at every level) so two trip documents
// compare equal regardless of key order — jsonb round-trips through Postgres
// do not preserve it.
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// Two trip lists are equal when they hold the same ids with the same content,
// irrespective of order or object key order. Used by the background sync to
// skip a state update (and re-render) when a poll returns nothing new.
export function tripsEqual(a: Trip[], b: Trip[]): boolean {
  if (a.length !== b.length) return false;
  const byId = (list: Trip[]) => new Map(list.map((t) => [t.id, stableStringify(t)]));
  const ma = byId(a);
  const mb = byId(b);
  if (ma.size !== mb.size) return false;
  for (const [id, s] of ma) if (mb.get(id) !== s) return false;
  return true;
}

export interface MigrationResult {
  imported: string[]; // trip ids moved from the browser into the account
  skipped: string[]; // ids left in the browser because the account already has them
  failed: { id: string; error: string }[]; // ids whose save was rejected
}

// Move browser-stored trips into the signed-in user's account store. A trip
// whose id already exists in the account is left untouched locally (never
// overwrites the account copy); the rest are saved to the account and removed
// from the local store, so each trip lives in exactly one place. Used once on
// sign-in to offer importing trips created while signed out.
//
// Each trip is handled independently: a rejected save (e.g. an id that collides
// with a row the user cannot write under row-level security) is recorded in
// `failed` and leaves that trip in the browser, without aborting the rest.
export async function migrateLocalTrips(
  local: TripStore,
  account: TripStore,
  accountIds: Iterable<string>
): Promise<MigrationResult> {
  const existing = new Set(accountIds);
  const imported: string[] = [];
  const skipped: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const trip of await local.list()) {
    if (existing.has(trip.id)) {
      skipped.push(trip.id);
      continue;
    }
    try {
      await account.save(trip);
      await local.remove(trip.id);
      imported.push(trip.id);
    } catch (e) {
      failed.push({ id: trip.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { imported, skipped, failed };
}
