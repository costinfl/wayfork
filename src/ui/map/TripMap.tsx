import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RateMatrix } from "../../domain/currency";
import {
  fetchLiveSegments,
  LIVE_MIN_ZOOM,
  vehiclePositions,
  type LiveSegment,
} from "../../domain/liveTransit";
import { legKey, limiter, resolveLegLine } from "../../domain/legs";
import { tripOverlay, type OverlayTrack } from "../../domain/overlay";
import type { Poi } from "../../domain/poi";
import type { ReachBand, ReachMode } from "../../domain/reach";
import { fetchRoute } from "../../domain/route";
import { fetchTransitPlan } from "../../domain/transit";
import type { CurrencyCode, Place, Trip } from "../../domain/types";
import { useSheetInset } from "../SideSheet";
import {
  addTripLayers,
  ll,
  REACH_COLORS,
  setDiscover,
  setReach,
  setStops,
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
}

const BASE = import.meta.env.BASE_URL ?? "/";
const STYLE_URL = (dark: boolean) => `${BASE}map-style-${dark ? "dark" : "light"}.json`;
const LIVE_POLL_MS = 30_000;
const LIVE_TICK_MS = 500;

// A view shared/bookmarked in the URL (#map=zoom/lat/lon/…) wins over the
// automatic fit — but only for the page's first map: read at module load,
// before MapLibre writes its own hash, and consumed by the first instance
// (TripView remounts the map when the trip changes, and that must fit).
// Resolved leg geometry, shared by every map instance (the map remounts per
// trip): legKey → real line, or null when routing failed (keep provisional).
const legLines = new Map<string, [number, number][] | null>();
const routeQueue = limiter(2);
const routers = {
  route: (from: Place, to: Place, profile: "foot" | "driving") => fetchRoute(from, to, profile),
  transit: (from: Place, to: Place) => fetchTransitPlan(from, to),
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
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
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
      setVehicles(map, vs);
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
      <div className="absolute top-3 left-3 flex flex-col gap-1.5" style={{ zIndex: 2 }}>
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
        {live && liveStatus && (
          <div className="text-[11px] px-2 py-1 rounded-md self-start" style={{ background: chip, color: btn().color }}>
            {liveStatus}
          </div>
        )}
      </div>
      {reach && (
        <div
          className="absolute left-3 rounded-xl p-2.5 text-xs"
          style={{ zIndex: 2, top: 128, background: chip, color: btn().color, border: btn().border }}
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
