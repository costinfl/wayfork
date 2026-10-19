import { describe, expect, it, vi } from "vitest";
import { migrationReport } from "../domain/migrate";
import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import { createLocalStorageStore } from "./localStorageStore";
import { backupV1, listV1Backups, migrateStoredTrips, V1_BACKUP_PREFIX } from "./migrateStore";
import { TripConflictError, type TripStore } from "./repository";

const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
  };
};

// A raw v1 document: no schemaVersion, one slot without a place.
const v1Doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  uid: `uid-${id}`,
  name: `Trip ${id}`,
  participants: [{ id: "p1", name: "Ana" }],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [
    {
      id: `${id}-d1`,
      date: "2026-05-01",
      startTimeMin: 540,
      location: { name: "Rome", lat: 41.9, lon: 12.5 },
      slots: [
        {
          id: `${id}-s1`,
          title: "Free time",
          defaultVariantId: `${id}-v1`,
          checkpoint: null,
          variants: [
            {
              id: `${id}-v1`,
              name: "Stroll",
              cost: { amount: 0, currency: "EUR" },
              microSteps: [{ id: `${id}-m1`, type: "walk", label: "Walk", durationMin: 20, distanceKm: null }],
            },
          ],
        },
      ],
    },
  ],
  expenses: [],
  ...extra,
});

const seededLocal = (docs: unknown[]) => {
  const storage = memStorage();
  storage.setItem("wayfork.trips", JSON.stringify(docs));
  return { storage, store: createLocalStorageStore(storage) };
};

describe("migrateStoredTrips", () => {
  it("writes v1 trips back as v2, backing up the original JSON first", async () => {
    const { storage, store } = seededLocal([v1Doc("a", { version: 0 })]);
    const backups = memStorage();
    const trips = await store.list();
    expect(migrationReport(trips[0])).toBeDefined(); // migrated in memory on read

    const res = await migrateStoredTrips(store, trips, {
      myId: null,
      backup: (uid, raw) => backupV1(uid, raw, backups),
    });

    expect(res.failed).toEqual([]);
    expect(res.upgraded.map((t) => t.id)).toEqual(["a"]);
    expect(res.estimatedPlaces).toBe(1);
    const stored = JSON.parse(storage.getItem("wayfork.trips")!);
    expect(stored[0].schemaVersion).toBe(2);
    expect(stored[0].days[0].slots[0].place).toMatchObject({ name: "Rome", estimated: true });
    expect(JSON.parse(listV1Backups(backups)["uid-a"])).not.toHaveProperty("schemaVersion");
  });

  it("is idempotent: a second pass finds nothing to do", async () => {
    const { store } = seededLocal([v1Doc("a", { version: 0 })]);
    await migrateStoredTrips(store, await store.list(), { myId: null, backup: () => {} });
    const again = await migrateStoredTrips(store, await store.list(), { myId: null, backup: () => {} });
    expect(again.upgraded).toEqual([]);
  });

  it("refines guessed places with the geocoder before saving", async () => {
    const { store } = seededLocal([v1Doc("a", { version: 0 })]);
    const geocode = vi.fn(async () => ({ name: "Villa Borghese", lat: 41.914, lon: 12.492 }));
    const res = await migrateStoredTrips(store, await store.list(), { myId: null, geocode, backup: () => {} });
    expect(geocode).toHaveBeenCalledWith("Free time", expect.objectContaining({ name: "Rome" }));
    expect(res.upgraded[0].days[0].slots[0].place).toMatchObject({ name: "Villa Borghese", estimated: true });
  });

  it("keeps the backfilled guess when the geocoder fails", async () => {
    const { store } = seededLocal([v1Doc("a", { version: 0 })]);
    const geocode = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await migrateStoredTrips(store, await store.list(), { myId: null, geocode, backup: () => {} });
    expect(res.failed).toEqual([]);
    expect(res.upgraded[0].days[0].slots[0].place.name).toBe("Rome");
  });

  it("only writes the user's own trips; shared-in ones stay migrated in memory", async () => {
    const own = parseTrip(v1Doc("own", { owner: "me", version: 1 })).trip!;
    const shared = parseTrip(v1Doc("shared", { owner: "someone-else", version: 3 })).trip!;
    const save = vi.fn(async (t: Trip) => ({ ...t, version: (t.version ?? -1) + 1 }));
    const store: TripStore = { list: async () => [], save, remove: async () => {} };
    const res = await migrateStoredTrips(store, [own, shared], { myId: "me", backup: () => {} });
    expect(save).toHaveBeenCalledTimes(1);
    expect(res.upgraded.map((t) => [t.id, t.version])).toEqual([["own", 2]]);
    expect(res.readOnly).toEqual(["shared"]);
  });

  it("re-migrates and retries once on a version conflict", async () => {
    const local = parseTrip(v1Doc("a", { version: 1 })).trip!;
    const remote = parseTrip(v1Doc("a", { version: 2, name: "Renamed elsewhere" })).trip!;
    const save = vi
      .fn<(t: Trip) => Promise<Trip>>()
      .mockRejectedValueOnce(new TripConflictError(remote))
      .mockImplementation(async (t) => ({ ...t, version: 3 }));
    const store: TripStore = { list: async () => [], save, remove: async () => {} };
    const res = await migrateStoredTrips(store, [local], { myId: null, backup: () => {} });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ name: "Renamed elsewhere", version: 2, schemaVersion: 2 });
    expect(res.upgraded[0].version).toBe(3);
  });

  it("takes the remote copy as-is when the conflicting writer already upgraded it", async () => {
    const local = parseTrip(v1Doc("a", { version: 1 })).trip!;
    const remoteV2 = { ...local, version: 2 }; // a plain v2 object: no migration report
    const save = vi.fn().mockRejectedValueOnce(new TripConflictError(remoteV2));
    const store: TripStore = { list: async () => [], save, remove: async () => {} };
    const res = await migrateStoredTrips(store, [local], { myId: null, backup: () => {} });
    expect(save).toHaveBeenCalledTimes(1);
    expect(res.upgraded).toEqual([remoteV2]);
  });

  it("records a failed save without aborting the rest", async () => {
    const a = parseTrip(v1Doc("a")).trip!;
    const b = parseTrip(v1Doc("b")).trip!;
    const save = vi
      .fn<(t: Trip) => Promise<Trip>>()
      .mockRejectedValueOnce(new Error("RLS says no"))
      .mockImplementation(async (t) => t);
    const store: TripStore = { list: async () => [], save, remove: async () => {} };
    const res = await migrateStoredTrips(store, [a, b], { myId: null, backup: () => {} });
    expect(res.failed).toEqual([{ id: "a", error: "RLS says no" }]);
    expect(res.upgraded.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("v1 backups", () => {
  it("never overwrites the first backup taken for a trip", () => {
    const s = memStorage();
    backupV1("u1", "original", s);
    backupV1("u1", "later", s);
    expect(s.getItem(V1_BACKUP_PREFIX + "u1")).toBe("original");
    expect(listV1Backups(s)).toEqual({ u1: "original" });
  });
});
