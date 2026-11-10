// A deliberately small reader for OSM `opening_hours`: the common forms only
// ("24/7", "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off", several time ranges,
// ranges past midnight). Anything else (holidays, months, sunrise, week
// numbers, comments…) answers null — "don't know" — so no false warnings.

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
type Range = [number, number]; // minutes since midnight; end may exceed 1440

const toMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 ? h * 60 + min : null;
};

function parseDays(sel: string): number[] | null {
  const out: number[] = [];
  for (const part of sel.split(",")) {
    const [a, b] = part.split("-");
    const i = DAYS.indexOf(a);
    const j = b === undefined ? i : DAYS.indexOf(b);
    if (i < 0 || j < 0) return null;
    for (let d = i; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === j) break;
    }
  }
  return out;
}

function parseTimes(spec: string): Range[] | null {
  const out: Range[] = [];
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-");
    const from = toMin(a ?? "");
    let to = toMin(b ?? "");
    if (from === null || to === null) return null;
    if (to <= from) to += 1440; // past midnight
    out.push([from, to]);
  }
  return out;
}

// Weekly schedule: for each day (0 = Monday) its open ranges; null when the
// spec uses anything this reader does not understand.
export function parseOpeningHours(spec: string): Range[][] | null {
  const s = spec.trim();
  if (!s) return null;
  if (s === "24/7") return DAYS.map(() => [[0, 1440]]);
  const week: Range[][] = DAYS.map(() => []);
  for (const raw of s.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    const m = /^(?:([A-Za-z,-]+)\s+)?(.+)$/.exec(rule);
    if (!m) return null;
    let [, daySel, rest] = m;
    // "Mo-Fr" alone with "off" etc. — or a rule that is only times.
    if (!daySel && /^[A-Z][a-z]([,-][A-Z][a-z])*$/.test(rest)) return null;
    const days = daySel ? parseDays(daySel) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    rest = rest.trim();
    const ranges = rest === "off" || rest === "closed" ? [] : parseTimes(rest.replace(/\s+/g, ""));
    if (!ranges) return null;
    for (const d of days) week[d] = ranges; // a later rule replaces earlier ones for its days
  }
  return week;
}

// Open at `minutes` (local) on `weekday` (0 = Monday)? null = unknown.
export function isOpenAt(spec: string, weekday: number, minutes: number): boolean | null {
  const week = parseOpeningHours(spec);
  if (!week) return null;
  const today = week[weekday].some(([a, b]) => minutes >= a && minutes < b);
  // A range from yesterday that runs past midnight.
  const yesterday = week[(weekday + 6) % 7].some(([, b]) => b > 1440 && minutes + 1440 < b);
  return today || yesterday;
}

// Monday-based weekday of an ISO date.
export const weekdayOf = (isoDate: string): number => (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
