/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";
import type { Day, ItinerarySlot } from "../domain/types";
import type { Poi } from "../domain/poi";

// Stub the domain adapters — network is exercised in poi.test.ts.
const { fetchPoisMock, fetchPoiSummaryMock } = vi.hoisted(() => ({
  fetchPoisMock: vi.fn(),
  fetchPoiSummaryMock: vi.fn(),
}));
vi.mock("../domain/poi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain/poi")>()),
  fetchPois: fetchPoisMock,
  fetchPoiSummary: fetchPoiSummaryMock,
}));

import DiscoverPanel, { anchorSlot, searchCenter } from "./DiscoverPanel";

const POI: Poi = {
  id: "node/1",
  name: "Colosseum",
  lat: 41.89,
  lon: 12.49,
  category: "sights",
  distanceM: 850,
  openingHours: "09:00-19:00",
  wikipedia: "en:Colosseum",
};

const placedSlot = (id: string, title: string, lat: number): ItinerarySlot => ({
  id,
  title,
  variants: [],
  defaultVariantId: "",
  checkpoint: null,
  place: { name: title, lat, lon: 12.5 },
});

const day = (overrides: Partial<Day> = {}): Day => ({
  id: "d1",
  date: "2026-08-01",
  startTimeMin: 540,
  slots: [],
  location: { name: "Rome", lat: 41.9, lon: 12.5 },
  ...overrides,
});

const noop = () => {};
const renderPanel = (d: Day, props: Partial<Parameters<typeof DiscoverPanel>[0]> = {}) =>
  render(
    <DiscoverPanel
      day={d}
      canEdit={true}
      anchorId={null}
      onAnchorChange={noop}
      onAdd={async () => []}
      onResults={noop}
      {...props}
    />
  );

beforeEach(() => {
  fetchPoisMock.mockReset().mockResolvedValue([POI]);
  fetchPoiSummaryMock.mockReset().mockResolvedValue({ extract: "An amphitheatre." });
});

describe("anchorSlot / searchCenter", () => {
  const d = day({ slots: [placedSlot("s1", "Trastevere", 41.88), placedSlot("s2", "Termini", 41.9)] });

  it("uses the chosen placed slot, else the last placed slot, else the day location", () => {
    expect(anchorSlot(d, "s1")?.title).toBe("Trastevere");
    expect(anchorSlot(d, null)?.title).toBe("Termini");
    expect(searchCenter(day(), null)?.name).toBe("Rome");
    expect(searchCenter(day({ location: null }), null)).toBeNull();
  });
});

describe("DiscoverPanel", () => {
  it("fetches nothing until the Discover button is pressed", async () => {
    renderPanel(day());
    fireEvent.click(screen.getByText(/Discover places nearby/));
    expect(screen.getByText(/Pick categories and a radius/)).toBeTruthy();
    expect(fetchPoisMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("🧭 Discover"));
    await waitFor(() => expect(screen.getByText(/Colosseum/)).toBeTruthy());
    expect(fetchPoisMock).toHaveBeenCalledTimes(1);
    expect(fetchPoisMock).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 41.9, lon: 12.5 }),
      3000,
      ["sights", "museums"]
    );
  });

  it("reports results to the parent for the map overlay", async () => {
    const onResults = vi.fn();
    renderPanel(day(), { onResults });
    fireEvent.click(screen.getByText(/Discover places nearby/));
    fireEvent.click(screen.getByText("🧭 Discover"));
    await waitFor(() =>
      expect(onResults).toHaveBeenCalledWith({
        center: { name: "Rome", lat: 41.9, lon: 12.5 },
        radiusM: 3000,
        pois: [POI],
      })
    );
  });

  it("shows the failure state with a working Retry when Overpass is down", async () => {
    fetchPoisMock.mockResolvedValueOnce(null);
    const onResults = vi.fn();
    renderPanel(day(), { onResults });
    fireEvent.click(screen.getByText(/Discover places nearby/));
    fireEvent.click(screen.getByText("🧭 Discover"));
    await waitFor(() => expect(screen.getByText(/Overpass is busy/)).toBeTruthy());
    expect(onResults).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText(/Colosseum/)).toBeTruthy());
  });

  it("offers placed slots as start points and reports the choice", async () => {
    const onAnchorChange = vi.fn();
    const d = day({ slots: [placedSlot("s1", "Trastevere", 41.88), placedSlot("s2", "Termini", 41.9)] });
    renderPanel(d, { onAnchorChange });
    fireEvent.click(screen.getByText(/Discover places nearby/));
    const select = screen.getByLabelText("Start from");
    expect(screen.getByText("Last stop (auto)")).toBeTruthy();
    fireEvent.change(select, { target: { value: "s1" } });
    expect(onAnchorChange).toHaveBeenCalledWith("s1");
    // Auto center = last placed slot (Termini), shown in the label.
    expect(screen.getByText(/around ⌖ Termini/)).toBeTruthy();
  });

  it("awaits the async add and shows the added state", async () => {
    const onAdd = vi.fn(async () => []);
    renderPanel(day(), { onAdd });
    fireEvent.click(screen.getByText(/Discover places nearby/));
    fireEvent.click(screen.getByText("🧭 Discover"));
    await waitFor(() => expect(screen.getByText("+ Add to day")).toBeTruthy());
    fireEvent.click(screen.getByText("+ Add to day"));
    await waitFor(() => expect(screen.getByText(/Added ✓/)).toBeTruthy());
    expect(onAdd).toHaveBeenCalledWith(POI);
  });

  it("hides the add button for viewers and lazy-loads details on expand", async () => {
    renderPanel(day(), { canEdit: false });
    fireEvent.click(screen.getByText(/Discover places nearby/));
    fireEvent.click(screen.getByText("🧭 Discover"));
    await waitFor(() => expect(screen.getByText(/Colosseum/)).toBeTruthy());
    expect(screen.queryByText("+ Add to day")).toBeNull();
    expect(fetchPoiSummaryMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Colosseum/));
    await waitFor(() => expect(screen.getByText(/An amphitheatre./)).toBeTruthy());
  });

  it("asks for a location when the day has none", () => {
    renderPanel(day({ location: null }));
    fireEvent.click(screen.getByText(/Discover places nearby/));
    expect(screen.getByText(/Give this day a location/)).toBeTruthy();
    expect(fetchPoisMock).not.toHaveBeenCalled();
  });
});
