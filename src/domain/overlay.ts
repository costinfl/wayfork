import { convert, type RateMatrix } from "./currency";
import { offsetArc, slotMarkerNumbers, variantGeometry, variantProfile, type RouteProfile } from "./geometry";
import { variantDuration } from "./schedule";
import type { CurrencyCode, Place, Trip } from "./types";

// Whole-trip variant-comparison overlay for the map-first canvas: every
// variant of every slot as a drawable track (not just the selected day's
// active chain), each carrying what it would cost to switch to it — Δtime and
// Δcost against the slot's active variant — so forks can be compared on the
// map itself. Pure: the UI only upgrades active road/foot lines with OSRM.

export interface OverlayTrack {
  key: string; // `${slotId}:${variantId}` — the feature id on the map
  dayIdx: number;
  slotId: string;
  variantId: string;
  name: string;
  active: boolean;
  estimated: boolean; // the variant or either endpoint is unconfirmed
  profile: RouteProfile;
  stored: boolean; // drawn from the variant's own step geometry
  from: Place;
  to: Place;
  line: [number, number][]; // [lat, lon]
  labelAt: [number, number]; // where the comparison badge sits
  color: string;
  durationMin: number;
  cost: number; // in the overlay's view currency
  distanceKm: number | null;
  deltaMin: number; // vs the slot's active variant (0 for the active one)
  deltaCost: number;
}

export interface OverlayStop {
  slotId: string;
  dayIdx: number;
  number: number; // the day-local marker number (matches the timeline)
  title: string;
  place: Place;
  estimated: boolean;
}

export interface TripOverlay {
  tracks: OverlayTrack[];
  stops: OverlayStop[];
}

export const ACTIVE_COLOR = "#3b82f6";
// Alternatives get distinct hues in slot order, so two forks of the same slot
// never share a colour (wraps after five, which no real slot reaches).
export const ALT_COLORS = ["#f59e0b", "#a855f7", "#14b8a6", "#f43f5e", "#84cc16"];

const ARC_BEND = 0.16;
const samePlace = (a: Place, b: Place) => a.lat === b.lat && a.lon === b.lon;

const midpoint = (line: [number, number][]): [number, number] => line[Math.floor(line.length / 2)];

export function tripOverlay(
  trip: Trip,
  activeVariants: Record<string, string>,
  opts: { rates: RateMatrix; ccy: CurrencyCode }
): TripOverlay {
  const tracks: OverlayTrack[] = [];
  const stops: OverlayStop[] = [];
  // Carried across days so day N's first slot connects from day N−1's last.
  let prev: Place | null = null;

  trip.days.forEach((day, dayIdx) => {
    const numbers = slotMarkerNumbers(day);
    for (const slot of day.slots) {
      const to = slot.place;
      stops.push({
        slotId: slot.id,
        dayIdx,
        number: numbers.get(slot.id) ?? 0,
        title: slot.title,
        place: to,
        estimated: !!to.estimated,
      });
      const from = prev ?? to;
      prev = to;

      const activeId = activeVariants[slot.id] ?? slot.defaultVariantId;
      const active = slot.variants.find((v) => v.id === activeId) ?? slot.variants[0];
      const costOf = (v: typeof active) => convert(v.cost.amount, v.cost.currency, opts.ccy, opts.rates);
      const baseMin = variantDuration(active);
      const baseCost = costOf(active);

      let altIdx = 0;
      for (const v of slot.variants) {
        const isActive = v.id === active.id;
        const stored = variantGeometry(v);
        const profile = variantProfile(v);
        if (!stored && samePlace(from, to)) continue; // nothing to draw (origin, or stayed put)

        let line: [number, number][];
        if (stored) {
          line = stored;
        } else if (isActive && profile !== "arc") {
          line = [
            [from.lat, from.lon],
            [to.lat, to.lon],
          ]; // straight until the UI resolves real road/foot geometry
        } else {
          // Alternatives bow to alternating sides so sibling forks separate;
          // the active arc (rail/air) bows a little so it doesn't read as a bee-line.
          const bend = isActive
            ? ARC_BEND
            : (altIdx % 2 === 0 ? 1 : -1) * ARC_BEND * (1 + Math.floor(altIdx / 2));
          line = offsetArc(from, to, bend);
        }
        const distances = v.microSteps.map((m) => m.distanceKm).filter((d): d is number => d !== null);
        const durationMin = variantDuration(v);
        const cost = costOf(v);
        tracks.push({
          key: `${slot.id}:${v.id}`,
          dayIdx,
          slotId: slot.id,
          variantId: v.id,
          name: v.name,
          active: isActive,
          estimated: !!v.estimated || !!from.estimated || !!to.estimated,
          profile,
          stored: !!stored,
          from,
          to,
          line,
          labelAt: midpoint(line),
          color: isActive ? ACTIVE_COLOR : ALT_COLORS[altIdx % ALT_COLORS.length],
          durationMin,
          cost,
          distanceKm: distances.length ? Math.round(distances.reduce((s, d) => s + d, 0) * 10) / 10 : null,
          deltaMin: durationMin - baseMin,
          deltaCost: cost - baseCost,
        });
        if (!isActive) altIdx++;
      }
    }
  });
  return { tracks, stops };
}

const signed = (n: number, unit: string) => (n > 0 ? `+${n}${unit}` : n < 0 ? `−${-n}${unit}` : "");

// The comparison badge on an alternative: "+25 min · +€12", "−10 min", "same".
export function deltaLabel(t: Pick<OverlayTrack, "deltaMin" | "deltaCost">, ccy: CurrencyCode): string {
  const symbol =
    new Intl.NumberFormat("en", { style: "currency", currency: ccy, maximumFractionDigits: 0 })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? ccy;
  const min = signed(Math.round(t.deltaMin), " min");
  const c = Math.round(t.deltaCost);
  const cost = c > 0 ? `+${symbol}${c}` : c < 0 ? `−${symbol}${-c}` : "";
  return [min, cost].filter(Boolean).join(" · ") || "same";
}
