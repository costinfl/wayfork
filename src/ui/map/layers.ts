import type maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import {
  filterVehicles,
  MODE_COLORS,
  STOPS_MIN_ZOOM,
  vehicleCategory,
  type LiveMode,
  tripProgress,
  vehicleFootprint,
  type TransitStop,
  type TripDetails,
  type Vehicle,
} from "../../domain/liveTransit";
import { deltaLabel, type OverlayStop, type OverlayTrack } from "../../domain/overlay";
import type { ReachBand } from "../../domain/reach";
import { circlePolygon } from "../../domain/geometry";
import type { Poi } from "../../domain/poi";
import type { CurrencyCode, Place } from "../../domain/types";

// Every data layer of the trip map, mnml.ro-style: GeoJSON sources with
// data-driven paint, a blurred "glow" under each line/point family, and
// feature-state for hover/focus highlights. Coordinates are [lat, lon]
// app-wide; `ll` flips them at this MapLibre boundary only.

export const ll = ([lat, lon]: [number, number]): [number, number] => [lon, lat];
const llp = (p: { lat: number; lon: number }): [number, number] => [p.lon, p.lat];

export const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

export const SOURCES = [
  "reach",
  "discover-area",
  "tracks",
  "badges",
  "selected-trip",
  "transit-stops",
  "vehicles",
  "vehicles-3d",
  "stops",
  "discover-pois",
] as const;
export type SourceId = (typeof SOURCES)[number];

export const ESTIMATED_COLOR = "#f59e0b";
const REACH_COLORS = ["#22d3ee", "#3b82f6", "#8b5cf6"];

export function addTripLayers(map: maplibregl.Map, dark: boolean): void {
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });
  const halo = dark ? "#0b0f14" : "#ffffff";
  const focusOpacity = (on: number, off: number): maplibregl.ExpressionSpecification => [
    "case",
    ["boolean", ["get", "focus"], false],
    on,
    off,
  ];
  const highlighted: maplibregl.ExpressionSpecification = ["boolean", ["feature-state", "highlighted"], false];

  // Reachability bands: non-overlapping grid runs, so one translucent fill.
  map.addLayer({
    id: "reach-fill",
    type: "fill",
    source: "reach",
    paint: {
      "fill-color": ["match", ["get", "band"], 0, REACH_COLORS[0], 1, REACH_COLORS[1], REACH_COLORS[2]],
      "fill-opacity": 0.2,
      "fill-antialias": false,
    },
  });
  map.addLayer({
    id: "discover-fill",
    type: "fill",
    source: "discover-area",
    paint: { "fill-color": "#3b82f6", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: "discover-outline",
    type: "line",
    source: "discover-area",
    paint: { "line-color": "#3b82f6", "line-width": 1.5, "line-dasharray": [3, 2] },
  });

  // Alternatives: thin solid lines in their own hue, kept faint so the active
  // journey reads first — and fainter still outside the focused day. Hovering
  // one lights it up. Each sits a few pixels to the side (`offset`) so a
  // variant sharing the active route's roads stays visible next to it.
  const hover: maplibregl.ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
  map.addLayer({
    id: "tracks-alt",
    type: "line",
    source: "tracks",
    filter: ["==", ["get", "active"], false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": ["case", ["any", hover, highlighted], 0.95, ["boolean", ["get", "focus"], false], 0.3, 0.07],
      "line-offset": ["get", "offset"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["any", hover, highlighted], 4, 1.2], 14, ["case", ["any", hover, highlighted], 6, 2.5]],
    },
  });
  // Active chain: a wide blurred glow under a solid line.
  map.addLayer({
    id: "tracks-active-glow",
    type: "line",
    source: "tracks",
    filter: ["==", ["get", "active"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", highlighted, 22, 14],
      "line-blur": 10,
      // Much fainter under estimated (dashed) segments, so the gaps stay visible.
      "line-opacity": [
        "case",
        ["boolean", ["get", "estimated"], false],
        focusOpacity(0.12, 0.04),
        focusOpacity(0.45, 0.12),
      ],
    },
  });
  // The active route is always blue. A segment whose variant or endpoint is
  // only estimated is dashed — the one meaning dashes have on this map — and
  // its stop shows the amber "N?" marker. Two layers because line-dasharray
  // can't vary per feature.
  const activePaint = {
    "line-color": ["get", "color"],
    "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", highlighted, 8, 2.5], 14, ["case", highlighted, 8, 5]],
    "line-opacity": focusOpacity(1, 0.3),
  } satisfies maplibregl.LineLayerSpecification["paint"];
  const estimated: maplibregl.ExpressionSpecification = ["boolean", ["get", "estimated"], false];
  map.addLayer({
    id: "tracks-active",
    type: "line",
    source: "tracks",
    filter: ["all", ["==", ["get", "active"], true], ["!", estimated]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: activePaint,
  });
  map.addLayer({
    id: "tracks-active-estimated",
    type: "line",
    source: "tracks",
    filter: ["all", ["==", ["get", "active"], true], estimated],
    layout: { "line-join": "round" },
    paint: { ...activePaint, "line-dasharray": [1.6, 1.2] },
  });

  // The tapped vehicle's whole trip: its route in the line colour, under the
  // vehicles, and its stops (passed ones dimmed).
  map.addLayer({
    id: "selected-trip-line",
    type: "line",
    source: "selected-trip",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: "selected-trip-stops",
    type: "circle",
    source: "selected-trip",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-color": halo,
      "circle-radius": 4,
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-opacity": ["case", ["get", "passed"], 0.35, 1],
      "circle-stroke-opacity": ["case", ["get", "passed"], 0.35, 1],
    },
  });

  // Public-transport stops in view (with 🚋 Live on, from z15): tap → departures.
  map.addLayer({
    id: "transit-stops",
    type: "circle",
    source: "transit-stops",
    minzoom: STOPS_MIN_ZOOM,
    paint: {
      "circle-color": halo,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 3.5, 18, 6],
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "transit-stops-label",
    type: "symbol",
    source: "transit-stops",
    minzoom: 16.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: { "text-color": dark ? "#9fb0c3" : "#475569", "text-halo-color": halo, "text-halo-width": 1.2 },
  });

  // Live vehicles: 3D boxes up close, glowing dots further out.
  map.addLayer({
    id: "vehicles-3d",
    type: "fill-extrusion",
    source: "vehicles-3d",
    minzoom: 15,
    paint: {
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-height": 3.4,
      "fill-extrusion-base": 0.4,
      "fill-extrusion-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "vehicles-glow",
    type: "circle",
    source: "vehicles",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 16],
      "circle-blur": 1,
      "circle-opacity": ["case", ["get", "realTime"], 0.55, 0.3],
    },
  });
  // Dots for every vehicle below z15; above it, only for those without a box
  // (metro). Two layers because a layer filter can't depend on zoom.
  const dotPaint: maplibregl.CircleLayerSpecification["paint"] = {
    "circle-color": ["get", "color"],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 16, 7],
    "circle-stroke-color": halo,
    "circle-stroke-width": 1,
  };
  map.addLayer({ id: "vehicles-dots", type: "circle", source: "vehicles", maxzoom: 15, paint: dotPaint });
  map.addLayer({
    id: "vehicles-dots-unboxed",
    type: "circle",
    source: "vehicles",
    minzoom: 15,
    filter: ["==", ["get", "box"], false],
    paint: dotPaint,
  });
  map.addLayer({
    id: "vehicles-selected",
    type: "circle",
    source: "vehicles",
    filter: ["boolean", ["get", "selected"], false],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 15],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "vehicles-label",
    type: "symbol",
    source: "vehicles",
    minzoom: 14.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 10,
      "text-offset": [0, -1.3],
      "text-allow-overlap": false,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": halo, "text-halo-width": 1.5 },
  });

  // Slot stops: numbered (day-local, like the timeline), amber when estimated.
  map.addLayer({
    id: "stops-glow",
    type: "circle",
    source: "stops",
    filter: ["boolean", ["get", "focus"], false],
    paint: {
      "circle-color": ["case", ["get", "estimated"], ESTIMATED_COLOR, "#3b82f6"],
      "circle-radius": ["case", ["boolean", ["feature-state", "highlighted"], false], 26, 18],
      "circle-blur": 1,
      "circle-opacity": 0.5,
    },
  });
  map.addLayer({
    id: "stops",
    type: "circle",
    source: "stops",
    paint: {
      "circle-color": [
        "case",
        ["get", "estimated"],
        ESTIMATED_COLOR,
        ["boolean", ["get", "focus"], false],
        "#3b82f6",
        dark ? "#475569" : "#94a3b8",
      ],
      "circle-radius": ["case", ["boolean", ["get", "focus"], false], 10, 5],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "highlighted"], false], 3, 1.5],
    },
  });
  map.addLayer({
    id: "stops-label",
    type: "symbol",
    source: "stops",
    filter: ["boolean", ["get", "focus"], false],
    layout: {
      "text-field": ["case", ["get", "estimated"], ["concat", ["to-string", ["get", "number"]], "?"], ["to-string", ["get", "number"]]],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });

  // Comparison badges on the focused day's alternatives: "+25 min · +€12".
  map.addLayer({
    id: "badges",
    type: "symbol",
    source: "badges",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-padding": 4,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": ["get", "color"],
      "text-halo-width": 3,
      "text-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.45],
    },
  });

  map.addLayer({
    id: "discover-pois",
    type: "circle",
    source: "discover-pois",
    paint: {
      "circle-color": ESTIMATED_COLOR,
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
}

const setData = (map: maplibregl.Map, id: SourceId, data: FeatureCollection) =>
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);

export function setTracks(
  map: maplibregl.Map,
  tracks: OverlayTrack[],
  focusDay: number | null,
  ccy: CurrencyCode,
  lines: Map<string, [number, number][]> // current best line per track key (routed legs where known)
): void {
  const focus = (t: OverlayTrack) => focusDay === null || t.dayIdx === focusDay;
  setData(
    map,
    "tracks",
    fc(
      tracks.map((t) => ({
        type: "Feature",
        id: t.key,
        properties: {
          key: t.key,
          active: t.active,
          color: t.color,
          estimated: t.estimated,
          focus: focus(t),
          // Alternatives fan out to alternating sides: +4, −4, +8, −8 px…
          offset: t.active ? 0 : (t.altIndex % 2 === 0 ? 1 : -1) * 4 * (1 + Math.floor(t.altIndex / 2)),
        },
        geometry: { type: "LineString", coordinates: (lines.get(t.key) ?? t.line).map(ll) },
      }))
    )
  );
  setData(
    map,
    "badges",
    fc(
      tracks
        .filter((t) => !t.active && focusDay !== null && t.dayIdx === focusDay)
        .map((t) => {
          const line = lines.get(t.key) ?? t.line;
          return {
            type: "Feature",
            id: t.key, // shares the track's id so hovering either lights both
            properties: { key: t.key, color: t.color, label: `${t.name}: ${deltaLabel(t, ccy)}` },
            geometry: { type: "Point", coordinates: ll(line[Math.floor(line.length / 2)] ?? t.labelAt) },
          };
        })
    )
  );
}

export function setStops(map: maplibregl.Map, stops: OverlayStop[], focusDay: number | null): void {
  setData(
    map,
    "stops",
    fc(
      stops.map((s) => ({
        type: "Feature",
        id: s.slotId,
        properties: {
          slotId: s.slotId,
          dayIdx: s.dayIdx,
          number: s.number,
          title: s.title,
          estimated: s.estimated,
          focus: focusDay === null || s.dayIdx === focusDay,
        },
        geometry: { type: "Point", coordinates: llp(s.place) },
      }))
    )
  );
}

// Vehicles are drawn in their transport type's colour (matching the Live
// filter toggles), filtered to the selected types (none selected = all).
export function setVehicles(
  map: maplibregl.Map,
  vehicles: Vehicle[],
  selectedTripId: string | null = null,
  opts: { trolleyLines?: ReadonlyMap<string, boolean>; show?: ReadonlySet<LiveMode> } = {}
): void {
  const trolleyLines = opts.trolleyLines ?? new Map<string, boolean>();
  const boxes: Feature[] = [];
  const dots: Feature[] = filterVehicles(vehicles, opts.show ?? new Set(), trolleyLines).map((v) => {
    const category = vehicleCategory(v, trolleyLines);
    const color = MODE_COLORS[category];
    const ring = vehicleFootprint(v);
    if (ring) {
      boxes.push({
        type: "Feature",
        properties: { tripId: v.id, color },
        geometry: { type: "Polygon", coordinates: [ring.map(ll)] },
      });
    }
    return {
      type: "Feature",
      properties: {
        tripId: v.id,
        name: v.name,
        mode: category,
        color,
        lineColor: v.color,
        realTime: v.realTime,
        box: !!ring,
        selected: v.id === selectedTripId,
      },
      geometry: { type: "Point", coordinates: llp(v) },
    };
  });
  setData(map, "vehicles", fc(dots));
  setData(map, "vehicles-3d", fc(boxes));
}

export function setSelectedTrip(map: maplibregl.Map, trip: TripDetails | null, now = Date.now()): void {
  if (!trip) {
    setData(map, "selected-trip", EMPTY);
    return;
  }
  const { nextIndex } = tripProgress(trip, now);
  setData(
    map,
    "selected-trip",
    fc([
      ...(trip.line.length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: { color: trip.color },
              geometry: { type: "LineString" as const, coordinates: trip.line.map(ll) },
            },
          ]
        : []),
      ...trip.stops.map((st, i) => ({
        type: "Feature" as const,
        properties: { color: trip.color, name: st.name, passed: i < nextIndex, stopId: st.stopId ?? "" },
        geometry: { type: "Point" as const, coordinates: llp(st) },
      })),
    ])
  );
}

export function setTransitStops(map: maplibregl.Map, stops: TransitStop[]): void {
  setData(
    map,
    "transit-stops",
    fc(
      stops.map((st) => ({
        type: "Feature" as const,
        properties: {
          stopId: st.stopId,
          name: st.name,
          tz: st.tz ?? "",
          modes: st.modes.join(","),
          color: MODE_COLORS[st.modes[0] ?? "other"],
        },
        geometry: { type: "Point" as const, coordinates: llp(st) },
      }))
    )
  );
}

export function setReach(map: maplibregl.Map, bands: ReachBand[] | null): void {
  const features: Feature[] = [];
  bands?.forEach((b, band) => {
    for (const [s, w, n, e] of b.rects) {
      features.push({
        type: "Feature",
        properties: { band },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      });
    }
  });
  setData(map, "reach", fc(features));
}

export function setDiscover(
  map: maplibregl.Map,
  discover: { center: Place; radiusM: number; pois: Poi[] } | null
): void {
  if (!discover) {
    setData(map, "discover-area", EMPTY);
    setData(map, "discover-pois", EMPTY);
    return;
  }
  const ring = circlePolygon(discover.center, discover.radiusM).map(ll);
  setData(map, "discover-area", fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }]));
  setData(
    map,
    "discover-pois",
    fc(
      discover.pois.map((p) => ({
        type: "Feature",
        properties: { name: p.name },
        geometry: { type: "Point", coordinates: llp(p) },
      }))
    )
  );
}

export { REACH_COLORS };
