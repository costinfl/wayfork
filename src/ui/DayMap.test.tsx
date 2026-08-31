/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import type { Day, ItinerarySlot, Place, StepType, VariantNode } from "../domain/types";

// MapLibre GL is WebGL-bound and unusable in jsdom — mock it and capture what
// the component draws: the `tracks`/`discover-area` GeoJSON sources (last
// setData), the added layers, the per-layer event handlers, and the markers
// (each with its DOM element), so tests inspect the wiring without a renderer.
const { sources, layers, layerHandlers, markers, zoomCalls } = vi.hoisted(() => ({
  sources: {} as Record<string, any>,
  layers: [] as any[],
  layerHandlers: {} as Record<string, (e: any) => void>,
  markers: [] as any[],
  zoomCalls: [] as string[],
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class Marker {
    element: HTMLElement;
    _lngLat: unknown;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat(ll: unknown) {
      this._lngLat = ll;
      return this;
    }
    addTo() {
      markers.push(this);
      return this;
    }
    remove() {
      const i = markers.indexOf(this);
      if (i >= 0) markers.splice(i, 1);
    }
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  class MapMock {
    constructor(_opts: unknown) {}
    on(type: string, layerOrFn: any, fn?: (e: any) => void) {
      if (type === "load") {
        layerOrFn(); // fire synchronously so sources/layers exist before asserts
      } else {
        layerHandlers[`${type}:${layerOrFn}`] = fn!;
      }
      return this;
    }
    addSource() {}
    addLayer(cfg: any) {
      layers.push(cfg);
    }
    getSource(id: string) {
      return { setData: (fc: any) => (sources[id] = fc) };
    }
    setFeatureState() {}
    getCanvas() {
      return { style: {} as CSSStyleDeclaration };
    }
    fitBounds() {}
    jumpTo() {}
    resize() {}
    remove() {}
    zoomIn() {
      zoomCalls.push("in");
    }
    zoomOut() {
      zoomCalls.push("out");
    }
  }
  const L = { Map: MapMock, Marker, LngLatBounds };
  return { default: L, ...L };
});
// Keep the routing adapter off the network.
vi.mock("../domain/route", () => ({ fetchRoute: vi.fn(async () => null) }));

import { DayMap } from "./DayMap";

const trackFeatures = () => (sources["tracks"]?.features ?? []) as any[];
const featureFor = (key: string) => trackFeatures().find((f) => f.id === key);

const P = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

const step = (type: StepType): VariantNode["microSteps"][number] => ({
  id: `ms-${type}-${Math.random()}`,
  type,
  label: type,
  durationMin: 10,
  distanceKm: null,
});
const variant = (id: string, type: StepType, geometry?: [number, number][] | null): VariantNode => ({
  id,
  name: id,
  cost: { amount: 0, currency: "EUR" },
  microSteps: [step(type)],
  ...(geometry !== undefined ? { geometry } : {}),
});
const slot = (id: string, place: Place | null, variants: VariantNode[]): ItinerarySlot => ({
  id,
  title: id,
  variants,
  defaultVariantId: variants[0].id,
  checkpoint: null,
  place,
});

// slot1 (A) → slot2 (B, forked) → slot3 (no place, unmapped).
const day: Day = {
  id: "d1",
  date: "2026-07-08",
  startTimeMin: 540,
  slots: [
    slot("s1", P("A", 0, 0), [variant("s1v", "walk")]),
    slot("s2", P("B", 1, 1), [variant("active", "metro"), variant("alt", "car")]),
    slot("s3", null, [variant("s3v", "walk")]),
  ],
};

const reset = () => {
  for (const k of Object.keys(sources)) delete sources[k];
  layers.length = 0;
  for (const k of Object.keys(layerHandlers)) delete layerHandlers[k];
  markers.length = 0;
};

describe("DayMap wiring", () => {
  it("activates the variant when its dashed alternative is clicked", () => {
    reset();
    const onActivate = vi.fn();
    render(<DayMap day={day} activeVariants={{}} onActivate={onActivate} />);

    // One click handler on the alt-only layer; it reads the clicked feature key.
    const handler = layerHandlers["click:tracks-alt"];
    expect(handler).toBeTypeOf("function");
    handler({ features: [{ properties: { key: "s2:alt" } }] });
    expect(onActivate).toHaveBeenCalledWith("s2", "alt");
  });

  it("renders the unmapped-slots hint", () => {
    reset();
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    expect(
      screen.getByText(/1 slot have no location|1 slot have no location yet|no location/i)
    ).toBeInTheDocument();
  });

  it("draws a variant's stored geometry (transit route) instead of the schematic arc", () => {
    reset();
    const line: [number, number][] = [
      [0.1, 0.1],
      [0.5, 0.6],
      [1, 1],
    ];
    const dayWithTransit: Day = {
      ...day,
      slots: [
        day.slots[0],
        slot("s2", P("B", 1, 1), [variant("active", "metro", line), variant("alt", "car")]),
        day.slots[2],
      ],
    };
    render(<DayMap day={dayWithTransit} activeVariants={{}} onActivate={vi.fn()} />);
    // The active feature's coordinates are the stored line, flipped to [lon,lat].
    expect(featureFor("s2:active").geometry.coordinates).toEqual([
      [0.1, 0.1],
      [0.6, 0.5],
      [1, 1],
    ]);
  });

  it("falls back to the schematic arc when a transit-typed variant carries no geometry", () => {
    reset();
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    // "active" on s2 is a metro (arc profile) with no stored geometry — the arc
    // is a multi-point bézier, not a 2-point straight line.
    expect(featureFor("s2:active").geometry.coordinates.length).toBeGreaterThan(2);
  });

  it("does not attach a click handler to the active route layer (structural)", () => {
    reset();
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    // Only the alt layer is interactive — the active route can't be clicked
    // to activate, because it's a separate layer with no handler at all.
    expect(layerHandlers["click:tracks-alt"]).toBeTypeOf("function");
    expect(layerHandlers["click:tracks-active"]).toBeUndefined();
    // Both track features carry an `active` flag used by the layer filters.
    expect(featureFor("s2:active").properties.active).toBe(true);
    expect(featureFor("s2:alt").properties.active).toBe(false);
  });

  it("draws the discover search polygon, its ⌖ center, and a pin per POI", () => {
    reset();
    const discover = {
      center: { name: "A", lat: 0, lon: 0 },
      radiusM: 3000,
      pois: [
        { id: "node/1", name: "Colosseum", lat: 0.01, lon: 0.01, category: "sights", distanceM: 900 },
        { id: "node/2", name: "Pantheon", lat: 0.02, lon: 0.02, category: "sights", distanceM: 1200 },
      ],
    };
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} discover={discover as any} />);

    const area = sources["discover-area"];
    expect(area.features).toHaveLength(1);
    expect(area.features[0].geometry.type).toBe("Polygon");
    // A ⌖ center marker plus one titled dot per POI, in order.
    expect(markers.some((m) => m.element.textContent?.includes("⌖"))).toBe(true);
    const poiTitles = markers
      .map((m) => m.element.getAttribute("title"))
      .filter((t): t is string => !!t);
    expect(poiTitles).toEqual(["Colosseum", "Pantheon"]);
  });

  it("zooms in and out via the +/− buttons", () => {
    reset();
    zoomCalls.length = 0;
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(zoomCalls).toEqual(["in", "out"]);
  });

  it("toggles fullscreen via the ⛶ button and exits on Escape", () => {
    reset();
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    const btn = screen.getByLabelText("Fullscreen map");
    fireEvent.click(btn);
    const exit = screen.getByLabelText("Exit fullscreen map");
    expect(exit.parentElement?.parentElement?.className).toContain("fixed inset-0");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByLabelText("Fullscreen map").parentElement?.parentElement?.className
    ).not.toContain("fixed inset-0");
  });
});
