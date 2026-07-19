# Wayfork — free REST-API integrations

Strategy, quotas, and the phased roadmap for third-party services. Written
during the v1.0.0 exploration (2026-07); revisit quotas before each new
milestone.

## The architectural rule that decides everything

Wayfork is a **pure client-side app on GitHub Pages** — every API request
originates from the *user's own browser and IP*.

- **Keyless services with per-IP fair-use limits scale per user.** 100
  simultaneous users = 100 independent quotas. Nothing is shared, nothing
  ships in the bundle, nothing costs money.
- **Keyed services (Mapbox, MapTiler, Geoapify, ORS…) pool ONE quota across
  all users**, and the key is visible in the JS bundle (mitigable only by
  domain-locking or a proxy).

So Wayfork is keyless-first. Keyed providers are documented below as an
opt-in reliability upgrade for the small-audience case only.

## Adopted stack

| Service | Used for | Free limit (per user IP) | Since |
|---|---|---|---|
| Open-Meteo geocoding + forecast | place autocomplete, weather badges | ~10k req/day fair use | v0.2x |
| Frankfurter (ECB) | tri-currency rates | fair use | v0.2x |
| OSRM demo server | road/foot route geometry on the day map | courtesy, no SLA | v0.28 |
| **OpenFreeMap** (`tiles.openfreemap.org/styles/liberty`) | day-map base layer (MapLibre GL vector tiles) | keyless, unlimited, attribution required | **v1.3.0** (replaced OSM raster + Leaflet) |
| **Overpass API** (`overpass-api.de`, mirrors `overpass.kumi.systems`, `overpass.private.coffee`) | POI discovery (Discover panel) | ~10k req/day + 1 GB/day; 429 + slot queue when busy | **v1.0.0** |
| **Wikipedia REST summary / Wikidata EntityData** | POI descriptions + thumbnails via OSM `wikipedia`/`wikidata` tags | generous | **v1.0.0** |
| **Transitous / MOTIS 2** (`api.transitous.org/api/v6/plan`) | worldwide transit routing → real variant micro-steps + map geometry | fair use; contact the project before heavy endpoints | **v1.2.0** |
| OpenFreeMap | keyless unlimited vector tiles (MapLibre) | unlimited, attribution required | v1.3.0 (planned) |

Conventions for every adapter (see `src/domain/geocode.ts`, `poi.ts`,
`route.ts`, `transit.ts`): pure module in `src/domain/`, injectable
`fetchFn`, `null`/`[]` on failure, client-side abort timeouts, and the UI
never fetches until the user asks (Discover fires only on its explicit
button since v1.0.1; the day map's 🚆 Transit button is the same pattern).
Overpass queries stay cheap by design: narrowed tag selectors (no bare
`historic=*`), `[timeout:12]` + a matching 12 s client abort per endpoint,
and an 80-element output cap.

**Transitous/MOTIS response schema caveat:** both of MOTIS's interactive doc
UIs (transitous.org/api, routing.spline.de/doc) returned 403 to automated
fetches during research, and this sandbox cannot reach the live endpoint at
all (same constraint every external adapter here already has — Overpass,
Wikipedia, and OSRM were never verified against a live call either, only
against the public OpenAPI spec + stubbed responses). `transit.ts` parses
every field defensively — unrecognized `mode` values map to a generic
"transfer" step instead of dropping the leg, missing `duration`/`distance`
fall back to a haversine estimate, and a malformed polyline degrades to no
stored geometry (the map falls back to its schematic arc) — so a schema
mismatch produces a rougher variant, not a broken one. Worth a live spot
check before heavy real-world use.

## Scale scenarios

**~20 VIP users (owner + invited friends).** Shared keyed quotas fit:
Geoapify ≈ 600–1,200 of 3,000 credits/day (20 users × ~30 place searches);
Mapbox ≈ 3,000 of 50k map loads/month; ORS ≈ within 2,000 directions/day.
A **domain-locked** key (locked to `costinfl.github.io`) would be a safe
reliability upgrade at this scale.

**50–100 simultaneous users.** Shared keyed quotas break (100 users × 30
searches ≈ 3,000–6,000 Geoapify credits — over quota on day one), while
per-IP keyless quotas keep scaling per user. This is why the primary stack
is keyless.

## Evaluated and not adopted

| Service | Why not |
|---|---|
| Mapbox | 50k map loads/month pooled across all users; key in bundle; needs account/billing |
| MapTiler ("MapAtlas") | same pooled-session model; fine at 20 users, not at 100 |
| Geoapify | good API, but 3k credits/day pooled; keep as optional domain-locked fallback |
| OpenRouteService | 2k directions/day pooled — worse than OSRM's per-IP courtesy for this app |
| OpenTripMap | unclear maintenance; Overpass + Wikipedia covers it keylessly |
| Nominatim | 1 req/s, no autocomplete permitted; Open-Meteo/Photon fit better |
| Photon (komoot) | fine keyless geocoder (~1 req/s soft) — kept as an alternative if Open-Meteo degrades |

## Roadmap

- **v1.0.0 — POI discovery (shipped).** Discover panel beside the day map:
  Overpass categories (sights/museums/food/parks), Wikipedia enrichment,
  one-click add-to-day.
- **v1.0.1 — field fixes (shipped).** Admin-function CORS preflight;
  Overpass reliability (narrowed selectors, 12 s timeouts, third mirror,
  failure ≠ empty + Retry); explicit Discover button.
- **v1.1.0 — Discover & desktop UX (shipped).** Desktop wide view (~92%,
  default on); search circle + ⌖ center + POI pins on the day map; added
  slots insert after a chosen "Start from" anchor and connect with a real
  estimated leg (OSRM foot ≤2.5 km / driving beyond, haversine fallback).
- **v1.2.0 — Transit micro-steps (shipped).** A 🚆 Transit button (beside
  "+ variant", shown once a slot and its nearest earlier placed slot both
  have a map place) fetches the best Transitous itinerary and saves it as a
  variant: one micro-step per leg (walk/metro/train/bus/etc., mapped from
  MOTIS's `mode`), `estimated: true`, and — new — a stored `geometry` on
  the variant so the day map draws the itinerary's real path instead of a
  schematic arc (`VariantNode.geometry?: [number, number][] | null`).
- **v1.3.0 — OpenFreeMap vector tiles (shipped).** The day map moved from
  Leaflet + OSM raster to MapLibre GL + OpenFreeMap (Liberty style, keyless,
  unlimited); retires the OSM tile-policy risk noted since v0.28. `DayMap.tsx`
  rewritten on MapLibre's source/layer model (one `tracks` GeoJSON source,
  `tracks-active`/`tracks-alt` line layers, feature-state highlight, a
  `discover-area` polygon via new `circlePolygon` in `geometry.ts`). The
  MapLibre chunk is heavier (~288 KB gzip vs Leaflet's ~46 KB) but stays
  lazy-loaded, so the entry bundle is unchanged. **This completes the
  free-API integration roadmap (v1.0–v1.3).**
- Later: per-micro-step waypoint routing; POI opening_hours →
  checkpoint `opensMin`; PDF export with POI photos (map thumbnails can now
  use MapLibre's canvas export).
