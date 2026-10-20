import { useState } from "react";
import { tripProgress, type LiveMode, type TripDetails, type TripStop } from "../../domain/liveTransit";

// The info card for a tapped live vehicle: line, direction, live/delay status,
// next and final stop with local times, accessibility, alerts, and the full
// stop list. Rendered in the map's toolbar column (see TripMap.tsx).

export const MODE_ICON: Record<LiveMode, string> = {
  metro: "🚇",
  tram: "🚊",
  bus: "🚌",
  trolleybus: "🚎",
  rail: "🚆",
  ferry: "⛴️",
  other: "🚐",
};

export interface VehicleSummary {
  tripId: string;
  name: string;
  mode: LiveMode;
  color: string;
}

// What "Use in my plan" asks the planner to do with the ride.
export type UseTripTarget = { kind: "slot"; afterSlotId: string | null } | { kind: "variant"; slotId: string };
export interface UseTripRequest {
  details: TripDetails;
  fromIdx: number;
  toIdx: number;
  target: UseTripTarget;
}

export interface CardTheme {
  bg: string;
  fg: string;
  border: string;
}

// Clock time in the stop's own zone (a trip abroad shows local times).
export function stopTime(t: number | undefined, tz?: string): string {
  if (t === undefined) return "—";
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, ...(tz ? { timeZone: tz } : {}) }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts).format(t); // unknown zone name
  }
}

const arrivalOf = (s: TripStop) => s.arrival ?? s.departure ?? s.scheduledArrival ?? s.scheduledDeparture;
const stopDelay = (s: TripStop): number | null => {
  const real = s.arrival ?? s.departure;
  const sched = s.scheduledArrival ?? s.scheduledDeparture;
  return real !== undefined && sched !== undefined ? Math.round((real - sched) / 60_000) : null;
};

export function DelayChip({ delayMin }: { delayMin: number | null }) {
  if (delayMin === null) return null;
  const [label, color] =
    delayMin > 0 ? [`+${delayMin} min`, "#ef4444"] : delayMin < 0 ? [`${delayMin} min`, "#38bdf8"] : ["on time", "#22c55e"];
  return (
    <span className="font-semibold" style={{ color }} data-testid="delay">
      {label}
    </span>
  );
}

export function VehicleCard({
  vehicle,
  details,
  status,
  now,
  presence,
  follow,
  onFollow,
  onClose,
  theme,
  onUse,
  daySlots = [],
  dayLabel = "the day",
}: {
  vehicle: VehicleSummary;
  details: TripDetails | null;
  status: "loading" | "ready" | "error";
  now: number;
  // "waiting": not on the map yet (picked from a departures board before it
  // leaves); "live": on the map (Follow works); "gone": it was, and left.
  presence: "waiting" | "live" | "gone";
  follow: boolean;
  onFollow: (on: boolean) => void;
  onClose: () => void;
  theme: CardTheme;
  // Given only to editors: add the ride to the plan; returns validation errors.
  onUse?: (req: UseTripRequest) => string[];
  daySlots?: { id: string; title: string }[]; // the focused day's slots, in order
  dayLabel?: string; // e.g. "Day 1"
}) {
  const [showStops, setShowStops] = useState(false);
  const [useOpen, setUseOpen] = useState(false);
  const name = details?.name || vehicle.name;
  const color = details?.color ?? vehicle.color;
  const mode = details?.mode ?? vehicle.mode;
  const progress = details ? tripProgress(details, now) : null;
  const next = details && progress && !progress.finished ? details.stops[progress.nextIndex] : null;
  const last = details?.stops[details.stops.length - 1];

  return (
    <div
      className="rounded-xl p-2.5 text-xs self-start w-72 max-w-[calc(100vw-24px)]"
      style={{ background: theme.bg, color: theme.fg, border: `1px solid ${theme.border}` }}
      role="dialog"
      aria-label={`Vehicle ${name}`}
    >
      <div className="flex items-start gap-2">
        <span
          className="px-1.5 py-0.5 rounded-md font-bold text-[13px] shrink-0"
          style={{ background: color, color: "#fff" }}
        >
          {MODE_ICON[mode]} {name}
        </span>
        <div className="flex-1 min-w-0">
          {details?.headsign && <div className="font-semibold leading-tight">→ {details.headsign}</div>}
          {details?.longName && <div className="opacity-75 leading-tight">{details.longName}</div>}
          {details?.agency && <div className="opacity-60 leading-tight">{details.agency}</div>}
        </div>
        <button onClick={onClose} aria-label="Close vehicle info" className="px-1 shrink-0">
          ✕
        </button>
      </div>

      {status === "loading" && <div className="mt-2 opacity-70">Loading trip…</div>}
      {status === "error" && <div className="mt-2 opacity-70">Trip details unavailable.</div>}

      {details && progress && (
        <>
          {details.cancelled && (
            <div className="mt-2 px-2 py-1 rounded font-semibold" style={{ background: "#7f1d1d", color: "#fff" }}>
              Cancelled
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span style={{ color: details.realTime ? "#22c55e" : undefined, opacity: details.realTime ? 1 : 0.7 }}>
              {details.realTime ? "● Live" : "○ Scheduled"}
            </span>
            <DelayChip delayMin={progress.delayMin} />
            {details.wheelchair !== null && (
              <span title={details.wheelchair ? "Wheelchair accessible" : "Not wheelchair accessible"} style={{ opacity: details.wheelchair ? 1 : 0.45 }}>
                ♿{details.wheelchair ? "" : "✗"}
              </span>
            )}
            {details.bikes !== null && (
              <span title={details.bikes ? "Bikes allowed" : "No bikes"} style={{ opacity: details.bikes ? 1 : 0.45 }}>
                🚲{details.bikes ? "" : "✗"}
              </span>
            )}
          </div>

          <div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5 items-baseline">
            {next ? (
              <>
                <span className="opacity-60">Next</span>
                <span className="font-semibold truncate">
                  {next.name}
                  {next.track && <span className="opacity-70 font-normal"> · track {next.track}</span>}
                </span>
                <span className="tabular-nums">{stopTime(arrivalOf(next), next.tz)}</span>
              </>
            ) : (
              <>
                <span className="opacity-60">Status</span>
                <span className="font-semibold">Arrived</span>
                <span />
              </>
            )}
            {last && (
              <>
                <span className="opacity-60">To</span>
                <span className="truncate">{last.name}</span>
                <span className="tabular-nums">{stopTime(arrivalOf(last), last.tz)}</span>
              </>
            )}
          </div>

          {details.alerts.map((a) => (
            <div key={a} className="mt-1.5 px-2 py-1 rounded" style={{ background: "rgba(245,158,11,0.18)" }}>
              ⚠ {a}
            </div>
          ))}

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setShowStops((s) => !s)}
              aria-expanded={showStops}
              className="px-2 py-1 rounded-md font-semibold"
              style={{ border: `1px solid ${theme.border}` }}
            >
              {showStops ? "Hide stops" : `All stops (${details.stops.length})`}
            </button>
            {presence === "live" && (
              <button
                onClick={() => onFollow(!follow)}
                aria-pressed={follow}
                className="px-2 py-1 rounded-md font-semibold"
                style={{ border: `1px solid ${theme.border}`, ...(follow ? { background: "#3b82f6", color: "#fff" } : {}) }}
              >
                {follow ? "Following" : "Follow"}
              </button>
            )}
          </div>

          {onUse && (
            <UseInPlan
              details={details}
              firstBoardable={progress.finished ? 0 : progress.nextIndex}
              open={useOpen}
              onOpen={setUseOpen}
              onUse={onUse}
              daySlots={daySlots}
              dayLabel={dayLabel}
              theme={theme}
            />
          )}

          {showStops && (
            <ol className="mt-2 max-h-56 overflow-y-auto pr-1" aria-label="Stops">
              {details.stops.map((s, i) => {
                const passed = i < progress.nextIndex;
                const d = stopDelay(s);
                return (
                  <li key={`${i}-${s.name}`} className="flex items-baseline gap-2 py-0.5" style={{ opacity: passed ? 0.45 : 1 }}>
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ background: passed ? "transparent" : color, border: `2px solid ${color}` }}
                    />
                    <span className={`flex-1 truncate ${i === progress.nextIndex ? "font-semibold" : ""}`}>{s.name}</span>
                    <span className="tabular-nums">{stopTime(arrivalOf(s), s.tz)}</span>
                    {!passed && details.realTime && d !== null && d !== 0 && <DelayChip delayMin={d} />}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
      {presence === "gone" && details && <div className="mt-1.5 opacity-60">No longer in the live view.</div>}
    </div>
  );
}

// "＋ Use in my plan": pick where to board and alight, and whether the ride
// becomes a new slot or an alternative for an existing one.
function UseInPlan({
  details,
  firstBoardable,
  open,
  onOpen,
  onUse,
  daySlots,
  dayLabel,
  theme,
}: {
  details: TripDetails;
  firstBoardable: number; // stops the vehicle has passed can't be boarded
  open: boolean;
  onOpen: (open: boolean) => void;
  onUse: (req: UseTripRequest) => string[];
  daySlots: { id: string; title: string }[];
  dayLabel: string;
  theme: CardTheme;
}) {
  const last = details.stops.length - 1;
  const firstFrom = Math.min(firstBoardable, last - 1);
  const [fromIdx, setFromIdx] = useState(firstFrom);
  const [toIdx, setToIdx] = useState(last);
  const [target, setTarget] = useState("end");
  const [errors, setErrors] = useState<string[]>([]);
  const [added, setAdded] = useState(false);
  const field = { background: "transparent", border: `1px solid ${theme.border}`, color: theme.fg };

  if (!open) {
    return (
      <div className="mt-2">
        <button
          onClick={() => {
            onOpen(true);
            setAdded(false);
          }}
          className="px-2 py-1 rounded-md font-semibold"
          style={{ background: "#3b82f6", color: "#fff" }}
        >
          ＋ Use in my plan
        </button>
        {added && <span className="ml-2" style={{ color: "#22c55e" }}>Added ✓</span>}
      </div>
    );
  }

  const parseTarget = (v: string): UseTripTarget =>
    v === "end"
      ? { kind: "slot", afterSlotId: daySlots.length ? daySlots[daySlots.length - 1].id : null }
      : v.startsWith("after:")
        ? { kind: "slot", afterSlotId: v.slice(6) }
        : { kind: "variant", slotId: v.slice(7) };

  return (
    <div className="mt-2 p-2 rounded-lg flex flex-col gap-1.5" style={{ border: `1px solid ${theme.border}` }}>
      <label className="flex items-center gap-2">
        <span className="w-12 opacity-70">From</span>
        <select
          aria-label="Board at"
          value={fromIdx}
          onChange={(e) => {
            const f = Number(e.target.value);
            setFromIdx(f);
            if (toIdx <= f) setToIdx(last);
          }}
          className="flex-1 min-w-0 rounded px-1 py-0.5"
          style={field}
        >
          {details.stops.slice(firstFrom, last).map((s, k) => (
            <option key={firstFrom + k} value={firstFrom + k} style={{ color: "#17222c" }}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-12 opacity-70">To</span>
        <select
          aria-label="Get off at"
          value={toIdx}
          onChange={(e) => setToIdx(Number(e.target.value))}
          className="flex-1 min-w-0 rounded px-1 py-0.5"
          style={field}
        >
          {details.stops.slice(fromIdx + 1).map((s, k) => (
            <option key={fromIdx + 1 + k} value={fromIdx + 1 + k} style={{ color: "#17222c" }}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-12 opacity-70">Add as</span>
        <select
          aria-label="Add as"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="flex-1 min-w-0 rounded px-1 py-0.5"
          style={field}
        >
          <option value="end" style={{ color: "#17222c" }}>
            New slot at the end of {dayLabel}
          </option>
          {daySlots.map((s) => (
            <option key={`a-${s.id}`} value={`after:${s.id}`} style={{ color: "#17222c" }}>
              New slot after: {s.title}
            </option>
          ))}
          {daySlots.map((s) => (
            <option key={`v-${s.id}`} value={`option:${s.id}`} style={{ color: "#17222c" }}>
              Option for: {s.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 mt-0.5">
        <button
          onClick={() => {
            const errs = onUse({ details, fromIdx, toIdx, target: parseTarget(target) });
            setErrors(errs);
            if (!errs.length) {
              setAdded(true);
              onOpen(false);
            }
          }}
          className="px-2 py-1 rounded-md font-semibold"
          style={{ background: "#3b82f6", color: "#fff" }}
        >
          Add
        </button>
        <button onClick={() => onOpen(false)} className="px-2 py-1 rounded-md" style={{ border: `1px solid ${theme.border}` }}>
          Cancel
        </button>
      </div>
      {errors.map((e) => (
        <div key={e} style={{ color: "#ef4444" }}>
          {e}
        </div>
      ))}
      <div className="opacity-60">Times are today's — the ride is added as estimated.</div>
    </div>
  );
}
