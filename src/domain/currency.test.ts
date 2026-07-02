import { describe, expect, it } from "vitest";
import { convert, money } from "./currency";

describe("convert", () => {
  it("returns the amount unchanged for identical currencies", () => {
    expect(convert(123.45, "EUR", "EUR")).toBe(123.45);
  });

  it("converts through the EUR pivot", () => {
    expect(convert(4.97, "RON", "EUR")).toBeCloseTo(1);
    expect(convert(1, "EUR", "USD")).toBeCloseTo(1.08);
  });

  it("cross-derives non-EUR pairs", () => {
    // 4.97 RON = 1 EUR = 1.08 USD
    expect(convert(4.97, "RON", "USD")).toBeCloseTo(1.08);
  });

  it("round-trips within floating point tolerance", () => {
    expect(convert(convert(250, "RON", "USD"), "USD", "RON")).toBeCloseTo(250);
  });
});

describe("money", () => {
  it("formats whole currency amounts", () => {
    expect(money(1234.56, "EUR")).toBe("€1,235");
  });
});
