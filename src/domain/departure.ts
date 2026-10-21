import type { Place } from "./types";

// When a planned move actually departs, as an instant: a slot's local
// minutes on its day, in the place's own time zone, moved onto a date whose
// timetable Transitous can know. Trip data carries no IANA zone, so it is
// looked up once per area (Open-Meteo, keyless) with a longitude estimate as
// the fallback.

const TZ_KEY = "wayfork.tz";
const DAY_MS = 86_400_000;

const tzCache = new Map<string, string | null>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(TZ_KEY) ?? "{}") as Record<string, string>);
    } catch {
      return [];
    }
  })()
);
const tzInFlight = new Map<string, Promise<string | null>>();
const tzKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;

// The IANA zone at a place ("Europe/Rome"), or null when the lookup fails.
// Cached per ~10 km area, across visits.
export function fetchTimeZone(place: { lat: number; lon: number }, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const key = tzKey(place);
  const known = tzCache.get(key);
  if (known) return Promise.resolve(known);
  const pending = tzInFlight.get(key);
  if (pending) return pending;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&timezone=auto&forecast_days=1`;
  const job = (async () => {
    try {
      const res = await fetchFn(url);
      if (!res.ok) return null;
      const tz = ((await res.json()) as { timezone?: unknown })?.timezone;
      if (typeof tz !== "string" || !validZone(tz)) return null;
      tzCache.set(key, tz);
      try {
        const saved = Object.fromEntries([...tzCache].filter(([, v]) => v));
        localStorage.setItem(TZ_KEY, JSON.stringify(saved));
      } catch {
        /* per-session only */
      }
      return tz;
    } catch {
      return null;
    } finally {
      tzInFlight.delete(key);
    }
  })();
  tzInFlight.set(key, job);
  return job;
}

const validZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Minutes the zone is ahead of UTC at `instant`.
function offsetMin(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

// Local wall time (date + minutes since its midnight; minutes may run past
// 24 h or below 0) in `tz` → the UTC instant. Without a zone, the offset is
// estimated from the longitude (15° per hour).
export function zonedToUtc(date: string, minutes: number, tz: string | null, lon: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d) + minutes * 60_000;
  if (!tz || !validZone(tz)) return new Date(wall - Math.round(lon / 15) * 3_600_000);
  // Two passes: the offset at the guess, then at the corrected instant (DST).
  let utc = wall - offsetMin(wall, tz) * 60_000;
  utc = wall - offsetMin(utc, tz) * 60_000;
  return new Date(utc);
}

const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

// The date to query timetables for: the trip's own date while it is within
// the published horizon, else the next date (from today) on the same weekday
// — same weekday and time of day is the closest stand-in.
export function timetableDate(
  date: string,
  today: Date,
  horizonDays = 28
): { date: string; projected: boolean } {
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  if (target >= t0 && target <= t0 + horizonDays * DAY_MS) return { date, projected: false };
  const ahead = (new Date(target).getUTCDay() - new Date(t0).getUTCDay() + 7) % 7;
  return { date: isoDate(t0 + ahead * DAY_MS), projected: true };
}

export interface SlotDeparture {
  time: Date;
  label: string; // e.g. "Sat 14:30" or "Sat 14:30 (timetable of 24 Oct)"
  projected: boolean;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A planned departure from `place` at local `minutes` on `date`.
export function slotDeparture(place: Place, date: string, minutes: number, tz: string | null, now: Date): SlotDeparture {
  // Minutes past midnight belong to the next day(s): weekday and projection follow.
  const dayOffset = Math.floor(minutes / 1440);
  const [y, m, d] = date.split("-").map(Number);
  const actualDate = isoDate(Date.UTC(y, m - 1, d) + dayOffset * DAY_MS);
  const mins = minutes - dayOffset * 1440;
  const { date: queryDate, projected } = timetableDate(actualDate, now);
  const wd = WEEKDAY[new Date(`${actualDate}T00:00:00Z`).getUTCDay()];
  const hhmm = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const [, qm, qd] = queryDate.split("-").map(Number);
  return {
    time: zonedToUtc(queryDate, mins, tz, place.lon),
    label: projected ? `${wd} ${hhmm} (timetable of ${qd} ${MONTH[qm - 1]})` : `${wd} ${hhmm}`,
    projected,
  };
}
