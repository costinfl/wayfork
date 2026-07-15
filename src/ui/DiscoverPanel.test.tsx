/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";
import type { Day } from "../domain/types";
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

import DiscoverPanel, { searchCenter } from "./DiscoverPanel";

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

const day = (overrides: Partial<Day> = {}): Day => ({
  id: "d1",
  date: "2026-08-01",
  startTimeMin: 540,
  slots: [],
  location: { name: "Rome", lat: 41.9, lon: 12.5 },
  ...overrides,
});

beforeEach(() => {
  fetchPoisMock.mockReset().mockResolvedValue([POI]);
  fetchPoiSummaryMock.mockReset().mockResolvedValue({ extract: "An amphitheatre." });
});

describe("searchCenter", () => {
  it("prefers the last slot with a place, falling back to the day location", () => {
    const d = day();
    expect(searchCenter(d)?.name).toBe("Rome");
    const withSlots = day({
      slots: [
        { id: "s1", title: "A", variants: [], defaultVariantId: "", checkpoint: null, place: { name: "Trastevere", lat: 41.88, lon: 12.47 } },
        { id: "s2", title: "B", variants: [], defaultVariantId: "", checkpoint: null },
      ],
    });
    expect(searchCenter(withSlots)?.name).toBe("Trastevere");
    expect(searchCenter(day({ location: null }))).toBeNull();
  });
});

describe("DiscoverPanel", () => {
  it("fetches nothing until opened, then lists POIs", async () => {
    render(<DiscoverPanel day={day()} canEdit={true} onAdd={() => []} />);
    expect(fetchPoisMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Discover places nearby/));
    await waitFor(() => expect(screen.getByText(/Colosseum/)).toBeTruthy(), { timeout: 2000 });
    expect(fetchPoisMock).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 41.9, lon: 12.5 }),
      3000,
      ["sights", "museums"]
    );
    expect(screen.getByText(/09:00-19:00/)).toBeTruthy();
  });

  it("adds a slot via onAdd and shows the added state", async () => {
    const onAdd = vi.fn(() => []);
    render(<DiscoverPanel day={day()} canEdit={true} onAdd={onAdd} />);
    fireEvent.click(screen.getByText(/Discover places nearby/));
    await waitFor(() => expect(screen.getByText("+ Add to day")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText("+ Add to day"));
    expect(onAdd).toHaveBeenCalledWith(POI);
    expect(screen.getByText(/Added ✓/)).toBeTruthy();
  });

  it("hides the add button for viewers and lazy-loads details on expand", async () => {
    render(<DiscoverPanel day={day()} canEdit={false} onAdd={() => []} />);
    fireEvent.click(screen.getByText(/Discover places nearby/));
    await waitFor(() => expect(screen.getByText(/Colosseum/)).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText("+ Add to day")).toBeNull();
    expect(fetchPoiSummaryMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Colosseum/));
    await waitFor(() => expect(screen.getByText(/An amphitheatre./)).toBeTruthy());
  });

  it("asks for a location when the day has none", () => {
    render(<DiscoverPanel day={day({ location: null })} canEdit={true} onAdd={() => []} />);
    fireEvent.click(screen.getByText(/Discover places nearby/));
    expect(screen.getByText(/Give this day a location/)).toBeTruthy();
    expect(fetchPoisMock).not.toHaveBeenCalled();
  });
});
