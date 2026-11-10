import type { ScheduleRow } from "./schedule";
import type { MicroStep, Place } from "./types";

// "Go" mode: where the plan says you should be right now, and what's next.
// Each step gets its wall-clock window as planned (local minutes since the
// day's midnight, possibly past 1440, clock changes applied where they
// happen) and the same window on the day-start zone's clock, which is what
// "now" is compared against — so a flight that turns the clocks back an hour
// doesn't put the rest of the day an hour off.

export interface GoStep {
  slotId: string;
  slotTitle: string;
  step: MicroStep;
  start: number; // local (as planned)
  end: number;
  shift: number; // clock change before this step, relative to the day's start zone
  // Where this step happens / ends: its own endpoints, else the stop's place.
  from: Place | null;
  to: Place;
}

export function dayTimeline(rows: ScheduleRow[]): GoStep[] {
  const out: GoStep[] = [];
  let prevPlace: Place | null = null;
  for (const r of rows) {
    let cursor = r.start;
    let shift = r.tzOffsetMin;
    for (const step of r.variant.microSteps) {
      const end = cursor + step.durationMin + (step.tzShiftMin ?? 0);
      out.push({
        slotId: r.slot.id,
        slotTitle: r.slot.title,
        step,
        start: cursor,
        end,
        shift,
        from: step.from ?? prevPlace,
        to: step.to ?? r.slot.place,
      });
      prevPlace = step.to ?? prevPlace;
      cursor = end;
      shift += step.tzShiftMin ?? 0;
    }
    prevPlace = r.slot.place;
  }
  return out;
}

export interface GoStatus {
  current: GoStep | null; // the step under way now
  next: GoStep | null; // the one after it (or the first, before the day starts)
  minutesToNext: number | null;
  done: boolean; // the whole day is behind us
}

// The window on the day-start zone's clock (a step's own shift is spread
// over it: it ends where the next one starts).
const absStart = (s: GoStep) => s.start - s.shift;
const absEnd = (s: GoStep) => s.end - s.shift - (s.step.tzShiftMin ?? 0);

// `now`: minutes on the day-start zone's clock.
export function goStatus(timeline: GoStep[], now: number): GoStatus {
  const i = timeline.findIndex((s) => now >= absStart(s) && now < absEnd(s));
  const current = i >= 0 ? timeline[i] : null;
  const next = i >= 0 ? timeline[i + 1] ?? null : timeline.find((s) => absStart(s) > now) ?? null;
  return {
    current,
    next,
    minutesToNext: next ? absStart(next) - now : null,
    done: !current && !next && timeline.length > 0,
  };
}

// The local date and minutes-since-midnight at `now` in `tz` (else estimated
// from the longitude, 15° per hour).
export function localNow(now: Date, tz: string | null, lon: number): { date: string; minutes: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(now);
      const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
      return { date: `${v("year")}-${v("month")}-${v("day")}`, minutes: Number(v("hour")) * 60 + Number(v("minute")) };
    } catch {
      /* unknown zone: fall through */
    }
  }
  const t = new Date(now.getTime() + Math.round(lon / 15) * 3_600_000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// Minutes on the day's own clock: the local time, plus 1440 when it is already
// the day after (a plan running past midnight). `preview` when today is not
// the plan's day — the timeline is then followed at today's time of day.
export function dayClock(dayDate: string, local: { date: string; minutes: number }): { minutes: number; preview: boolean } {
  const days = Math.round((Date.parse(`${local.date}T00:00:00Z`) - Date.parse(`${dayDate}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return { minutes: local.minutes, preview: false };
  if (days === 1 && local.minutes < 360) return { minutes: local.minutes + 1440, preview: false };
  return { minutes: local.minutes, preview: true };
}
