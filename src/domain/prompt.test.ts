import { describe, expect, it } from "vitest";
import { buildTripPrompt } from "./prompt";
import { scaffoldTrip, type Place, type PlanInput } from "./scaffold";

const place = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

const input: PlanInput = {
  startPoint: place("Bucharest", 44.43, 26.1),
  destinations: [place("Rome", 41.9, 12.5), place("Venice", 45.44, 12.34)],
  startDate: "2026-07-08",
  numDays: 5,
  returnToStart: true,
};

describe("buildTripPrompt", () => {
  const scaffold = scaffoldTrip(input);
  const prompt = buildTripPrompt(input, scaffold);

  it("substitutes every placeholder (no {TOKEN} left)", () => {
    expect(prompt).not.toMatch(/\{[A-Z_]+\}/);
  });

  it("embeds the inputs", () => {
    expect(prompt).toContain("Bucharest (lat 44.43, lon 26.1)");
    expect(prompt).toContain("1. Rome — lat 41.9, lon 12.5");
    expect(prompt).toContain("2. Venice — lat 45.44, lon 12.34");
    expect(prompt).toContain("2026-07-08");
    expect(prompt).toContain("Return to the starting point on the last day: yes");
  });

  it("injects the trip id and the full day scaffold table", () => {
    expect(prompt).toContain(scaffold.id);
    for (const [i, day] of scaffold.days.entries()) {
      const row = `| ${i + 1} | ${day.date} | ${day.location!.name} |`;
      expect(prompt).toContain(row);
    }
    // The return day sits back in Bucharest.
    expect(prompt).toContain(`| 5 | ${scaffold.days[4].date} | Bucharest |`);
  });

  it("reflects a no-return plan in the flag", () => {
    const noReturn: PlanInput = { ...input, returnToStart: false, numDays: 4 };
    const prompt2 = buildTripPrompt(noReturn, scaffoldTrip(noReturn));
    expect(prompt2).toContain("Return to the starting point on the last day: no");
  });
});
