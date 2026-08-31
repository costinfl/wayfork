import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, LineString } from "geojson";
import {
  circlePolygon,
  dayTrack,
  offsetArc,
  slotMarkerNumbers,
  type TrackSegment,
} from "../domain/geometry";
import type { Poi } from "../domain/poi";
import { fetchRoute } from "../domain/route";
import type { Day, Place } from "../domain/types";
import { C } from "./theme";

// The day-journey map. Active variant chain → solid blue route (real road/foot
// geometry from OSRM where available, straight line as fallback); alternatives
// of a fork → dashed grey schematic arcs that bow apart and are clickable to
// activate. MapLibre GL + OpenFreeMap keyless vector tiles; lazy-loaded by the
// parent so it (and its CSS) stay out of the entry bundle.

export interface DayMapHandle {
  focusSegment: (slotId: string, variantId: string) => void;
}

const ARC_BEND = 0.16;
// Keyless, unlimited vector tiles (see docs/INTEGRATIONS.md). Liberty is the
// closest visual match to the OSM raster look this map used through v1.2.
const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const same = (s: TrackSegment) => s.from.lat === s.to.lat && s.from.lon === s.to.lon;

// The whole app keeps coordinates as [lat, lon]; MapLibre/GeoJSON want
// [lon, lat]. Flip only here, at the library boundary (same pattern route.ts
// uses for OSRM responses) — never in the domain layer.
const toLngLat = ([lat, lon]: [number, number]): [number, number] => [lon, lat];

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

interface TrackFeature extends Feature<LineString> {
  id: string;
  properties: { key: string; active: boolean };
}

// A centered map marker from raw HTML (the old L.divIcon equivalent).
const htmlMarker = (html: string): maplibregl.Marker => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return new maplibregl.Marker({ element: el.firstElementChild as HTMLElement });
};

function DayMapImpl(
  {
    day,
    activeVariants,
    onActivate,
    discover = null,
  }: {
    day: Day;
    activeVariants: Record<string, string>;
    onActivate: (slotId: string, variantId: string) => void;
    // The last Discover search: draws the search circle, its ⌖ center, and a
    // pin per result so it is obvious where "nearby" was measured from.
    discover?: { center: Place; radiusM: number; pois: Poi[] } | null;
  },
  ref: React.Ref<DayMapHandle>
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // The current track features, keyed by `${slotId}:${variantId}` via their
  // GeoJSON id, so the async OSRM upgrade and focusSegment can find them.
  const featuresRef = useRef<TrackFeature[]>([]);
  // Markers (numbered slots, ⌖ center, POI dots) are imperative layers with no
  // source — tracked so each redraw can remove-then-rebuild them.
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Each slot's place point, so focus can still pan to a slot whose segment is
  // degenerate (the day's origin slot draws no line).
  const pointsRef = useRef<Map<string, [number, number]>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Props the (once-registered) MapLibre event handlers close over, kept fresh.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  // Whether THIS map instance's style has loaded and its sources/layers exist —
  // MapLibre rejects setData before then. The ref is the guard (updated
  // synchronously so a redraw with a stale-closure `styleReady` can't touch a
  // freshly-recreated map's not-yet-existent sources on fullscreen toggle); the
  // state is only there to re-trigger the redraw effect once load fires.
  const styleReadyRef = useRef(false);
  const [styleReady, setStyleReady] = useState(false);

  const { segments, unmapped } = dayTrack(day, activeVariants);

  // Fullscreen = a fixed CSS overlay (not the Fullscreen API — jsdom-testable
  // and consistent across browsers). MapLibre must re-measure after the resize.
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = () => {
    setFullscreen((f) => !f);
    setTimeout(() => mapRef.current?.resize(), 60);
  };
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // Init the MapLibre map. Re-created when fullscreen toggles: the portal
  // switch remounts the container element, so the map must bind to the new
  // node. Sources/layers are added once, on the style-load event.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: elRef.current,
      style: OPENFREEMAP_STYLE,
      scrollZoom: true,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    styleReadyRef.current = false;
    setStyleReady(false);

    map.on("load", () => {
      // One source per concern; two line layers over `tracks` split active vs.
      // alternative so "no click handler on the active route" holds by
      // construction (only the alt layer gets one).
      map.addSource("tracks", { type: "geojson", data: EMPTY_FC });
      map.addSource("discover-area", { type: "geojson", data: EMPTY_FC });

      map.addLayer({
        id: "discover-fill",
        type: "fill",
        source: "discover-area",
        paint: { "fill-color": C.line, "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "discover-outline",
        type: "line",
        source: "discover-area",
        paint: { "line-color": C.line, "line-width": 1.5 },
      });
      map.addLayer({
        id: "tracks-alt",
        type: "line",
        source: "tracks",
        filter: ["==", ["get", "active"], false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.ghost,
          "line-opacity": 0.85,
          "line-dasharray": [2, 2],
          "line-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 9, 3],
        },
      });
      map.addLayer({
        id: "tracks-active",
        type: "line",
        source: "tracks",
        filter: ["==", ["get", "active"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.line,
          "line-opacity": 0.95,
          "line-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 9, 5],
        },
      });

      map.on("click", "tracks-alt", (e) => {
        const key = e.features?.[0]?.properties?.key;
        if (typeof key !== "string") return;
        const i = key.indexOf(":");
        onActivateRef.current(key.slice(0, i), key.slice(i + 1));
      });
      map.on("mouseenter", "tracks-alt", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "tracks-alt", () => (map.getCanvas().style.cursor = ""));

      styleReadyRef.current = true;
      setStyleReady(true);
    });

    return () => {
      styleReadyRef.current = false;
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      featuresRef.current = [];
      setStyleReady(false);
    };
  }, [fullscreen]);

  // (Re)draw the whole track whenever the day, active selection, or discover
  // search changes — and once the style becomes ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    pointsRef.current.clear();
    for (const seg of segments) pointsRef.current.set(seg.slotId, [seg.to.lat, seg.to.lon]);

    const bounds = new maplibregl.LngLatBounds();
    let boundsCount = 0;
    let firstPoint: [number, number] | null = null;
    const extend = (pt: [number, number]) => {
      const ll = toLngLat(pt);
      bounds.extend(ll);
      if (boundsCount === 0) firstPoint = ll;
      boundsCount++;
    };

    // Numbered markers at each located slot place (in track order). Numbers
    // come from the shared slotMarkerNumbers helper so the timeline can show
    // the same number next to each slot.
    const markerNumbers = slotMarkerNumbers(day);
    const numbersSeen = new Set<number>();
    for (const seg of segments) {
      const n = markerNumbers.get(seg.slotId);
      if (n === undefined || numbersSeen.has(n)) continue;
      numbersSeen.add(n);
      const marker = htmlMarker(
        `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${C.line};color:#fff;font:600 12px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</span>`
      )
        .setLngLat(toLngLat([seg.to.lat, seg.to.lon]))
        .addTo(map);
      markersRef.current.push(marker);
      extend([seg.to.lat, seg.to.lon]);
    }

    // Group alternatives per slot so their arcs bow to alternating sides.
    const altIndexBySlot = new Map<string, number>();
    const features: TrackFeature[] = [];

    for (const seg of segments) {
      if (same(seg)) continue; // degenerate origin — marker only, no line

      // A transit variant (added via "🚆 Transit") carries its own real route
      // line — precomputed at add-time since, unlike OSRM's road/foot geometry,
      // it can't be deterministically re-fetched from just the two endpoints
      // (many itineraries connect the same two places). Draw it as-is, active
      // or not, instead of the schematic arc rail/train otherwise falls back to.
      const variant = day.slots
        .find((s) => s.id === seg.slotId)
        ?.variants.find((v) => v.id === seg.variantId);
      const storedGeometry = variant?.geometry;

      extend([seg.from.lat, seg.from.lon]);

      let latlngs: [number, number][];
      if (storedGeometry && storedGeometry.length > 0) {
        latlngs = storedGeometry;
      } else if (seg.active && seg.profile !== "arc") {
        latlngs = [
          [seg.from.lat, seg.from.lon],
          [seg.to.lat, seg.to.lon],
        ]; // straight line until (and unless) OSRM resolves
      } else {
        // Alternatives (and rail/air/same-endpoint) are schematic arcs; sign
        // alternates so siblings fork to opposite sides. The active arc bows a
        // little too so a flight/train doesn't read as a bee-line.
        const k = altIndexBySlot.get(seg.slotId) ?? 0;
        const bend = seg.active ? ARC_BEND : (k % 2 === 0 ? 1 : -1) * ARC_BEND * (1 + Math.floor(k / 2));
        if (!seg.active) altIndexBySlot.set(seg.slotId, k + 1);
        latlngs = offsetArc(seg.from, seg.to, bend);
      }

      const key = `${seg.slotId}:${seg.variantId}`;
      const feature: TrackFeature = {
        type: "Feature",
        id: key,
        properties: { key, active: seg.active },
        geometry: { type: "LineString", coordinates: latlngs.map(toLngLat) },
      };
      features.push(feature);

      // Upgrade the active road/foot segment to real geometry, best-effort.
      // Skipped when stored geometry already resolved the line above.
      if (!storedGeometry && seg.active && seg.profile !== "arc") {
        fetchRoute(seg.from, seg.to, seg.profile).then((geo) => {
          if (!geo || mapRef.current !== map || !featuresRef.current.includes(feature)) return;
          feature.geometry.coordinates = geo.map(toLngLat);
          (map.getSource("tracks") as maplibregl.GeoJSONSource).setData({
            type: "FeatureCollection",
            features: featuresRef.current,
          });
        });
      }
    }

    featuresRef.current = features;
    (map.getSource("tracks") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });

    // Discover overlay: search polygon + ⌖ center + a pin per result. When a
    // search is active the user wants to see the searched area, so it wins the
    // view fit; otherwise fit the whole track.
    if (discover) {
      const ring = circlePolygon(discover.center, discover.radiusM).map(toLngLat);
      (map.getSource("discover-area") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
        ],
      });
      const cross = htmlMarker(
        `<span style="font:700 18px system-ui;color:${C.line};text-shadow:0 0 3px #fff">⌖</span>`
      )
        .setLngLat(toLngLat([discover.center.lat, discover.center.lon]))
        .addTo(map);
      markersRef.current.push(cross);
      for (const poi of discover.pois) {
        const dot = htmlMarker(
          `<div title="${poi.name.replace(/"/g, "&quot;")}" style="width:11px;height:11px;border-radius:50%;background:${C.amber};border:1.5px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.3)"></div>`
        )
          .setLngLat(toLngLat([poi.lat, poi.lon]))
          .addTo(map);
        markersRef.current.push(dot);
      }
      const dBounds = new maplibregl.LngLatBounds();
      for (const pt of ring) dBounds.extend(pt);
      map.fitBounds(dBounds, { padding: 10, animate: false });
    } else {
      (map.getSource("discover-area") as maplibregl.GeoJSONSource).setData(EMPTY_FC);
      if (boundsCount === 1 && firstPoint) {
        map.jumpTo({ center: firstPoint, zoom: 13 });
      } else if (boundsCount > 1) {
        map.fitBounds(bounds, { padding: 40, animate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id, JSON.stringify(activeVariants), fullscreen, discover, styleReady]);

  useImperativeHandle(ref, () => ({
    focusSegment: (slotId, variantId) => {
      const map = mapRef.current;
      if (!map || !styleReadyRef.current) return;
      const key = `${slotId}:${variantId}`;
      const feature = featuresRef.current.find((f) => f.id === key);
      if (feature) {
        const b = new maplibregl.LngLatBounds();
        for (const c of feature.geometry.coordinates) b.extend(c as [number, number]);
        map.fitBounds(b, { padding: 60, maxZoom: 15, animate: false });
        map.setFeatureState({ source: "tracks", id: key }, { highlighted: true });
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => {
          if (mapRef.current === map) {
            map.setFeatureState({ source: "tracks", id: key }, { highlighted: false });
          }
        }, 2000);
        return;
      }
      // Degenerate segment (the day's origin slot) — just pan to its marker.
      const point = pointsRef.current.get(slotId);
      if (point) map.jumpTo({ center: toLngLat(point), zoom: 15 });
    },
  }));

  const panel = (
    <div
      className={
        fullscreen ? "fixed inset-0 flex flex-col" : "rounded-xl overflow-hidden relative"
      }
      style={{
        border: `1px solid ${C.border}`,
        background: C.card,
        ...(fullscreen ? { zIndex: 1100 } : {}),
      }}
    >
      <div className="absolute top-2 right-2 flex items-center gap-1" style={{ zIndex: 1050 }}>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          aria-label="Zoom out"
          title="Zoom out"
          className="w-8 h-8 rounded-lg text-base font-bold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
        >
          −
        </button>
        <button
          onClick={() => mapRef.current?.zoomIn()}
          aria-label="Zoom in"
          title="Zoom in"
          className="w-8 h-8 rounded-lg text-base font-bold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
        >
          +
        </button>
        <button
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen map" : "Fullscreen map"}
          title={fullscreen ? "Exit fullscreen (Esc)" : "Fill the whole window"}
          className="w-8 h-8 rounded-lg text-base font-bold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
        >
          {fullscreen ? "✕" : "⛶"}
        </button>
      </div>
      <div
        ref={elRef}
        style={fullscreen ? { flex: 1, width: "100%" } : { height: 420, width: "100%" }}
        aria-label="Day journey map"
      />
      {unmapped.length > 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: C.sub, background: C.card }}>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
            style={{ background: C.amberBg, color: C.amber }}
          >
            📍 {unmapped.length} slot{unmapped.length > 1 ? "s" : ""} have no location — add one in Edit
            mode
          </span>
        </div>
      )}
    </div>
  );

  // Fullscreen escapes to a body-level portal: the map column is a sticky
  // flex item, and sticky elements form their own stacking context (Blink),
  // which would trap the overlay's z-index under later page content.
  return fullscreen ? createPortal(panel, document.body) : panel;
}

export const DayMap = forwardRef(DayMapImpl);
export default DayMap;
