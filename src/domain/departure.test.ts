/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fetchTimeZone, slotDeparture, timetableDate, zonedToUtc } from "./departure";

const iso = (d: Date) => d.toISOString().replace(/\.000Z$/, "Z");

describe("zonedToUtc", () => {
  it("applies the zone's offset, DST included", () => {
    expect(iso(zonedToUtc("2026-07-15", 14 * 60 + 30, "Europe/Rome", 12.5))).toBe("2026-07-15T12:30:00Z");
    expect(iso(zonedToUtc("2026-01-15", 14 * 60 + 30, "Europe/Rome", 12.5))).toBe("2026-01-15T13:30:00Z");
    expect(iso(zonedToUtc("2026-07-15", 9 * 60, "Asia/Kolkata", 77))).toBe("2026-07-15T03:30:00Z");
  });

  it("rolls minutes past midnight into the next day", () => {
    expect(iso(zonedToUtc("2026-07-15", 25 * 60, "Europe/Rome", 12.5))).toBe("2026-07-15T23:00:00Z");
  });

  it("estimates from the longitude without a zone", () => {
    expect(iso(zonedToUtc("2026-07-15", 12 * 60, null, 26.1))).toBe("2026-07-15T10:00:00Z");
    expect(iso(zonedToUtc("2026-07-15", 12 * 60, "Not/AZone", -74))).toBe("2026-07-15T17:00:00Z");
  });
});

describe("timetableDate", () => {
  const today = new Date("2026-10-21T09:00:00Z"); // a Wednesday

  it("keeps a date within the published horizon", () => {
    expect(timetableDate("2026-10-21", today)).toEqual({ date: "2026-10-21", projected: false });
    expect(timetableDate("2026-11-10", today)).toEqual({ date: "2026-11-10", projected: false });
  });

  it("projects past and far-future dates onto the next same weekday", () => {
    expect(timetableDate("2026-05-16", today)).toEqual({ date: "2026-10-24", projected: true }); // Sat
    expect(timetableDate("2026-05-13", today)).toEqual({ date: "2026-10-21", projected: true }); // Wed
    expect(timetableDate("2027-03-01", today)).toEqual({ date: "2026-10-26", projected: true }); // Mon
  });
});

describe("slotDeparture", () => {
  const now = new Date("2026-10-21T09:00:00Z");
  const rome = { name: "Rome", lat: 41.9, lon: 12.5 };

  it("labels the planned weekday and time, in the place's zone", () => {
    const dep = slotDeparture(rome, "2026-10-24", 14 * 60 + 30, "Europe/Rome", now);
    expect(dep).toMatchObject({ label: "Sat 14:30", projected: false });
    expect(iso(dep.time)).toBe("2026-10-24T12:30:00Z");
  });

  it("says when it uses a stand-in timetable", () => {
    const dep = slotDeparture(rome, "2026-05-16", 18 * 60, "Europe/Rome", now);
    expect(dep.label).toBe("Sat 18:00 (timetable of 24 Oct)");
    expect(iso(dep.time)).toBe("2026-10-24T16:00:00Z");
  });

  it("an after-midnight time belongs to the next day", () => {
    const dep = slotDeparture(rome, "2026-10-23", 24 * 60 + 30, "Europe/Rome", now);
    expect(dep.label).toBe("Sat 00:30");
    expect(iso(dep.time)).toBe("2026-10-23T22:30:00Z");
  });
});

describe("fetchTimeZone", () => {
  const ok = (tz: unknown) => vi.fn(async () => new Response(JSON.stringify({ timezone: tz })));

  it("reads the zone, caching it for the area", async () => {
    const f = ok("Europe/Rome");
    expect(await fetchTimeZone({ lat: 41.9, lon: 12.5 }, f)).toBe("Europe/Rome");
    expect(await fetchTimeZone({ lat: 41.93, lon: 12.48 }, f)).toBe("Europe/Rome");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("timezone=auto");
    expect(JSON.parse(localStorage.getItem("wayfork.tz")!)).toMatchObject({ "41.9,12.5": "Europe/Rome" });
  });

  it("shares one request between concurrent callers", async () => {
    const f = ok("Europe/Lisbon");
    const [a, b] = await Promise.all([
      fetchTimeZone({ lat: 38.7, lon: -9.1 }, f),
      fetchTimeZone({ lat: 38.7, lon: -9.1 }, f),
    ]);
    expect([a, b]).toEqual(["Europe/Lisbon", "Europe/Lisbon"]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("is null on failure or a bogus zone, and retries later", async () => {
    expect(await fetchTimeZone({ lat: 10, lon: 10 }, vi.fn(async () => new Response("", { status: 500 })))).toBeNull();
    expect(await fetchTimeZone({ lat: 10, lon: 10 }, ok("Nowhere/Land"))).toBeNull();
    expect(await fetchTimeZone({ lat: 10, lon: 10 }, vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
    expect(await fetchTimeZone({ lat: 10, lon: 10 }, ok("Africa/Lagos"))).toBe("Africa/Lagos");
  });
});
