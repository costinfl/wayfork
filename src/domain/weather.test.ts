import { describe, expect, it } from "vitest";
import type { VariantNode } from "./types";
import { exposedMinutes, fetchDayWeather, weatherIcon } from "./weather";

const loc = { name: "Rome", lat: 41.9, lon: 12.5 };

const stub = (status: number, body: unknown) =>
  (async () =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response) as unknown as typeof fetch;

describe("fetchDayWeather", () => {
  it("maps the Open-Meteo daily arrays to a DayWeather", async () => {
    const fetchFn = stub(200, {
      daily: {
        weather_code: [61],
        temperature_2m_max: [18.4],
        temperature_2m_min: [11.2],
        precipitation_probability_max: [70],
      },
    });
    const w = await fetchDayWeather(loc, "2026-05-14", fetchFn);
    expect(w).toEqual({ code: 61, tMax: 18.4, tMin: 11.2, precipProb: 70 });
  });

  it("returns null when the date is out of forecast range (non-ok)", async () => {
    expect(await fetchDayWeather(loc, "2030-01-01", stub(400, {}))).toBeNull();
  });

  it("returns null on a malformed body instead of throwing", async () => {
    expect(await fetchDayWeather(loc, "2026-05-14", stub(200, { daily: {} }))).toBeNull();
  });

  it("defaults precipitation to 0 when the field is missing", async () => {
    const fetchFn = stub(200, {
      daily: { weather_code: [0], temperature_2m_max: [25], temperature_2m_min: [14] },
    });
    const w = await fetchDayWeather(loc, "2026-05-14", fetchFn);
    expect(w?.precipProb).toBe(0);
  });
});

describe("weatherIcon", () => {
  it("buckets WMO codes into icons", () => {
    expect(weatherIcon(0).label).toBe("clear");
    expect(weatherIcon(3).label).toBe("overcast");
    expect(weatherIcon(63).label).toBe("rain");
    expect(weatherIcon(95).label).toBe("thunderstorm");
  });
});

describe("exposedMinutes", () => {
  const v: VariantNode = {
    id: "v",
    name: "walky",
    cost: { amount: 0, currency: "EUR" },
    microSteps: [
      { id: "1", type: "walk", label: "a", durationMin: 9, distanceKm: 0.7 },
      { id: "2", type: "metro", label: "b", durationMin: 30, distanceKm: null },
      { id: "3", type: "walk", label: "c", durationMin: 6, distanceKm: null },
    ],
  };
  it("sums only walking legs", () => {
    expect(exposedMinutes(v)).toBe(15);
  });
});
