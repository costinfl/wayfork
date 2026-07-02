import { describe, expect, it } from "vitest";
import { removeExpense } from "../domain/mutate";
import type { Trip } from "../domain/types";
import { createLocalStorageStore } from "./localStorageStore";
import { mergeWithBuiltins } from "./repository";
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
  it("round-trips save/list/remove", async () => {
    const store = createLocalStorageStore(fakeStorage());
    expect(await store.list()).toEqual([]);
    const trip = clone(TRIPS[0]);
    await store.save(trip);
    expect(await store.list()).toEqual([trip]);
    await store.remove(trip.id);
    expect(await store.list()).toEqual([]);
  });

  it("save replaces an existing trip with the same id", async () => {
    const store = createLocalStorageStore(fakeStorage());
    const trip = clone(TRIPS[0]);
    await store.save(trip);
    await store.save(removeExpense(trip, trip.expenses[0].id));
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].expenses).toHaveLength(trip.expenses.length - 1);
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
