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
