// Generates the Wayfork basemap styles (public/map-style-{dark,light}.json):
// a minimal, label-light MapLibre style over OpenFreeMap's keyless OpenMapTiles
// vector tiles, with 3D building extrusions — the data layers (routes, stops,
// vehicles, reach rings) are meant to be what stands out. One generator keeps
// the two palettes structurally identical.
//
//   node scripts/gen-map-styles.mjs
import { writeFileSync } from "node:fs";

const PALETTES = {
  dark: {
    background: "#0b0f14",
    water: "#0f1a26",
    park: "#0f1c16",
    landuse: "#10151b",
    building: "#1a212b",
    buildingTop: "#252e3a",
    roadMinor: "#1b222c",
    roadMajor: "#262f3b",
    roadMotorway: "#323d4c",
    rail: "#2a3340",
    boundary: "#3a4656",
    label: "#8a96a6",
    labelMajor: "#c3ccd8",
    halo: "#0b0f14",
  },
  light: {
    background: "#f3f1ec",
    water: "#cfdde8",
    park: "#dfe8d6",
    landuse: "#ebe8e1",
    building: "#dedad2",
    buildingTop: "#e9e5dd",
    roadMinor: "#ffffff",
    roadMajor: "#fbfaf7",
    roadMotorway: "#f4e3c4",
    rail: "#c9c4ba",
    boundary: "#b8b0a3",
    label: "#6b6f75",
    labelMajor: "#33373d",
    halo: "#f3f1ec",
  },
};

const src = "openmaptiles";
const width = (minor, major) => ["interpolate", ["exponential", 1.5], ["zoom"], 10, minor, 18, major];

function style(name, p) {
  const road = (id, classes, color, w, minzoom = 5) => ({
    id,
    type: "line",
    source: src,
    "source-layer": "transportation",
    minzoom,
    filter: ["all", ["match", ["get", "class"], classes, true, false], ["!=", ["get", "brunnel"], "tunnel"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": w },
  });
  const label = (id, classes, size, color, minzoom, maxzoom = 24) => ({
    id,
    type: "symbol",
    source: src,
    "source-layer": "place",
    minzoom,
    maxzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": size,
      "text-letter-spacing": 0.04,
      "text-max-width": 8,
    },
    paint: { "text-color": color, "text-halo-color": p.halo, "text-halo-width": 1.2 },
  });
  return {
    version: 8,
    name: `Wayfork ${name}`,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    sources: {
      [src]: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
          '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
          'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      {
        id: "landuse",
        type: "fill",
        source: src,
        "source-layer": "landuse",
        paint: { "fill-color": p.landuse },
      },
      {
        id: "park",
        type: "fill",
        source: src,
        "source-layer": "park",
        paint: { "fill-color": p.park },
      },
      {
        id: "landcover-wood",
        type: "fill",
        source: src,
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass"], true, false],
        paint: { "fill-color": p.park, "fill-opacity": 0.7 },
      },
      { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": p.water } },
      {
        id: "waterway",
        type: "line",
        source: src,
        "source-layer": "waterway",
        paint: { "line-color": p.water, "line-width": width(0.5, 4) },
      },
      {
        id: "boundary-country",
        type: "line",
        source: src,
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [3, 2] },
      },
      road("road-minor", ["minor", "service", "track"], p.roadMinor, width(0.4, 8), 12),
      road("road-major", ["primary", "secondary", "tertiary", "trunk"], p.roadMajor, width(0.7, 14), 7),
      road("road-motorway", ["motorway"], p.roadMotorway, width(0.9, 16), 5),
      road("rail", ["rail", "transit"], p.rail, width(0.5, 3), 10),
      {
        id: "building-flat",
        type: "fill",
        source: src,
        "source-layer": "building",
        minzoom: 13,
        maxzoom: 14.5,
        paint: { "fill-color": p.building },
      },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: src,
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, p.building, 60, p.buildingTop],
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, ["coalesce", ["get", "render_height"], 0]],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },
      {
        id: "road-label",
        type: "symbol",
        source: src,
        "source-layer": "transportation_name",
        minzoom: 15,
        filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], true, false],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 1 },
      },
      label("place-neighbourhood", ["suburb", "neighbourhood", "quarter"], 11, p.label, 12, 16),
      label("place-town", ["town", "village"], 12, p.label, 8, 15),
      label("place-city", ["city"], ["interpolate", ["linear"], ["zoom"], 4, 12, 12, 18], p.labelMajor, 3, 14),
      label("place-country", ["country"], 13, p.label, 1, 6),
    ],
  };
}

for (const [name, palette] of Object.entries(PALETTES)) {
  const out = new URL(`../public/map-style-${name}.json`, import.meta.url);
  writeFileSync(out, JSON.stringify(style(name, palette), null, 1) + "\n");
  console.log(`wrote ${out.pathname}`);
}
