import { describe, expect, it, vi } from "vitest";
import {
  buildPoiQuery,
  categorize,
  distanceM,
  fetchPois,
  fetchPoiSummary,
} from "./poi";

const CENTER = { lat: 41.9, lon: 12.5 }; // Rome

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const errStatus = (status: number): Response =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

describe("buildPoiQuery", () => {
  it("includes only the requested categories' filters and the radius", () => {
    const q = buildPoiQuery(CENTER, 1000, ["museums"]);
    expect(q).toContain('nwr["tourism"~"^(museum|gallery)$"]["name"](around:1000,41.9,12.5);');
    expect(q).not.toContain("historic");
    expect(q).not.toContain("restaurant");
  });
});

describe("categorize", () => {
  it("prefers museums over sights and maps each category", () => {
    expect(categorize({ tourism: "museum" })).toBe("museums");
    expect(categorize({ tourism: "attraction" })).toBe("sights");
    expect(categorize({ historic: "castle" })).toBe("sights");
    expect(categorize({ leisure: "park" })).toBe("parks");
    expect(categorize({ amenity: "cafe" })).toBe("food");
    expect(categorize({ shop: "bakery" })).toBeNull();
  });
});

describe("distanceM", () => {
  it("is ~0 for identical points and grows with separation", () => {
    expect(distanceM(CENTER, CENTER)).toBe(0);
    const d = distanceM(CENTER, { lat: 41.91, lon: 12.5 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });
});

describe("fetchPois", () => {
  const elements = [
    {
      type: "node",
      id: 1,
      lat: 41.9001,
      lon: 12.5001,
      tags: { name: "Colosseum", historic: "yes", wikipedia: "en:Colosseum", opening_hours: "09:00-19:00" },
    },
    // way without direct lat/lon → uses center
    {
      type: "way",
      id: 2,
      center: { lat: 41.92, lon: 12.52 },
      tags: { name: "Galleria Borghese", tourism: "museum", wikidata: "Q842858" },
    },
    // nameless → dropped
    { type: "node", id: 3, lat: 41.9, lon: 12.5, tags: { tourism: "attraction" } },
    // category not requested → dropped
    { type: "node", id: 4, lat: 41.9, lon: 12.5, tags: { name: "Bar", amenity: "cafe" } },
  ];

  it("parses, categorizes, sorts by distance and posts to the primary endpoint", async () => {
    const fetchFn = vi.fn(async () => okJson({ elements }));
    const pois = await fetchPois(CENTER, 1000, ["sights", "museums"], fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(String(init.body)).toContain(encodeURIComponent("around:1000"));
    expect(pois.map((p) => p.name)).toEqual(["Colosseum", "Galleria Borghese"]);
    expect(pois[0]).toMatchObject({
      id: "node/1",
      category: "sights",
      openingHours: "09:00-19:00",
      wikipedia: "en:Colosseum",
    });
    expect(pois[1]).toMatchObject({ id: "way/2", category: "museums", wikidata: "Q842858" });
    expect(pois[0].distanceM).toBeLessThan(pois[1].distanceM);
  });

  it("falls back to the mirror on 429 and returns its results", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(errStatus(429))
      .mockResolvedValueOnce(okJson({ elements: [elements[0]] }));
    const pois = await fetchPois(CENTER, 3000, ["sights"], fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1] as unknown as [string])[0]).toBe(
      "https://overpass.kumi.systems/api/interpreter"
    );
    expect(pois).toHaveLength(1);
  });

  it("returns [] when both endpoints fail or on no categories", async () => {
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await fetchPois(CENTER, 1000, ["sights"], failing as unknown as typeof fetch)).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(await fetchPois(CENTER, 1000, [], failing as unknown as typeof fetch)).toEqual([]);
  });
});

describe("fetchPoiSummary", () => {
  it("resolves a wikipedia tag straight to the REST summary", async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ extract: "An ancient amphitheatre.", thumbnail: { source: "https://img/x.jpg" } })
    );
    const s = await fetchPoiSummary({ wikipedia: "en:Colosseum" }, fetchFn as unknown as typeof fetch);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://en.wikipedia.org/api/rest_v1/page/summary/Colosseum"
    );
    expect(s).toEqual({ extract: "An ancient amphitheatre.", thumbnailUrl: "https://img/x.jpg" });
  });

  it("resolves a wikidata tag through the enwiki sitelink", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({ entities: { Q842858: { sitelinks: { enwiki: { title: "Galleria Borghese" } } } } })
      )
      .mockResolvedValueOnce(okJson({ extract: "An art gallery in Rome." }));
    const s = await fetchPoiSummary({ wikidata: "Q842858" }, fetchFn as unknown as typeof fetch);
    expect((fetchFn.mock.calls[1] as unknown as [string])[0]).toContain(
      "en.wikipedia.org/api/rest_v1/page/summary/Galleria%20Borghese"
    );
    expect(s).toEqual({ extract: "An art gallery in Rome." });
  });

  it("returns null without tags, on missing sitelink, or on failure", async () => {
    const fetchFn = vi.fn(async () => okJson({ entities: { Q1: { sitelinks: {} } } }));
    expect(await fetchPoiSummary({}, fetchFn as unknown as typeof fetch)).toBeNull();
    expect(await fetchPoiSummary({ wikidata: "Q1" }, fetchFn as unknown as typeof fetch)).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      await fetchPoiSummary({ wikipedia: "en:X" }, failing as unknown as typeof fetch)
    ).toBeNull();
  });
});
