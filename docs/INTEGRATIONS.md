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
| OSM raster tiles | day-map base layer | tile usage policy, no heavy use | v0.28 |
| **Overpass API** (`overpass-api.de`, mirror `overpass.kumi.systems`) | POI discovery (Discover panel) | ~10k req/day + 1 GB/day; 429 + slot queue when busy | **v1.0.0** |
| **Wikipedia REST summary / Wikidata EntityData** | POI descriptions + thumbnails via OSM `wikipedia`/`wikidata` tags | generous | **v1.0.0** |
| Transitous / MOTIS 2 (`api.transitous.org`) | worldwide transit routing → variant micro-steps | fair use; contact the project before heavy endpoints | v1.1.0 (planned) |
| OpenFreeMap | keyless unlimited vector tiles (MapLibre) | unlimited, attribution required | v1.2.0 (planned) |

Conventions for every adapter (see `src/domain/geocode.ts`, `poi.ts`,
`route.ts`): pure module in `src/domain/`, injectable `fetchFn`, returns
`[]`/`null` on any failure, one mirror/fallback at most, and the UI never
fetches until the user asks (panels collapsed by default, debounced).

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
- **v1.1.0 — Transit micro-steps.** Transitous `plan` between consecutive
  placed slots → real metro/train/bus legs inserted as a variant with
  per-leg micro-steps (also fixes "no real transit geometry" on the map).
- **v1.2.0 — OpenFreeMap vector tiles.** Swap OSM raster + Leaflet for
  MapLibre GL + OpenFreeMap (keyless, unlimited); retires the OSM
  tile-policy risk noted since v0.28.
- Later: per-micro-step waypoint routing; POI opening_hours →
  checkpoint `opensMin`; PDF export with POI photos.
