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

import { vi } from "vitest";
import { parsePhoton, reversePlace, searchPhoton } from "./geocode";
import photonSearch from "./__fixtures__/photon-search-colosseum.json";
import photonReverse from "./__fixtures__/photon-reverse-colosseo.json";

// Recorded from photon.komoot.io on 2026-11-10 (q=colosseum near Rome; reverse
// at the Colosseum), trimmed.
describe("Photon search", () => {
  it("parses hits with a title, a kind · area detail, and a city-qualified place", () => {
    const hits = parsePhoton(photonSearch);
    expect(hits[0]).toMatchObject({
      title: "Colosseum",
      detail: "pedestrian · Rome, Italy",
      place: { name: "Colosseum, Rome" },
    });
    // The monument right next to the square of the same name is collapsed into it.
    expect(hits.filter((h) => h.title === "Colosseum" && h.place.name === "Colosseum, Rome")).toHaveLength(1);
    expect(hits.map((h) => h.title)).toContain("Colosseum Shop");
    expect(hits.find((h) => h.title === "Colosseum Shop")!.detail).toBe("books · Rome, Italy");
    // An area elsewhere says what it is.
    expect(hits.some((h) => /district · Australia/.test(h.detail))).toBe(true);
  });

  it("biases toward a point, needs 3 characters, and is [] on failure", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(photonSearch)));
    const hits = await searchPhoton("colosseum", { lat: 41.9, lon: 12.5 }, f);
    expect(hits.length).toBeGreaterThan(2);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("q=colosseum&lat=41.9000&lon=12.5000");
    expect(await searchPhoton("co", null, f)).toEqual([]);
    expect(await searchPhoton("colosseum", null, vi.fn(async () => new Response("", { status: 502 })))).toEqual([]);
    expect(await searchPhoton("colosseum", null, vi.fn(async () => Promise.reject(new Error("abort"))))).toEqual([]);
  });

  it("names a tapped point", async () => {
    const hit = await reversePlace({ lat: 41.8902, lon: 12.4922 }, vi.fn(async () => new Response(JSON.stringify(photonReverse))));
    expect(hit).toMatchObject({ title: "Colosseum", detail: "archaeological site · Rome, Italy" });
    expect(hit!.place).toMatchObject({ name: "Colosseum, Rome", lat: expect.closeTo(41.89, 2), lon: expect.closeTo(12.492, 2) });
    expect(await reversePlace({ lat: 0, lon: 0 }, vi.fn(async () => new Response(JSON.stringify({ features: [] }))))).toBeNull();
  });
});
