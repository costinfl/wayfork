import { describe, expect, it, vi } from "vitest";
import { commonsThumb, fetchPoiPhotos, parseP18, parsePageImages } from "./photos";
import type { Poi } from "./poi";

// Response shapes follow the MediaWiki/Wikibase API docs (prop=pageimages,
// formatversion=2; wbgetentities props=claims). Live recording wasn't possible:
// Wikimedia rate-limits the sandbox this was built in (HTTP 429).
const pageImages = {
  batchcomplete: true,
  query: {
    normalized: [{ fromencoded: false, from: "Pantheon,_Rome", to: "Pantheon, Rome" }],
    pages: [
      { pageid: 1, ns: 0, title: "Colosseum", thumbnail: { source: "https://upload.wikimedia.org/c160.jpg", width: 160, height: 107 } },
      { pageid: 2, ns: 0, title: "Pantheon, Rome", thumbnail: { source: "https://upload.wikimedia.org/p160.jpg", width: 160, height: 120 } },
      { ns: 0, title: "No such page", missing: true },
    ],
  },
};
const entities = {
  entities: {
    Q4176: { id: "Q4176", claims: { P18: [{ mainsnak: { snaktype: "value", property: "P18", datavalue: { value: "Trevi Fountain, Rome.jpg", type: "string" } } }] } },
    Q999: { id: "Q999", claims: {} },
  },
};

const poi = (id: string, extra: Partial<Poi>): Poi => ({ id, name: id, lat: 0, lon: 0, category: "sights", distanceM: 0, ...extra });

describe("Discover photos", () => {
  it("builds Commons thumbnail URLs", () => {
    expect(commonsThumb("File:Colosseo 2020.jpg")).toBe("https://commons.wikimedia.org/wiki/Special:FilePath/Colosseo_2020.jpg?width=160");
  });

  it("parses page images (with normalised titles) and P18 claims", () => {
    expect(parsePageImages(pageImages)).toMatchObject({
      Colosseum: "https://upload.wikimedia.org/c160.jpg",
      "Pantheon,_Rome": "https://upload.wikimedia.org/p160.jpg",
    });
    expect(parseP18(entities)).toEqual({ Q4176: "Trevi Fountain, Rome.jpg" });
    expect(parsePageImages(null)).toEqual({});
  });

  it("uses tags first, then one batched request per source", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("wikipedia.org") ? pageImages : entities))
    ) as unknown as typeof fetch;
    const pics = await fetchPoiPhotos(
      [
        poi("tagged", { commons: "File:Foo bar.jpg", wikipedia: "en:Colosseum" }),
        poi("img", { image: "https://example.org/x.jpg" }),
        poi("col", { wikipedia: "en:Colosseum" }),
        poi("pan", { wikipedia: "en:Pantheon,_Rome" }),
        poi("trevi", { wikidata: "Q4176" }),
        poi("none", { wikidata: "Q999" }),
        poi("bare", {}),
      ],
      fetchFn
    );
    expect(pics).toEqual({
      tagged: "https://commons.wikimedia.org/wiki/Special:FilePath/Foo_bar.jpg?width=160",
      img: "https://example.org/x.jpg",
      col: "https://upload.wikimedia.org/c160.jpg",
      pan: "https://upload.wikimedia.org/p160.jpg",
      trevi: "https://commons.wikimedia.org/wiki/Special:FilePath/Trevi_Fountain%2C_Rome.jpg?width=160",
    });
    const urls = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("en.wikipedia.org/w/api.php?action=query&prop=pageimages");
    expect(urls[0]).toContain(encodeURIComponent("Colosseum|Pantheon,_Rome"));
    expect(urls[1]).toContain("ids=Q4176|Q999");
  });

  it("splits more than 50 Wikidata ids into several requests", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ entities: {} }))) as unknown as typeof fetch;
    await fetchPoiPhotos(Array.from({ length: 120 }, (_, i) => poi(`p${i}`, { wikidata: `Q${i + 1}` })), fetchFn);
    const urls = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(3);
    expect(urls.map((u) => u.split("ids=")[1].split("|").length)).toEqual([50, 50, 20]);
  });

  it("is empty when the services fail", async () => {
    const fail = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    expect(await fetchPoiPhotos([poi("col", { wikipedia: "en:Colosseum" }), poi("q", { wikidata: "Q1" })], fail)).toEqual({});
  });
});
