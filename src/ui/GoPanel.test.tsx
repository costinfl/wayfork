/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "../test/setup-dom";

const { fetchTimeZoneMock, fetchDeparturesMock } = vi.hoisted(() => ({
  fetchTimeZoneMock: vi.fn(async (..._a: unknown[]) => "Europe/Rome" as string | null),
  fetchDeparturesMock: vi.fn(async (..._a: unknown[]): Promise<unknown[] | null> => []),
}));
vi.mock("../domain/departure", async (orig) => ({ ...(await orig<typeof import("../domain/departure")>()), fetchTimeZone: fetchTimeZoneMock }));
vi.mock("../domain/liveTransit", async (orig) => ({ ...(await orig<typeof import("../domain/liveTransit")>()), fetchDepartures: fetchDeparturesMock }));

import { GoPanel } from "./GoPanel";
import { computeSchedule } from "../domain/schedule";
import type { Day } from "../domain/types";

const P = (name: string, lat: number, lon: number) => ({ name, lat, lon });
const day: Day = {
  id: "d",
  date: "2026-05-14",
  startTimeMin: 10 * 60,
  slots: [
    {
      id: "s1", title: "Hotel", place: P("Termini", 41.901, 12.501), checkpoint: null, defaultVariantId: "v",
      variants: [{ id: "v", name: "Check out", cost: { amount: 0, currency: "EUR" }, microSteps: [{ id: "w", type: "wait", label: "Check out", durationMin: 20, distanceKm: null }] }],
    },
    {
      id: "s2", title: "Colosseum", place: P("Colosseo", 41.8902, 12.4922), checkpoint: null, defaultVariantId: "m",
      variants: [{ id: "m", name: "Metro", cost: { amount: 0, currency: "EUR" }, microSteps: [
        { id: "r", type: "metro", label: "B → Laurentina", durationMin: 6, distanceKm: 2, from: P("Termini", 41.901, 12.501), to: P("Colosseo", 41.8902, 12.4922),
          ride: { line: "B", board: "Termini", alight: "Colosseo", track: "2", boardStopId: "it-roma_T1", tz: "Europe/Rome" } },
      ] }],
    },
  ],
};
const rows = computeSchedule(day, {});
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};
afterEach(() => vi.useRealTimers());

describe("GoPanel", () => {
  it("shows what's now and next on the day's local clock, with live departures for the next ride", async () => {
    at("2026-05-14T08:10:00Z"); // 10:10 in Rome
    fetchDeparturesMock.mockResolvedValueOnce([
      { tripId: "t1", name: "B", departure: Date.parse("2026-05-14T08:21:00Z"), delayMin: 2, cancelled: false, realTime: true, mode: "metro", color: "#00f", tz: "Europe/Rome" },
      { tripId: "t2", name: "B1", departure: Date.parse("2026-05-14T08:22:00Z"), delayMin: null, cancelled: false, realTime: false, mode: "metro", color: "#00f" },
      { tripId: "t3", name: "B", departure: Date.parse("2026-05-14T08:27:00Z"), delayMin: null, cancelled: true, realTime: true, mode: "metro", color: "#00f" },
    ]);
    await act(async () => {
      render(<GoPanel day={day} dayLabel="Day 1" rows={rows} onPosition={vi.fn()} onClose={vi.fn()} />);
    });
    const panel = screen.getByRole("dialog", { name: "Go mode" });
    expect(panel).toHaveTextContent("10:10 local");
    expect(panel).not.toHaveTextContent("Preview");
    expect(panel).toHaveTextContent("NOW · until 10:20");
    expect(panel).toHaveTextContent("NEXT · 10:20 (in 10 min)");
    expect(panel).toHaveTextContent("Board at Termini · platform 2 → get off at Colosseo");
    expect(fetchDeparturesMock).toHaveBeenCalledWith("it-roma_T1");
    const live = screen.getByLabelText("Live departures");
    expect(live).toHaveTextContent("Live · B: 10:21 +2 · 10:27 cancelled"); // other lines left out
  });

  it("previews another day at today's time", async () => {
    at("2026-11-10T09:00:00Z"); // 10:00 in Rome, but not the plan's day
    await act(async () => {
      render(<GoPanel day={day} dayLabel="Day 1" rows={rows} onPosition={vi.fn()} onClose={vi.fn()} />);
    });
    expect(screen.getByText(/Preview — this day is 2026-05-14/)).toBeInTheDocument();
  });

  it("asks for location only on request, shows the distance, and stops watching on exit", async () => {
    at("2026-05-14T08:10:00Z");
    let success!: PositionCallback;
    const watchPosition = vi.fn((ok: PositionCallback) => {
      success = ok;
      return 7;
    });
    const clearWatch = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, geolocation: { watchPosition, clearWatch } });
    const onPosition = vi.fn();
    const { unmount } = await act(async () => render(<GoPanel day={day} dayLabel="Day 1" rows={rows} onPosition={onPosition} onClose={vi.fn()} />));
    expect(watchPosition).not.toHaveBeenCalled();
    expect(screen.getByText(/stays on this device/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📍 Show me on the map" }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    act(() => success({ coords: { latitude: 41.9035, longitude: 12.501, accuracy: 20 } } as GeolocationPosition));
    expect(onPosition).toHaveBeenLastCalledWith({ lat: 41.9035, lon: 12.501, accuracy: 20 });
    expect(screen.getByText(/to Termini/)).toHaveTextContent("280 m to Termini");
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing location" }));
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(onPosition).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "📍 Show me on the map" }));
    unmount();
    expect(clearWatch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("explains a blocked location", async () => {
    at("2026-05-14T08:10:00Z");
    const watchPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
      return 1;
    });
    vi.stubGlobal("navigator", { ...navigator, geolocation: { watchPosition, clearWatch: vi.fn() } });
    await act(async () => {
      render(<GoPanel day={day} dayLabel="Day 1" rows={rows} onPosition={vi.fn()} onClose={vi.fn()} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "📍 Show me on the map" }));
    expect(screen.getByText(/Location is blocked for this site/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
