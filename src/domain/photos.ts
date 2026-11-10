import type { Poi } from "./poi";

// A small photo for each Discover result, looked up in as few requests as
// possible: the OSM `wikimedia_commons` / `image` tags first (no request),
// then Wikipedia page images (one request per language, ≤ 50 titles), then
// Wikidata's image property (P18) for POIs that only carry a QID (one
// request, ≤ 50 ids). Every step is best effort: a POI without a photo is
// simply left out.

const THUMB = 160;

// A Commons file as a scaled thumbnail (Special:FilePath redirects to it).
export const commonsThumb = (file: string, width = THUMB): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    file.replace(/^File:/i, "").replace(/ /g, "_")
  )}?width=${width}`;

type Pics = Record<string, string>; // poi id → image URL

async function json(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Wikipedia `prop=pageimages` (formatversion=2): titles → thumbnail URL,
// following title normalisation ("Pantheon,_Rome" → "Pantheon, Rome").
export function parsePageImages(body: unknown): Record<string, string> {
  const q = (body as { query?: { pages?: unknown[]; normalized?: { from: string; to: string }[] } } | null)?.query;
  const out: Record<string, string> = {};
  for (const p of (q?.pages ?? []) as { title?: string; thumbnail?: { source?: string } }[]) {
    if (p.title && p.thumbnail?.source) out[p.title] = p.thumbnail.source;
  }
  for (const n of q?.normalized ?? []) if (out[n.to]) out[n.from] = out[n.to];
  return out;
}

// Wikidata `wbgetentities&props=claims`: QID → its first P18 image file.
export function parseP18(body: unknown): Record<string, string> {
  const entities = (body as { entities?: Record<string, { claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }> } | null)?.entities;
  const out: Record<string, string> = {};
  for (const [qid, e] of Object.entries(entities ?? {})) {
    const file = e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof file === "string") out[qid] = file;
  }
  return out;
}

// The APIs take at most 50 titles / ids per request.
const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type PhotoSource = Pick<Poi, "id" | "commons" | "image" | "wikipedia" | "wikidata">;

export async function fetchPoiPhotos(pois: PhotoSource[], fetchFn: typeof fetch = fetch): Promise<Pics> {
  const pics: Pics = {};
  const byLang = new Map<string, Map<string, string[]>>(); // lang → title → poi ids
  const byQid = new Map<string, string[]>();
  for (const p of pois) {
    if (p.commons) pics[p.id] = commonsThumb(p.commons);
    else if (p.image) pics[p.id] = p.image;
    else if (p.wikipedia) {
      const i = p.wikipedia.indexOf(":");
      const [lang, title] = i > 0 && i <= 3 ? [p.wikipedia.slice(0, i), p.wikipedia.slice(i + 1)] : ["en", p.wikipedia];
      const titles = byLang.get(lang) ?? new Map<string, string[]>();
      titles.set(title, [...(titles.get(title) ?? []), p.id]);
      byLang.set(lang, titles);
    } else if (p.wikidata && /^Q\d+$/.test(p.wikidata)) byQid.set(p.wikidata, [...(byQid.get(p.wikidata) ?? []), p.id]);
  }
  const jobs: Promise<void>[] = [];
  for (const [lang, titles] of byLang) {
    if (!/^[a-z-]{2,12}$/.test(lang)) continue;
    for (const list of chunks([...titles.keys()], 50)) {
      jobs.push(
        json(
          fetchFn,
          `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages&pithumbsize=${THUMB}&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(list.join("|"))}`
        ).then((body) => {
          const found = parsePageImages(body);
          for (const t of list) if (found[t]) for (const id of titles.get(t)!) pics[id] = found[t];
        })
      );
    }
  }
  for (const qids of chunks([...byQid.keys()], 50)) {
    jobs.push(
      json(fetchFn, `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&origin=*&ids=${qids.join("|")}`).then(
        (body) => {
          const files = parseP18(body);
          for (const q of qids) if (files[q]) for (const id of byQid.get(q)!) pics[id] = commonsThumb(files[q]);
        }
      )
    );
  }
  await Promise.all(jobs);
  return pics;
}
