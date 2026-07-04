import type { DayLocation, VariantNode } from "./types";

// Daily forecast per day location via the free Open-Meteo API (no key).
// Forecasts only exist ~16 days out; anything beyond resolves to null and
// the UI shows no weather — same graceful degradation as the ECB rates.

export interface DayWeather {
  code: number; // WMO weather code
  tMax: number;
  tMin: number;
  precipProb: number; // 0-100
}

export async function fetchDayWeather(
  loc: DayLocation,
  date: string,
  fetchFn: typeof fetch = fetch
): Promise<DayWeather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null; // date out of forecast range, or API hiccup
    const body = (await res.json()) as {
      daily?: Record<string, unknown[]>;
    };
    const d = body?.daily;
    const code = d?.weather_code?.[0];
    const tMax = d?.temperature_2m_max?.[0];
    const tMin = d?.temperature_2m_min?.[0];
    const precip = d?.precipitation_probability_max?.[0];
    if (typeof code !== "number" || typeof tMax !== "number" || typeof tMin !== "number") {
      return null;
    }
    return { code, tMax, tMin, precipProb: typeof precip === "number" ? precip : 0 };
  } catch {
    return null;
  }
}

// WMO weather code → icon + label buckets.
export function weatherIcon(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀️", label: "clear" };
  if (code <= 2) return { icon: "🌤", label: "partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "overcast" };
  if (code <= 48) return { icon: "🌫", label: "fog" };
  if (code <= 57) return { icon: "🌦", label: "drizzle" };
  if (code <= 67) return { icon: "🌧", label: "rain" };
  if (code <= 77) return { icon: "🌨", label: "snow" };
  if (code <= 82) return { icon: "🌧", label: "rain showers" };
  if (code <= 86) return { icon: "🌨", label: "snow showers" };
  return { icon: "⛈", label: "thunderstorm" };
}

// Minutes a variant spends outdoors — its weather exposure. Walking legs are
// the exposed step type; transit/waiting are treated as covered.
export const exposedMinutes = (v: VariantNode): number =>
  v.microSteps.filter((ms) => ms.type === "walk").reduce((s, ms) => s + ms.durationMin, 0);

// Rain risk threshold at which exposed variants get flagged in the UI.
export const RAIN_RISK_THRESHOLD = 40;
