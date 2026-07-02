import { describe, expect, it } from "vitest";
import { TRIPS } from "../data";
import type { Trip } from "./types";
import { validateTrip } from "./validate";

describe("shipped trips", () => {
  for (const trip of TRIPS) {
    it(`"${trip.name}" passes validation`, () => {
      expect(validateTrip(trip)).toEqual([]);
    });
  }
});

describe("validateTrip", () => {
  const base = (): Trip => structuredClone(TRIPS[0]);

  it("rejects a defaultVariantId that is not among the slot's variants", () => {
    const trip = base();
    trip.days[0].slots[0].defaultVariantId = "nope";
    expect(validateTrip(trip).join("\n")).toContain('defaultVariantId "nope"');
  });

  it("rejects duplicate ids", () => {
    const trip = base();
    trip.days[0].slots[1].id = trip.days[0].slots[0].id;
    expect(validateTrip(trip).join("\n")).toContain("duplicate slot id");
  });

  it("rejects currencies missing from the rate matrix", () => {
    const trip = base();
    trip.expenses[0].currency = "GBP";
    expect(validateTrip(trip).join("\n")).toContain('"GBP" is not in the rate matrix');
  });

  it("rejects percent splits that do not sum to 1", () => {
    const trip = base();
    trip.expenses[0].split = { type: "percent", shares: { "p-andrei": 0.5, "p-ioana": 0.4 } };
    expect(validateTrip(trip).join("\n")).toContain("percent shares sum to");
  });

  it("rejects fixed splits that do not sum to the amount", () => {
    const trip = base();
    trip.expenses[0].split = { type: "fixed", shares: { "p-andrei": 1 } };
    expect(validateTrip(trip).join("\n")).toContain("fixed shares sum to");
  });

  it("rejects split shares for unknown participants", () => {
    const trip = base();
    trip.expenses[0].split = { type: "percent", shares: { ghost: 1 } };
    expect(validateTrip(trip).join("\n")).toContain('unknown participant "ghost"');
  });

  it("rejects an unknown payer", () => {
    const trip = base();
    trip.expenses[0].payerId = "ghost";
    expect(validateTrip(trip).join("\n")).toContain('payer "ghost"');
  });

  it("rejects non-increasing day dates", () => {
    const trip = base();
    trip.days.push({ ...structuredClone(trip.days[0]), id: "day-dup" });
    expect(validateTrip(trip).join("\n")).toContain("is not after the previous day");
  });

  it("rejects a checkpoint set before the day starts (offset instead of absolute time)", () => {
    const trip = base();
    trip.days[0].slots[2].checkpoint = { label: "Boarding", timeMin: 240, bufferMin: 20 };
    expect(validateTrip(trip).join("\n")).toContain("before the day starts");
  });

  it("rejects non-positive micro-step durations", () => {
    const trip = base();
    trip.days[0].slots[0].variants[0].microSteps[0].durationMin = 0;
    expect(validateTrip(trip).join("\n")).toContain("must be a positive integer");
  });
});
