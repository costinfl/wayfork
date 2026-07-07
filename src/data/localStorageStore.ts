import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import { TripConflictError, type TripStore } from "./repository";

const KEY = "wayfork.trips";
const LEGACY_KEY = "wayfork.uploadedTrips"; // pre-v0.6 uploads

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// localStorage-backed TripStore. Every entry is re-validated on read so a
// stale or hand-tampered store can never crash the app.
export function createLocalStorageStore(storage: StorageLike = localStorage): TripStore {
  const read = (): Trip[] => {
    try {
      let raw = storage.getItem(KEY);
      if (!raw) {
        raw = storage.getItem(LEGACY_KEY);
        if (raw) {
          storage.setItem(KEY, raw);
          storage.removeItem(LEGACY_KEY);
        }
      }
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.map((entry) => parseTrip(entry).trip).filter((t): t is Trip => t !== null);
    } catch {
      return [];
    }
  };
  const write = (trips: Trip[]) => {
    try {
      storage.setItem(KEY, JSON.stringify(trips));
    } catch {
      /* storage full/unavailable — callers keep their in-memory state */
    }
  };
  return {
    async list() {
      return read();
    },
    // Optimistic-concurrency guard, mirroring the remote store so cross-tab
    // writes can't clobber each other. The expected `trip.version` must match the
    // stored row's; on a match the stored version is bumped, on a mismatch the
    // save is rejected with the current row to re-merge against. Legacy entries
    // and brand-new trips both carry no version (treated as -1) so their first
    // save lands at version 0.
    async save(trip) {
      const current = read();
      const others = current.filter((t) => t.id !== trip.id);
      const existing = current.find((t) => t.id === trip.id);
      if (existing) {
        if (trip.version !== existing.version) {
          throw new TripConflictError(existing);
        }
      } else if (trip.version !== undefined) {
        throw new TripConflictError(null); // expected to update a row that's gone
      }
      const saved: Trip = { ...trip, version: (existing?.version ?? -1) + 1 };
      write([...others, saved]);
      return saved;
    },
    async remove(id) {
      write(read().filter((t) => t.id !== id));
    },
  };
}
