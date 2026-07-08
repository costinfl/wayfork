import { describe, expect, it } from "vitest";
import { scaffoldTrip, type Place, type PlanInput } from "./scaffold";
import { validateTrip } from "./validate";

const place = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

const START = place("Bucharest", 44.43, 26.1);
const ROME = place("Rome", 41.9, 12.5);
const FLORENCE = place("Florence", 43.77, 11.26);
const VENICE = place("Venice", 45.44, 12.34);

const plan = (over: Partial<PlanInput> = {}): PlanInput => ({
  startPoint: START,
  destinations: [ROME],
  startDate: "2026-07-08",
  numDays: 3,
  returnToStart: false,
  ...over,
});

describe("scaffoldTrip", () => {
  it("builds a single-destination trip that passes the validator", () => {
    const trip = scaffoldTrip(plan({ destinations: [ROME], numDays: 3 }));
    expect(validateTrip(trip)).toEqual([]);
    expect(trip.days).toHaveLength(3);
    expect(trip.name).toBe("Rome · Jul 2026");
    expect(trip.currencies).toEqual({ home: "RON", local: "EUR", intl: "USD" });
    expect(trip.participants).toHaveLength(1);
    expect(trip.expenses).toEqual([]);
    // Every day sits in Rome for weather.
    for (const d of trip.days) {
      expect(d.location).toEqual({ name: "Rome", lat: 41.9, lon: 12.5 });
    }
  });

  it("derives strictly increasing dates from the start date", () => {
    const trip = scaffoldTrip(plan({ numDays: 3 }));
    expect(trip.days.map((d) => d.date)).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });

  it("puts a travel + free-time slot on the first day of a destination block", () => {
    const trip = scaffoldTrip(plan({ numDays: 3 }));
    const first = trip.days[0];
    expect(first.slots).toHaveLength(2);
    expect(first.slots[0].title).toBe("Bucharest → Rome");
    expect(first.slots[1].title).toBe("Free time in Rome");
    expect(first.startTimeMin).toBe(360);
    // Placeholder variants are flagged estimated.
    expect(first.slots[0].variants[0].estimated).toBe(true);
    // Subsequent explore days carry a single free-time slot.
    expect(trip.days[1].slots).toHaveLength(1);
    expect(trip.days[1].slots[0].title).toBe("Explore Rome");
    expect(trip.days[1].startTimeMin).toBe(540);
  });

  it("distributes the remainder to the earliest destinations (3 dests / 8 days / return)", () => {
    const trip = scaffoldTrip(
      plan({ destinations: [ROME, FLORENCE, VENICE], numDays: 8, returnToStart: true })
    );
    expect(validateTrip(trip)).toEqual([]);
    const cities = trip.days.map((d) => d.location?.name);
    // 3 + 2 + 2 + return-to-start.
    expect(cities).toEqual([
      "Rome", "Rome", "Rome",
      "Florence", "Florence",
      "Venice", "Venice",
      "Bucharest",
    ]);
  });

  it("makes the last day the return to the starting point", () => {
    const trip = scaffoldTrip(
      plan({ destinations: [ROME, VENICE], numDays: 5, returnToStart: true })
    );
    const last = trip.days[trip.days.length - 1];
    expect(last.location).toEqual({ name: "Bucharest", lat: 44.43, lon: 26.1 });
    expect(last.slots).toHaveLength(1);
    expect(last.slots[0].title).toBe("Return to Bucharest");
    expect(last.startTimeMin).toBe(360);
  });

  it("chains travel-slot origins across destinations", () => {
    const trip = scaffoldTrip(
      plan({ destinations: [ROME, VENICE], numDays: 4, returnToStart: false })
    );
    // Rome gets days 0-1, Venice gets days 2-3; the travel slot into Venice
    // departs from Rome, not the starting point.
    const veniceArrival = trip.days[2];
    expect(veniceArrival.slots[0].title).toBe("Rome → Venice");
  });

  it("names a multi-destination trip as a range", () => {
    const trip = scaffoldTrip(
      plan({ destinations: [ROME, VENICE], numDays: 4 })
    );
    expect(trip.name).toBe("Rome – Venice · Jul 2026");
  });

  it("throws when there are no destinations", () => {
    expect(() => scaffoldTrip(plan({ destinations: [], numDays: 3 }))).toThrow(/at least one/i);
  });

  it("throws when there are fewer days than destinations (+ return)", () => {
    expect(() =>
      scaffoldTrip(plan({ destinations: [ROME, FLORENCE, VENICE], numDays: 2 }))
    ).toThrow(/at least 3/i);
    expect(() =>
      scaffoldTrip(plan({ destinations: [ROME, VENICE], numDays: 2, returnToStart: true }))
    ).toThrow(/at least 3/i);
  });
});
