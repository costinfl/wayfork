import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { dayTrack, offsetArc, type TrackSegment } from "../domain/geometry";
import { fetchRoute } from "../domain/route";
import type { Day } from "../domain/types";
import { C } from "./theme";

// The day-journey map. Active variant chain → solid blue route (real road/foot
// geometry from OSRM where available, straight line as fallback); alternatives
// of a fork → dashed grey schematic arcs that bow apart and are clickable to
// activate. Leaflet + OSM raster tiles; lazy-loaded by the parent so it (and
// its CSS) stay out of the entry bundle.

export interface DayMapHandle {
  focusSegment: (slotId: string, variantId: string) => void;
}

const ARC_BEND = 0.16;
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const same = (s: TrackSegment) =>
  s.from.lat === s.to.lat && s.from.lon === s.to.lon;

const activeStyle = { color: C.line, weight: 5, opacity: 0.95, dashArray: undefined as string | undefined };
const altStyle = { color: C.ghost, weight: 3, opacity: 0.85, dashArray: "6 8" };

function DayMapImpl(
  {
    day,
    activeVariants,
    onActivate,
  }: {
    day: Day;
    activeVariants: Record<string, string>;
    onActivate: (slotId: string, variantId: string) => void;
  },
  ref: React.Ref<DayMapHandle>
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Drawn polylines keyed by `${slotId}:${variantId}` so focus can find them.
  const linesRef = useRef<Map<string, L.Polyline>>(new Map());
  // Each slot's place point, so focus can still pan to a slot whose segment is
  // degenerate (the day's origin slot draws no line).
  const pointsRef = useRef<Map<string, [number, number]>>(new Map());
  const layersRef = useRef<L.Layer[]>([]);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { segments, unmapped } = dayTrack(day, activeVariants);

  // Fullscreen = a fixed CSS overlay (not the Fullscreen API — jsdom-testable
  // and consistent across browsers). Leaflet must re-measure after the resize.
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = () => {
    setFullscreen((f) => !f);
    setTimeout(() => mapRef.current?.invalidateSize(), 60);
  };
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // Init the Leaflet map. Re-created when fullscreen toggles: the portal
  // switch remounts the container element, so the map must bind to the new
  // node (the redraw effect below re-renders the track and refits bounds).
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { scrollWheelZoom: false });
    L.tileLayer(OSM_URL, { attribution: OSM_ATTRIB, maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = [];
      linesRef.current.clear();
    };
  }, [fullscreen]);

  // (Re)draw the whole track whenever the day or the active selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const layer of layersRef.current) layer.remove();
    layersRef.current = [];
    linesRef.current.clear();
    pointsRef.current.clear();
    for (const seg of segments) pointsRef.current.set(seg.slotId, [seg.to.lat, seg.to.lon]);

    const allPoints: [number, number][] = [];

    // Numbered markers at each located slot place (in track order).
    const placesSeen: string[] = [];
    for (const seg of segments) {
      const key = `${seg.to.lat},${seg.to.lon}`;
      if (placesSeen.includes(key)) continue;
      placesSeen.push(key);
      const n = placesSeen.length;
      const marker = L.marker([seg.to.lat, seg.to.lon], {
        icon: L.divIcon({
          className: "wf-day-marker",
          html: `<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${C.line};color:#fff;font:600 12px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(map);
      layersRef.current.push(marker);
      allPoints.push([seg.to.lat, seg.to.lon]);
    }

    // Group alternatives per slot so their arcs bow to alternating sides.
    const altIndexBySlot = new Map<string, number>();

    for (const seg of segments) {
      if (same(seg)) continue; // degenerate origin — marker only, no line
      allPoints.push([seg.from.lat, seg.from.lon]);

      let latlngs: [number, number][];
      if (seg.active && seg.profile !== "arc") {
        latlngs = [
          [seg.from.lat, seg.from.lon],
          [seg.to.lat, seg.to.lon],
        ]; // straight line until (and unless) OSRM resolves
      } else {
        // Alternatives (and rail/air/same-endpoint) are schematic arcs; sign
        // alternates so siblings fork to opposite sides. The active arc bows a
        // little too so a flight/train doesn't read as a bee-line.
        const k = altIndexBySlot.get(seg.slotId) ?? 0;
        const bend = seg.active ? ARC_BEND : (k % 2 === 0 ? 1 : -1) * ARC_BEND * (1 + Math.floor(k / 2));
        if (!seg.active) altIndexBySlot.set(seg.slotId, k + 1);
        latlngs = offsetArc(seg.from, seg.to, bend);
      }

      const style = seg.active ? activeStyle : altStyle;
      const line = L.polyline(latlngs, { ...style, interactive: true }).addTo(map);
      if (!seg.active) {
        line.on("click", () => onActivate(seg.slotId, seg.variantId));
      }
      layersRef.current.push(line);
      linesRef.current.set(`${seg.slotId}:${seg.variantId}`, line);

      // Upgrade the active road/foot segment to real geometry, best-effort.
      if (seg.active && seg.profile !== "arc") {
        fetchRoute(seg.from, seg.to, seg.profile).then((geo) => {
          if (geo && linesRef.current.get(`${seg.slotId}:${seg.variantId}`) === line) {
            line.setLatLngs(geo);
          }
        });
      }
    }

    if (allPoints.length === 1) {
      map.setView(allPoints[0], 13);
    } else if (allPoints.length > 1) {
      map.fitBounds(allPoints, { padding: [40, 40] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id, JSON.stringify(activeVariants), fullscreen]);

  useImperativeHandle(ref, () => ({
    focusSegment: (slotId, variantId) => {
      const map = mapRef.current;
      if (!map) return;
      const line = linesRef.current.get(`${slotId}:${variantId}`);
      if (line) {
        map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 15 });
        const restore = line.options.dashArray ? altStyle : activeStyle;
        line.setStyle({ weight: 9, opacity: 1 });
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => line.setStyle(restore), 2000);
        return;
      }
      // Degenerate segment (the day's origin slot) — just pan to its marker.
      const point = pointsRef.current.get(slotId);
      if (point) map.setView(point, 15);
    },
  }));

  const panel = (
    <div
      className={
        fullscreen ? "fixed inset-0 flex flex-col" : "rounded-xl overflow-hidden relative"
      }
      style={{
        border: `1px solid ${C.border}`,
        background: C.card,
        ...(fullscreen ? { zIndex: 1100 } : {}),
      }}
    >
      <button
        onClick={toggleFullscreen}
        aria-label={fullscreen ? "Exit fullscreen map" : "Fullscreen map"}
        title={fullscreen ? "Exit fullscreen (Esc)" : "Fill the whole window"}
        className="absolute top-2 right-2 w-8 h-8 rounded-lg text-base font-bold"
        style={{ zIndex: 1050, border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
      >
        {fullscreen ? "✕" : "⛶"}
      </button>
      <div
        ref={elRef}
        style={fullscreen ? { flex: 1, width: "100%" } : { height: 420, width: "100%" }}
        aria-label="Day journey map"
      />
      {unmapped.length > 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: C.sub, background: C.card }}>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
            style={{ background: C.amberBg, color: C.amber }}
          >
            📍 {unmapped.length} slot{unmapped.length > 1 ? "s" : ""} have no location — add one in Edit
            mode
          </span>
        </div>
      )}
    </div>
  );

  // Fullscreen escapes to a body-level portal: the map column is a sticky
  // flex item, and sticky elements form their own stacking context (Blink),
  // which would trap the overlay's z-index under later page content.
  return fullscreen ? createPortal(panel, document.body) : panel;
}

export const DayMap = forwardRef(DayMapImpl);
export default DayMap;
