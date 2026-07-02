import type { CurrencyCode } from "./types";

// Exchange rates cached once at app init (would come from ECB feed).
// Stored as EUR-pivot; convert() cross-derives any pair client-side.
export type RateMatrix = Record<CurrencyCode, number>; // 1 EUR = x

export const RATES_EUR: RateMatrix = { EUR: 1, RON: 4.97, USD: 1.08 };

export const convert = (
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: RateMatrix = RATES_EUR
): number => (from === to ? amount : (amount / rates[from]) * rates[to]);

export const money = (amount: number, ccy: CurrencyCode): string =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 0,
  }).format(amount);
