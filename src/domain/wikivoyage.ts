// Destination ideas from Wikivoyage: the See / Do / Eat listings of a city
// guide. Listings are wikitext templates — `{{see | name=… | lat=… | long=…
// | content=…}}` (or `{{listing | type=see …}}`) — so this reads the page
// source. Big cities keep their listings on district subpages ("Rome/Trastevere"),
// fetched in one batched query when the main page has few of its own.

export type IdeaKind = "see" | "do" | "eat";

export interface Idea {
  kind: IdeaKind;
  name: string;
  lat: number | null;
  lon: number | null;
  description: string; // plain text, trimmed
  page: string; // the guide page it came from
  // For a photo (see photos.ts): the listing's own Commons image, or its
  // Wikidata item / Wikipedia article.
  image?: string; // "File:…"
  wikidata?: string;
  wikipedia?: string; // "en:Title"
}

const KINDS = new Set(["see", "do", "eat"]);
const MAX_DESC = 220;

// Top-level template bodies ("see | name=…") in wikitext, braces nested.
function templates(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = text.indexOf("{{", i)) !== -1) {
    let depth = 0;
    let j = i;
    for (; j < text.length - 1; j++) {
      if (text[j] === "{" && text[j + 1] === "{") {
        depth++;
        j++;
      } else if (text[j] === "}" && text[j + 1] === "}") {
        depth--;
        j++;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    out.push(text.slice(i + 2, j - 1));
    i = j + 1;
  }
  return out;
}

// Split on top-level "|" (not inside [[…]] or {{…}}).
function params(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let k = 0; k < body.length; k++) {
    const two = body.slice(k, k + 2);
    if (two === "[[" || two === "{{") {
      depth++;
      cur += two;
      k++;
    } else if ((two === "]]" || two === "}}") && depth > 0) {
      depth--;
      cur += two;
      k++;
    } else if (body[k] === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += body[k];
  }
  parts.push(cur);
  return parts;
}

// Wiki markup → plain text.
export function plain(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const num = (s: string | undefined): number | null => {
  const n = s === undefined || s.trim() === "" ? NaN : Number(s.trim());
  return Number.isFinite(n) ? n : null;
};

export function parseListings(wikitext: string, page: string): Idea[] {
  const ideas: Idea[] = [];
  for (const t of templates(wikitext)) {
    const [head, ...rest] = params(t);
    const fields: Record<string, string> = {};
    for (const p of rest) {
      const eq = p.indexOf("=");
      if (eq > 0) fields[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    }
    const tname = head.trim().toLowerCase();
    const kind = (tname === "listing" || tname === "marker" ? (fields.type ?? "").toLowerCase() : tname) as IdeaKind;
    if (!KINDS.has(kind)) continue;
    const name = plain(fields.name ?? "");
    if (!name) continue;
    const lat = num(fields.lat);
    const lon = num(fields.long ?? fields.lon);
    let description = plain(fields.content ?? fields.description ?? "");
    if (description.length > MAX_DESC) description = `${description.slice(0, MAX_DESC - 1).replace(/\s+\S*$/, "")}…`;
    const image = (fields.image ?? "").replace(/^(File|Image):/i, "").trim();
    const wikidata = (fields.wikidata ?? "").trim();
    const wikipedia = (fields.wikipedia ?? "").trim();
    ideas.push({
      ...(image ? { image: `File:${image}` } : {}),
      ...(/^Q\d+$/.test(wikidata) ? { wikidata } : {}),
      ...(wikipedia ? { wikipedia: wikipedia.includes(":") ? wikipedia : `en:${wikipedia}` } : {}),
      kind,
      name,
      lat: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? lat : null,
      lon: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? lon : null,
      description,
      page,
    });
  }
  return ideas;
}

// The guide's title for a place name: "Rome, Lazio, Italy" → "Rome".
export const guideTitle = (placeName: string): string => placeName.split(",")[0].trim();

export const WIKIVOYAGE = "https://en.wikivoyage.org";
const API = `${WIKIVOYAGE}/w/api.php?format=json&formatversion=2&origin=*&action=query&prop=revisions&rvprop=content&rvslots=main`;

interface QueryPages {
  query?: { pages?: { title?: string; missing?: boolean; revisions?: { slots?: { main?: { content?: string } } }[] }[] };
}

const pagesOf = (body: unknown) =>
  ((body as QueryPages | null)?.query?.pages ?? [])
    .filter((p) => !p.missing && p.title)
    .map((p) => ({ title: p.title!, text: p.revisions?.[0]?.slots?.main?.content ?? "" }));

async function get(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Ideas for a city, or null when Wikivoyage can't be reached or has no guide.
export async function fetchIdeas(
  city: string,
  fetchFn: typeof fetch = fetch
): Promise<{ title: string; ideas: Idea[] } | null> {
  const main = pagesOf(await get(fetchFn, `${API}&redirects=1&titles=${encodeURIComponent(city)}`))[0];
  if (!main) return null;
  let ideas = parseListings(main.text, main.title);
  if (ideas.length < 8) {
    // District guides: up to 12 subpages in one request.
    const subs = pagesOf(
      await get(fetchFn, `${API}&generator=allpages&gapnamespace=0&gaplimit=12&gapprefix=${encodeURIComponent(`${main.title}/`)}`)
    );
    for (const s of subs) ideas = ideas.concat(parseListings(s.text, s.title));
  }
  // The same place listed twice (main page and a district) counts once.
  const seen = new Set<string>();
  ideas = ideas.filter((i) => {
    const k = `${i.kind}:${i.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { title: main.title, ideas };
}
