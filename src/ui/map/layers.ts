import type maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { vehicleFootprint, type Vehicle } from "../../domain/liveTransit";
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

  // Alternatives: dashed, each in its own hue; dimmed outside the focused day.
  map.addLayer({
    id: "tracks-alt",
    type: "line",
    source: "tracks",
    filter: ["==", ["get", "active"], false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": focusOpacity(0.9, 0.18),
      "line-dasharray": [2, 1.6],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", highlighted, 7, 1.5], 14, ["case", highlighted, 7, 3]],
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
      "line-opacity": focusOpacity(0.45, 0.12),
    },
  });
  map.addLayer({
    id: "tracks-active",
    type: "line",
    source: "tracks",
    filter: ["==", ["get", "active"], true],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["boolean", ["get", "estimated"], false], ESTIMATED_COLOR, ["get", "color"]],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", highlighted, 8, 2.5], 14, ["case", highlighted, 8, 5]],
      "line-opacity": focusOpacity(1, 0.3),
    },
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
    paint: { "text-color": "#ffffff", "text-halo-color": ["get", "color"], "text-halo-width": 3 },
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
  lines: Map<string, [number, number][]> // resolved road/foot geometry, by key
): void {
  const focus = (t: OverlayTrack) => focusDay === null || t.dayIdx === focusDay;
  setData(
    map,
    "tracks",
    fc(
      tracks.map((t) => ({
        type: "Feature",
        id: t.key,
        properties: { key: t.key, active: t.active, color: t.color, estimated: t.estimated, focus: focus(t) },
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
        .map((t) => ({
          type: "Feature",
          properties: { key: t.key, color: t.color, label: `${t.name}: ${deltaLabel(t, ccy)}` },
          geometry: { type: "Point", coordinates: ll(t.labelAt) },
        }))
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

export function setVehicles(map: maplibregl.Map, vehicles: Vehicle[]): void {
  const boxes: Feature[] = [];
  const dots: Feature[] = vehicles.map((v) => {
    const ring = vehicleFootprint(v);
    if (ring) {
      boxes.push({
        type: "Feature",
        properties: { color: v.color },
        geometry: { type: "Polygon", coordinates: [ring.map(ll)] },
      });
    }
    return {
      type: "Feature",
      properties: { name: v.name, color: v.color, realTime: v.realTime, box: !!ring },
      geometry: { type: "Point", coordinates: llp(v) },
    };
  });
  setData(map, "vehicles", fc(dots));
  setData(map, "vehicles-3d", fc(boxes));
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
