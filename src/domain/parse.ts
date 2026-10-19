import { STEP_TYPES } from "./types";
import type { Trip } from "./types";
import { migrateTrip } from "./migrate";
import { validateTrip } from "./validate";

// Defensive parser for untrusted trip JSON (in-app uploads, localStorage).
// Structural pass first (shape + primitive types with readable paths), then
// the semantic invariants from validateTrip. Returns the typed trip only when
// both passes are clean. A v1 document (no `schemaVersion`) is migrated to v2
// first (migrate.ts), so every trip that leaves here is current — the store-wide
// pass in data/migrateStore.ts then writes migrated trips back.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseTrip(raw: unknown): { trip: Trip | null; errors: string[] } {
  const input = migrateTrip(raw).trip;
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 50) errors.push(m);
  };

  if (!isObj(input)) {
    return { trip: null, errors: ["root: expected a JSON object describing a Trip"] };
  }

  const checkStr = (o: Record<string, unknown>, k: string, where: string) => {
    if (typeof o[k] !== "string" || o[k] === "") err(`${where}.${k} must be a non-empty string`);
  };
  const checkNum = (o: Record<string, unknown>, k: string, where: string) => {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k])) err(`${where}.${k} must be a number`);
  };
  const checkArr = (o: Record<string, unknown>, k: string, where: string): unknown[] => {
    if (!Array.isArray(o[k])) {
      err(`${where}.${k} must be an array`);
      return [];
    }
    return o[k];
  };

  const checkPlace = (o: Record<string, unknown>, where: string) => {
    checkStr(o, "name", where);
    checkNum(o, "lat", where);
    checkNum(o, "lon", where);
    if (o.estimated !== undefined && typeof o.estimated !== "boolean") {
      err(`${where}.estimated, when present, must be a boolean`);
    }
  };
  const checkLine = (g: unknown, where: string) => {
    if (g === undefined || g === null) return;
    if (!Array.isArray(g)) {
      err(`${where} must be null or an array of [lat, lon] pairs`);
      return;
    }
    g.forEach((pt, gi) => {
      if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== "number" || typeof pt[1] !== "number") {
        err(`${where}[${gi}] must be a [lat, lon] number pair`);
      }
    });
  };

  checkStr(input, "id", "trip");
  checkStr(input, "name", "trip");
  if (input.uid !== undefined && (typeof input.uid !== "string" || input.uid === "")) {
    err("trip.uid, when present, must be a non-empty string");
  }
  if (input.schemaVersion !== 2) {
    err(`trip.schemaVersion ${String(input.schemaVersion)} is not supported (expected 2)`);
  }
  if (
    input.version !== undefined &&
    (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 0)
  ) {
    err("trip.version, when present, must be a non-negative integer");
  }

  for (const [i, p] of checkArr(input, "participants", "trip").entries()) {
    const where = `participants[${i}]`;
    if (!isObj(p)) {
      err(`${where} must be an object`);
      continue;
    }
    checkStr(p, "id", where);
    checkStr(p, "name", where);
  }

  const currencies = input.currencies;
  if (!isObj(currencies)) {
    err("trip.currencies must be an object with home/local/intl");
  } else {
    for (const k of ["home", "local", "intl"]) checkStr(currencies, k, "currencies");
  }

  for (const [i, d] of checkArr(input, "days", "trip").entries()) {
    const dw = `days[${i}]`;
    if (!isObj(d)) {
      err(`${dw} must be an object`);
      continue;
    }
    checkStr(d, "id", dw);
    checkStr(d, "date", dw);
    checkNum(d, "startTimeMin", dw);
    if (d.location !== undefined && d.location !== null) {
      if (!isObj(d.location)) {
        err(`${dw}.location must be null or an object with name/lat/lon`);
      } else {
        checkStr(d.location, "name", `${dw}.location`);
        checkNum(d.location, "lat", `${dw}.location`);
        checkNum(d.location, "lon", `${dw}.location`);
      }
    }
    for (const [j, s] of checkArr(d, "slots", dw).entries()) {
      const sw = `${dw}.slots[${j}]`;
      if (!isObj(s)) {
        err(`${sw} must be an object`);
        continue;
      }
      checkStr(s, "id", sw);
      checkStr(s, "title", sw);
      checkStr(s, "defaultVariantId", sw);
      if (s.checkpoint !== null) {
        if (!isObj(s.checkpoint)) {
          err(`${sw}.checkpoint must be null or an object`);
        } else {
          checkStr(s.checkpoint, "label", `${sw}.checkpoint`);
          checkNum(s.checkpoint, "timeMin", `${sw}.checkpoint`);
          checkNum(s.checkpoint, "bufferMin", `${sw}.checkpoint`);
          if (s.checkpoint.opensMin !== undefined && s.checkpoint.opensMin !== null) {
            checkNum(s.checkpoint, "opensMin", `${sw}.checkpoint`);
          }
        }
      }
      if (!isObj(s.place)) {
        err(`${sw}.place must be an object with name/lat/lon (required since schema v2)`);
      } else {
        checkPlace(s.place, `${sw}.place`);
      }
      for (const [k, v] of checkArr(s, "variants", sw).entries()) {
        const vw = `${sw}.variants[${k}]`;
        if (!isObj(v)) {
          err(`${vw} must be an object`);
          continue;
        }
        checkStr(v, "id", vw);
        checkStr(v, "name", vw);
        if (v.estimated !== undefined && typeof v.estimated !== "boolean") {
          err(`${vw}.estimated, when present, must be a boolean`);
        }
        if (!isObj(v.cost)) {
          err(`${vw}.cost must be an object with amount and currency`);
        } else {
          checkNum(v.cost, "amount", `${vw}.cost`);
          checkStr(v.cost, "currency", `${vw}.cost`);
        }
        for (const [l, ms] of checkArr(v, "microSteps", vw).entries()) {
          const mw = `${vw}.microSteps[${l}]`;
          if (!isObj(ms)) {
            err(`${mw} must be an object`);
            continue;
          }
          checkStr(ms, "id", mw);
          checkStr(ms, "label", mw);
          checkNum(ms, "durationMin", mw);
          if (!STEP_TYPES.includes(ms.type as (typeof STEP_TYPES)[number])) {
            err(`${mw}.type "${String(ms.type)}" must be one of: ${STEP_TYPES.join(", ")}`);
          }
          if (ms.distanceKm !== null && typeof ms.distanceKm !== "number") {
            err(`${mw}.distanceKm must be a number or null`);
          }
          if (
            ms.tzShiftMin !== undefined &&
            ms.tzShiftMin !== null &&
            typeof ms.tzShiftMin !== "number"
          ) {
            err(`${mw}.tzShiftMin must be a number (minutes) or absent`);
          }
          for (const k of ["from", "to"] as const) {
            if (ms[k] === undefined || ms[k] === null) continue;
            if (!isObj(ms[k])) err(`${mw}.${k} must be null or an object with name/lat/lon`);
            else checkPlace(ms[k], `${mw}.${k}`);
          }
          checkLine(ms.geometry, `${mw}.geometry`);
        }
      }
    }
  }

  for (const [i, e] of checkArr(input, "expenses", "trip").entries()) {
    const ew = `expenses[${i}]`;
    if (!isObj(e)) {
      err(`${ew} must be an object`);
      continue;
    }
    checkStr(e, "id", ew);
    checkStr(e, "label", ew);
    checkStr(e, "payerId", ew);
    checkStr(e, "currency", ew);
    checkNum(e, "amount", ew);
    if (e.estimated !== undefined && typeof e.estimated !== "boolean") {
      err(`${ew}.estimated, when present, must be a boolean`);
    }
    if (e.phase !== "pre-trip" && e.phase !== "mid-trip") {
      err(`${ew}.phase must be "pre-trip" or "mid-trip"`);
    }
    if (!isObj(e.split)) {
      err(`${ew}.split must be an object`);
    } else {
      const t = e.split.type;
      if (t !== "equal" && t !== "percent" && t !== "fixed") {
        err(`${ew}.split.type must be "equal", "percent" or "fixed"`);
      } else if (t !== "equal") {
        if (!isObj(e.split.shares)) {
          err(`${ew}.split.shares must be an object mapping participant ids to numbers`);
        } else {
          for (const [pid, share] of Object.entries(e.split.shares)) {
            if (typeof share !== "number") err(`${ew}.split.shares["${pid}"] must be a number`);
          }
        }
      }
    }
  }

  if (errors.length) return { trip: null, errors };

  const trip = input as unknown as Trip;
  const semantic = validateTrip(trip);
  if (semantic.length) return { trip: null, errors: semantic };
  // Preserve uid as-is: a present one is kept, an absent one stays absent so a
  // read never mints a new (unstable) uid. The client falls back to the logical
  // id via uidOf(); a persisted uid is stamped at creation/upload instead.
  return { trip, errors: [] };
}
