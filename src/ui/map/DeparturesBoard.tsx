import type { Departure, TransitStop } from "../../domain/liveTransit";
import { DelayChip, MODE_ICON, stopTime, type CardTheme, type VehicleSummary } from "./VehicleCard";

// The departures board for a tapped stop: the next departures with line,
// direction, local time, countdown, delay and track. Picking one opens that
// vehicle's trip card (TripMap keeps the board underneath to come back to).

export function DeparturesBoard({
  stop,
  departures,
  status,
  now,
  onPickTrip,
  onClose,
  theme,
}: {
  stop: TransitStop;
  departures: Departure[];
  status: "loading" | "ready" | "error";
  now: number;
  onPickTrip: (v: VehicleSummary) => void;
  onClose: () => void;
  theme: CardTheme;
}) {
  return (
    <div
      className="rounded-xl p-2.5 text-xs self-start w-72 max-w-[calc(100vw-24px)]"
      style={{ background: theme.bg, color: theme.fg, border: `1px solid ${theme.border}` }}
      role="dialog"
      aria-label={`Departures from ${stop.name}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px] leading-tight">{stop.name}</div>
          <div className="opacity-70">
            {stop.modes.map((m) => MODE_ICON[m]).join(" ")} Departures
          </div>
        </div>
        <button onClick={onClose} aria-label="Close departures" className="px-1 shrink-0">
          ✕
        </button>
      </div>

      {status === "loading" && <div className="mt-2 opacity-70">Loading departures…</div>}
      {status === "error" && <div className="mt-2 opacity-70">Departures unavailable.</div>}
      {status === "ready" && departures.length === 0 && (
        <div className="mt-2 opacity-70">No departures in the next hours.</div>
      )}

      {departures.length > 0 && (
        <ul className="mt-2 max-h-72 overflow-y-auto pr-1 flex flex-col gap-0.5" aria-label="Departures">
          {departures.map((d) => {
            const inMin = Math.round((d.departure - now) / 60_000);
            return (
              <li key={`${d.tripId}-${d.departure}`}>
                <button
                  onClick={() => onPickTrip({ tripId: d.tripId, name: d.name, mode: d.mode, color: d.color })}
                  className="w-full flex items-center gap-2 py-1 px-1 rounded text-left hover:bg-white/10"
                  title="Show this trip"
                  style={{ opacity: d.cancelled ? 0.5 : 1 }}
                >
                  <span
                    className="px-1.5 py-0.5 rounded font-bold shrink-0 min-w-9 text-center"
                    style={{ background: d.color, color: "#fff" }}
                  >
                    {d.name}
                  </span>
                  <span className={`flex-1 min-w-0 truncate ${d.cancelled ? "line-through" : ""}`}>
                    {d.headsign ? `→ ${d.headsign}` : MODE_ICON[d.mode]}
                    {d.track && <span className="opacity-60"> · {d.track}</span>}
                  </span>
                  <span className="text-right shrink-0 tabular-nums leading-tight">
                    <span className="block">{stopTime(d.departure, d.tz ?? stop.tz)}</span>
                    {d.cancelled ? (
                      <span className="block font-semibold" style={{ color: "#ef4444" }}>
                        cancelled
                      </span>
                    ) : d.delayMin ? (
                      <span className="block">
                        <DelayChip delayMin={d.delayMin} />
                      </span>
                    ) : inMin >= 0 && inMin < 60 ? (
                      <span className="block opacity-60">{inMin === 0 ? "now" : `in ${inMin} min`}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
