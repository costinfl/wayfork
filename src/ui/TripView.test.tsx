/**
 * @vitest-environment jsdom
 */
import { TEST_PLACE } from "../test/places";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/setup-dom";

// Stub the Transitous adapter — network/parsing is exercised in transit.test.ts.
const { fetchTransitPlanMock } = vi.hoisted(() => ({ fetchTransitPlanMock: vi.fn() }));
vi.mock("../domain/transit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../domain/transit")>()),
  fetchTransitPlan: fetchTransitPlanMock,
}));

// The map is WebGL-bound (its own wiring is covered in map/TripMap.test.tsx);
// here a stub records the props TripView hands it.
const { mapProps } = vi.hoisted(() => ({ mapProps: { current: null as any } }));
vi.mock("./map/TripMap", () => ({
  default: (props: unknown) => {
    mapProps.current = props;
    return null;
  },
}));

import { TripView } from "./WayforkApp";
import { RATES_EUR } from "../domain/currency";
import { parseTripDetails } from "../domain/liveTransit";
import nycTrip from "../domain/__fixtures__/motis-trip-nyc-qm32.json";
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
  }, TEST_PLACE);
  t.days[0].startTimeMin = 540;
  t.days[0].slots = [
    {
      id: "s1",
      title: "Transfer",
      defaultVariantId: "fast",
      checkpoint: null,
      place: TEST_PLACE,
      variants: [variant("fast", "Fast", 30), variant("slow", "Slow", 60)],
    },
    {
      id: "s2",
      title: "Museum",
      defaultVariantId: "walk2",
      checkpoint,
      place: TEST_PLACE,
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
        place: TEST_PLACE,
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
  const placedSlot = (id: string, title: string, place: { name: string; lat: number; lon: number }) => ({
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
    }, TEST_PLACE);
    t.days[0].slots = [
      // First slot: no earlier slot -> button absent.
      placedSlot("s1", "Start", { name: "A", lat: 1, lon: 1 }),
      // Has an earlier slot (s1) -> shown, from s1's place to this one.
      placedSlot("s3", "Destination", { name: "B", lat: 2, lon: 2 }),
    ];
    return t;
  };

  const enterEditMode = () => fireEvent.click(screen.getByRole("button", { name: "Edit" }));

  beforeEach(() => {
    fetchTransitPlanMock.mockReset();
  });

  it("only offers the button on a slot that has an earlier slot", () => {
    renderView(placedTrip());
    enterEditMode();
    expect(screen.getAllByText("🚆 Transit")).toHaveLength(1); // s3 only, not s1
  });

  it("fetches from the nearest earlier place to this slot's place, then saves the itinerary as a variant", async () => {
    const itinerary: TransitItinerary = {
      durationMin: 20,
      legs: [{ type: "metro", label: "M2 → B", durationMin: 20, distanceKm: 5, line: null, from: null, to: null }],
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

describe("TripView — trip map wiring", () => {
  it("hands the map the trip, selected day and active variants", async () => {
    renderView(fixture());
    await waitFor(() => expect(mapProps.current).not.toBeNull());
    expect(mapProps.current).toMatchObject({ dayIdx: 0, ccy: "EUR", activeVariants: { s1: "fast", s2: "walk2" } });
  });

  it("a stop clicked on the map selects its day", async () => {
    renderView(fixture());
    await waitFor(() => expect(mapProps.current).not.toBeNull());
    expect(screen.queryByText("Beach day")).toBeNull();
    act(() => mapProps.current.onSelectSlot("s3", 1));
    expect(await screen.findByText("Beach day")).toBeInTheDocument();
    expect(mapProps.current.dayIdx).toBe(1);
    expect(mapProps.current.focus).toMatchObject({ slotId: "s3" });
  });

  it("◎ reach shows walking rings from the slot, switchable and closable", async () => {
    renderView(fixture());
    fireEvent.click(screen.getAllByRole("button", { name: /reach/ })[1]); // the Museum slot
    await waitFor(() => expect(mapProps.current.reach?.bands).toBeTruthy());
    expect(mapProps.current.reach).toMatchObject({ originName: TEST_PLACE.name, mode: "walk" });
    expect(mapProps.current.reach.bands.map((b: { maxMin: number }) => b.maxMin)).toEqual([15, 30, 45]);
    act(() => mapProps.current.reach.onClose());
    expect(mapProps.current.reach).toBeNull();
  });
});

describe("TripView — use a live trip in the plan", () => {
  const nyc = () => parseTripDetails("qm32", nycTrip)!;
  const renderWithSpy = (canEdit = true) => {
    const onTripChange = vi.fn();
    render(
      <TripView
        trip={fixture()}
        rates={RATES_EUR}
        ratesLabel="built-in snapshot"
        storeLabel="local browser"
        canEdit={canEdit}
        onTripChange={onTripChange}
      />
    );
    return onTripChange;
  };

  it("adds the ride as a new slot right after the chosen one", async () => {
    const onTripChange = renderWithSpy();
    await waitFor(() => expect(mapProps.current?.onUseTrip).toBeTypeOf("function"));
    let errors: string[] = [];
    act(() => {
      errors = mapProps.current.onUseTrip({ details: nyc(), fromIdx: 1, toIdx: 3, target: { kind: "slot", afterSlotId: "s1" } });
    });
    expect(errors).toEqual([]);
    const saved: Trip = onTripChange.mock.calls[0][0];
    const slots = saved.days[0].slots;
    expect(slots.map((s) => s.title)).toEqual(["Transfer", "Bus QM32: 3 AV/E 43 ST → 3 AV/E 55 ST", "Museum"]);
    const added = slots[1];
    expect(added.place).toMatchObject({ name: "3 AV/E 55 ST" });
    expect(added.variants[0]).toMatchObject({ estimated: true, name: "Bus QM32 3 AV/E 43 ST → 3 AV/E 55 ST" });
    // The previous slot's place (Testville) is far from New York: no walk is
    // invented for that gap, just the ride.
    expect(added.variants[0].microSteps.map((m) => m.type)).toEqual(["bus"]);
  });

  it("adds the ride as an option for a slot and makes it the active one", async () => {
    const onTripChange = renderWithSpy();
    await waitFor(() => expect(mapProps.current?.onUseTrip).toBeTypeOf("function"));
    act(() => {
      mapProps.current.onUseTrip({ details: nyc(), fromIdx: 0, toIdx: 2, target: { kind: "variant", slotId: "s2" } });
    });
    const saved: Trip = onTripChange.mock.calls[0][0];
    const museum = saved.days[0].slots.find((s) => s.id === "s2")!;
    expect(museum.variants).toHaveLength(2);
    const added = museum.variants[1];
    expect(added.name).toBe("Bus QM32 3 AV/E 39 ST → 3 AV/E 48 ST");
    await waitFor(() => expect(mapProps.current.activeVariants.s2).toBe(added.id));
  });

  it("is not offered to viewers", async () => {
    renderWithSpy(false);
    await waitFor(() => expect(mapProps.current).not.toBeNull());
    expect(mapProps.current.onUseTrip).toBeUndefined();
  });
});
