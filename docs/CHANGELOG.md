# Wayfork — Changelog

> Historical record only. Do not read during normal sessions — resume from
> `docs/STATUS.md`. Consult this file only when debugging a regression.
> New entries are PREPENDED at the top of the session history — newest first.

## Session history

- **v1.1.1** — component/UI test coverage for the big components (the open
  item deferred since v0.28); 236 → 260 tests. WayforkApp: the v0.25
  conflict→merge→retry path driven through the DOM (retry carries the fresh
  version + both sides' changes; info banner; bounded three-attempt bail-out
  with reload + warn banner) and the three v0.26 sync-poll guards under fake
  timers (empty-poll keep, stale-token skip, post-write grace). CRUD forms:
  equal/percent/fixed split payloads + payer, opening-hours checkpoint
  window + clear-to-null + the validateTrip-returned rejections, trip/day
  happy + rejection paths — all via typed spy onSave. TripView: variant
  switch ripples rendered times, ok/amber/red checkpoint banners, day tabs,
  viewer-mode gating. Injection seam: WayforkApp takes an optional `deps`
  prop (localStore/auth/remoteStore/collab) defaulting to the real clients
  (runtime unchanged); TripView gained an `export` keyword. Test-only —
  no behavior change, no tag. README truth-pass, changelog re-sort + prepend
  rule, trip-prompt schema sync (tz/opensMin), CLAUDE.md additions
  (typecheck command, trip-prompt runtime-asset note). The "queue authored
  workstreams in STATUS" step was skipped: both workstreams (plan-a-trip
  wizard, day-journey map) had already shipped as v0.27/v0.28. No version
  bump.
- **v1.0.1 + v1.1.0** — Field-feedback round on v1.0.0. Fixes (v1.0.1): the
  admin panel's "Failed to fetch" was a doubly-failing CORS preflight
  (`apikey` missing from Access-Control-Allow-Headers + verify_jwt 401-ing
  the OPTIONS request) — headers widened, admin-users redeployed v2 with
  verify_jwt off (handler self-gates on the admin JWT); Overpass hardened
  (bare `historic=*` narrowed to tourist-grade values, `[timeout:12]` with a
  matching 12 s client abort per endpoint, third mirror overpass.private.
  coffee, and `fetchPois` now returns null-on-failure vs []-on-empty so the
  panel can show "Overpass is busy — Retry" instead of a silent empty
  state); Discover only fires from its explicit 🧭 button. Features
  (v1.1.0): desktop wide view (~92 % width, default on, persisted, toggle
  hidden below lg); the day map draws the search circle, a ⌖ center marker
  and amber POI pins for the last search (`discover` prop, deterministic
  fitBounds); a "Start from" select anchors discovery — added places insert
  right after the anchor (new `insertSlotAfter` mutation) and the anchor
  advances to each added slot; added slots connect with a real estimated
  leg via new `estimateLeg` in domain/route.ts (OSRM foot ≤2.5 km with
  distance-derived walk time, driving beyond with OSRM duration, haversine
  ×1.3 fallback; variant flagged `estimated`). Transitous → v1.2.0,
  OpenFreeMap → v1.3.0. 236 tests; Playwright-verified.

- **v1.0.0** — Free-API integrations, phase 1: POI discovery + admin. New
  `docs/INTEGRATIONS.md` fixes the API strategy: the app is pure client-side,
  so keyless per-IP services (Overpass, Wikipedia, Open-Meteo, OSRM,
  Transitous, OpenFreeMap) scale per user, while keyed free tiers
  (Mapbox/MapTiler/Geoapify) pool one quota — keyless-first, roadmap
  v1.1.0 Transitous transit micro-steps → v1.2.0 OpenFreeMap vector tiles.
  **Discover panel** (`domain/poi.ts` + `ui/DiscoverPanel.tsx`, collapsed by
  default, beside the day map): Overpass QL nearby search (sights/museums/
  food/parks chips, 1/3/10 km radius, primary instance + kumi mirror
  fallback, distance-sorted, opening hours) with lazy Wikipedia/Wikidata
  extracts + thumbnails, and one-click "Add to day" → placed starter slot
  through the usual validate→save path. **Day map ⛶ fullscreen** (CSS
  overlay, Esc exits, invalidateSize on toggle). **Admin panel**
  (`ui/AdminPanel.tsx` + AuthBar 🛠 button for ADMIN_EMAIL only) backed by
  the new `supabase/functions/admin-users` edge function (service-role ops
  server-side, JWT email gate): list users + owned-trip counts,
  disable/enable via auth ban, revoke shared access + pending invites
  (owned trips kept), delete user cascading their trips. 226 tests
  (poi/DiscoverPanel/AdminPanel/DayMap-fullscreen); Playwright-verified
  (Overpass/Wikipedia/Supabase stubbed).

- **v0.28.0** — Day-journey map. A lazy-loaded Leaflet + OSM map (the repo's
  first runtime dependency, own ~46KB-gzip chunk) sits beside the day's timeline
  (two columns wide, toggleable panel on mobile). Slots gained an optional
  `place` (canonical `Place` in types.ts; parsed/validated; SlotForm autocomplete
  via an extracted `PlaceInput`; built-in Rome/Lisbon/Neptun backfilled). Pure
  `domain/geometry.ts` (`dayTrack` + `offsetArc`) builds segments; the active
  chain draws a solid route (OSRM road/foot geometry via `domain/route.ts`,
  straight-line fallback, cached), forks' alternatives dashed schematic arcs,
  clickable to activate. Variant cards gain a ⌖ focus button. 207 tests
  (geometry/route/DayMap/VariantCard, Leaflet mocked); Playwright-verified on
  Rome day 1 (tiles/OSRM stubbed): active track, focus, solid/dashed restyle.

- **v0.27.0** — Plan-a-trip wizard. `+ Add trip` leads with a `PlanTripForm`:
  starting point + ordered destinations via a debounced Open-Meteo place
  autocomplete (`domain/geocode.ts`, keyless; keyboard/click select, lat/lon
  confirmation), ↑/↓ reorder, ✕ remove, start date, number of days, live
  "return to {start}" toggle. Submitting builds a validated **scaffold trip**
  (`domain/scaffold.ts` — days distributed across destinations with
  floor+remainder, per-day locations for weather, `estimated` placeholder slots,
  optional return day) that is persisted and opened, plus a **scaffold-bound AI
  prompt** (`domain/prompt.ts` from a rewritten `docs/trip-prompt.md`) embedding
  the day table and forbidding date/location edits. `UploadTrip` now replaces a
  scaffold in place on id match, flagging day/date/location drift as non-blocking
  warnings; the static `TripPromptCard` is retired. New optional `estimated`
  provenance flag on `VariantNode`/`ExpenseItem` (parser + muted "est." badge +
  form checkbox). 184 tests; E2E-verified (Rome→Florence, return, geocoding
  stubbed): autocomplete dropdown, 6-day scaffold timeline, copy-ready prompt.

- **v0.26.0** — fix: the trip picker snapped back to the first built-in (and
  the open day reset) a few seconds after selecting a trip. The 15s background
  sync poll wholesale-replaces `storedTrips`; when a signed-in poll came back
  empty — almost always a lapsed access token answered as anon, so RLS yields
  nothing — the selected trip's `uid` vanished from the list and the derived
  `trip = allTrips.find(...) ?? TRIPS[0]` fell back to Rome, which also
  remounts `TripView` (keyed by uid) and resets the day. Fix: the poll now
  skips when the signed-in access token can't be refreshed (rather than
  fetching as anon), and ignores an empty poll result while trips are still
  held (a reload or the next non-empty poll reconciles). Browser-verified: an
  empty poll no longer disturbs the selection or the open day. 156 tests.

- **v0.25.0** — collaboration Phase 6: concurrency guard for simultaneous
  edits. Whole-document saves were last-write-wins, so two co-editors could
  silently clobber each other. Added a monotonic `version` token per `trips`
  row (migration `0007`, bumped by the existing `set_updated_at` trigger;
  applied live) injected onto `Trip.version` like `owner`. `TripStore.save` now
  returns the persisted trip with its new version or throws `TripConflictError`:
  the Supabase adapter inserts a brand-new trip and does a conditional
  version-guarded `PATCH` for an existing one (empty result ⇒ a follow-up read
  yields the conflict), and `localStorageStore` mirrors the contract for
  cross-tab parity. On conflict `WayforkApp.saveTrip` runs the pure
  `mergeTrip(base, local, remote)` (`src/domain/merge.ts`) — a 3-way merge of
  the top-level collections by id over the last-synced ancestor — re-validates,
  retries against the fresh version, and shows a `SyncNotice` banner
  (info: merged / warn: reloaded). Non-overlapping co-edits both survive; a
  same-item clash resolves local-wins and is flagged. 156 tests (new
  `merge.test.ts`; store conflict + localStorage version cases); the full
  conflict → 3-way-merge → banner flow browser-verified with a stubbed remote
  (remote rename and local expense-delete both survive).

## docs migration — split IMPLEMENTATION_LOG into CLAUDE.md / STATUS.md / CHANGELOG.md (token-efficiency restructure)

- **v0.24.0** — collaboration Phase 5: roles, roster, leave. Invite as editor
  **or viewer** (role select in `SharePanel`); a viewer gets a read-only view —
  `WayforkApp` derives `myRole` from `listMyMemberships` and passes `canEdit`
  to `TripView`, hiding Edit / + Add expense / per-expense ✎✕ / ⚙ / Share. The
  owner sees a "People with access" roster (email + role, with remove) via
  `listMembers`; a shared member can **Leave** (`leaveTrip`). Migration
  `0006_member_roster` adds `trip_members.email` (populated by `accept_invite`)
  and a "member leaves" self-delete RLS policy. 142 tests (collab + SharePanel
  cases); viewer read-only, owner roster, and leave screenshot-verified.
  Remaining: the concurrency guard (Phase 6).

- **v0.23.0** — trip collaboration MVP (Phases 3 + 4): sharing is usable
  end-to-end. Store & model: `Trip.owner` injected from the row on read;
  `list()` returns owned + shared (RLS); `save()` upserts against the trip's
  real owner so an editor edits the owner's row; `remove()` owner-only.
  `src/data/collab.ts` wraps the invites/members tables + `accept_invite` RPC.
  UI: a **Share** button on owned trips opens `SharePanel` (invite by email +
  pending list + revoke); `InvitesInbox` lets an invitee accept, which pulls
  the shared trip into their picker. Migration `0005` denormalizes
  `trip_name`/`invited_by_email` for the inbox. Both flows (owner invites,
  invitee accepts) screenshot-verified against a stubbed Supabase; collab +
  store-owner-routing + inbox unit-tested. 135 tests. Remaining: viewer
  read-only, roster management, concurrency guard (Phase 5).

- **v0.22.0** — fix: selecting an uploaded trip snapped back to the first
  trip. v0.20's `parseTrip` minted a *random* uid whenever a stored trip had
  none, so a trip uploaded before v0.20 got a different uid on every read; the
  15s background-sync poll then saw a "change", replaced `storedTrips`, and the
  selected `tripUid` no longer matched → fell back to `TRIPS[0]` (Rome).
  `parseTrip` no longer invents a uid on read (absent stays absent; the client
  falls back to the logical id via `uidOf`); a stable uid is stamped only at
  creation (`newTrip`) and upload (`addTrip`). Selection now survives repeated
  polls (screenshot-verified). 126 tests.

- **v0.21.0** — trip collaboration Phase 2: membership + invites + RLS
  (`supabase/migrations/0004_trip_collaboration.sql`). `trip_members`
  (owner/editor/viewer) and `trip_invites` (in-app inbox matched by email, no
  SMTP). `trips` RLS opened to members via `security definer`
  `is_trip_member`/`is_trip_editor` (recursion-safe); `accept_invite(uuid)` RPC
  creates the membership for the caller's own invite. Owner access preserved,
  strangers excluded, anon locked out — all verified against the live DB in a
  rolled-back transaction. Backend only; the store (list shared / owner
  routing) and Share UI + invites inbox are the next phases. 126 tests.

- **v0.20.0** — surrogate `uid` trip identity (collaboration Phase 1). Added
  `Trip.uid` (optional in the type so fixtures need not set it; ensured by
  `parseTrip` — backfilled when absent, validated when present — and stamped by
  `newTrip` via `newUid()`/`crypto.randomUUID`). Built-in trips carry stable
  `builtin-*` uids. The client now selects and keys trips by
  `uidOf(t) = t.uid ?? t.id` (picker value/option keys, selected-trip state,
  TripView/TripForm remount keys), so trips stay distinct even once shared
  across accounts where logical `id`s may repeat. id-based override/label logic
  is unchanged (still correct within one account). 126 tests; picker
  switching by uid screenshot-verified. Foundation for the sharing phases.

- **v0.19.0** — component/UI test harness. jsdom + @testing-library/react +
  jest-dom wired into Vitest as a per-file opt-in: `*.test.tsx` declare
  `@vitest-environment jsdom` and import `src/test/setup-dom.ts` (matchers +
  auto-cleanup), so the framework-free domain/data tests keep running in the
  fast node env untouched — no global config change. First component tests
  cover `AuthBar` (send-link → check-email, error, signed-in/sign-out) and
  `MigrationBanner` (counts/names, import/dismiss, error, busy). 122 tests.

- **v0.18.0** — per-user trip identity (composite primary key). `public.trips`
  moved from a global `id text primary key` to `primary key (owner, id)`
  (`supabase/migrations/0003_per_user_trip_pk.sql`), so two accounts can each
  hold their own copy/override of the same logical id without colliding — the
  latent bug behind v0.17's import failure. The Supabase store now sends the
  `owner` on writes and upserts with `on_conflict=owner,id`; the owner comes
  from the session (`getOwner` provider threaded from `WayforkApp`). Verified
  the authenticated composite upsert (insert + update paths) against the live
  DB. 115 tests.

- **v0.17.0** — fix silent import failures. On sign-in the migration banner
  offers to import trips still in the browser (v0.14); a save rejected by
  row-level security (an id colliding with a row the user can't write) was
  thrown away and the banner hidden, so Import looked like a no-op and the
  trip reappeared on refresh. Now `migrateLocalTrips` handles each trip
  independently — a rejected save is recorded in `failed` and leaves that trip
  in the browser without aborting the batch — and `MigrationBanner` shows the
  reason and keeps the un-imported trips. The concrete trigger was a pre-auth
  shared-sandbox row (`owner IS NULL`) with the same id as a browser trip;
  those orphan rows were deleted from `wayfork-db` (invisible under per-user
  RLS and only good for blocking imports). 114 tests; the failure path
  (403 → error shown, trip preserved) screenshot-verified. See the global-PK
  limitation above for the underlying collision class.

- **v0.16.0** — background multi-device sync. A signed-in session keeps its
  trip list fresh without a manual reload: a visibility-aware poll of the
  account store every 15s (and immediately when the tab regains focus) pulls
  edits made on another device; signed-out, a `storage` event listener syncs
  changes across tabs in the same browser. Poll results are reconciled with
  `tripsEqual` (`repository.ts`) — an order- and key-order-independent compare
  (jsonb round-trips don't preserve key order) — so state (and re-renders) only
  change when the content actually did. A short post-write grace window
  (`markLocalWrite`) suppresses polls so an in-flight save's stale read can't
  momentarily revert an optimistic update. Deliberately poll-based, not a
  Supabase Realtime WebSocket, to stay library-free and testable. 113 tests;
  E2E-verified (a remote rename appears on a focus tick with no reload).

- **v0.15.0** — public trip-generation contract in-app + dinner-timing fix.
  The generator prompt is now `docs/trip-prompt.md`, reframed from "mock data"
  to a real-data contract (use real flights/stations/prices when the assistant
  can browse) and shown copy-ready in the app (`TripPromptCard`, imported
  `?raw` so the in-app prompt and repo doc never drift) under `+ Add trip`.
  **Dinner-at-noon investigation:** not a scheduler bug — slots chain
  back-to-back advancing the clock only by micro-step durations, so trips that
  don't model dwell/free time collapse into the morning and a "dinner" slot
  lands at midday (worst in the contributed Neptun trip: 12:30 & 13:35). Fixed
  at the content level: the contract now mandates realistic full-day pacing
  (model dwell/free time with `wait` steps; anchor meals to wall-clock windows;
  no "dinner" before 18:00), and the offending Neptun (×2) and Lisbon (×1)
  trips gained free-afternoon `wait` slots so dinners land ~18:30–19:00. No
  model/scheduler change. 110 tests; prompt card and fixed timeline
  screenshot-verified (Neptun dinner now 18:30–20:00).

- **v0.14.0** — local→account trip migration. `migrateLocalTrips`
  (`src/data/repository.ts`) moves browser-stored trips into the signed-in
  user's account store, skipping any id already in the account (never
  overwrites the account copy) and removing the rest from localStorage so each
  trip lives in one place. On sign-in `WayforkApp` computes the trips still in
  the browser and, when any exist, shows `MigrationBanner` ("N trips saved in
  this browser — Import?"): Import runs the move and folds the results into the
  account list; "Not now" dismisses. 110 tests (move + collision-skip +
  no-op unit-tested); banner and the import round-trip screenshot-verified
  (POST to the account, localStorage cleared).

- **v0.13.0** — auth: per-user trips. A hand-rolled GoTrue client
  (`src/data/supabaseAuth.ts`, library-free like the PostgREST adapter) does
  email magic-link sign-in — request a link (`/auth/v1/otp`), exchange the
  redirect-fragment tokens for a session, persist it, and auto-refresh the
  access JWT near expiry. `createSupabaseStore` gained a token provider so
  signed-in reads/writes send the user's JWT as the bearer; the anon key stays
  the API-gateway key. `AuthBar` (sign-in field / signed-in identity) sits atop
  `WayforkApp`, which now selects the store by auth state: per-user Supabase
  when signed in, localStorage when signed out (the remote table is never
  touched anonymously). Migration `0002_auth_rls.sql` adds an `owner uuid`
  column (default `auth.uid()`) and replaces the shared-sandbox anon policies
  with per-user `authenticated` RLS. 107 tests; signed-out and signed-in states
  screenshot-verified (JWT bearer confirmed on the REST call).

- **v0.12.0** — opening-hours checkpoints: `Checkpoint.opensMin` (optional)
  turns a deadline into a window [opensMin, timeMin]. Scheduler computes a
  `waitMin` when you arrive before opening; the banner shows the window and a
  "you'd wait Nm" note; SlotForm gains an optional "Opens" input; parser and
  validator accept it (opensMin ≤ timeMin). Lisbon's Jerónimos slot is now a
  window (11:00–11:30). 97 tests. Closes the "checkpoint types" roadmap item.

- **v0.11.0** — timezones: micro-steps carry an optional `tzShiftMin` (clock
  change during the step); the ripple scheduler applies it so all times after a
  flight display in the arrival zone (Rome day now reads 08:27→10:17 across the
  −1h hop, elapsed still 2h50m). Timeline shows a "clocks −1h" badge on the
  crossing and a local-offset badge on shifted slots; checkpoints stay in their
  local zone. `fmtOffset` helper; parser/validator accept the field; Rome
  (−60) and Lisbon (−120) flights annotated; prompt template documents it.
  93 tests.

- **v0.10.0** — weather per day: added optional `Day.location`
  (name/lat/lon) to the model, parser, and validator; `fetchDayWeather`
  (`src/domain/weather.ts`) pulls a daily forecast from the free Open-Meteo
  API (no key), null on out-of-range dates or errors. Day header shows a
  forecast badge (amber when rain risk >= 40%); exposed variants (by walking
  minutes) are flagged "☔ outdoors — rain likely" so weather informs the
  fork choice. Locations added to all built-in trips; DayForm edits them;
  prompt template updated. 89 tests.

- **v0.9.0** — Supabase persistence: `createSupabaseStore` implements
  `TripStore` over PostgREST (project `wayfork-db`, table `public.trips`,
  one validated jsonb document per trip; publishable key + permissive anon
  RLS policies, see `supabase/migrations/0001_trips.sql`). The app prefers
  the remote store at startup and degrades to localStorage when unreachable;
  storage source shown in the ledger footnote. 83 tests.

- **v0.8.0** — trip/day/participant CRUD completes roadmap item 3:
  "+ New trip" creates a valid trip from scratch (name, first day,
  participants, currencies); "⚙" trip settings edits name/currencies/
  participants; day tabs gain ✎/+/✕ in edit mode (dates kept sorted, date
  and persisted departure time editable); starterSlot/newTrip factories keep
  schema invariants intact; 79 tests.

- **v0.7.0** — itinerary CRUD: "Edit" mode on the timeline with add/edit/
  delete/reorder for slots (title + checkpoint editor), add/edit/delete for
  variants (name, cost, ordered micro-step editor with type/label/duration/
  distance). New slots ship with a starter variant so schema invariants hold.
  Pure mutations in `src/domain/mutate.ts` (slot/variant helpers incl.
  defaultVariantId fixup and last-variant guard); every change validated via
  `validateTrip` before persisting through the TripStore; 74 tests.

- **v0.6.0** — expense CRUD + repository layer: async `TripStore` interface
  (`src/data/repository.ts`) as the persistence boundary for a future
  database/API, with `createLocalStorageStore` (validated reads, legacy-key
  migration) as the current adapter; edits to built-in trips are
  copy-on-write overrides ("(edited)" in the picker, ↺ resets); add/edit/
  delete expenses with split authoring (equal/percent/fixed) validated
  through `validateTrip` before saving; pure trip mutations in
  `src/domain/mutate.ts`; 66 tests.

- **v0.5.0** — live ECB exchange rates via the Frankfurter API, fetched once
  at load with the built-in matrix as offline fallback (`src/domain/rates.ts`,
  unit-tested with a stubbed fetch); rates threaded through all conversions
  and `computeBalances`; ledger footnote shows the active source ("ECB <date>"
  vs "built-in snapshot"). Micro-step distances now render on step chips.

- **v0.4.0** — in-app trip upload: trip data format unified on JSON (built-in
  trips converted; prompt template now emits JSON); `parseTrip` defensive
  runtime parser in front of `validateTrip`; `+ Add trip` UI (file upload +
  paste) with error reporting, localStorage persistence, and ✕ removal;
  50 tests. E2E-verified with a template-generated Vienna trip (valid upload,
  invalid rejection, reload persistence, removal). The contributed Neptun
  trip was integrated as the third built-in trip; its offset-style checkpoint
  times prompted a new validator rule (checkpoint before day start rejected).

- **v0.3.0** — mock-data pipeline: `docs/MOCK_TRIP_PROMPT.md` prompt template
  (inputs: destination + start/end date) for AI-generating new trips;
  `validateTrip` domain validator wired into the test suite; trip picker and
  day tabs in the UI (multi-day support); Lisbon 3-day / 3-participant trip
  added as the template's reference output (exercises fixed splits, USD
  expenses, zero-cost variants, 3-way settlement, per-day checkpoints).

- **v0.2.0** — TypeScript conversion; split into `domain/` (pure engines),
  `data/`, `ui/`; 28 Vitest unit tests over schedule/ledger/currency/time
  engines; CI runs tests before deploying. UI behavior unchanged
  (screenshot-verified against v0.1).

- **v0.1.0** (tag) — single-file prototype (`wayforkprototype1.jsx`) wrapped in
  a Vite + React + Tailwind repo; GitHub Pages deployment via `gh-pages` branch.
