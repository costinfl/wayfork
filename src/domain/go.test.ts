import { describe, expect, it } from "vitest";
import { dayClock, dayTimeline, goStatus, localNow } from "./go";
import { computeSchedule } from "./schedule";
import type { Day } from "./types";

const P = (name: string, lat = 0, lon = 0) => ({ name, lat, lon });
const day: Day = {
  id: "d",
  date: "2026-05-14",
  startTimeMin: 9 * 60,
  slots: [
    {
      id: "s1", title: "To the airport", place: P("Airport", 44.57, 26.08), checkpoint: null, defaultVariantId: "v1",
      variants: [{ id: "v1", name: "Metro", cost: { amount: 0, currency: "EUR" }, microSteps: [
        { id: "a", type: "walk", label: "Walk to metro", durationMin: 10, distanceKm: 1, to: P("Metro", 44.43, 26.1) },
        { id: "b", type: "metro", label: "M2", durationMin: 30, distanceKm: 12 },
      ] }],
    },
    {
      id: "s2", title: "Flight", place: P("Rome FCO", 41.8, 12.24), checkpoint: null, defaultVariantId: "v2",
      variants: [{ id: "v2", name: "Booked", cost: { amount: 0, currency: "EUR" }, microSteps: [
        { id: "c", type: "wait", label: "Boarding", durationMin: 20, distanceKm: null },
        { id: "d", type: "flight", label: "OTP → FCO", durationMin: 120, distanceKm: 1100, tzShiftMin: -60 },
      ] }],
    },
    {
      id: "s3", title: "Into Rome", place: P("Termini", 41.9, 12.5), checkpoint: null, defaultVariantId: "v3",
      variants: [{ id: "v3", name: "Train", cost: { amount: 0, currency: "EUR" }, microSteps: [
        { id: "e", type: "train", label: "Leonardo Express", durationMin: 32, distanceKm: 30 },
      ] }],
    },
  ],
};
const rows = computeSchedule(day, {});

describe("Go mode timeline", () => {
  it("gives each step its clock window, clock changes included, with where it happens", () => {
    const t = dayTimeline(rows);
    expect(t.map((s) => [s.step.id, s.start, s.end])).toEqual([
      ["a", 540, 550],
      ["b", 550, 580],
      ["c", 580, 600],
      ["d", 600, 660], // 2 h flight, an hour back on the clock
      ["e", 660, 692], // Rome time
    ]);
    expect(t.map((s) => s.shift)).toEqual([0, 0, 0, 0, -60]);
    expect(t[1].from?.name).toBe("Metro"); // after the walk
    expect(t[1].to.name).toBe("Airport");
    expect(t[2].from?.name).toBe("Airport"); // the previous stop
    expect(t[3].end).toBe(rows[1].end);
  });

  it("knows what's under way and what's next", () => {
    const t = dayTimeline(rows);
    expect(goStatus(t, 500)).toMatchObject({ current: null, next: { step: { id: "a" } }, minutesToNext: 40, done: false });
    expect(goStatus(t, 560)).toMatchObject({ current: { step: { id: "b" } }, next: { step: { id: "c" } }, minutesToNext: 20 });
    // "now" is on the day-start (Bucharest) clock: the 2 h flight runs to 12:00 there.
    expect(goStatus(t, 700)).toMatchObject({ current: { step: { id: "d" } }, next: { step: { id: "e" } }, minutesToNext: 20 });
    // 12:05 Bucharest = 11:05 in Rome: on the train that leaves at 11:00 Rome time.
    expect(goStatus(t, 725)).toMatchObject({ current: { step: { id: "e" } }, next: null });
    expect(goStatus(t, 760)).toMatchObject({ current: null, next: null, done: true });
  });

  it("reads the local clock in the place's zone and maps it onto the plan's day", () => {
    const now = new Date("2026-05-14T07:30:00Z");
    expect(localNow(now, "Europe/Bucharest", 26)).toEqual({ date: "2026-05-14", minutes: 10 * 60 + 30 });
    expect(localNow(now, null, 12.5)).toEqual({ date: "2026-05-14", minutes: 8 * 60 + 30 }); // ~+1 h
    expect(dayClock("2026-05-14", { date: "2026-05-14", minutes: 600 })).toEqual({ minutes: 600, preview: false });
    expect(dayClock("2026-05-14", { date: "2026-05-15", minutes: 30 })).toEqual({ minutes: 1470, preview: false });
    expect(dayClock("2026-05-14", { date: "2026-11-10", minutes: 600 })).toEqual({ minutes: 600, preview: true });
  });
});
