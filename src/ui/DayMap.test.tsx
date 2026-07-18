/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";
import type { Day, ItinerarySlot, Place, StepType, VariantNode } from "../domain/types";

// Leaflet is too heavy/canvas-bound for jsdom — mock it and capture the created
// polylines (with their click handlers) so we can test the wiring: which
// segments become clickable alternatives, and the unmapped hint.
const { polylines, circles, circleMarkers } = vi.hoisted(() => ({
  polylines: [] as any[],
  circles: [] as any[],
  circleMarkers: [] as any[],
}));

vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("leaflet", () => {
  const polyline = (latlngs: unknown, options: any) => {
    const o: any = { options, _latlngs: latlngs };
    o.addTo = () => o;
    o.on = (ev: string, fn: () => void) => {
      if (ev === "click") o._onClick = fn;
      return o;
    };
    o.setStyle = (s: any) => ((o.options = { ...o.options, ...s }), o);
    o.setLatLngs = (ll: unknown) => ((o._latlngs = ll), o);
    o.getBounds = () => ({});
    o.remove = () => {};
    polylines.push(o);
    return o;
  };
  const layer = (store: any[] | null, latlng: unknown, options: unknown) => {
    const o: any = { _latlng: latlng, options };
    o.addTo = () => o;
    o.remove = () => {};
    o.bindTooltip = (t: string) => ((o._tooltip = t), o);
    if (store) store.push(o);
    return o;
  };
  const L = {
    map: () => ({ setView: () => {}, fitBounds: () => {}, remove: () => {}, invalidateSize: () => {} }),
    tileLayer: () => ({ addTo: () => ({}) }),
    marker: () => ({ addTo: () => ({ remove: () => {} }), remove: () => {} }),
    divIcon: () => ({}),
    circle: (latlng: unknown, options: unknown) => layer(circles, latlng, options),
    circleMarker: (latlng: unknown, options: unknown) => layer(circleMarkers, latlng, options),
    polyline,
  };
  return { default: L, ...L };
});
// Keep the routing adapter off the network.
vi.mock("../domain/route", () => ({ fetchRoute: vi.fn(async () => null) }));

import { DayMap } from "./DayMap";

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

describe("DayMap wiring", () => {
  it("activates the variant when its dashed alternative is clicked", () => {
    polylines.length = 0;
    const onActivate = vi.fn();
    render(<DayMap day={day} activeVariants={{}} onActivate={onActivate} />);

    // The alternative segment is the dashed one and carries a click handler.
    const dashed = polylines.filter((p) => p.options.dashArray);
    expect(dashed.length).toBeGreaterThanOrEqual(1);
    const withClick = dashed.find((p) => typeof p._onClick === "function");
    expect(withClick).toBeTruthy();
    withClick._onClick();
    expect(onActivate).toHaveBeenCalledWith("s2", "alt");
  });

  it("renders the unmapped-slots hint", () => {
    const onActivate = vi.fn();
    render(<DayMap day={day} activeVariants={{}} onActivate={onActivate} />);
    expect(screen.getByText(/1 slot have no location|1 slot have no location yet|no location/i)).toBeInTheDocument();
  });

  it("draws a variant's stored geometry (transit route) instead of the schematic arc", () => {
    polylines.length = 0;
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
    const active = polylines.find((p) => !p.options.dashArray);
    expect(active._latlngs).toEqual(line);
  });

  it("falls back to the schematic arc when a transit-typed variant carries no geometry", () => {
    polylines.length = 0;
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    // "active" on s2 is a metro (arc profile) with no stored geometry — still
    // renders a bowed arc, not the two-point straight line.
    const active = polylines.find((p) => !p.options.dashArray);
    expect(active._latlngs.length).toBeGreaterThan(2);
  });

  it("does not attach a click handler to the active solid segment", () => {
    polylines.length = 0;
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    const solid = polylines.filter((p) => !p.options.dashArray);
    for (const p of solid) expect(p._onClick).toBeUndefined();
  });

  it("draws the discover search circle, its center, and a pin per POI", () => {
    circles.length = 0;
    circleMarkers.length = 0;
    const discover = {
      center: { name: "A", lat: 0, lon: 0 },
      radiusM: 3000,
      pois: [
        { id: "node/1", name: "Colosseum", lat: 0.01, lon: 0.01, category: "sights", distanceM: 900 },
        { id: "node/2", name: "Pantheon", lat: 0.02, lon: 0.02, category: "sights", distanceM: 1200 },
      ],
    };
    render(
      <DayMap day={day} activeVariants={{}} onActivate={vi.fn()} discover={discover as any} />
    );
    expect(circles).toHaveLength(1);
    expect(circles[0].options.radius).toBe(3000);
    expect(circleMarkers).toHaveLength(2);
    expect(circleMarkers.map((m) => m._tooltip)).toEqual(["Colosseum", "Pantheon"]);
  });

  it("toggles fullscreen via the ⛶ button and exits on Escape", () => {
    render(<DayMap day={day} activeVariants={{}} onActivate={vi.fn()} />);
    const btn = screen.getByLabelText("Fullscreen map");
    fireEvent.click(btn);
    const exit = screen.getByLabelText("Exit fullscreen map");
    expect(exit.parentElement?.className).toContain("fixed inset-0");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByLabelText("Fullscreen map").parentElement?.className).not.toContain(
      "fixed inset-0"
    );
  });
});
