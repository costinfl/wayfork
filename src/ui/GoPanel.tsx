import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchTimeZone } from "../domain/departure";
import { fmtDistance, mapsLink } from "../domain/directions";
import { dayClock, dayTimeline, goStatus, localNow, type GoStep } from "../domain/go";
import { fetchDepartures, type Departure } from "../domain/liveTransit";
import { distanceM } from "../domain/poi";
import type { ScheduleRow } from "../domain/schedule";
import { fmtTime } from "../domain/time";
import type { Day } from "../domain/types";
import { stopTime } from "./map/VehicleCard";
import { C, STEP_ICON } from "./theme";

// Go mode for the travel day: what the plan says is happening now, what's
// next and when, live departures for the next ride, and — only if the
// traveller turns it on — their position on the map and the distance to
// where they need to be. The position never leaves the device and stops
// being watched when Go mode closes.

export type Me = { lat: number; lon: number; accuracy: number };
type LocState = "off" | "asking" | "on" | "denied" | "unavailable";

const CLOCK_MS = 20_000;
const DEPARTURES_MS = 60_000;

export function GoPanel({
  day,
  dayLabel,
  rows,
  onPosition,
  onClose,
}: {
  day: Day;
  dayLabel: string;
  rows: ScheduleRow[];
  onPosition: (me: Me | null) => void;
  onClose: () => void;
}) {
  const timeline = useMemo(() => dayTimeline(rows), [rows]);
  const anchor = day.slots[0]?.place ?? day.location ?? null;

  // The plan's local clock (the first stop's zone), ticking.
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    if (anchor) void fetchTimeZone(anchor).then(setTz);
  }, [anchor?.lat, anchor?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  const clock = dayClock(day.date, localNow(now, tz, anchor?.lon ?? 0));
  const status = goStatus(timeline, clock.minutes);
  // Shown in the zone where the plan is now (after any clock change).
  const shown = clock.minutes + ((status.current ?? status.next)?.shift ?? 0);

  // Position: opt-in, watched only while on.
  const [loc, setLoc] = useState<LocState>("off");
  const [me, setMe] = useState<Me | null>(null);
  const watchId = useRef<number | null>(null);
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const stopWatching = () => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setMe(null);
    onPositionRef.current(null);
  };
  const startWatching = () => {
    if (!navigator.geolocation) {
      setLoc("unavailable");
      return;
    }
    setLoc("asking");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const m = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
        setLoc("on");
        setMe(m);
        onPositionRef.current(m);
      },
      (err) => {
        stopWatching();
        setLoc(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 }
    );
  };
  useEffect(() => () => stopWatching(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live departures for the next ride (or the one under way, if it hasn't left).
  const ride = [status.current, status.next].find((s) => s?.step.ride?.boardStopId) ?? null;
  const [departures, setDepartures] = useState<Departure[] | null>(null);
  const stopId = ride?.step.ride?.boardStopId ?? null;
  const line = ride?.step.ride?.line ?? null;
  useEffect(() => {
    setDepartures(null);
    if (!stopId) return;
    let cancelled = false;
    const load = () =>
      void fetchDepartures(stopId).then((d) => {
        if (!cancelled) setDepartures(d ? d.filter((x) => !line || x.name === line).slice(0, 3) : null);
      });
    load();
    const id = setInterval(load, DEPARTURES_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stopId, line]);

  // Where to head: the next step's start, else where the current one ends.
  const target = status.next?.from ?? status.current?.to ?? null;
  const away = me && target ? distanceM(me, target) : null;

  const stepLine = (s: GoStep) => (
    <>
      {STEP_ICON[s.step.type]} {s.step.label}
      <span style={{ color: C.sub }}> · {s.slotTitle}</span>
    </>
  );

  // Body-level: the sheet it's opened from is transformed (drag/snap), which
  // would make `fixed` relative to the sheet instead of the screen.
  return createPortal(
    <div
      role="dialog"
      aria-label="Go mode"
      className="fixed z-50 left-3 right-3 top-3 lg:right-auto lg:top-auto lg:bottom-12 lg:w-[380px] rounded-xl p-3 text-sm shadow-2xl"
      style={{ background: C.card, color: C.ink, border: `2px solid ${C.line}` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-bold">▶ Go · {dayLabel}</span>
        <span className="text-xs" style={{ color: C.sub }}>
          {fmtTime(((shown % 1440) + 1440) % 1440)} local
        </span>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Exit Go mode" className="px-1" style={{ color: C.sub }}>
          ✕
        </button>
      </div>
      {clock.preview && (
        <div className="text-xs mb-1.5 rounded px-2 py-1" style={{ background: C.amberBg, color: C.amber }}>
          Preview — this day is {day.date}; it runs as if it were today, at the current time.
        </div>
      )}

      {status.current && (
        <div className="mb-1">
          <span className="text-xs font-semibold" style={{ color: C.sub }}>
            NOW · until {fmtTime(status.current.end)}
          </span>
          <div>{stepLine(status.current)}</div>
        </div>
      )}
      {status.next && (
        <div className="mb-1">
          <span className="text-xs font-semibold" style={{ color: C.line }}>
            NEXT · {fmtTime(status.next.start)}
            {status.minutesToNext !== null && ` (in ${status.minutesToNext} min)`}
          </span>
          <div className="font-semibold">{stepLine(status.next)}</div>
          {status.next.step.ride?.board && (
            <div className="text-xs">
              Board at <b>{status.next.step.ride.board}</b>
              {status.next.step.ride.track && <> · platform {status.next.step.ride.track}</>}
              {status.next.step.ride.alight && (
                <>
                  {" "}
                  → get off at <b>{status.next.step.ride.alight}</b>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!status.current && !status.next && (
        <div className="mb-1">{status.done ? "That's the day — well done! 🎉" : "Nothing planned for this day yet."}</div>
      )}

      {ride && stopId && (
        <div className="text-xs mt-1" aria-label="Live departures">
          <span className="font-semibold">Live · {line ?? "departures"}:</span>{" "}
          {departures === null ? (
            <span style={{ color: C.sub }}>checking…</span>
          ) : departures.length === 0 ? (
            <span style={{ color: C.sub }}>no departures soon</span>
          ) : (
            departures.map((d, i) => (
              <span key={d.tripId + d.departure}>
                {i > 0 && " · "}
                {stopTime(d.departure, d.tz ?? ride.step.ride?.tz)}
                {d.cancelled ? (
                  <span style={{ color: C.red }}> cancelled</span>
                ) : d.delayMin ? (
                  <span style={{ color: d.delayMin > 0 ? C.red : C.line }}>
                    {" "}
                    {d.delayMin > 0 ? "+" : ""}
                    {d.delayMin}
                  </span>
                ) : null}
              </span>
            ))
          )}
        </div>
      )}

      <div className="mt-2 pt-2 text-xs" style={{ borderTop: `1px solid ${C.border}` }}>
        {loc === "off" && (
          <>
            <button
              onClick={startWatching}
              className="px-2.5 py-1 rounded-lg font-semibold"
              style={{ background: C.line, color: C.onLine }}
            >
              📍 Show me on the map
            </button>
            <p className="mt-1" style={{ color: C.sub }}>
              Uses your device's location while Go is open. It stays on this device and stops when you exit.
            </p>
          </>
        )}
        {loc === "asking" && <span style={{ color: C.sub }}>Waiting for your location…</span>}
        {loc === "on" && (
          <div className="flex items-center gap-2 flex-wrap">
            {away !== null && target ? (
              <span>
                📍 <b>{fmtDistance(away)}</b> to {target.name}
              </span>
            ) : (
              <span>📍 Showing you on the map</span>
            )}
            {me && target && (
              <a href={mapsLink({ name: "Me", ...me }, target, "walking")} target="_blank" rel="noreferrer" style={{ color: C.line }} className="underline">
                Directions ↗
              </a>
            )}
            <span className="flex-1" />
            <button
              onClick={() => {
                stopWatching();
                setLoc("off");
              }}
              className="underline"
              style={{ color: C.sub }}
            >
              Stop sharing location
            </button>
          </div>
        )}
        {loc === "denied" && (
          <span style={{ color: C.amber }}>
            Location is blocked for this site — allow it in your browser's site settings to see yourself on the map.
          </span>
        )}
        {loc === "unavailable" && <span style={{ color: C.amber }}>Your location isn't available right now.</span>}
      </div>
    </div>,
    document.body
  );
}
