import { describe, expect, it } from "vitest";
import { fetchRatesEUR } from "./rates";

const fakeFetch = (status: number, body: unknown) =>
  (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;

describe("fetchRatesEUR", () => {
  it("builds an EUR-pivot matrix from the API response", async () => {
    const fetchFn = fakeFetch(200, { date: "2026-07-02", rates: { RON: 5.03, USD: 1.11 } });
    const { rates, date } = await fetchRatesEUR(["RON", "EUR", "USD"], fetchFn);
    expect(rates).toEqual({ EUR: 1, RON: 5.03, USD: 1.11 });
    expect(date).toBe("2026-07-02");
  });

  it("requests each non-EUR code exactly once", async () => {
    let url = "";
    const fetchFn = (async (u: RequestInfo | URL) => {
      url = String(u);
      return { ok: true, status: 200, json: async () => ({ rates: { RON: 5, USD: 1.1 } }) } as Response;
    }) as unknown as typeof fetch;
    await fetchRatesEUR(["RON", "USD", "RON", "EUR"], fetchFn);
    expect(url).toContain("symbols=RON,USD");
  });

  it("rejects on HTTP errors", async () => {
    await expect(fetchRatesEUR(["RON"], fakeFetch(503, {}))).rejects.toThrow("HTTP 503");
  });

  it("rejects when a requested rate is missing or unusable", async () => {
    await expect(
      fetchRatesEUR(["RON", "USD"], fakeFetch(200, { rates: { RON: 5.03 } }))
    ).rejects.toThrow("no usable rate for USD");
    await expect(
      fetchRatesEUR(["RON"], fakeFetch(200, { rates: { RON: "5.03" } }))
    ).rejects.toThrow("no usable rate for RON");
  });
});
