# Wayfork — Status

> The only file to read when resuming. Conventions & commands: `CLAUDE.md`
> (repo root). Full history & shipped designs: `docs/CHANGELOG.md`.

## Current version: v2.7.0 — live on the deploy branch (v2 merged 2026-10-21) — 412 tests green

Shipped: full domain model + ripple scheduler (timezone shifts, opening-hour
checkpoints, weather badges); tri-currency with live ECB rates + fallback;
ledger with equal/percent/fixed splits, projection, greedy settlement; full
CRUD (trips/days/participants/slots/variants/steps/expenses); Supabase
persistence with magic-link auth, per-user RLS, local→account migration,
poll-based multi-device sync (15s / on focus); collaboration Phases 1–6 (invite
editor/viewer, in-app inbox, co-edit, viewer read-only, roster + remove, leave;
trips keyed by surrogate `uid`, rows by `(owner, id)`; and an optimistic
concurrency guard — per-row `version` token, version-guarded saves, 3-way
re-merge on conflict). **Plan-a-trip wizard (v0.27):** a `PlanTripForm`
(starting point + ordered destinations via Open-Meteo place autocomplete,
start date + number of days, return-to-start toggle) builds a validated
**scaffold trip** (`domain/scaffold.ts`) plus a tailored, scaffold-bound AI
prompt (`domain/prompt.ts` + `docs/trip-prompt.md`); the paste/upload path
replaces a matching scaffold in place and flags any drift from it. New
`estimated` provenance flag on variants/expenses (muted badge + form checkbox).
**Day-journey map (v0.28):** a lazy-loaded map (MapLibre GL + OpenFreeMap
since v1.3.0; Leaflet + OSM raster originally) beside the selected day's
timeline — the active variant chain as a solid route
(OSRM road/foot geometry via `domain/route.ts`, straight-line fallback),
forked alternatives as dashed schematic arcs (`domain/geometry.ts`) that are
clickable to activate; a ⌖ button on each variant card focuses its segment.
Slots gained an optional `place` (built-in Rome/Lisbon/Neptun backfilled).
**POI discovery (v1.0.0):** free-API strategy documented in
`docs/INTEGRATIONS.md` (keyless-first — client-side app means per-user IP
quotas); Discover panel beside the day map (`domain/poi.ts` Overpass QL with
mirror fallback + Wikipedia/Wikidata enrichment, `ui/DiscoverPanel.tsx`
category chips/radius/add-to-day → placed starter slot); day-map ⛶
fullscreen toggle (CSS overlay); owner-only Admin panel (`ui/AdminPanel.tsx`
+ `supabase/functions/admin-users` edge function gated on ADMIN_EMAIL —
list/disable/enable/revoke-invites/delete-with-trips).
**v1.0.1 + v1.1.0 (field feedback):** admin-function CORS preflight fixed
(apikey allow-listed, verify_jwt off — the handler self-gates); Overpass
hardened (narrow selectors, 12 s server+client timeouts, third mirror,
failure ≠ empty + Retry); explicit 🧭 Discover button (no auto-fetch);
desktop wide view (~92 %, default on, persisted, `wayfork.wideView`);
search circle + ⌖ center + POI pins drawn on the day map; "Start from"
anchor select — added places insert right after the anchor
(`insertSlotAfter`), connect with a real estimated leg (`estimateLeg`:
OSRM foot ≤2.5 km / driving beyond, haversine fallback, `estimated` flag),
and the anchor advances to each added slot.
**Component/UI coverage (v1.1.1):** the big components are now
behavior-tested — WayforkApp conflict→merge→retry + the v0.26 sync-poll
guards (via a `deps` injection seam defaulting to the real clients), all
four CRUD forms, and TripView (ripple render, checkpoint banner states,
viewer gating; exported for tests).
**Transit micro-steps (v1.2.0):** a 🚆 Transit button beside "+ variant"
(shown once a slot and its nearest earlier placed slot both carry a map
place) fetches the best Transitous/MOTIS itinerary (`domain/transit.ts`)
and saves it as a variant — one micro-step per leg, `estimated: true`, and
a stored route `geometry` the day map now draws directly instead of a
schematic arc (`VariantNode.geometry?`). Response parsing is defensive
throughout (unrecognized `mode` → "transfer", missing duration/distance →
haversine estimate) since the exact MOTIS response schema wasn't fully
confirmable from the sandbox — see the caveat in `docs/INTEGRATIONS.md`.
**OpenFreeMap vector tiles (v1.3.0):** the day map moved from Leaflet + OSM
raster tiles to **MapLibre GL + OpenFreeMap** (keyless, unlimited, Liberty
style) — retires the OSM tile-usage-policy risk open since v0.28. `DayMap.tsx`
rewritten on MapLibre's data-driven model: one `tracks` GeoJSON source with
`tracks-active`/`tracks-alt` line layers (feature-state highlight for focus,
click delegation on the alt layer only), a `discover-area` polygon (new pure
`circlePolygon` helper in `geometry.ts` — MapLibre has no metres-accurate
circle), and imperative HTML markers. Coordinates stay `[lat,lon]` app-wide;
a `toLngLat` flip is applied only at the MapLibre boundary. **This completes
the free-API integration roadmap (v1.0–v1.3).**
**Map zoom controls + Supabase keep-alive (v1.3.1):** the day map now
scroll-zooms (`scrollZoom: true`, was disabled) and gained `−`/`+` buttons
in the same top-right row as the ⛶ fullscreen toggle (`map.zoomIn()`/
`zoomOut()`). Also added `.github/workflows/keep-alive.yml` — a daily
scheduled ping (`GET /rest/v1/trips?select=id&limit=1`, URL/key read live
from `supabaseConfig.ts` so it can't drift) to stop the free-tier Supabase
project auto-pausing after a week idle (this is what caused the "Failed to
fetch" magic-link report this session — the project had paused).
**Timeline marker numbers (v1.3.2):** each timeline slot now shows a small
numbered badge (same style as the map's numbered markers) next to its title
when the map is open and the slot has a place — so a user can tell which
timeline item a given map marker/cluster point belongs to. New pure
`slotMarkerNumbers(day)` in `domain/geometry.ts`, shared by both `DayMap.tsx`
(refactored to use it instead of its own inline dedup) and `WayforkApp.tsx`'s
timeline, so the two numberings can't drift apart.

**v2.0.0 — map-first canvas (breaking; mnml.ro-inspired).** These are the
technologies mnml.ro/radet and /stb use, identified from their bundles:
- Next.js on Vercel and Supabase;
- MapLibre GL 5, with Mapbox GL 3.9 as an alternate engine;
- a minimal custom OpenFreeMap style with fill-extrusion buildings;
- GeoJSON layers with glow and feature-state;
- vehicles polled through server proxies and drawn with a three.js custom
  layer.

What Wayfork v2 adapted from that:
- **Schema v2** (`Trip.schemaVersion: 2`): `ItinerarySlot.place` is required.
  Route geometry moved from `VariantNode.geometry` onto `MicroStep.geometry`,
  with optional `from`/`to` stations. `Place.estimated` marks guessed
  coordinates. Read the variant line with `variantGeometry(v)`.
- **Migration.** `domain/migrate.ts` runs inside `parseTrip`. It backfills a
  missing place from the nearest anchor: previous slot → next slot → day
  location → trip. It also moves variant geometry onto the steps, and it
  repairs v2 documents that the v1 site edited. `data/migrateStore.ts` then
  writes migrated trips back after each load, version-guarded:
  - it backs up the raw v1 JSON (`wayfork.v1backup.<uid>`) first;
  - it refines guessed places with Photon (paced);
  - it saves only the user's own or local trips.
  `V2MigrationBanner` offers Review and a backup download.
- **Layout.** The planner lives in `ui/SideSheet.tsx`: docked right on
  desktop and collapsible; a 3-snap draggable bottom sheet on mobile. It sits
  over `ui/map/TripMap.tsx`, a full-viewport map portalled to `<body>` and
  lazy-loaded (~293 KB gzip). The map's state lives in the `#map=` URL hash.
- **Basemap.** `public/map-style-{dark,light}.json`, generated by
  `scripts/gen-map-styles.mjs`. Dark is the default; it has 3D buildings.
- **Whole-trip overlay** (`domain/overlay.ts` + `ui/map/layers.ts`):
  - every day's numbered stops (amber "N?" when estimated);
  - every variant's track, alternatives dashed in distinct hues, with
    Δtime/Δcost badges for the focused day;
  - clicking an alternative or badge activates it; clicking a stop selects
    its day and scrolls the timeline;
  - Day/Whole-trip scope toggle, 2D/3D toggle and theme toggle.
- **🚋 Live vehicles** (`domain/liveTransit.ts`): Transitous `map/trips`,
  interpolated along each segment. Shown as dots below z15 and as
  fill-extrusion boxes above it (metro stays a dot because it runs
  underground). On by default only while the trip is happening.
- **◎ Reach rings** (`domain/reach.ts`): a 15/30/45-minute travel-time grid.
  Walking is computed locally; transit uses Transitous `one-to-all`, falling
  back to walking if it fails.
- The AI prompt contract (`docs/trip-prompt.md`) now requires a place on
  every slot.

**v2.1.0 — micro-step routing + calmer alternatives.**
- **Legs from micro-steps.** Every variant's line is now built from its
  micro-steps (`domain/legs.ts`, `variantLegs`). Steps with their own
  endpoints or geometry become exact legs; runs of steps without them are
  merged into one leg between the nearest known points.
- **Routing per leg** (focused day, all variants, active first, two lookups
  at a time, cached across remounts):
  - walking → FOSSGIS OSRM foot profile (real footpaths);
  - car, taxi, shuttle → FOSSGIS car profile;
  - metro, tram, bus, train → the lines of a Transitous `/plan` itinerary,
    falling back to a road route;
  - flights → arc (the only arcs left).
- **`route.ts`** now tries `routing.openstreetmap.de` first and the OSRM demo
  server second.
- **Alternatives** are thin solid lines, faint (30 % in the focused day, 7 %
  otherwise), offset ±4/8 px so they never hide under the active line, and
  fully lit on hover together with their Δ badge (badges idle at 45 %).

**v2.1.1 — one meaning per line style.**
- The active route is always solid blue.
- An estimated active segment (its variant, or an endpoint, is a guess) is
  **dashed blue** with a dimmed glow, on its own layer
  `tracks-active-estimated`. Dashes mean nothing else on routes.
- Alternatives never use orange: `ALT_COLORS` is purple, teal, rose, lime,
  gold. Amber is reserved for "estimated" stops ("N?").
- A collapsible legend sits under the map toolbar (`wayfork.mapLegend`).
  The reach panel now stacks in the same column.

**v2.1.2 — believable transit plans only.** `fetchTransitPlan`:
- always sends `transitModes` without AIRPLANE (`GROUND_TRANSIT_MODES`);
- departs tomorrow 10:00 by default;
- passes an optional `maxTravelTime`;
- takes the first itinerary that passes `plausibleItinerary`: no flight legs,
  distance ≤ max(3× straight line, +5 km), within the cap.

Map transit legs cap at `transitBudgetMin` = clamp(3× the leg's
step-minutes + 30, 60, 600). Otherwise → road fallback. This fixes the Rome
"Leonardo Express via Cagliari/Brussels/Lyon" route: Transitous's only
answers for FCO → Trastevere were 20–24 h flight detours, and it has no FCO
rail link. Caveat seen 2026-10-19 ~20:45 UTC: Transitous also stopped
answering Sibari→Taranto and Taranto→Bari at any hour (it did earlier the
same day), so those legs currently draw by road. This is upstream data, not
the app.

**v2.2.0 — tap a live vehicle.** Clicking a 🚋 Live dot or 3D box opens
`ui/map/VehicleCard.tsx` in the map's toolbar column, fed by MOTIS
`/api/v6/trip?tripId=` (`fetchTripDetails` / `parseTripDetails` /
`tripProgress` in `domain/liveTransit.ts`, cached per trip). The card shows:
- line badge, → headsign, long name, operator;
- Live/Scheduled status and delay;
- next stop (+ track) and final stop, times in the stop's own time zone;
- ♿/🚲 flags, alerts, cancellations;
- an "All stops" list with passed stops dimmed;
- Follow (the camera tracks the vehicle).

On the map, the trip's whole route and stops are drawn (`selected-trip`
source) and the vehicle gets a white ring. Esc/✕ closes the card, and
turning Live off clears it.

**v2.3.0 — "＋ Use in my plan"** on the vehicle card (editors only).
- **Choose:** From (boardable stops only), To, and Add as — a new slot after
  any slot of the focused day (default: at the day's end), or an "Option for"
  an existing slot.
- **Built by** `tripToVariant` (`domain/liveTransit.ts`):
  - the ride step, with stop places and the route shape cut to the ride
    (`tripSegmentLine`);
  - walks to the boarding stop and on to the slot only for 100 m – 3 km
    gaps;
  - `estimated: true`, cost 0.
- **Applied by** `TripView.addLiveTrip`: new slot via `insertSlotAfter`
  (title from `tripSlotTitle`), or variant via `upsertVariant` (made
  active); the map focuses it.

**v2.4.0 — departures board.**
- **Stops in view.** With 🚋 Live on, from z15, the stops in view are drawn
  (`transit-stops` layer, MOTIS `/api/v6/map/stops`, refetched on
  `moveend`, debounced).
- **Tapping a stop** — or a stop on a tapped vehicle's route — opens
  `ui/map/DeparturesBoard.tsx`, fed by `/api/v6/stoptimes`
  (`fetchDepartures`, refreshed every 30 s): line, → headsign, local time,
  "in N min", delay, track, cancelled.
- **Picking a departure** opens that trip's card under the board, so you can
  come back. The card's `presence` is "waiting" (not on the road yet: no
  Follow, no "left the view" note), "live" or "gone".

**v2.5.0 — live filter by transport type.**
- **The "N live" chip is a button.** It opens toggles in fixed order:
  trains, subways, trams, buses, trolleybuses (plus ferry/other when
  present). Each has a border in the type colour and a count ("5 trams").
- **Filtering is additive.** No toggle shows everything; any selection shows
  only those types. The selection is saved in `wayfork.liveModes`, and the
  chip reads "N of M live".
- **Vehicles are coloured by type** (`MODE_COLORS`, one palette). The line's
  own colour stays on the card and its route.
- **Trolleybuses.** The live feed reports them as BUS. While the panel is
  open, each bus line in view is looked up once via `/api/v6/trip` (two at a
  time); GTFS `routeType` 11 or 800–899 means trolleybus. Results are cached
  in `wayfork.trolleyLines`, keyed `dataset|line`. Domain helpers:
  `lineKey`, `vehicleCategory`, `countByCategory`, `filterVehicles`. The
  card shows 🚎.

**v2.6.0 — Discover within a reach ring.**
- While ◎ rings are shown, Discover offers a "Within reach" picker: any
  distance, or ≤ 15/30/45 min (walk or transit).
- With a limit, the search centres on the ring's origin, and its radius is
  `reachRadiusM` (it covers those bands; capped at 10 km for Overpass).
  Results are kept to the bands (`reachMinutes`, point-in-cells), and each
  is tagged "◎ ≤ N min".
- Changing the limit or the rings re-filters the same results, and the map
  markers follow. Picking a limit makes the ring's slot the "Start from"
  anchor when it is on this day.

**v2.7.0 — lookups depart at the planned time.**
- ◎ transit rings depart at the slot's scheduled **end**, from its place.
  The 🚆 Transit option departs at the slot's scheduled **start**, from the
  previous place.
- Times are converted in the place's IANA zone (`domain/departure.ts`):
  `fetchTimeZone` asks Open-Meteo `timezone=auto`, cached per ~10 km in
  `wayfork.tz`, with a longitude estimate as the fallback. `zonedToUtc`
  handles DST.
- Dates outside [today, +28 d] are projected onto the next same weekday
  (`timetableDate`), since Transitous has no timetable for them. The rings
  note says e.g. "departing Thu 10:17 (timetable of 22 Oct)".
- The map's leg lines still use a default time; only the track matters
  there.

**v2 in production:** v1 trips are migrated on read and written back. A
cached v1 client keeps unknown keys, so it can't corrupt v2 trips, and any
unplaced slot it adds is repaired on the next v2 read. The `v2/` preview is
retired: deploy.yml publishes the deploy branch only.

## NEXT TASK — v2 follow-ups, smallest first

1. Drag a stop on the map to confirm or move an estimated place.
2. Give the planner sheet a dark theme to match the map.
3. Earlier candidate, still open: trip export/share as PDF (the map can now
   export its canvas).

## Open items
- Admin panel: re-test live after the v1.0.1 CORS fix (magic-link sign-in
  as costinfl@gmail.com on the deployed site) — the sandbox can't do auth
  emails; the preflight fix is deployed (admin-users v2, verify_jwt off).
- Transit micro-steps: only the single best-returned itinerary is offered
  (no alternatives UI); the `time` request param is unset (routes as "now"
  rather than against the trip's actual day/time) — both reasonable v1
  scope cuts, worth revisiting. The MOTIS response schema should get a live
  spot check once this sandbox (or a real deploy) can reach the endpoint.
- Trip map — the MapLibre GL chunk is ~293 KB gzipped (was ~46 KB with
  Leaflet), the cost of a full WebGL vector renderer. It stays lazy-loaded
  (only fetched when a day's map first renders), so the entry bundle is
  unchanged — but if map weight ever matters, MapLibre supports slimmer
  builds / `maplibre-gl-basic`. v2 was screenshot-verified against the REAL
  OpenFreeMap tiles and Transitous API (both reachable from this sandbox).
- Trip map — steps can now carry `from`/`to` + geometry (schema v2), but only
  🚆 Transit variants fill them; routing other variants leg by leg via their
  step places is still open. Day N's first slot now connects from day N−1's
  last place; only the trip's very first slot is a bare marker.
- Scaffold replace is automatic: pasting a trip whose id matches an existing
  scaffold overwrites that row in place and surfaces day/date/location drift as
  a warning list — but there is no explicit "Replace scaffold" confirmation step
  before it happens (the Step-4 cut). Add a confirm gate if in-place overwrite
  ever feels too eager.
- Place names carry their disambiguation (e.g. "Rome, Lazio, Italy"), so scaffold
  trip names and travel-slot titles read verbosely ("Bucharest, Romania → Rome,
  Lazio, Italy"). Fine per spec (coords are user-selected truth) but a shorter
  display label could be split out later.
- Variant costs are projection-only, not netted into settlement (deliberate —
  no payer yet; spec ambiguous, revisit).
- Optional: swap the sync poll for Supabase Realtime WebSocket (would make the
  concurrency guard's re-merge fire near-instantly instead of after the 15s poll).
- Invites are in-app only: `createInvite` inserts a `trip_invites` row that the
  recipient sees in the inbox after signing in with that email — no email is
  ever sent (the only email the app sends is the magic-link sign-in). Delivering
  invites by email would need a Supabase Edge Function (or trigger→SMTP) on
  invite insert, plus a sending domain — not verifiable in this sandbox.
- Future feature: trip export/share as PDF (own workstream — POI photos, map
  thumbnails, render pipeline).

## Update rule
After each session: bump the version line, rewrite NEXT TASK, prune finished
open items, and prepend the session's details to `docs/CHANGELOG.md` (newest
first) — never here.
