import { describe, expect, it } from "vitest";
import { nextStep, TOUR_STEPS } from "./tour";

describe("tour", () => {
  it("walks the steps in order", () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual(["stop", "options", "totals", "map", "edit"]);
    const all = () => true;
    expect(nextStep(TOUR_STEPS, -1, 1, all)).toBe(0);
    expect(nextStep(TOUR_STEPS, 4, 1, all)).toBeNull();
    expect(nextStep(TOUR_STEPS, 2, -1, all)).toBe(1);
  });

  it("skips steps whose anchor is missing", () => {
    const present = (a: string) => a !== "options" && a !== "edit";
    expect(nextStep(TOUR_STEPS, 0, 1, present)).toBe(2);
    expect(nextStep(TOUR_STEPS, 2, -1, present)).toBe(0);
    expect(nextStep(TOUR_STEPS, 3, 1, present)).toBeNull();
  });
});
