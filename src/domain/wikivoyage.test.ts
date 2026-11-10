import { describe, expect, it, vi } from "vitest";
import { fetchIdeas, guideTitle, parseListings, plain } from "./wikivoyage";

// Wikitext in Wikivoyage's documented listing-template format
// (Wikivoyage:Listings). Live recording wasn't possible: Wikimedia
// rate-limits the sandbox this was built in (HTTP 429).
const MAIN = `==See==
{{mapframe}}
* {{see
| name=Colosseum | alt=Colosseo | url=https://parcocolosseo.it | lat=41.8902 | long=12.4922 | image=Colosseo 2020.jpg | wikidata=Q10285
| hours=8:30-19:15 | content=The '''largest''' amphitheatre ever built, see [[Ancient Rome|the ancient city]].<ref>source</ref>
}}
* {{see | name=Pantheon | lat= | long= | wikipedia=Pantheon, Rome | content=A Roman temple, now a church.}}
==Do==
* {{do | name=Walk the [[Appian Way]] | lat=41.85 | long=12.51 | content={{km|16}} of ancient road.}}
* {{listing | type=eat | name=Da Enzo | lat=41.888 | long=12.4775 | content=Trattoria in Trastevere.}}
* {{sleep | name=Hotel X | lat=1 | long=2}}
* {{listing | type=see | name= | content=No name}}
`;

describe("Wikivoyage listings", () => {
  it("reads see / do / eat listings with coordinates and plain descriptions", () => {
    const ideas = parseListings(MAIN, "Rome");
    expect(ideas.map((i) => [i.kind, i.name])).toEqual([
      ["see", "Colosseum"],
      ["see", "Pantheon"],
      ["do", "Walk the Appian Way"],
      ["eat", "Da Enzo"],
    ]);
    expect(ideas[0]).toMatchObject({
      lat: 41.8902,
      lon: 12.4922,
      description: "The largest amphitheatre ever built, see the ancient city.",
      page: "Rome",
    });
    expect(ideas[1]).toMatchObject({ lat: null, lon: null });
    // Photo sources: the listing's own image, Wikidata item, Wikipedia article.
    expect(ideas[0]).toMatchObject({ image: "File:Colosseo 2020.jpg", wikidata: "Q10285" });
    expect(ideas[1]).toMatchObject({ wikipedia: "en:Pantheon, Rome" });
    expect(ideas[3].image).toBeUndefined();
    expect(ideas[2].description).toBe("of ancient road.");
  });

  it("strips markup and names the guide", () => {
    expect(plain("[[A|b]] '''c''' <b>d</b> [https://x.org e]")).toBe("b c d e");
    expect(guideTitle("Rome, Lazio, Italy")).toBe("Rome");
  });

  it("follows redirects and adds district subpages when the main page is thin", async () => {
    const page = (title: string, text: string) => ({ title, revisions: [{ slots: { main: { content: text } } }] });
    const fetchFn = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("generator=allpages")
            ? { query: { pages: [page("Rome/Trastevere", "{{eat | name=Da Enzo | lat=41.888 | long=12.4775}}{{see | name=Santa Maria in Trastevere}}")] } }
            : { query: { pages: [page("Rome", MAIN)] } }
        )
      )
    ) as unknown as typeof fetch;
    const r = await fetchIdeas("Rome", fetchFn);
    expect(r!.title).toBe("Rome");
    expect(r!.ideas.map((i) => i.name)).toEqual(["Colosseum", "Pantheon", "Walk the Appian Way", "Da Enzo", "Santa Maria in Trastevere"]);
    const urls = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(urls[0]).toContain("redirects=1&titles=Rome");
    expect(urls[1]).toContain("gapprefix=Rome%2F");
  });

  it("is null without a guide or a connection", async () => {
    const missing = vi.fn(async () => new Response(JSON.stringify({ query: { pages: [{ title: "Nowhere", missing: true }] } }))) as unknown as typeof fetch;
    expect(await fetchIdeas("Nowhere", missing)).toBeNull();
    expect(await fetchIdeas("Rome", vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch)).toBeNull();
  });
});
