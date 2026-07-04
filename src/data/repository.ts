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

export interface MigrationResult {
  imported: string[]; // trip ids moved from the browser into the account
  skipped: string[]; // ids left in the browser because the account already has them
}

// Move browser-stored trips into the signed-in user's account store. A trip
// whose id already exists in the account is left untouched locally (never
// overwrites the account copy); the rest are saved to the account and removed
// from the local store, so each trip lives in exactly one place. Used once on
// sign-in to offer importing trips created while signed out.
export async function migrateLocalTrips(
  local: TripStore,
  account: TripStore,
  accountIds: Iterable<string>
): Promise<MigrationResult> {
  const existing = new Set(accountIds);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const trip of await local.list()) {
    if (existing.has(trip.id)) {
      skipped.push(trip.id);
      continue;
    }
    await account.save(trip);
    await local.remove(trip.id);
    imported.push(trip.id);
  }
  return { imported, skipped };
}
