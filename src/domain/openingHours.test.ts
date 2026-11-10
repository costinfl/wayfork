import { describe, expect, it } from "vitest";
import { isOpenAt, parseOpeningHours, weekdayOf } from "./openingHours";

const at = (h: number, m = 0) => h * 60 + m;

describe("opening hours", () => {
  it("reads the common forms", () => {
    const spec = "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off";
    expect(isOpenAt(spec, 0, at(9))).toBe(true);
    expect(isOpenAt(spec, 4, at(18))).toBe(false);
    expect(isOpenAt(spec, 5, at(13, 59))).toBe(true);
    expect(isOpenAt(spec, 6, at(12))).toBe(false);
    expect(isOpenAt("24/7", 3, at(3))).toBe(true);
    expect(isOpenAt("08:30-19:15", 6, at(19))).toBe(true); // no days = every day
  });

  it("handles split hours, day lists, wrap-around ranges and later overrides", () => {
    const lunch = "Tu-Su 09:00-12:30,14:00-19:00";
    expect(isOpenAt(lunch, 2, at(13))).toBe(false);
    expect(isOpenAt(lunch, 2, at(15))).toBe(true);
    expect(isOpenAt(lunch, 0, at(10))).toBe(false); // Monday not listed
    expect(isOpenAt("Sa,Su 10:00-16:00", 6, at(11))).toBe(true);
    expect(isOpenAt("Fr-Mo 10:00-16:00", 0, at(11))).toBe(true); // wraps the week
    const bar = "Mo-Su 18:00-02:00";
    expect(isOpenAt(bar, 2, at(23))).toBe(true);
    expect(isOpenAt(bar, 3, at(1, 30))).toBe(true); // Wednesday night, after midnight
    expect(isOpenAt(bar, 3, at(3))).toBe(false);
    expect(isOpenAt("Mo-Su 09:00-17:00; We off", 2, at(10))).toBe(false);
  });

  it("is unknown (null) for anything beyond the common forms", () => {
    for (const spec of ["Mo-Fr 09:00-18:00; PH off", "Apr-Oct: 09:00-19:00", "sunrise-sunset", "by appointment", "", "Mo-Fr"]) {
      expect(parseOpeningHours(spec)).toBeNull();
      expect(isOpenAt(spec, 0, at(10))).toBeNull();
    }
  });

  it("weekday is Monday-based", () => {
    expect(weekdayOf("2026-11-09")).toBe(0); // a Monday
    expect(weekdayOf("2026-11-15")).toBe(6);
  });
});
