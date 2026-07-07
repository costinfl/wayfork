import { describe, expect, it } from "vitest";
import { removeExpense } from "../domain/mutate";
import type { Trip } from "../domain/types";
import { createLocalStorageStore } from "./localStorageStore";
import { mergeWithBuiltins, TripConflictError } from "./repository";
import { TRIPS } from "./index";

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

const clone = (t: Trip): Trip => structuredClone(t);

describe("createLocalStorageStore", () => {
  it("round-trips save/list/remove, stamping version 0 on a new trip", async () => {
    const store = createLocalStorageStore(fakeStorage());
    expect(await store.list()).toEqual([]);
    const saved = await store.save(clone(TRIPS[0]));
    expect(saved.version).toBe(0);
    expect(await store.list()).toEqual([saved]);
    await store.remove(saved.id);
    expect(await store.list()).toEqual([]);
  });

  it("save replaces an existing trip and bumps its version", async () => {
    const store = createLocalStorageStore(fakeStorage());
    const saved = await store.save(clone(TRIPS[0]));
    const edited = await store.save(removeExpense(saved, saved.expenses[0].id));
    expect(edited.version).toBe(1); // bumped from the matched version
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].expenses).toHaveLength(saved.expenses.length - 1);
    expect(listed[0].version).toBe(1);
  });

  it("rejects a stale save with a TripConflictError carrying the current trip", async () => {
    const store = createLocalStorageStore(fakeStorage());
    const base = await store.save(clone(TRIPS[0])); // version 0
    await store.save({ ...base, name: "First edit" }); // version 1 wins
    const err = await store.save({ ...base, name: "Stale edit" }).catch((e) => e); // still version 0
    expect(err).toBeInstanceOf(TripConflictError);
    expect((err as TripConflictError).remote?.name).toBe("First edit");
    expect((err as TripConflictError).remote?.version).toBe(1);
  });

  it("drops invalid entries instead of crashing", async () => {
    const storage = fakeStorage();
    storage.setItem("wayfork.trips", JSON.stringify([{ nonsense: true }, clone(TRIPS[1])]));
    const store = createLocalStorageStore(storage);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(TRIPS[1].id);
  });

  it("migrates pre-v0.6 uploads from the legacy key", async () => {
    const storage = fakeStorage();
    storage.setItem("wayfork.uploadedTrips", JSON.stringify([clone(TRIPS[2])]));
    const store = createLocalStorageStore(storage);
    expect((await store.list())[0].id).toBe(TRIPS[2].id);
    expect(storage.getItem("wayfork.uploadedTrips")).toBeNull();
    expect(storage.getItem("wayfork.trips")).not.toBeNull();
  });
});

describe("mergeWithBuiltins", () => {
  it("overrides built-ins by id and appends the rest", () => {
    const override = { ...clone(TRIPS[0]), name: "Rome (edited)" };
    const extra = { ...clone(TRIPS[1]), id: "trip-custom", name: "Custom" };
    const merged = mergeWithBuiltins(TRIPS, [override, extra]);
    expect(merged).toHaveLength(TRIPS.length + 1);
    expect(merged[0].name).toBe("Rome (edited)");
    expect(merged[1]).toEqual(TRIPS[1]);
    expect(merged.at(-1)?.id).toBe("trip-custom");
  });
});
