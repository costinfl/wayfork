import type { Place } from "./types";

// Turn-by-turn for a walking or driving leg (OSRM `steps=true`, the same
// FOSSGIS servers as route.ts), fetched on demand and never stored — plus a
// hand-off link to a navigation app for the leg.

export interface DirectionStep {
  text: string; // "Turn left onto Via Cavour"
  distanceM: number;
}

interface RawStep {
  name?: string;
  distance?: number;
  maneuver?: { type?: string; modifier?: string };
}

const onto = (name: string | undefined) => (name ? ` onto ${name}` : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function instruction(s: RawStep): string | null {
  const type = s.maneuver?.type ?? "";
  const mod = s.maneuver?.modifier ?? "";
  const name = s.name || undefined;
  switch (type) {
    case "depart":
      return `Head ${mod && mod !== "straight" ? mod : "off"}${name ? ` on ${name}` : ""}`;
    case "arrive":
      return `Arrive${name ? ` at ${name}` : ""}`;
    case "roundabout":
    case "rotary":
      return `Take the roundabout${onto(name)}`;
    case "continue":
    case "new name":
      return `Continue${mod && mod !== "straight" ? ` ${mod}` : ""}${onto(name)}`;
    case "turn":
    case "end of road":
    case "fork":
    case "on ramp":
    case "off ramp":
    case "merge": {
      const dir = mod === "straight" ? "Go straight" : mod.startsWith("slight") || type === "fork" ? `Keep ${mod.replace("slight ", "")}` : `Turn ${mod}`;
      return mod ? `${dir}${onto(name)}` : `${cap(type)}${onto(name)}`;
    }
    default:
      return mod ? `${cap(mod)}${onto(name)}` : null;
  }
}

// Steps from an OSRM route response, consecutive tiny unnamed steps kept as is
// (they matter on foot); [] when there are none.
export function parseOsrmSteps(body: unknown): DirectionStep[] {
  const steps = (body as { routes?: { legs?: { steps?: RawStep[] }[] }[] } | null)?.routes?.[0]?.legs?.[0]?.steps;
  if (!Array.isArray(steps)) return [];
  const out: DirectionStep[] = [];
  for (const s of steps) {
    const text = instruction(s);
    if (text) out.push({ text, distanceM: Math.round(s.distance ?? 0) });
  }
  return out;
}

export async function fetchDirections(
  from: Place,
  to: Place,
  profile: "foot" | "driving",
  fetchFn: typeof fetch = fetch
): Promise<DirectionStep[] | null> {
  const url =
    `https://routing.openstreetmap.de/routed-${profile === "foot" ? "foot" : "car"}/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&steps=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return null;
    const steps = parseOsrmSteps(await res.json());
    return steps.length ? steps : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const fmtDistance = (m: number): string =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;

// A universal directions link (opens Google Maps' app or site; other map apps
// register for it on most phones).
export function mapsLink(from: Place, to: Place, mode: "walking" | "driving" | "transit"): string {
  const p = (x: Place) => `${x.lat.toFixed(6)},${x.lon.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${p(from)}&destination=${p(to)}&travelmode=${mode}`;
}
