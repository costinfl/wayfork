import { useEffect, useMemo, useState } from "react";
import type { Day, ItinerarySlot, Place } from "../domain/types";
import type { Poi, PoiCategoryId } from "../domain/poi";
import { POI_CATEGORIES, fetchPois, fetchPoiSummary } from "../domain/poi";
import type { PoiSummary } from "../domain/poi";
import { reachMinutes, reachRadiusM, REACH_BANDS, type ReachBand, type ReachMode } from "../domain/reach";
import { C } from "./theme";

// Nearby-POI discovery beside the day map. Nothing is fetched until the user
// hits the explicit 🧭 Discover button (keeps Overpass traffic to deliberate
// searches); results also flow up to the parent so the map can draw the
// search circle. The "Start from" anchor decides both the search center and
// where an added place is inserted (right after it) — the parent advances it
// to each newly added slot.

const RADII = [
  { m: 1000, label: "1 km" },
  { m: 3000, label: "3 km" },
  { m: 10000, label: "10 km" },
];

const CATEGORY_ICON: Record<PoiCategoryId, string> = {
  sights: "🏛",
  museums: "🖼",
  food: "🍽",
  parks: "🌳",
};

// The ◎ reach rings currently on the map, which Discover can search within.
export interface DiscoverReach {
  slotId: string;
  origin: Place;
  mode: ReachMode;
  bands: ReachBand[];
}

// Overpass radius cap — the largest preset; a 45-min transit ring can be wider.
const MAX_RADIUS_M = 10000;

// The last executed search, shared with the day map.
export interface DiscoverQuery {
  center: Place;
  radiusM: number;
  pois: Poi[];
}

// The slot new discoveries chain after: the explicitly chosen one, else the
// day's last slot that has a place. Null when nothing on the day is placed.
export function anchorSlot(day: Day, anchorId: string | null): ItinerarySlot | null {
  if (anchorId) {
    const chosen = day.slots.find((s) => s.id === anchorId);
    if (chosen?.place) return chosen;
  }
  for (let i = day.slots.length - 1; i >= 0; i--) {
    if (day.slots[i].place) return day.slots[i];
  }
  return null;
}

export function searchCenter(day: Day, anchorId: string | null): Place | null {
  return anchorSlot(day, anchorId)?.place ?? day.location ?? null;
}

const fmtDistance = (m: number): string =>
  m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;

type Status = "idle" | "searching" | "done" | "failed";

export default function DiscoverPanel({
  day,
  canEdit,
  anchorId,
  onAnchorChange,
  onAdd,
  onResults,
  reach = null,
}: {
  day: Day;
  canEdit: boolean;
  anchorId: string | null;
  onAnchorChange: (id: string | null) => void;
  // Adds a slot for the POI after the anchor; resolves to validation problems.
  onAdd: (poi: Poi) => Promise<string[]>;
  // Reports the last executed search (null when cleared) for the map overlay.
  onResults: (q: DiscoverQuery | null) => void;
  // Reach rings on the map; with a "Within" limit, results are kept to them.
  reach?: DiscoverReach | null;
}) {
  const [open, setOpen] = useState(false);
  const [radiusM, setRadiusM] = useState(3000);
  const [cats, setCats] = useState<PoiCategoryId[]>(["sights", "museums"]);
  const [status, setStatus] = useState<Status>("idle");
  const [pois, setPois] = useState<Poi[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, PoiSummary | null>>({});
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const [withinMin, setWithinMin] = useState<number | null>(null);
  const [searched, setSearched] = useState<{ center: Place; radiusM: number } | null>(null);
  const within = reach ? withinMin : null; // the limit lapses with the rings
  const center = within !== null && reach ? reach.origin : searchCenter(day, anchorId);
  const ringRadiusM = within !== null && reach ? reachRadiusM(reach.origin, reach.bands, within) : 0;
  // Travel band per result (only while a limit applies), and what's shown.
  const reachOf = useMemo(() => {
    const m = new Map<string, number | null>();
    if (within !== null && reach) for (const p of pois) m.set(p.id, reachMinutes(reach.bands, p));
    return m;
  }, [pois, within, reach]);
  const shown = useMemo(
    () => (within === null ? pois : pois.filter((p) => (reachOf.get(p.id) ?? Infinity) <= within)),
    [pois, within, reachOf]
  );
  // Keep the map's markers in step when the limit or the rings change.
  useEffect(() => {
    if (status === "done" && searched) onResults({ ...searched, pois: shown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const placedSlots = day.slots.filter((s) => s.place);

  // New day = new context: back to the idle state.
  useEffect(() => {
    setStatus("idle");
    setPois([]);
    setSearched(null);
    setExpanded(null);
    setAddedIds(new Set());
  }, [day.id]);

  const discover = () => {
    if (!center || status === "searching") return;
    const at = { ...center };
    const r = within !== null ? Math.min(MAX_RADIUS_M, Math.max(500, ringRadiusM)) : radiusM;
    setStatus("searching");
    fetchPois(at, r, cats).then((result) => {
      if (result === null) {
        setStatus("failed");
        return;
      }
      setSearched({ center: at, radiusM: r });
      setPois(result);
      setStatus("done"); // the effect above reports the (filtered) results
    });
  };

  const toggleCat = (id: PoiCategoryId) =>
    setCats((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const expand = (poi: Poi) => {
    const next = expanded === poi.id ? null : poi.id;
    setExpanded(next);
    if (next && summaries[poi.id] === undefined) {
      fetchPoiSummary(poi).then((s) => setSummaries((prev) => ({ ...prev, [poi.id]: s })));
    }
  };

  const add = async (poi: Poi) => {
    const errors = await onAdd(poi);
    if (!errors.length) setAddedIds((prev) => new Set(prev).add(poi.id));
  };

  return (
    <div
      className="rounded-xl mt-3"
      style={{ background: C.card, border: `1px solid ${C.border}` }}
      data-testid="discover-panel"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 font-semibold text-sm flex items-center justify-between"
        style={{ color: C.ink }}
      >
        <span>🧭 Discover places nearby</span>
        <span style={{ color: C.sub }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {!center ? (
            <p className="text-sm" style={{ color: C.sub }}>
              Give this day a location (or a slot a place) to discover what's nearby.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {POI_CATEGORIES.map((cat) => {
                  const active = cats.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleCat(cat.id)}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        border: `1px solid ${active ? C.line : C.border}`,
                        background: active ? C.lineSoft : C.card,
                        color: active ? C.line : C.sub,
                      }}
                    >
                      {CATEGORY_ICON[cat.id]} {cat.label}
                    </button>
                  );
                })}
                {reach && (
                  <select
                    value={within ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      setWithinMin(v);
                      // Places found within a slot's reach chain after that slot.
                      if (v !== null && day.slots.some((sl) => sl.id === reach.slotId)) onAnchorChange(reach.slotId);
                    }}
                    aria-label="Within reach"
                    className="rounded px-2 py-1 text-xs font-semibold ml-auto"
                    style={{ border: `1px solid ${C.border}`, color: C.ink, background: C.card }}
                  >
                    <option value="">Any distance</option>
                    {REACH_BANDS.map((b) => (
                      <option key={b} value={b}>
                        ◎ ≤ {b} min {reach.mode === "walk" ? "walk" : "by transit"}
                      </option>
                    ))}
                  </select>
                )}
                {within === null && (
                  <select
                    value={radiusM}
                    onChange={(e) => setRadiusM(Number(e.target.value))}
                    aria-label="Search radius"
                    className={`rounded px-2 py-1 text-xs font-semibold ${reach ? "" : "ml-auto"}`}
                    style={{ border: `1px solid ${C.border}`, color: C.ink, background: C.card }}
                  >
                    {RADII.map((r) => (
                      <option key={r.m} value={r.m}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap mb-2 text-xs" style={{ color: C.sub }}>
                <label className="flex items-center gap-1.5">
                  Start from
                  <select
                    value={anchorId ?? ""}
                    onChange={(e) => onAnchorChange(e.target.value || null)}
                    aria-label="Start from"
                    className="rounded px-2 py-1 text-xs font-semibold"
                    style={{ border: `1px solid ${C.border}`, color: C.ink, background: C.card }}
                  >
                    <option value="">Last stop (auto)</option>
                    {placedSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={discover}
                  disabled={status === "searching" || cats.length === 0}
                  className="px-3 py-1 rounded-lg text-xs font-bold ml-auto"
                  style={{
                    border: `1px solid ${C.line}`,
                    background: C.lineSoft,
                    color: C.line,
                    opacity: status === "searching" || cats.length === 0 ? 0.6 : 1,
                  }}
                >
                  {status === "searching" ? "Searching…" : "🧭 Discover"}
                </button>
              </div>
              <p className="text-xs mb-2" style={{ color: C.sub }}>
                {within !== null
                  ? `within ${within} min of ⌖ ${center.name}${ringRadiusM > MAX_RADIUS_M ? " (searching the nearest 10 km)" : ""}`
                  : `around ⌖ ${center.name} (start point)`}{" "}
                · data © OpenStreetMap contributors
              </p>

              {status === "idle" && (
                <p className="text-sm" style={{ color: C.sub }}>
                  Pick categories and a radius, then hit Discover.
                </p>
              )}
              {status === "failed" && (
                <p className="text-sm flex items-center gap-2" style={{ color: C.amber }}>
                  Overpass is busy right now — nothing was lost.
                  <button
                    onClick={discover}
                    className="px-2 py-0.5 rounded-lg text-xs font-bold"
                    style={{ border: `1px solid ${C.amber}`, background: C.amberBg, color: C.amber }}
                  >
                    Retry
                  </button>
                </p>
              )}
              {status === "done" && shown.length === 0 && (
                <p className="text-sm" style={{ color: C.sub }}>
                  {within !== null && pois.length > 0
                    ? `Nothing within ${within} min — ${pois.length} found farther away.`
                    : "Nothing found — try a wider radius or more categories."}
                </p>
              )}

              {status === "done" && shown.length > 0 && (
                <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {shown.map((poi) => (
                    <li
                      key={poi.id}
                      className="rounded-lg px-3 py-2"
                      style={{ border: `1px solid ${C.border}` }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => expand(poi)}
                          className="text-left text-sm font-semibold flex-1"
                          style={{ color: C.ink }}
                        >
                          {CATEGORY_ICON[poi.category]} {poi.name}
                          <span className="font-normal text-xs ml-2" style={{ color: C.sub }}>
                            {fmtDistance(poi.distanceM)}
                            {reachOf.get(poi.id) != null && ` · ◎ ≤ ${reachOf.get(poi.id)} min`}
                          </span>
                        </button>
                        {canEdit &&
                          (addedIds.has(poi.id) ? (
                            <span className="text-xs font-semibold" style={{ color: C.ok }}>
                              Added ✓
                            </span>
                          ) : (
                            <button
                              onClick={() => void add(poi)}
                              className="px-2 py-0.5 rounded-lg text-xs font-semibold shrink-0"
                              style={{
                                border: `1px solid ${C.line}`,
                                background: C.lineSoft,
                                color: C.line,
                              }}
                            >
                              + Add to day
                            </button>
                          ))}
                      </div>
                      {poi.openingHours && (
                        <p className="text-xs mt-1" style={{ color: C.sub }}>
                          🕒 {poi.openingHours}
                        </p>
                      )}
                      {expanded === poi.id && (
                        <div className="mt-2 flex gap-2">
                          {summaries[poi.id] === undefined ? (
                            <p className="text-xs" style={{ color: C.sub }}>
                              Loading details…
                            </p>
                          ) : summaries[poi.id] === null ? (
                            <p className="text-xs" style={{ color: C.sub }}>
                              No description available.
                              {poi.website && (
                                <>
                                  {" "}
                                  <a
                                    href={poi.website}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: C.line }}
                                  >
                                    Website ↗
                                  </a>
                                </>
                              )}
                            </p>
                          ) : (
                            <>
                              {summaries[poi.id]!.thumbnailUrl && (
                                <img
                                  src={summaries[poi.id]!.thumbnailUrl}
                                  alt={poi.name}
                                  className="w-16 h-16 object-cover rounded-lg shrink-0"
                                />
                              )}
                              <p className="text-xs" style={{ color: C.sub }}>
                                {summaries[poi.id]!.extract}
                                {poi.website && (
                                  <>
                                    {" "}
                                    <a
                                      href={poi.website}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: C.line }}
                                    >
                                      Website ↗
                                    </a>
                                  </>
                                )}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
