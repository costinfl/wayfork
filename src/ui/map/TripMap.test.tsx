/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../../test/setup-dom";
import { RATES_EUR } from "../../domain/currency";
import type { ItinerarySlot, Place, StepType, Trip, VariantNode } from "../../domain/types";

// MapLibre GL is WebGL-bound and unusable in jsdom — mock it and capture what
// the component draws: each GeoJSON source's last setData, the added layers,
// the per-layer event handlers, and camera/style calls.
const h = vi.hoisted(() => ({
  sources: {} as Record<string, any>,
  layers: [] as any[],
  handlers: {} as Record<string, (e: any) => void>,
  calls: [] as string[],
  styles: [] as string[],
  zoom: 14,
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  class MapMock {
    constructor(opts: { style: string }) {
      h.styles.push(opts.style);
    }
    on(type: string, layerOrFn: any, fn?: (e: any) => void) {
      if (type === "style.load") layerOrFn(); // fire synchronously: layers exist before asserts
      else if (typeof layerOrFn === "function") h.handlers[type] = layerOrFn;
      else h.handlers[`${type}:${layerOrFn}`] = fn!;
      return this;
    }
    off() {}
    addControl() {}
    addSource() {}
    addLayer(cfg: any) {
      h.layers.push(cfg);
    }
    getSource(id: string) {
      return { setData: (data: any) => (h.sources[id] = data) };
    }
    setStyle(url: string) {
      h.styles.push(url);
    }
    setFeatureState() {}
    getCanvas() {
      return { style: {} as CSSStyleDeclaration };
    }
    cameraForBounds() {
      return { center: [0, 0], zoom: 10 };
    }
    easeTo() {
      h.calls.push("easeTo");
    }
    getZoom() {
      return h.zoom;
    }
    getBounds() {
      return { getSouth: () => 44.4, getWest: () => 26.0, getNorth: () => 44.5, getEast: () => 26.2 };
    }
    zoomIn() {
      h.calls.push("zoomIn");
    }
    zoomOut() {
      h.calls.push("zoomOut");
    }
    remove() {}
  }
  class AttributionControl {}
  const L = { Map: MapMock, LngLatBounds, AttributionControl };
  return { default: L, ...L };
});
const { fetchRoute, fetchTransitPlan } = vi.hoisted(() => ({
  fetchRoute: vi.fn(async (_from: Place, _to: Place, _profile?: string): Promise<[number, number][] | null> => null),
  fetchTransitPlan: vi.fn(async () => null),
}));
vi.mock("../../domain/route", () => ({ fetchRoute }));
vi.mock("../../domain/transit", async (orig) => ({
  ...(await orig<typeof import("../../domain/transit")>()),
  fetchTransitPlan,
}));
const { fetchLiveSegments, fetchTripDetails, fetchStopsInView, fetchDepartures } = vi.hoisted(() => ({
  fetchLiveSegments: vi.fn(async () => [] as any[]),
  fetchTripDetails: vi.fn(async (_id: string): Promise<any> => null),
  fetchStopsInView: vi.fn(async (_b: unknown): Promise<any> => []),
  fetchDepartures: vi.fn(async (_id: string): Promise<any> => []),
}));
vi.mock("../../domain/liveTransit", async (orig) => ({
  ...(await orig<typeof import("../../domain/liveTransit")>()),
  fetchLiveSegments,
  fetchTripDetails,
  fetchStopsInView,
  fetchDepartures,
}));

import TripMap from "./TripMap";

const P = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });
const variant = (id: string, type: StepType): VariantNode => ({
  id,
  name: id,
  cost: { amount: 0, currency: "EUR" },
  microSteps: [{ id: `${id}-m`, type, label: id, durationMin: 10, distanceKm: null }],
});
const slot = (id: string, place: Place, variants: VariantNode[]): ItinerarySlot => ({
  id,
  title: `Slot ${id}`,
  place,
  checkpoint: null,
  defaultVariantId: variants[0].id,
  variants,
});
const trip: Trip = {
  schemaVersion: 2,
  id: "t",
  name: "t",
  participants: [{ id: "p", name: "P" }],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [
    {
      id: "d1",
      date: "2026-05-01",
      startTimeMin: 540,
      slots: [
        slot("s1", P("A", 0, 0), [variant("v1", "walk")]),
        slot("s2", P("B", 1, 1), [variant("metro", "metro"), variant("taxi", "car")]),
      ],
    },
    { id: "d2", date: "2026-05-02", startTimeMin: 540, slots: [slot("s3", P("C", 2, 2), [variant("v3", "train")])] },
  ],
  expenses: [],
};

const renderMap = (over: Partial<Parameters<typeof TripMap>[0]> = {}) => {
  const props = {
    trip,
    dayIdx: 0,
    activeVariants: {},
    rates: RATES_EUR,
    ccy: "EUR",
    onActivate: vi.fn(),
    onSelectSlot: vi.fn(),
    ...over,
  };
  const utils = render(<TripMap {...props} />);
  return { ...props, ...utils };
};

const features = (id: string) => (h.sources[id]?.features ?? []) as any[];

beforeEach(() => {
  for (const k of Object.keys(h.sources)) delete h.sources[k];
  for (const k of Object.keys(h.handlers)) delete h.handlers[k];
  h.layers.length = 0;
  h.calls.length = 0;
  h.styles.length = 0;
  h.zoom = 14;
  fetchLiveSegments.mockClear();
  localStorage.clear();
});

describe("TripMap", () => {
  it("routes every variant's legs in the focused day — alternatives too — by step type", async () => {
    fetchRoute.mockImplementation(async (from: Place, to: Place) => [
      [from.lat, from.lon],
      [0.5, 0.5],
      [to.lat, to.lon],
    ] as [number, number][]);
    renderMap();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // s2's metro → a transit plan (none here → road fallback); its taxi → roads.
    expect(fetchTransitPlan).toHaveBeenCalledWith(
      P("A", 0, 0),
      P("B", 1, 1),
      expect.anything(),
      { maxTravelTime: 60 } // 10′ metro → 3×10+30 = 60, the 1-hour floor
    );
    expect(fetchRoute).toHaveBeenCalledWith(P("A", 0, 0), P("B", 1, 1), "driving");
    // Day 2's train isn't routed until that day is in focus.
    expect(fetchTransitPlan).not.toHaveBeenCalledWith(P("B", 1, 1), P("C", 2, 2));
    const taxi = features("tracks").find((f) => f.id === "s2:taxi");
    expect(taxi.geometry.coordinates).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
    // Alternatives fan out sideways so they never hide under the active line.
    expect(taxi.properties.offset).toBe(4);
    expect(features("tracks").find((f) => f.id === "s2:metro").properties.offset).toBe(0);
  });

  it("draws the whole trip with the selected day in focus", () => {
    renderMap();
    const tracks = features("tracks");
    expect(tracks.map((f) => f.id)).toEqual(["s2:metro", "s2:taxi", "s3:v3"]);
    expect(tracks.map((f) => f.properties.focus)).toEqual([true, true, false]);
    expect(features("stops").map((f) => [f.id, f.properties.number, f.properties.focus])).toEqual([
      ["s1", 1, true],
      ["s2", 2, true],
      ["s3", 1, false],
    ]);
    // A comparison badge for the focused day's alternative only.
    expect(features("badges").map((f) => f.properties.key)).toEqual(["s2:taxi"]);
  });

  it("draws the active route blue, dashing only estimated segments", () => {
    renderMap();
    const layer = (id: string) => h.layers.find((l) => l.id === id);
    const solid = layer("tracks-active");
    const dashed = layer("tracks-active-estimated");
    expect(solid.paint["line-color"]).toEqual(["get", "color"]);
    expect(solid.paint["line-dasharray"]).toBeUndefined();
    expect(dashed.paint["line-color"]).toEqual(["get", "color"]);
    expect(dashed.paint["line-dasharray"]).toBeDefined();
    // Disjoint filters: an active segment lands in exactly one of the two.
    expect(JSON.stringify(solid.filter)).toContain('["!",["boolean",["get","estimated"],false]]');
    expect(JSON.stringify(dashed.filter)).toContain('["boolean",["get","estimated"],false]');
    expect(layer("tracks-alt").paint["line-dasharray"]).toBeUndefined();
  });

  it("shows a collapsible legend for the line styles", () => {
    renderMap();
    expect(screen.getByText("Your route")).toBeInTheDocument();
    expect(screen.getByText("Estimated — confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide legend" }));
    expect(screen.queryByText("Your route")).toBeNull();
    expect(localStorage.getItem("wayfork.mapLegend")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Show legend" }));
    expect(screen.getByText("Your route")).toBeInTheDocument();
  });

  it("the 'Whole trip' scope focuses every day", () => {
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Whole trip" }));
    expect(features("tracks").every((f) => f.properties.focus)).toBe(true);
    expect(features("badges")).toEqual([]); // badges only in single-day focus
  });

  it("activates an alternative when its track or badge is clicked", () => {
    const { onActivate } = renderMap();
    h.handlers["click:tracks-alt"]({ features: [{ properties: { key: "s2:taxi" } }] });
    h.handlers["click:badges"]({ features: [{ properties: { key: "s2:taxi" } }] });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate).toHaveBeenCalledWith("s2", "taxi");
  });

  it("reports a clicked stop with its day", () => {
    const { onSelectSlot } = renderMap();
    h.handlers["click:stops"]({ features: [{ properties: { slotId: "s3", dayIdx: 1 } }] });
    expect(onSelectSlot).toHaveBeenCalledWith("s3", 1);
  });

  it("uses the dark basemap by default and swaps style on the theme toggle", () => {
    renderMap();
    expect(h.styles[0]).toMatch(/map-style-dark\.json$/);
    fireEvent.click(screen.getByRole("button", { name: "Toggle dark map" }));
    expect(h.styles[1]).toMatch(/map-style-light\.json$/);
  });

  it("zoom buttons drive the map", () => {
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(h.calls).toContain("zoomIn");
    expect(h.calls).toContain("zoomOut");
  });

  it("live vehicles: off for a past trip, fetched for the view when toggled on", async () => {
    renderMap();
    expect(fetchLiveSegments).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    expect(fetchLiveSegments).toHaveBeenCalledWith(
      { min: { lat: 44.4, lon: 26.0 }, max: { lat: 44.5, lon: 26.2 } },
      14
    );
  });

  it("live vehicles: asks to zoom in instead of fetching at city scale", async () => {
    h.zoom = 9;
    renderMap();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    expect(fetchLiveSegments).not.toHaveBeenCalled();
    expect(screen.getByText(/zoom in for live vehicles/)).toBeInTheDocument();
  });

  it("tapping a live vehicle opens its trip card and draws its route", async () => {
    const { parseTripDetails } = await vi.importActual<typeof import("../../domain/liveTransit")>(
      "../../domain/liveTransit"
    );
    const nyc = (await import("../../domain/__fixtures__/motis-trip-nyc-qm32.json")).default;
    fetchTripDetails.mockResolvedValueOnce(parseTripDetails("qm32", nyc));
    renderMap();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    await act(async () => {
      h.handlers["click:vehicles-dots"]({ features: [{ properties: { tripId: "qm32", name: "QM32", mode: "bus", color: "#00933c" } }] });
    });
    expect(fetchTripDetails).toHaveBeenCalledWith("qm32");
    expect(await screen.findByText("→ BAY TERRACE BELL BL via WHITESTONE EXPWY")).toBeInTheDocument();
    const drawn = features("selected-trip");
    expect(drawn.filter((f) => f.geometry.type === "LineString")).toHaveLength(1);
    expect(drawn.filter((f) => f.geometry.type === "Point")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Close vehicle info" }));
    expect(screen.queryByRole("dialog", { name: /Vehicle/ })).toBeNull();
    expect(features("selected-trip")).toEqual([]);
  });

  it("live filter: the N live chip opens per-type toggles that filter additively", async () => {
    const now = Date.now();
    const seg = (tripId: string, name: string, mode: string) => ({
      id: `${tripId}-0`, tripId, name, mode, color: "#123456",
      departure: now - 60_000, arrival: now + 600_000, realTime: true,
      line: [[44.45, 26.1], [44.46, 26.11]], cumM: [0, 1300],
    });
    const tag = (n: string) => `20261020_10:00_ro-Test_${n}`;
    fetchLiveSegments.mockResolvedValue([
      seg(tag("t1"), "41", "tram"),
      seg(tag("b1"), "336", "bus"),
      seg(tag("b2"), "66", "bus"),
      seg(tag("m1"), "M2", "metro"),
    ]);
    fetchTripDetails.mockImplementation(async (id: string) =>
      ({ tripId: id, routeType: id === tag("b2") ? 11 : 3 }) as any
    );
    renderMap();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    const chip = await screen.findByRole("button", { name: /4 live/ }, { timeout: 2000 });
    fireEvent.click(chip);
    const group = screen.getByRole("group", { name: "Filter by transport type" });
    expect(group).toHaveTextContent("1 tram");
    expect(group).toHaveTextContent("1 subway");
    expect(group).toHaveTextContent("0 trains");
    // Bus lines are looked up once; 66 turns out to be a trolleybus line.
    await waitFor(() => expect(group).toHaveTextContent("1 trolleybus"), { timeout: 2000 });
    expect(group).toHaveTextContent("1 bus");
    expect(fetchTripDetails).toHaveBeenCalledWith(tag("b1"));
    const dots = () => features("vehicles");
    await waitFor(() => expect(dots().find((f) => f.properties.name === "66")?.properties.color).toBe("#14b8a6"));

    fireEvent.click(screen.getByRole("button", { name: /1 tram/ }));
    expect(screen.getByRole("button", { name: /1 tram/ })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(dots().map((f) => f.properties.name)).toEqual(["41"]));
    fireEvent.click(screen.getByRole("button", { name: /1 trolleybus/ }));
    await waitFor(() => expect(dots().map((f) => f.properties.name).sort()).toEqual(["41", "66"]));
    expect(JSON.parse(localStorage.getItem("wayfork.liveModes")!).sort()).toEqual(["tram", "trolleybus"]);
    expect(screen.getByRole("button", { name: /2 of 4 live/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(dots()).toHaveLength(4));
    fetchLiveSegments.mockReset();
    fetchLiveSegments.mockResolvedValue([]);
    fetchTripDetails.mockReset();
    fetchTripDetails.mockResolvedValue(null);
  });

  it("shows stops in view at z15+ with Live on, and a tapped stop's departures", async () => {
    h.zoom = 16;
    const stop = { stopId: "s-1", name: "Sul e Sueste", lat: 38.707, lon: -9.133, tz: "Europe/Lisbon", modes: ["bus"] };
    fetchStopsInView.mockResolvedValue([stop]);
    fetchDepartures.mockResolvedValue([
      { tripId: "trip-711", name: "711", mode: "bus", color: "#22c55e", headsign: "Alto Damaia", departure: Date.now() + 5 * 60_000, delayMin: null, realTime: false, cancelled: false },
    ]);
    renderMap();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    expect(fetchStopsInView).toHaveBeenCalled();
    expect(features("transit-stops").map((f) => f.properties.name)).toEqual(["Sul e Sueste"]);
    expect(screen.getByText("Stop — tap for departures")).toBeInTheDocument();

    await act(async () => {
      h.handlers["click:transit-stops"]({
        features: [{ properties: { stopId: "s-1", name: "Sul e Sueste", tz: "Europe/Lisbon", modes: "bus" }, geometry: { coordinates: [-9.133, 38.707] } }],
      });
    });
    expect(fetchDepartures).toHaveBeenCalledWith("s-1");
    expect(await screen.findByText("→ Alto Damaia")).toBeInTheDocument();

    // A departure opens that trip's card, keeping the board underneath.
    await act(async () => fireEvent.click(screen.getByTitle("Show this trip")));
    expect(fetchTripDetails).toHaveBeenCalledWith("trip-711");
    expect(screen.getByRole("dialog", { name: "Vehicle 711" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Departures from Sul e Sueste" })).toBeInTheDocument();

    // Live off clears both, and the stops.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Live/ })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(features("transit-stops")).toEqual([]);
  });

  it("renders reach bands and their legend", () => {
    const onMode = vi.fn();
    renderMap({
      reach: {
        originName: "B",
        mode: "walk",
        bands: [
          { maxMin: 15, rects: [[0, 0, 1, 1]] },
          { maxMin: 30, rects: [] },
        ],
        onMode,
        onClose: vi.fn(),
      },
    });
    expect(features("reach")).toHaveLength(1);
    expect(features("reach")[0].properties.band).toBe(0);
    expect(screen.getByText("◎ Reach from B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Transit/ }));
    expect(onMode).toHaveBeenCalledWith("transit");
  });
});
