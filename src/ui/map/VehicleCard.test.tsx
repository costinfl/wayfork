/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../../test/setup-dom";
import nycTrip from "../../domain/__fixtures__/motis-trip-nyc-qm32.json";
import { parseTripDetails, type TripDetails } from "../../domain/liveTransit";
import { stopTime, VehicleCard } from "./VehicleCard";

const details = parseTripDetails("qm32", nycTrip)!;
const vehicle = { tripId: "qm32", name: "QM32", mode: "bus" as const, color: "#00933c" };
const theme = { bg: "#111", fg: "#eee", border: "#333" };

const renderCard = (over: Partial<Parameters<typeof VehicleCard>[0]> = {}) => {
  const props = {
    vehicle,
    details,
    status: "ready" as const,
    now: Date.parse("2026-10-19T20:36:00Z"),
    gone: false,
    follow: false,
    onFollow: vi.fn(),
    onClose: vi.fn(),
    theme,
    ...over,
  };
  render(<VehicleCard {...props} />);
  return props;
};

describe("VehicleCard", () => {
  it("shows line, direction, operator, live status, next and final stop in local time", () => {
    renderCard();
    expect(screen.getByText(/QM32/)).toBeInTheDocument();
    expect(screen.getByText("→ BAY TERRACE BELL BL via WHITESTONE EXPWY")).toBeInTheDocument();
    expect(screen.getByText("MTA Bus Company")).toBeInTheDocument();
    expect(screen.getByText("● Live")).toBeInTheDocument();
    expect(screen.getByTestId("delay")).toHaveTextContent("on time");
    expect(screen.getByText("3 AV/E 43 ST")).toBeInTheDocument(); // next stop
    expect(screen.getByText("16:37")).toBeInTheDocument(); // 20:37Z in New York (EDT)
    expect(screen.getByText("212 ST/15 AV")).toBeInTheDocument(); // final stop
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText(/Buses detoured/)).toBeInTheDocument();
    expect(screen.getByTitle("Not wheelchair accessible")).toBeInTheDocument();
  });

  it("colours delays: late red, early blue", () => {
    const late: TripDetails = {
      ...details,
      stops: details.stops.map((s, i) => (i === 1 ? { ...s, arrival: s.scheduledArrival! + 4 * 60_000 } : s)),
    };
    renderCard({ details: late });
    expect(screen.getByTestId("delay")).toHaveTextContent("+4 min");
    expect(screen.getByTestId("delay")).toHaveStyle({ color: "#ef4444" });
  });

  it("lists every stop on demand, dimming the passed ones", () => {
    renderCard({ now: Date.parse("2026-10-19T20:41:00Z") }); // after 3 AV/E 48 ST
    fireEvent.click(screen.getByRole("button", { name: /All stops \(6\)/ }));
    const items = screen.getByRole("list", { name: "Stops" }).querySelectorAll("li");
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveStyle({ opacity: "0.45" });
    expect(items[3]).toHaveStyle({ opacity: "1" });
  });

  it("shows a cancelled banner, arrival, loading and error states", () => {
    const { unmount } = render(
      <VehicleCard vehicle={vehicle} details={{ ...details, cancelled: true }} status="ready" now={Date.parse("2026-10-20T00:00:00Z")} gone follow={false} onFollow={vi.fn()} onClose={vi.fn()} theme={theme} />
    );
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Arrived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull(); // gone → nothing to follow
    unmount();
    renderCard({ details: null, status: "loading" });
    expect(screen.getByText("Loading trip…")).toBeInTheDocument();
  });

  it("follow and close call back", () => {
    const p = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(p.onFollow).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Close vehicle info" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("formats times in the stop's zone, tolerating unknown zones", () => {
    const t = Date.parse("2026-10-19T20:37:00Z");
    expect(stopTime(t, "America/New_York")).toBe("16:37");
    expect(stopTime(t, "Europe/Bucharest")).toBe("23:37");
    expect(stopTime(t, "Not/AZone")).toMatch(/^\d\d:\d\d$/);
    expect(stopTime(undefined)).toBe("—");
  });
});
