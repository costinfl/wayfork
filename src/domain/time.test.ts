import { describe, expect, it } from "vitest";
import { fmtDur, fmtOffset, fmtTime } from "./time";

describe("fmtTime", () => {
  it("formats minutes since midnight as HH:MM", () => {
    expect(fmtTime(0)).toBe("00:00");
    expect(fmtTime(6 * 60 + 30)).toBe("06:30");
    expect(fmtTime(23 * 60 + 59)).toBe("23:59");
  });

  it("wraps past midnight and handles negatives", () => {
    expect(fmtTime(1440 + 60)).toBe("01:00");
    expect(fmtTime(-30)).toBe("23:30");
  });
});

describe("fmtDur", () => {
  it("formats sub-hour durations in minutes", () => {
    expect(fmtDur(45)).toBe("45m");
  });

  it("formats exact hours without a minutes part", () => {
    expect(fmtDur(60)).toBe("1h");
    expect(fmtDur(120)).toBe("2h");
  });

  it("formats mixed durations", () => {
    expect(fmtDur(90)).toBe("1h 30m");
    expect(fmtDur(62)).toBe("1h 2m");
  });
});

describe("fmtOffset", () => {
  it("formats signed offsets", () => {
    expect(fmtOffset(60)).toBe("+1h");
    expect(fmtOffset(-60)).toBe("−1h");
    expect(fmtOffset(-90)).toBe("−1h 30m");
    expect(fmtOffset(30)).toBe("+30m");
  });
});
