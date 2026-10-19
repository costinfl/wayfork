import { offsetArc } from "./geometry";
import { distanceM } from "./poi";
import type { TransitItinerary } from "./transit";
import type { MicroStep, Place, StepType, VariantNode } from "./types";

// How a variant actually travels from its origin to its slot's place, leg by
// leg, derived from its micro-steps — so the map follows footpaths for walks,
// roads for drives, the real transit lines for metro/tram/bus/train, and only
// draws an arc for flights. Steps that carry their own endpoints or geometry
// (schema v2, e.g. 🚆 Transit variants) become exact legs; runs of steps
// without endpoints are merged into one leg between the nearest known points.

export type LegProfile = "foot" | "driving" | "transit" | "arc";

export interface VariantLeg {
  from: Place;
  to: Place;
  profile: LegProfile;
  stored: [number, number][] | null; // the step's own geometry, drawn as-is
}

const STEP_PROFILE: Record<Exclude<StepType, "wait">, LegProfile> = {
  walk: "foot",
  car: "driving",
  shuttle: "driving",
  transfer: "driving",
  bus: "transit",
  metro: "transit",
  train: "transit",
  flight: "arc",
};

// A merged run of steps: a flight anywhere makes it an arc (there is no way
// to place the flight within the run); any public transport makes it a
// transit leg (a trip plan includes its walks); otherwise driving beats foot.
function combine(profiles: LegProfile[]): LegProfile {
  if (profiles.includes("arc")) return "arc";
  if (profiles.includes("transit")) return "transit";
  if (profiles.includes("driving")) return "driving";
  return "foot";
}

const same = (a: Place, b: Place) => a.lat === b.lat && a.lon === b.lon;
const pointPlace = ([lat, lon]: [number, number], name: string): Place => ({ name, lat, lon });
// Moving between two places with no step saying how (e.g. an all-wait slot
// that is elsewhere): walk short hops, drive further.
const implied = (a: Place, b: Place): LegProfile => (distanceM(a, b) <= 2500 ? "foot" : "driving");

export function variantLegs(v: VariantNode, from: Place, to: Place): VariantLeg[] {
  const legs: VariantLeg[] = [];
  let cursor = from;
  let pending: LegProfile[] = [];
  const flush = (target: Place) => {
    if (!same(cursor, target)) {
      legs.push({
        from: cursor,
        to: target,
        profile: pending.length ? combine(pending) : implied(cursor, target),
        stored: null,
      });
    }
    pending = [];
    cursor = target;
  };

  for (const step of v.microSteps as MicroStep[]) {
    if (step.type === "wait") continue;
    const profile = STEP_PROFILE[step.type];
    const geo = step.geometry && step.geometry.length >= 2 ? step.geometry : null;
    const start = step.from ?? (geo ? pointPlace(geo[0], step.label) : null);
    if (start && !same(start, cursor)) flush(start); // earlier steps end where this one starts
    if (geo) {
      const end = step.to ?? pointPlace(geo[geo.length - 1], step.label);
      pending = [];
      legs.push({ from: cursor, to: end, profile, stored: geo });
      cursor = end;
    } else if (step.to) {
      pending.push(profile);
      flush(step.to);
    } else {
      pending.push(profile);
    }
  }
  if (pending.length || !same(cursor, to)) flush(to);
  return legs;
}

// The line drawn for a leg before (or instead of) routing: its stored
// geometry, a bowed arc for flights, a straight placeholder otherwise.
export function provisionalLine(leg: VariantLeg, bend: number): [number, number][] {
  if (leg.stored) return leg.stored;
  if (leg.profile === "arc") return offsetArc(leg.from, leg.to, bend);
  return [
    [leg.from.lat, leg.from.lon],
    [leg.to.lat, leg.to.lon],
  ];
}

export const legKey = (l: VariantLeg): string =>
  `${l.profile}:${l.from.lat},${l.from.lon};${l.to.lat},${l.to.lon}`;

export interface LegRouters {
  route: (from: Place, to: Place, profile: "foot" | "driving") => Promise<[number, number][] | null>;
  transit: (from: Place, to: Place) => Promise<TransitItinerary | null>;
}

// Real geometry for a leg that needs routing, or null to keep its provisional
// line. Transit legs use a trip plan's leg lines (gaps bridged straight), and
// fall back to a road route when no plan exists.
export async function resolveLegLine(leg: VariantLeg, r: LegRouters): Promise<[number, number][] | null> {
  if (leg.stored || leg.profile === "arc") return null;
  if (leg.profile === "transit") {
    const plan = await r.transit(leg.from, leg.to);
    const line = plan?.legs.flatMap((l) =>
      l.line && l.line.length ? l.line : l.from && l.to ? [[l.from.lat, l.from.lon] as [number, number], [l.to.lat, l.to.lon] as [number, number]] : []
    );
    if (line && line.length >= 2) return line;
    return r.route(leg.from, leg.to, "driving");
  }
  return r.route(leg.from, leg.to, leg.profile);
}

// Runs async jobs at most `n` at a time — keeps a day's worth of leg lookups
// polite towards the keyless routing services.
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return <T>(job: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        job()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          })
      );
      next();
    });
}
