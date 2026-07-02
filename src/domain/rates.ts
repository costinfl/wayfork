import type { RateMatrix } from "./currency";

// Live EUR-pivot rates from the ECB via the free Frankfurter API.
// Fetched once at app load; callers fall back to the built-in RATES_EUR
// snapshot when this fails (offline, blocked, API change).
export interface LiveRates {
  rates: RateMatrix;
  date: string; // ECB reference date, e.g. "2026-07-02"
}

export async function fetchRatesEUR(
  codes: string[],
  fetchFn: typeof fetch = fetch
): Promise<LiveRates> {
  const symbols = [...new Set(codes)].filter((c) => c !== "EUR");
  const res = await fetchFn(`https://api.frankfurter.dev/v1/latest?symbols=${symbols.join(",")}`);
  if (!res.ok) throw new Error(`rates fetch failed: HTTP ${res.status}`);
  const body: unknown = await res.json();
  const rawRates =
    typeof body === "object" && body !== null
      ? (body as { rates?: unknown; date?: unknown })
      : {};
  const rates: RateMatrix = { EUR: 1 };
  for (const c of symbols) {
    const v =
      typeof rawRates.rates === "object" && rawRates.rates !== null
        ? (rawRates.rates as Record<string, unknown>)[c]
        : undefined;
    if (typeof v !== "number" || !(v > 0)) throw new Error(`no usable rate for ${c}`);
    rates[c] = v;
  }
  return { rates, date: typeof rawRates.date === "string" ? rawRates.date : "" };
}
