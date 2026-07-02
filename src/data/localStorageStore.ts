import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import type { TripStore } from "./repository";

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
    async save(trip) {
      write([...read().filter((t) => t.id !== trip.id), trip]);
    },
    async remove(id) {
      write(read().filter((t) => t.id !== id));
    },
  };
}
