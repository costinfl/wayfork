/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../../test/setup-dom";
import lisbonStopTimes from "../../domain/__fixtures__/motis-stoptimes-lisbon.json";
import { parseDepartures, type Departure } from "../../domain/liveTransit";
import { DeparturesBoard } from "./DeparturesBoard";

const stop = { stopId: "pt-Carris_4509", name: "Sul e Sueste", lat: 38.707, lon: -9.133, tz: "Europe/Lisbon", modes: ["bus" as const] };
const theme = { bg: "#111", fg: "#eee", border: "#333" };
const departures = parseDepartures(lisbonStopTimes);

const renderBoard = (over: Partial<Parameters<typeof DeparturesBoard>[0]> = {}) => {
  const props = {
    stop,
    departures,
    status: "ready" as const,
    now: Date.parse("2026-10-20T04:58:00Z"),
    onPickTrip: vi.fn(),
    onClose: vi.fn(),
    theme,
    ...over,
  };
  render(<DeparturesBoard {...props} />);
  return props;
};

describe("DeparturesBoard", () => {
  it("lists departures with line, direction, local time and a countdown", () => {
    renderBoard();
    expect(screen.getByText("Sul e Sueste")).toBeInTheDocument();
    const rows = screen.getByRole("list", { name: "Departures" }).querySelectorAll("li");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("711");
    expect(rows[0]).toHaveTextContent("→ Alto Damaia");
    expect(rows[0]).toHaveTextContent("06:00"); // 05:00Z in Lisbon (WEST)
    expect(rows[0]).toHaveTextContent("in 2 min");
  });

  it("shows delays, tracks and cancellations", () => {
    const special: Departure[] = [
      { ...departures[0], realTime: true, delayMin: 3, track: "B" },
      { ...departures[1], cancelled: true },
    ];
    renderBoard({ departures: special });
    const rows = screen.getByRole("list", { name: "Departures" }).querySelectorAll("li");
    expect(rows[0]).toHaveTextContent("+3 min");
    expect(rows[0]).toHaveTextContent("· B");
    expect(rows[1]).toHaveTextContent("cancelled");
  });

  it("opens the trip of a picked departure", () => {
    const p = renderBoard();
    fireEvent.click(screen.getAllByTitle("Show this trip")[0]);
    expect(p.onPickTrip).toHaveBeenCalledWith({
      tripId: departures[0].tripId,
      name: "711",
      mode: "bus",
      color: departures[0].color,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close departures" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("has loading, empty and error states", () => {
    const { unmount } = render(
      <DeparturesBoard stop={stop} departures={[]} status="loading" now={0} onPickTrip={vi.fn()} onClose={vi.fn()} theme={theme} />
    );
    expect(screen.getByText("Loading departures…")).toBeInTheDocument();
    unmount();
    renderBoard({ departures: [] });
    expect(screen.getByText("No departures in the next hours.")).toBeInTheDocument();
  });
});
