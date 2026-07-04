import { describe, expect, it } from "vitest";
import { TRIPS } from "./index";
import { createLocalStorageStore } from "./localStorageStore";
import { migrateLocalTrips, tripsEqual } from "./repository";
import type { TripStore } from "./repository";
import type { Trip } from "../domain/types";

const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

// In-memory account store so we can assert what got saved.
const memStore = (init: Trip[] = []): TripStore => {
  let data = [...init];
  return {
    async list() {
      return [...data];
    },
    async save(t) {
      data = [...data.filter((x) => x.id !== t.id), t];
    },
    async remove(id) {
      data = data.filter((x) => x.id !== id);
    },
  };
};

// Two valid local trips (real trips with fresh ids, so the localStorage store's
// re-validating reads accept them).
const clone = (t: Trip, id: string, name: string): Trip => ({ ...structuredClone(t), id, name });

const seedLocal = async (trips: Trip[]) => {
  const local = createLocalStorageStore(memStorage());
  for (const t of trips) await local.save(t);
  return local;
};

describe("migrateLocalTrips", () => {
  it("moves every local trip into an empty account and clears the browser", async () => {
    const a = clone(TRIPS[0], "local-a", "Local A");
    const b = clone(TRIPS[1], "local-b", "Local B");
    const local = await seedLocal([a, b]);
    const account = memStore();

    const result = await migrateLocalTrips(local, account, []);

    expect(result.imported.sort()).toEqual(["local-a", "local-b"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect((await account.list()).map((t) => t.id).sort()).toEqual(["local-a", "local-b"]);
    expect(await local.list()).toEqual([]); // moved, not copied
  });

  it("records a rejected save and leaves that trip in the browser, without aborting the rest", async () => {
    const a = clone(TRIPS[0], "local-a", "Local A");
    const b = clone(TRIPS[1], "local-b", "Local B");
    const local = await seedLocal([a, b]);
    // Account store that refuses to save local-a but accepts local-b.
    let data: Trip[] = [];
    const account: TripStore = {
      async list() {
        return [...data];
      },
      async save(t) {
        if (t.id === "local-a") throw new Error("HTTP 403");
        data = [...data.filter((x) => x.id !== t.id), t];
      },
      async remove(id) {
        data = data.filter((x) => x.id !== id);
      },
    };

    const result = await migrateLocalTrips(local, account, []);

    expect(result.imported).toEqual(["local-b"]);
    expect(result.failed).toEqual([{ id: "local-a", error: "HTTP 403" }]);
    expect((await account.list()).map((t) => t.id)).toEqual(["local-b"]);
    // The failed trip stays local; the imported one is gone.
    expect((await local.list()).map((t) => t.id)).toEqual(["local-a"]);
  });

  it("skips trips whose id already exists in the account, leaving them local", async () => {
    const a = clone(TRIPS[0], "local-a", "Local A");
    const b = clone(TRIPS[1], "local-b", "Local B");
    const local = await seedLocal([a, b]);
    const accountA = clone(TRIPS[0], "local-a", "Account A"); // same id, different content
    const account = memStore([accountA]);

    const result = await migrateLocalTrips(local, account, ["local-a"]);

    expect(result.imported).toEqual(["local-b"]);
    expect(result.skipped).toEqual(["local-a"]);
    expect(result.failed).toEqual([]);
    // The account's own copy of local-a is untouched; only local-b was added.
    const acct = await account.list();
    expect(acct.find((t) => t.id === "local-a")?.name).toBe("Account A");
    expect(acct.map((t) => t.id).sort()).toEqual(["local-a", "local-b"]);
    // The colliding trip stays in the browser; the imported one is gone.
    expect((await local.list()).map((t) => t.id)).toEqual(["local-a"]);
  });

  it("is a no-op when the browser has nothing to migrate", async () => {
    const local = await seedLocal([]);
    const account = memStore([clone(TRIPS[0], "acct-1", "Acct 1")]);
    const result = await migrateLocalTrips(local, account, ["acct-1"]);
    expect(result).toEqual({ imported: [], skipped: [], failed: [] });
    expect((await account.list()).map((t) => t.id)).toEqual(["acct-1"]);
  });
});

describe("tripsEqual", () => {
  const a = clone(TRIPS[0], "t1", "One");
  const b = clone(TRIPS[1], "t2", "Two");

  it("ignores list order and object key order", () => {
    const reordered = JSON.parse(JSON.stringify([b, a])); // different array order + fresh key order
    expect(tripsEqual([a, b], reordered)).toBe(true);
  });

  it("detects a content change", () => {
    expect(tripsEqual([a, b], [a, { ...b, name: "Two (edited)" }])).toBe(false);
  });

  it("detects added or removed trips", () => {
    expect(tripsEqual([a, b], [a])).toBe(false);
    expect(tripsEqual([a], [a, b])).toBe(false);
  });
});
