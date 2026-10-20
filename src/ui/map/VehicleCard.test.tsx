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
    presence: "live" as const,
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
      <VehicleCard vehicle={vehicle} details={{ ...details, cancelled: true }} status="ready" now={Date.parse("2026-10-20T00:00:00Z")} presence="gone" follow={false} onFollow={vi.fn()} onClose={vi.fn()} theme={theme} />
    );
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Arrived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull(); // gone → nothing to follow
    unmount();
    renderCard({ details: null, status: "loading" });
    expect(screen.getByText("Loading trip…")).toBeInTheDocument();
  });

  it("a vehicle not on the road yet offers no Follow and no 'left the view' note", () => {
    renderCard({ presence: "waiting" });
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(screen.queryByText(/No longer in the live view/)).toBeNull();
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

describe("VehicleCard — use in my plan", () => {
  const daySlots = [
    { id: "s1", title: "Hotel → Airport" },
    { id: "s2", title: "Museum" },
  ];

  it("is offered to editors only", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /Use in my plan/ })).toBeNull();
  });

  it("boards from the next stop onwards, alights later, and defaults to a new slot at the day's end", () => {
    const onUse = vi.fn(() => [] as string[]);
    renderCard({ onUse, daySlots, dayLabel: "Day 1", now: Date.parse("2026-10-19T20:41:00Z") });
    fireEvent.click(screen.getByRole("button", { name: /Use in my plan/ }));
    const from = screen.getByRole("combobox", { name: "Board at" }) as HTMLSelectElement;
    expect([...from.options].map((o) => o.text)).toEqual(["3 AV/E 55 ST", details.stops[4].name]); // passed stops gone
    const to = screen.getByRole("combobox", { name: "Get off at" }) as HTMLSelectElement;
    expect(to.value).toBe("5");
    fireEvent.change(from, { target: { value: "4" } });
    expect([...to.options].map((o) => o.text)).toEqual(["212 ST/15 AV"]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onUse).toHaveBeenCalledWith({ details, fromIdx: 4, toIdx: 5, target: { kind: "slot", afterSlotId: "s2" } });
    expect(screen.getByText("Added ✓")).toBeInTheDocument();
  });

  it("can add the ride as an option for a slot, and shows validation errors", () => {
    const onUse = vi.fn(() => ["slot s1: something is off"]);
    renderCard({ onUse, daySlots });
    fireEvent.click(screen.getByRole("button", { name: /Use in my plan/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Add as" }), { target: { value: "option:s1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "variant", slotId: "s1" } }));
    expect(screen.getByText("slot s1: something is off")).toBeInTheDocument();
    expect(screen.queryByText("Added ✓")).toBeNull();
  });
});
