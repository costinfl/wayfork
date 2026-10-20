import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RateMatrix } from "../../domain/currency";
import {
  countByCategory,
  isTrolleybusRouteType,
  lineKey,
  MODE_COLORS,
  fetchDepartures,
  fetchLiveSegments,
  fetchStopsInView,
  fetchTripDetails,
  LIVE_MIN_ZOOM,
  STOPS_MIN_ZOOM,
  type Departure,
  type TransitStop,
  vehiclePositions,
  type LiveMode,
  type LiveSegment,
  type TripDetails,
  type Vehicle,
} from "../../domain/liveTransit";
import { legKey, limiter, resolveLegLine } from "../../domain/legs";
import { MODE_ICON } from "./VehicleCard";
import { ALT_COLORS, tripOverlay, type OverlayTrack } from "../../domain/overlay";
import type { Poi } from "../../domain/poi";
import type { ReachBand, ReachMode } from "../../domain/reach";
import { fetchRoute } from "../../domain/route";
import { fetchTransitPlan, type TransitPlanOptions } from "../../domain/transit";
import type { CurrencyCode, Place, Trip } from "../../domain/types";
import { useSheetInset } from "../SideSheet";
import { DeparturesBoard } from "./DeparturesBoard";
import { VehicleCard, type UseTripRequest, type VehicleSummary } from "./VehicleCard";
import {
  addTripLayers,
  ll,
  REACH_COLORS,
  setDiscover,
  setReach,
  setSelectedTrip,
  setStops,
  setTransitStops,
  setTracks,
  setVehicles,
} from "./layers";

// The map-first trip canvas (v2): one full-viewport MapLibre map behind the
// planner sheet, drawing the WHOLE trip — every day's stops and every
// variant's track, the selected day in focus and the rest dimmed — on a dark,
// label-light OpenFreeMap basemap with 3D buildings. Optional layers: live
// transit vehicles (Transitous map/trips), reachability rings, Discover
// results. Lazy-loaded so MapLibre stays out of the entry bundle.

export interface MapFocus {
  slotId: string;
  variantId?: string;
  nonce: number; // bump to re-focus the same target
}

export interface ReachOverlay {
  originName: string;
  mode: ReachMode;
  bands: ReachBand[] | null; // null while loading
  note?: string | null; // e.g. "transit unavailable — walking only"
  onMode: (mode: ReachMode) => void;
  onClose: () => void;
}

export interface TripMapProps {
  trip: Trip;
  dayIdx: number;
  activeVariants: Record<string, string>;
  rates: RateMatrix;
  ccy: CurrencyCode;
  onActivate: (slotId: string, variantId: string) => void;
  onSelectSlot: (slotId: string, dayIdx: number) => void;
  focus?: MapFocus | null;
  discover?: { center: Place; radiusM: number; pois: Poi[] } | null;
  reach?: ReachOverlay | null;
  // Editors only: add a tapped vehicle's ride to the plan (returns validation errors).
  onUseTrip?: (req: UseTripRequest) => string[];
}

const BASE = import.meta.env.BASE_URL ?? "/";
const STYLE_URL = (dark: boolean) => `${BASE}map-style-${dark ? "dark" : "light"}.json`;
const LIVE_POLL_MS = 30_000;
const LIVE_TICK_MS = 500;

// A view shared/bookmarked in the URL (#map=zoom/lat/lon/…) wins over the
// automatic fit — but only for the page's first map: read at module load,
// before MapLibre writes its own hash, and consumed by the first instance
// (TripView remounts the map when the trip changes, and that must fit).
// Live filter: transport types in toggle order, with their labels.
const FILTER_ORDER: LiveMode[] = ["rail", "metro", "tram", "bus", "trolleybus", "ferry", "other"];
const FILTER_ALWAYS: LiveMode[] = ["rail", "metro", "tram", "bus", "trolleybus"]; // shown even at 0
const TYPE_LABEL: Record<LiveMode, [string, string]> = {
  rail: ["train", "trains"],
  metro: ["subway", "subways"],
  tram: ["tram", "trams"],
  bus: ["bus", "buses"],
  trolleybus: ["trolleybus", "trolleybuses"],
  ferry: ["ferry", "ferries"],
  other: ["other", "other"],
};
const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-session only */
  }
};
// Bus line → is it a trolleybus line? Looked up once per line (GTFS route
// type via the trip endpoint) and remembered across visits.
const trolleyLines = new Map<string, boolean>(
  Object.entries(readJson<Record<string, boolean>>("wayfork.trolleyLines", {}))
);
const trolleyInFlight = new Set<string>();
const classifyQueue = limiter(2);

// Resolved leg geometry, shared by every map instance (the map remounts per
// trip): legKey → real line, or null when routing failed (keep provisional).
const legLines = new Map<string, [number, number][] | null>();
const routeQueue = limiter(2);
const routers = {
  route: (from: Place, to: Place, profile: "foot" | "driving") => fetchRoute(from, to, profile),
  transit: (from: Place, to: Place, opts?: TransitPlanOptions) => fetchTransitPlan(from, to, fetch, opts),
};

// A track's best current line: each leg's resolved geometry where known.
const trackLine = (t: OverlayTrack): [number, number][] =>
  t.legs.flatMap((l, i) => legLines.get(legKey(l)) ?? t.legLines[i]);

let hashViewPending = typeof window !== "undefined" && /[#&]map=/.test(window.location.hash);

const readPref = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* per-session only */
  }
};

// Live vehicles are on by default while the trip is happening (today falls
// within its dates) — that's when "what's moving around me" helps.
const tripIsNow = (trip: Trip): boolean => {
  const today = new Date().toISOString().slice(0, 10);
  return trip.days.length > 0 && today >= trip.days[0].date && today <= trip.days[trip.days.length - 1].date;
};

// One legend line: a small SVG swatch drawn like the map line it explains.
function LegendRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="10" aria-hidden="true">
        {children}
      </svg>
      {label}
    </div>
  );
}

export default function TripMap(props: TripMapProps) {
  const { trip, dayIdx, activeVariants, rates, ccy, focus = null, discover = null, reach = null } = props;
  const inset = useSheetInset();
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped on every style (re)load: sources/layers exist only after it.
  const [styleGen, setStyleGen] = useState(0);
  const [dark, setDark] = useState(() => readPref("wayfork.mapDark", true));
  const [is3d, setIs3d] = useState(() => readPref("wayfork.map3d", true));
  const [scope, setScope] = useState<"day" | "trip">("day");
  const [live, setLive] = useState(() => tripIsNow(trip));
  // The tapped live vehicle and its trip (see VehicleCard).
  const [selected, setSelected] = useState<VehicleSummary | null>(null);
  const [vehicleTrip, setVehicleTrip] = useState<{ details: TripDetails | null; status: "loading" | "ready" | "error" }>({
    details: null,
    status: "loading",
  });
  const [follow, setFollow] = useState(false);
  // Where the selected vehicle is relative to the live view: "waiting" until
  // it first appears (e.g. picked from a departures board before it leaves),
  // "live" while on the map, "gone" once it disappears (trip over / panned away).
  const [presence, setPresence] = useState<"waiting" | "live" | "gone">("waiting");
  const [cardNow, setCardNow] = useState(() => Date.now());
  const selectedRef = useRef<VehicleSummary | null>(null);
  selectedRef.current = selected;
  const followRef = useRef(false);
  followRef.current = follow;
  const lastVehicles = useRef<Vehicle[]>([]);
  const selectVehicle = (v: VehicleSummary | null) => {
    setSelected(v);
    setFollow(false);
    setPresence("waiting");
  };
  const selectVehicleRef = useRef(selectVehicle);
  selectVehicleRef.current = selectVehicle;
  const [legendOpen, setLegendOpen] = useState(() => readPref("wayfork.mapLegend", true));
  useEffect(() => writePref("wayfork.mapLegend", legendOpen), [legendOpen]);
  // The tapped stop and its departures board (see DeparturesBoard).
  const [selectedStop, setSelectedStop] = useState<TransitStop | null>(null);
  const [board, setBoard] = useState<{ departures: Departure[]; status: "loading" | "ready" | "error" }>({
    departures: [],
    status: "loading",
  });
  const selectStopRef = useRef(setSelectedStop);
  selectStopRef.current = setSelectedStop;
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // Live filter by transport type (additive; empty = all), its panel, the
  // per-type counts in view, and trolleybus classification progress.
  const [liveFilter, setLiveFilter] = useState<Set<LiveMode>>(
    () => new Set(readJson<LiveMode[]>("wayfork.liveModes", []))
  );
  const liveFilterRef = useRef(liveFilter);
  liveFilterRef.current = liveFilter;
  useEffect(() => writeJson("wayfork.liveModes", [...liveFilter]), [liveFilter]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<LiveMode, number>>>({});
  const [classifying, setClassifying] = useState<{ done: number; total: number } | null>(null);
  const toggleType = (m: LiveMode) =>
    setLiveFilter((f) => {
      const next = new Set(f);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Handlers registered once on the map read the latest props through refs.
  const propsRef = useRef(props);
  propsRef.current = props;
  const darkRef = useRef(dark);
  darkRef.current = dark;

  const overlay = useMemo(
    () => tripOverlay(trip, activeVariants, { rates, ccy }),
    [trip, activeVariants, rates, ccy]
  );
  const focusDay = scope === "day" ? Math.min(dayIdx, trip.days.length - 1) : null;

  // Bumped when a leg's real geometry arrives, to redraw. A lookup may finish
  // after several redraws (or after unmount), so it checks `alive`, not a
  // per-run flag.
  const [routedGen, setRoutedGen] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode re-runs effects after a simulated unmount
    return () => {
      alive.current = false;
    };
  }, []);

  // ---- map lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: elRef.current,
        style: STYLE_URL(darkRef.current),
        hash: "map",
        maxPitch: 60,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      setFailed(true); // no WebGL — the planner still works without the map
      return;
    }
    // Bottom-left: the planner sheet covers the bottom-right corner.
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Transit: <a href="https://transitous.org" target="_blank">Transitous</a>',
      }),
      "bottom-left"
    );
    mapRef.current = map;
    map.on("style.load", () => {
      addTripLayers(map, darkRef.current);
      setStyleGen((g) => g + 1);
    });

    const keyOf = (e: maplibregl.MapLayerMouseEvent) => e.features?.[0]?.properties?.key;
    const activate = (e: maplibregl.MapLayerMouseEvent) => {
      const key = keyOf(e);
      if (typeof key !== "string") return;
      const i = key.indexOf(":");
      propsRef.current.onActivate(key.slice(0, i), key.slice(i + 1));
    };
    map.on("click", "tracks-alt", activate);
    // Tap a stop (in view, or on a tapped vehicle's route) → its departures.
    const pickStop = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const p = f?.properties;
      const coords = (f?.geometry as { coordinates?: [number, number] } | undefined)?.coordinates;
      if (!p || typeof p.stopId !== "string" || !p.stopId || !coords) return;
      selectStopRef.current({
        stopId: p.stopId,
        name: String(p.name ?? "Stop"),
        lat: coords[1],
        lon: coords[0],
        ...(p.tz ? { tz: String(p.tz) } : {}),
        modes: (String(p.modes ?? "") || "other").split(",") as LiveMode[],
      });
    };
    for (const layer of ["transit-stops", "selected-trip-stops"]) {
      map.on("click", layer, pickStop);
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    // Tap a live vehicle (dot or 3D box) → its trip card.
    for (const layer of ["vehicles-dots", "vehicles-dots-unboxed", "vehicles-3d"]) {
      map.on("click", layer, (e) => {
        const p = e.features?.[0]?.properties;
        const tripId = p?.tripId;
        if (typeof tripId !== "string") return;
        const v = lastVehicles.current.find((x) => x.id === tripId);
        selectVehicleRef.current({
          tripId,
          name: v?.name ?? String(p?.name ?? ""),
          mode: (v?.mode ?? p?.mode ?? "other") as LiveMode,
          color: v?.color ?? String(p?.color ?? "#a1a1aa"),
        });
      });
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    // Alternatives stay faint until hovered; the hover lights up the line and
    // its comparison badge (both carry the track key as feature id).
    let hovered: string | null = null;
    const setHover = (key: string | null) => {
      if (hovered === key) return;
      for (const source of ["tracks", "badges"]) {
        if (hovered) map.setFeatureState({ source, id: hovered }, { hover: false });
        if (key) map.setFeatureState({ source, id: key }, { hover: true });
      }
      hovered = key;
    };
    for (const layer of ["tracks-alt", "badges"]) {
      map.on("mousemove", layer, (e) => {
        const key = keyOf(e);
        setHover(typeof key === "string" ? key : null);
      });
      map.on("mouseleave", layer, () => setHover(null));
    }
    map.on("click", "badges", activate);
    map.on("click", "stops", (e) => {
      const p = e.features?.[0]?.properties;
      if (p && typeof p.slotId === "string") propsRef.current.onSelectSlot(p.slotId, Number(p.dayIdx));
    });
    for (const layer of ["tracks-alt", "badges", "stops"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    for (const [layer, field] of [
      ["stops", "title"],
      ["discover-pois", "name"],
      ["vehicles-dots", "name"],
    ] as const) {
      map.on("mousemove", layer, (e) => {
        const text = e.features?.[0]?.properties?.[field];
        if (typeof text === "string") setTip({ x: e.point.x, y: e.point.y, text });
      });
      map.on("mouseleave", layer, () => setTip(null));
    }
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Basemap theme: swapping the style drops our sources; style.load re-adds them.
  const firstTheme = useRef(true);
  useEffect(() => {
    writePref("wayfork.mapDark", dark);
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(STYLE_URL(dark));
  }, [dark]);

  // ---- data layers ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleGen === 0) return;
    const lines = new Map(overlay.tracks.map((t) => [t.key, trackLine(t)]));
    setTracks(map, overlay.tracks, focusDay, ccy, lines);
    setStops(map, overlay.stops, focusDay);

    // Route every leg of the focused day (active variants first): footpaths,
    // roads and transit lines instead of straight placeholders. Queued two at
    // a time; results are shared across days, trips and remounts.
    const todo = overlay.tracks
      .filter((t) => focusDay === null || t.dayIdx === focusDay)
      .sort((a, b) => Number(b.active) - Number(a.active));
    for (const t of todo) {
      for (const leg of t.legs) {
        const k = legKey(leg);
        if (leg.stored || leg.profile === "arc" || legLines.has(k)) continue;
        legLines.set(k, null); // claimed: in flight (or failed) → provisional line
        void routeQueue(() => resolveLegLine(leg, routers)).then((line) => {
          if (!line) return;
          legLines.set(k, line);
          if (alive.current) setRoutedGen((g) => g + 1);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleGen, overlay, focusDay, ccy, routedGen]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleGen > 0) setDiscover(map, discover);
  }, [styleGen, discover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleGen === 0) return;
    setReach(map, reach?.bands ?? null);
    // Frame the rings when they arrive.
    const rects = reach?.bands?.flatMap((b) => b.rects) ?? [];
    if (rects.length) {
      fitTo(rects.flatMap(([s, w, n, e]): [number, number][] => [[s, w], [n, e]]), 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleGen, reach?.bands]);

  // ---- camera --------------------------------------------------------------
  const padding = () => ({ top: 70, left: 70, right: inset.right + 50, bottom: inset.bottom + 50 });
  const fitTo = (points: [number, number][], maxZoom = 15.5) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of points) b.extend(ll(p));
    const bearing = is3d ? -15 : 0;
    const cam = map.cameraForBounds(b, { padding: padding(), bearing, maxZoom });
    if (cam) map.easeTo({ ...cam, bearing, pitch: is3d ? 50 : 0, duration: 900 });
  };

  // Fit the focused day (or the whole trip) when the selection changes. A view
  // restored from the URL hash wins on first load.
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (styleGen === 0) return;
    if (!fittedOnce.current) {
      fittedOnce.current = true;
      if (hashViewPending) {
        hashViewPending = false;
        return;
      }
    }
    const pts = overlay.stops
      .filter((s) => focusDay === null || s.dayIdx === focusDay)
      .map((s): [number, number] => [s.place.lat, s.place.lon]);
    for (const t of overlay.tracks) {
      if (focusDay === null || t.dayIdx === focusDay) pts.push(...t.line);
    }
    fitTo(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleGen > 0, focusDay, trip.uid ?? trip.id]);

  useEffect(() => {
    writePref("wayfork.map3d", is3d);
    mapRef.current?.easeTo({ pitch: is3d ? 50 : 0, bearing: is3d ? -15 : 0, duration: 600 });
  }, [is3d]);

  // Focus a slot (stop) or one of its variants (track), with a brief highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || styleGen === 0) return;
    const track = focus.variantId
      ? overlay.tracks.find((t) => t.key === `${focus.slotId}:${focus.variantId}`)
      : undefined;
    const stop = overlay.stops.find((s) => s.slotId === focus.slotId);
    if (track) {
      fitTo(track.line, 16);
      map.setFeatureState({ source: "tracks", id: track.key }, { highlighted: true });
    } else if (stop) {
      map.easeTo({ center: [stop.place.lon, stop.place.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
    }
    if (stop) map.setFeatureState({ source: "stops", id: stop.slotId }, { highlighted: true });
    const t = setTimeout(() => {
      if (mapRef.current !== map) return;
      if (track) map.setFeatureState({ source: "tracks", id: track.key }, { highlighted: false });
      if (stop) map.setFeatureState({ source: "stops", id: stop.slotId }, { highlighted: false });
    }, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // ---- live vehicles -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleGen === 0) return;
    if (!live) {
      setVehicles(map, []);
      setLiveStatus(null);
      return;
    }
    let segments: LiveSegment[] = [];
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      if (map.getZoom() < LIVE_MIN_ZOOM) {
        segments = [];
        setLiveStatus("zoom in for live vehicles");
        return;
      }
      const b = map.getBounds();
      const res = await fetchLiveSegments(
        { min: { lat: b.getSouth(), lon: b.getWest() }, max: { lat: b.getNorth(), lon: b.getEast() } },
        map.getZoom()
      );
      if (cancelled) return;
      if (res === null) {
        setLiveStatus("live data unavailable");
        return;
      }
      segments = res;
      setLiveStatus(null);
    };
    void poll();
    const pollId = setInterval(poll, LIVE_POLL_MS);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      clearTimeout(debounce);
      debounce = setTimeout(poll, 700);
    };
    map.on("moveend", onMove);
    const tickId = setInterval(() => {
      const vs = vehiclePositions(segments, Date.now());
      lastVehicles.current = vs;
      const sel = selectedRef.current;
      setVehicles(map, vs, sel?.tripId ?? null, { trolleyLines, show: liveFilterRef.current });
      const c = countByCategory(vs, trolleyLines);
      setCounts((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
      if (sel) {
        const v = vs.find((x) => x.id === sel.tripId);
        setPresence((p) => (v ? "live" : p === "waiting" ? "waiting" : "gone"));
        if (v && followRef.current) map.easeTo({ center: [v.lon, v.lat], duration: LIVE_TICK_MS - 50 });
      }
      setLiveStatus((s) => (segments.length && (s === null || s.endsWith("live")) ? `${vs.length} live` : s));
    }, LIVE_TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
      clearTimeout(debounce);
      map.off("moveend", onMove);
    };
  }, [live, styleGen]);

  // Load the tapped vehicle's trip and draw its route + stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!selected) {
      if (map && styleGen > 0) setSelectedTrip(map, null);
      return;
    }
    let cancelled = false;
    setVehicleTrip({ details: null, status: "loading" });
    void fetchTripDetails(selected.tripId).then((details) => {
      if (cancelled) return;
      setVehicleTrip({ details, status: details ? "ready" : "error" });
      if (mapRef.current && details) setSelectedTrip(mapRef.current, details);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.tripId, styleGen]);

  // Keep the card's "next stop" current, and close it on Esc or when Live goes off.
  useEffect(() => {
    if (!selected) return;
    const id = setInterval(() => {
      setCardNow(Date.now());
      if (mapRef.current && vehicleTrip.details) setSelectedTrip(mapRef.current, vehicleTrip.details);
    }, 10_000);
    // Esc closes the top panel: the trip card first, the board under it next.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && selectVehicle(null);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.tripId, vehicleTrip.details]);
  useEffect(() => {
    if (!live) {
      selectVehicle(null);
      setSelectedStop(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // Stops in view while Live is on (z15+): fetched on moveend, debounced.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleGen === 0) return;
    if (!live) {
      setTransitStops(map, []);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (map.getZoom() < STOPS_MIN_ZOOM) {
        setTransitStops(map, []);
        return;
      }
      const b = map.getBounds();
      const stops = await fetchStopsInView({
        min: { lat: b.getSouth(), lon: b.getWest() },
        max: { lat: b.getNorth(), lon: b.getEast() },
      });
      if (!cancelled && stops) setTransitStops(map, stops);
    };
    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 700);
    };
    void load();
    map.on("moveend", onMove);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off("moveend", onMove);
    };
  }, [live, styleGen]);

  // The tapped stop's departures, refreshed every 30 s while it's open.
  useEffect(() => {
    if (!selectedStop) return;
    let cancelled = false;
    setBoard({ departures: [], status: "loading" });
    const load = async () => {
      if (document.hidden) return;
      const departures = await fetchDepartures(selectedStop.stopId);
      if (cancelled) return;
      setCardNow(Date.now());
      setBoard((b) => (departures ? { departures, status: "ready" } : b.departures.length ? b : { departures: [], status: "error" }));
    };
    void load();
    const id = setInterval(load, 30_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !selectedRef.current && setSelectedStop(null);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectedStop?.stopId]);

  // While the filter panel is open, find out which bus lines in view are
  // trolleybus lines: one trip lookup per unknown line, two at a time.
  useEffect(() => {
    if (!filterOpen || !live) {
      setClassifying(null);
      return;
    }
    let cancelled = false;
    const sweep = () => {
      const keys = new Map<string, string>(); // line key → a tripId on it
      for (const v of lastVehicles.current) if (v.mode === "bus") keys.set(lineKey(v.id, v.name), v.id);
      const known = [...keys.keys()].filter((k) => trolleyLines.has(k)).length;
      setClassifying(known < keys.size ? { done: known, total: keys.size } : null);
      for (const [key, tripId] of keys) {
        if (trolleyLines.has(key) || trolleyInFlight.has(key)) continue;
        trolleyInFlight.add(key);
        void classifyQueue(() => fetchTripDetails(tripId)).then((d) => {
          trolleyInFlight.delete(key);
          if (!d) return; // unknown for now — counted as bus, retried next time
          trolleyLines.set(key, isTrolleybusRouteType(d.routeType));
          writeJson("wayfork.trolleyLines", Object.fromEntries(trolleyLines));
          if (!cancelled) sweep();
        });
      }
    };
    sweep();
    const id = setInterval(sweep, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [filterOpen, live]);

  // ---- chrome ----------------------------------------------------------------
  const btn = (active = false) => ({
    background: active ? "#3b82f6" : dark ? "rgba(17,24,33,0.92)" : "rgba(255,255,255,0.95)",
    color: active ? "#fff" : dark ? "#e2e8f0" : "#17222c",
    border: `1px solid ${dark ? "#263241" : "#d7dee5"}`,
  });
  const chip = dark ? "rgba(17,24,33,0.92)" : "rgba(255,255,255,0.95)";

  const layer = (
    <div className="fixed inset-0" style={{ zIndex: 0, background: dark ? "#0b0f14" : "#f3f1ec" }}>
      {/* Inline position: maplibre-gl.css gives .maplibregl-map position:relative,
          which would beat a class and collapse the canvas to 0px high. */}
      <div ref={elRef} style={{ position: "absolute", inset: 0 }} aria-label="Trip map" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "#94a3b8" }}>
          The map needs WebGL, which this browser doesn't provide — the planner still works.
        </div>
      )}
      <div
        className="absolute top-3 left-3 flex flex-col gap-1.5 overflow-y-auto"
        style={{ zIndex: 2, maxHeight: `calc(100% - ${inset.bottom + 24}px)` }}
      >
        <div className="flex rounded-lg overflow-hidden text-xs font-semibold" style={{ border: btn().border }}>
          {(["day", "trip"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className="px-2.5 py-1.5" style={{ ...btn(scope === s), border: "none" }}>
              {s === "day" ? `Day ${dayIdx + 1}` : "Whole trip"}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out" className="w-8 h-8 rounded-lg font-bold" style={btn()}>
            −
          </button>
          <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in" className="w-8 h-8 rounded-lg font-bold" style={btn()}>
            +
          </button>
          <button onClick={() => setIs3d((v) => !v)} aria-pressed={is3d} title="Tilt the map (3D buildings)" className="h-8 px-2 rounded-lg text-xs font-bold" style={btn(is3d)}>
            3D
          </button>
          <button onClick={() => setDark((v) => !v)} aria-label="Toggle dark map" title={dark ? "Light basemap" : "Dark basemap"} className="w-8 h-8 rounded-lg" style={btn()}>
            {dark ? "☀️" : "🌙"}
          </button>
          <button
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
            title="Live public transport around the map view (Transitous)"
            className="h-8 px-2 rounded-lg text-xs font-bold"
            style={btn(live)}
          >
            🚋 Live
          </button>
        </div>
        {live && liveStatus && !liveStatus.endsWith(" live") && (
          <div className="text-[11px] px-2 py-1 rounded-md self-start" style={{ background: chip, color: btn().color }}>
            {liveStatus}
          </div>
        )}
        {live && liveStatus?.endsWith(" live") && (
          <button
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
            title="Filter live vehicles by type"
            className="text-[11px] px-2 py-1 rounded-md self-start font-semibold"
            style={{ background: chip, color: btn().color, border: btn().border }}
          >
            {liveFilter.size ? `${[...liveFilter].reduce((n, m) => n + (counts[m] ?? 0), 0)} of ` : ""}
            {liveStatus} {filterOpen ? "▴" : "▾"}
          </button>
        )}
        {live && filterOpen && (
          <div
            className="rounded-xl p-2 text-xs self-start flex flex-col gap-1"
            style={{ background: chip, color: btn().color, border: btn().border }}
            role="group"
            aria-label="Filter by transport type"
          >
            <div className="flex flex-wrap gap-1 max-w-64">
              {FILTER_ORDER.filter((m) => FILTER_ALWAYS.includes(m) || (counts[m] ?? 0) > 0 || liveFilter.has(m)).map((m) => {
                const n = counts[m] ?? 0;
                const on = liveFilter.has(m);
                return (
                  <button
                    key={m}
                    onClick={() => toggleType(m)}
                    aria-pressed={on}
                    className="px-2 py-1 rounded-lg font-semibold flex items-center gap-1"
                    style={{
                      border: `2px solid ${MODE_COLORS[m]}`,
                      background: on ? `${MODE_COLORS[m]}40` : "transparent",
                      opacity: n === 0 && !on ? 0.5 : 1,
                    }}
                  >
                    <span aria-hidden="true">{MODE_ICON[m]}</span>
                    {n} {TYPE_LABEL[m][n === 1 ? 0 : 1]}
                  </button>
                );
              })}
            </div>
            {liveFilter.size > 0 && (
              <button onClick={() => setLiveFilter(new Set())} className="self-start underline opacity-80">
                Show all
              </button>
            )}
            {classifying && (
              <div className="opacity-70">
                Checking bus lines for trolleybuses… {classifying.done}/{classifying.total}
              </div>
            )}
          </div>
        )}
        {selectedStop && (
          <DeparturesBoard
            stop={selectedStop}
            departures={board.departures}
            status={board.status}
            now={cardNow}
            onPickTrip={(v) => selectVehicle(v)}
            onClose={() => setSelectedStop(null)}
            theme={{ bg: chip, fg: btn().color, border: btn().border.replace("1px solid ", "") }}
          />
        )}
        {selected && (
          <VehicleCard
            vehicle={selected}
            details={vehicleTrip.details}
            status={vehicleTrip.status}
            now={cardNow}
            presence={presence}
            follow={follow}
            onFollow={setFollow}
            onClose={() => selectVehicle(null)}
            theme={{ bg: chip, fg: btn().color, border: btn().border.replace("1px solid ", "") }}
            onUse={props.onUseTrip}
            daySlots={(trip.days[dayIdx] ?? trip.days[0]).slots.map((sl) => ({ id: sl.id, title: sl.title }))}
            dayLabel={`Day ${Math.min(dayIdx, trip.days.length - 1) + 1}`}
          />
        )}
        {legendOpen ? (
          <div
            className="rounded-xl px-2.5 py-2 text-[11px] self-start flex flex-col gap-1"
            style={{ background: chip, color: btn().color, border: btn().border }}
          >
            <div className="flex items-center justify-between gap-3">
              <b>Legend</b>
              <button onClick={() => setLegendOpen(false)} aria-label="Hide legend" className="px-1">
                ✕
              </button>
            </div>
            <LegendRow label="Your route">
              <line x1="1" y1="5" x2="27" y2="5" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
            </LegendRow>
            <LegendRow label="Estimated — confirm">
              <line x1="1" y1="5" x2="27" y2="5" stroke="#3b82f6" strokeWidth="3" strokeDasharray="5 3.5" />
            </LegendRow>
            <LegendRow label="Alternatives — hover to compare">
              <line x1="1" y1="3" x2="27" y2="3" stroke={ALT_COLORS[0]} strokeWidth="2" opacity="0.55" />
              <line x1="1" y1="8" x2="27" y2="8" stroke={ALT_COLORS[1]} strokeWidth="2" opacity="0.55" />
            </LegendRow>
            {live && (
              <LegendRow label="Stop — tap for departures">
                <circle cx="14" cy="5" r="3.5" fill={dark ? "#0b0f14" : "#ffffff"} stroke="#22c55e" strokeWidth="2" />
              </LegendRow>
            )}
          </div>
        ) : (
          <button
            onClick={() => setLegendOpen(true)}
            aria-label="Show legend"
            title="What do the lines mean?"
            className="w-8 h-8 rounded-lg text-xs font-bold self-start"
            style={btn()}
          >
            ?
          </button>
        )}
        {reach && (
          <div
            className="rounded-xl p-2.5 text-xs self-start"
            style={{ background: chip, color: btn().color, border: btn().border }}
          >
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <b>◎ Reach from {reach.originName}</b>
              <button onClick={reach.onClose} aria-label="Close reach rings" className="px-1">
                ✕
              </button>
            </div>
            <div className="flex gap-1 mb-1.5">
              {(["walk", "transit"] as const).map((m) => (
                <button key={m} onClick={() => reach.onMode(m)} className="px-2 py-1 rounded-md font-semibold" style={btn(reach.mode === m)}>
                  {m === "walk" ? "🚶 Walk" : "🚇 Transit"}
                </button>
              ))}
            </div>
            {reach.bands === null ? (
              <div>computing…</div>
            ) : (
              <div className="flex gap-2">
                {reach.bands.map((b, i) => (
                  <span key={b.maxMin} className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: REACH_COLORS[i], opacity: 0.8 }} />
                    {b.maxMin}′
                  </span>
                ))}
              </div>
            )}
            {reach.note && <div className="mt-1 opacity-80">{reach.note}</div>}
          </div>
        )}
      </div>
      {tip && (
        <div
          className="absolute pointer-events-none text-xs px-2 py-1 rounded-md"
          style={{ zIndex: 3, left: tip.x + 12, top: tip.y + 12, background: chip, color: btn().color, border: btn().border }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
  return createPortal(layer, document.body);
}
