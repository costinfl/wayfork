import { useState } from "react";
import { fetchDirections, fmtDistance, mapsLink, type DirectionStep } from "../domain/directions";
import type { MicroStep } from "../domain/types";
import { Chip } from "./Chip";
import { stopTime } from "./map/VehicleCard";
import { C, mono, STEP_ICON } from "./theme";

// A step of an option. Steps that know more — a ride (what to board, where to
// get off) or a walk/drive with both ends placed — open on click to show it,
// with turn-by-turn directions on demand and a hand-off to a maps app.

const PROFILE: Partial<Record<MicroStep["type"], "foot" | "driving">> = {
  walk: "foot",
  car: "driving",
  shuttle: "driving",
  transfer: "foot",
};

export function StepChip({ ms }: { ms: MicroStep }) {
  const [open, setOpen] = useState(false);
  const [dirs, setDirs] = useState<DirectionStep[] | "loading" | "none" | null>(null);
  const profile = PROFILE[ms.type];
  const routable = !!(profile && ms.from && ms.to);
  const expandable = !!ms.ride || routable || !!(ms.from && ms.to);

  const chip = (
    <Chip style={expandable ? { cursor: "pointer", border: `1px solid ${open ? C.line : "transparent"}` } : undefined}>
      {STEP_ICON[ms.type]} {ms.label} · <span style={mono}>{ms.durationMin}m</span>
      {!!ms.distanceKm && <span style={{ ...mono, opacity: 0.7 }}>· {ms.distanceKm}km</span>}
      {expandable && <span aria-hidden="true">{open ? " ▴" : " ▾"}</span>}
    </Chip>
  );
  if (!expandable) return chip;

  const loadDirections = async () => {
    if (!ms.from || !ms.to || !profile) return;
    setDirs("loading");
    const steps = await fetchDirections(ms.from, ms.to, profile);
    setDirs(steps ?? "none");
  };
  const r = ms.ride;
  const mode = r ? "transit" : profile === "foot" ? "walking" : "driving";

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${ms.label} — details`}
        onClick={(e) => {
          e.stopPropagation(); // inside a clickable option card
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
      >
        {chip}
      </span>
      {open && (
        <div
          className="basis-full w-full rounded-md p-2 text-xs"
          style={{ background: C.panel, color: C.ink, border: `1px solid ${C.border}` }}
          onClick={(e) => e.stopPropagation()}
          role="region"
          aria-label={`${ms.label} details`}
        >
          {r && (
            <div className="space-y-0.5">
              <div className="font-semibold">
                {r.line && (
                  <span className="px-1.5 py-0.5 rounded mr-1" style={{ background: r.color ?? C.line, color: "#fff" }}>
                    {r.line}
                  </span>
                )}
                {r.headsign && <>towards {r.headsign}</>}
                {r.agency && <span style={{ color: C.sub }}> · {r.agency}</span>}
              </div>
              {r.board && (
                <div>
                  Board at <b>{r.board}</b>
                  {r.track && <> · platform {r.track}</>}
                  {r.departs && r.tz && (
                    <span style={{ color: C.sub }} title="Times as looked up — check the timetable on the day">
                      {" "}
                      · {stopTime(Date.parse(r.departs), r.tz)}
                      {r.arrives && <>–{stopTime(Date.parse(r.arrives), r.tz)}</>} local
                    </span>
                  )}
                </div>
              )}
              {r.alight && (
                <div>
                  Get off at <b>{r.alight}</b>
                  {r.stops !== undefined && (
                    <span style={{ color: C.sub }}>
                      {" "}
                      · after {r.stops} stop{r.stops === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {routable && (
            <div className={r ? "mt-1.5" : ""}>
              {dirs === null && (
                <button onClick={() => void loadDirections()} className="underline font-semibold" style={{ color: C.line }}>
                  Directions
                </button>
              )}
              {dirs === "loading" && <span style={{ color: C.sub }}>Loading directions…</span>}
              {dirs === "none" && <span style={{ color: C.sub }}>Directions unavailable right now.</span>}
              {Array.isArray(dirs) && (
                <ol className="list-decimal pl-4 space-y-0.5" aria-label="Directions">
                  {dirs.map((d, i) => (
                    <li key={i}>
                      {d.text}
                      {d.distanceM > 0 && <span style={{ color: C.sub, ...mono }}> · {fmtDistance(d.distanceM)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {ms.from && ms.to && (
            <a
              href={mapsLink(ms.from, ms.to, mode)}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-1.5 font-semibold underline"
              style={{ color: C.line }}
            >
              Open in Maps ↗
            </a>
          )}
        </div>
      )}
    </>
  );
}
