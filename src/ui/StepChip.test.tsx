/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";

const { fetchDirectionsMock } = vi.hoisted(() => ({ fetchDirectionsMock: vi.fn() }));
vi.mock("../domain/directions", async (orig) => ({
  ...(await orig<typeof import("../domain/directions")>()),
  fetchDirections: fetchDirectionsMock,
}));

import { StepChip } from "./StepChip";
import type { MicroStep } from "../domain/types";

const A = { name: "Universitate", lat: 44.4355, lon: 26.1025 };
const B = { name: "Piața Victoriei", lat: 44.452, lon: 26.086 };

describe("StepChip", () => {
  it("a plain step is just a chip", () => {
    render(<StepChip ms={{ id: "m", type: "wait", label: "Queue", durationMin: 5, distanceKm: null }} />);
    expect(screen.getByText(/Queue/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a ride opens to what to board and where to get off, with a maps hand-off", () => {
    const ms: MicroStep = {
      id: "m", type: "metro", label: "M2 → Pipera", durationMin: 5, distanceKm: 2.1, from: A, to: B,
      ride: { line: "M2", headsign: "Pipera", board: "Universitate", alight: "Piața Victoriei", track: "1", stops: 2, color: "#2a9d8f" },
    };
    const onCard = vi.fn();
    render(<div onClick={onCard}><StepChip ms={ms} /></div>);
    fireEvent.click(screen.getByRole("button", { name: /M2 → Pipera — details/ }));
    expect(onCard).not.toHaveBeenCalled(); // doesn't select the option card
    const panel = screen.getByRole("region", { name: "M2 → Pipera details" });
    expect(panel).toHaveTextContent("towards Pipera");
    expect(panel).toHaveTextContent("Board at Universitate · platform 1");
    expect(panel).toHaveTextContent("Get off at Piața Victoriei · after 2 stops");
    expect(screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href")).toContain("travelmode=transit");
    expect(screen.queryByRole("button", { name: "Directions" })).toBeNull(); // rides have no turn-by-turn
  });

  it("a placed walk loads turn-by-turn on demand", async () => {
    fetchDirectionsMock.mockResolvedValueOnce([
      { text: "Head off on Bulevardul Regina Elisabeta", distanceM: 120 },
      { text: "Turn left onto Calea Victoriei", distanceM: 1530 },
    ]);
    render(<StepChip ms={{ id: "m", type: "walk", label: "Walk to Victoriei", durationMin: 20, distanceKm: 1.7, from: A, to: B }} />);
    fireEvent.click(screen.getByRole("button", { name: /Walk to Victoriei — details/ }));
    expect(fetchDirectionsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Directions" }));
    expect(fetchDirectionsMock).toHaveBeenCalledWith(A, B, "foot");
    const list = await screen.findByRole("list", { name: "Directions" });
    expect(list).toHaveTextContent("Turn left onto Calea Victoriei · 1.5 km");
    expect(screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href")).toContain("travelmode=walking");
  });

  it("says so when directions are unavailable", async () => {
    fetchDirectionsMock.mockResolvedValueOnce(null);
    render(<StepChip ms={{ id: "m", type: "car", label: "Drive", durationMin: 20, distanceKm: 10, from: A, to: B }} />);
    fireEvent.click(screen.getByRole("button", { name: /Drive — details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Directions" }));
    expect(await screen.findByText("Directions unavailable right now.")).toBeInTheDocument();
    expect(fetchDirectionsMock).toHaveBeenCalledWith(A, B, "driving");
  });
});
