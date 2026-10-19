import { useState } from "react";
import { tripProgress, type LiveMode, type TripDetails, type TripStop } from "../../domain/liveTransit";

// The info card for a tapped live vehicle: line, direction, live/delay status,
// next and final stop with local times, accessibility, alerts, and the full
// stop list. Rendered in the map's toolbar column (see TripMap.tsx).

export const MODE_ICON: Record<LiveMode, string> = {
  metro: "🚇",
  tram: "🚊",
  bus: "🚌",
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
  gone,
  follow,
  onFollow,
  onClose,
  theme,
}: {
  vehicle: VehicleSummary;
  details: TripDetails | null;
  status: "loading" | "ready" | "error";
  now: number;
  gone: boolean; // the vehicle has left the live feed (trip over, or out of view)
  follow: boolean;
  onFollow: (on: boolean) => void;
  onClose: () => void;
  theme: CardTheme;
}) {
  const [showStops, setShowStops] = useState(false);
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
            {!gone && (
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
      {gone && details && <div className="mt-1.5 opacity-60">No longer in the live view.</div>}
    </div>
  );
}
