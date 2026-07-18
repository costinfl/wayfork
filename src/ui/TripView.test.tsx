/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";

// Stub the Transitous adapter — network/parsing is exercised in transit.test.ts.
const { fetchTransitPlanMock } = vi.hoisted(() => ({ fetchTransitPlanMock: vi.fn() }));
vi.mock("../domain/transit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain/transit")>()),
  fetchTransitPlan: fetchTransitPlanMock,
}));

import { TripView } from "./WayforkApp";
import { RATES_EUR } from "../domain/currency";
import { newTrip } from "../domain/mutate";
import type { TransitItinerary } from "../domain/transit";
import type { Checkpoint, Trip, VariantNode } from "../domain/types";

// Wiring-level fixtures: schedule math itself is covered in domain tests —
// here we assert the RENDERED ripple, banner states, and role gating.

const variant = (id: string, name: string, durationMin: number): VariantNode => ({
  id,
  name,
  cost: { amount: 0, currency: "EUR" },
  microSteps: [{ id: `ms-${id}`, type: "walk", label: `${name} leg`, durationMin, distanceKm: null }],
});

// Day 1 (09:00): Transfer (Fast 30m ACTIVE / Slow 60m) → Museum (15m, optional
// checkpoint); Day 2 exists only for the tab test.
const fixture = (checkpoint: Checkpoint | null = null): Trip => {
  const t = newTrip("Fixture", "2026-08-01", [{ id: "p1", name: "Ana" }], {
    home: "RON",
    local: "EUR",
    intl: "USD",
  });
  t.days[0].startTimeMin = 540;
  t.days[0].slots = [
    {
      id: "s1",
      title: "Transfer",
      defaultVariantId: "fast",
      checkpoint: null,
      variants: [variant("fast", "Fast", 30), variant("slow", "Slow", 60)],
    },
    {
      id: "s2",
      title: "Museum",
      defaultVariantId: "walk2",
      checkpoint,
      variants: [variant("walk2", "Walk", 15)],
    },
  ];
  t.days.push({
    id: "d2",
    date: "2026-08-02",
    startTimeMin: 600,
    slots: [
      {
        id: "s3",
        title: "Beach day",
        defaultVariantId: "w3",
        checkpoint: null,
        variants: [variant("w3", "Stroll", 10)],
      },
    ],
  });
  t.expenses = [
    {
      id: "e1",
      phase: "mid-trip",
      label: "Coffee",
      payerId: "p1",
      amount: 4,
      currency: "EUR",
      split: { type: "equal" },
    },
  ];
  return t;
};

const renderView = (trip: Trip, canEdit = true) =>
  render(
    <TripView
      trip={trip}
      rates={RATES_EUR}
      ratesLabel="built-in snapshot"
      storeLabel="local browser"
      canEdit={canEdit}
      onTripChange={vi.fn()}
    />
  );

describe("TripView", () => {
  it("ripples a variant switch into the downstream slot's rendered times", () => {
    renderView(fixture());
    // Fast (30m) active: Museum runs 09:30–09:45.
    expect(screen.getByText("09:30–09:45")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Slow")); // activate the 60m alternative
    expect(screen.getByText("10:00–10:15")).toBeInTheDocument();
    expect(screen.queryByText("09:30–09:45")).toBeNull();
  });

  it.each([
    [700, 15, /on track/],
    [590, 60, /below 1h safety buffer/],
    [550, 15, /LATE — checkpoint breached/],
  ])("renders the checkpoint banner for timeMin=%i buffer=%i", (timeMin, bufferMin, expected) => {
    renderView(fixture({ label: "Timed entry", timeMin, bufferMin, opensMin: null }));
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("switches days via the tabs", () => {
    renderView(fixture());
    expect(screen.getByText("Museum")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Day 2/ }));
    expect(screen.getByText("Beach day")).toBeInTheDocument();
    expect(screen.queryByText("Museum")).toBeNull();
  });

  it("hides every edit affordance for viewers and shows them for editors", () => {
    const { unmount } = renderView(fixture(), false);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByText("+ Add expense")).toBeNull();
    expect(screen.queryByTitle("Edit expense")).toBeNull();
    expect(screen.queryByTitle("Delete expense")).toBeNull();
    unmount();

    renderView(fixture(), true);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("+ Add expense")).toBeInTheDocument();
    expect(screen.getByTitle("Edit expense")).toBeInTheDocument();
    expect(screen.getByTitle("Delete expense")).toBeInTheDocument();
  });
});

describe("TripView — 🚆 Transit option", () => {
  const placedSlot = (id: string, title: string, place: { name: string; lat: number; lon: number } | null) => ({
    id,
    title,
    defaultVariantId: `${id}v`,
    checkpoint: null,
    place,
    variants: [variant(`${id}v`, "Option A", 10)],
  });

  const placedTrip = (): Trip => {
    const t = newTrip("Fixture", "2026-08-01", [{ id: "p1", name: "Ana" }], {
      home: "RON",
      local: "EUR",
      intl: "USD",
    });
    t.days[0].slots = [
      // First slot: has a place but no EARLIER placed slot -> button absent.
      placedSlot("s1", "Start", { name: "A", lat: 1, lon: 1 }),
      // No place at all -> button absent regardless of what precedes it.
      placedSlot("s2", "Waypoint", null),
      // Has a place AND an earlier placed slot (s1, skipping unplaced s2) -> shown.
      placedSlot("s3", "Destination", { name: "B", lat: 2, lon: 2 }),
    ];
    return t;
  };

  const enterEditMode = () => fireEvent.click(screen.getByRole("button", { name: "Edit" }));

  beforeEach(() => {
    fetchTransitPlanMock.mockReset();
  });

  it("only offers the button on a placed slot that has an earlier placed slot", () => {
    renderView(placedTrip());
    enterEditMode();
    expect(screen.getAllByText("🚆 Transit")).toHaveLength(1); // s3 only, not s1 or s2
  });

  it("fetches from the nearest earlier place to this slot's place, then saves the itinerary as a variant", async () => {
    const itinerary: TransitItinerary = {
      durationMin: 20,
      legs: [{ type: "metro", label: "M2 → B", durationMin: 20, distanceKm: 5, line: null }],
    };
    fetchTransitPlanMock.mockResolvedValue(itinerary);
    const onTripChange = vi.fn();
    render(
      <TripView
        trip={placedTrip()}
        rates={RATES_EUR}
        ratesLabel="built-in snapshot"
        storeLabel="local browser"
        canEdit={true}
        onTripChange={onTripChange}
      />
    );
    enterEditMode();
    fireEvent.click(screen.getByText("🚆 Transit"));

    expect(fetchTransitPlanMock).toHaveBeenCalledWith(
      { name: "A", lat: 1, lon: 1 },
      { name: "B", lat: 2, lon: 2 }
    );
    await waitFor(() => expect(onTripChange).toHaveBeenCalled());
    const saved: Trip = onTripChange.mock.calls[0][0];
    const destination = saved.days[0].slots.find((s) => s.id === "s3")!;
    const added = destination.variants.find((v: VariantNode) => v.name === "Public transit");
    expect(added).toMatchObject({ estimated: true });
    expect(added!.microSteps[0]).toMatchObject({ type: "metro", label: "M2 → B", durationMin: 20 });
  });

  it("shows an inline message on the destination slot when no itinerary is found", async () => {
    fetchTransitPlanMock.mockResolvedValue(null);
    renderView(placedTrip());
    enterEditMode();
    fireEvent.click(screen.getByText("🚆 Transit"));
    expect(await screen.findByText(/No transit options found/)).toBeInTheDocument();
  });
});
