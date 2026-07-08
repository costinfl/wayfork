import { describe, expect, it } from "vitest";
import { searchPlaces } from "./geocode";

const fakeFetch = (status: number, body: unknown) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;

const throwingFetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

describe("searchPlaces", () => {
  it("maps Open-Meteo results to Places", async () => {
    const places = await searchPlaces(
      "Rome",
      fakeFetch(200, {
        results: [
          { name: "Rome", latitude: 41.9, longitude: 12.5, country: "Italy", admin1: "Lazio" },
        ],
      })
    );
    expect(places).toEqual([{ name: "Rome, Lazio, Italy", lat: 41.9, lon: 12.5, country: "Italy" }]);
  });

  it("builds a disambiguated display name and drops adjacent duplicates", async () => {
    const places = await searchPlaces(
      "Spring",
      fakeFetch(200, {
        results: [
          { name: "Springfield", latitude: 39.8, longitude: -89.6, country: "United States", admin1: "Illinois" },
          { name: "Bucharest", latitude: 44.4, longitude: 26.1, country: "Romania", admin1: "Bucharest" },
        ],
      })
    );
    expect(places[0].name).toBe("Springfield, Illinois, United States");
    // "Bucharest, Bucharest, Romania" collapses the repeated segment.
    expect(places[1].name).toBe("Bucharest, Romania");
  });

  it("returns [] for queries shorter than 2 characters without fetching", async () => {
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return fakeFetch(200, { results: [] });
    }) as unknown as typeof fetch;
    expect(await searchPlaces("R", spyFetch)).toEqual([]);
    expect(await searchPlaces("  ", spyFetch)).toEqual([]);
    expect(called).toBe(false);
  });

  it("returns [] on HTTP errors, thrown errors, and a missing results array", async () => {
    expect(await searchPlaces("Rome", fakeFetch(503, {}))).toEqual([]);
    expect(await searchPlaces("Rome", throwingFetch)).toEqual([]);
    expect(await searchPlaces("Rome", fakeFetch(200, {}))).toEqual([]);
  });
});
