import { useEffect, useState } from "react";
import type { Day } from "../domain/types";
import type { Poi, PoiCategoryId, PoiSummary } from "../domain/poi";
import { POI_CATEGORIES, fetchPois, fetchPoiSummary } from "../domain/poi";
import { C } from "./theme";

// Nearby-POI discovery beside the day map. Collapsed by default so no
// Overpass traffic happens until the user opens it; results are fetched for
// the day's location (falling back to the last slot that has a place).

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

export function searchCenter(day: Day): { name: string; lat: number; lon: number } | null {
  for (let i = day.slots.length - 1; i >= 0; i--) {
    const p = day.slots[i].place;
    if (p) return p;
  }
  return day.location ?? null;
}

const fmtDistance = (m: number): string =>
  m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;

export default function DiscoverPanel({
  day,
  canEdit,
  onAdd,
}: {
  day: Day;
  canEdit: boolean;
  // Adds a slot for the POI to the current day; returns validation problems.
  onAdd: (poi: Poi) => string[];
}) {
  const [open, setOpen] = useState(false);
  const [radiusM, setRadiusM] = useState(3000);
  const [cats, setCats] = useState<PoiCategoryId[]>(["sights", "museums"]);
  const [pois, setPois] = useState<Poi[] | null>(null); // null = loading/idle
  const [expanded, setExpanded] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, PoiSummary | null>>({});
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const center = searchCenter(day);

  useEffect(() => {
    if (!open || !center) return;
    let cancelled = false;
    setPois(null);
    // Debounce so chip/radius flurries collapse into one Overpass query.
    const t = setTimeout(() => {
      fetchPois(center, radiusM, cats).then((result) => {
        if (!cancelled) setPois(result);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day.id, center?.lat, center?.lon, radiusM, cats.join(",")]);

  const toggleCat = (id: PoiCategoryId) =>
    setCats((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const expand = (poi: Poi) => {
    const next = expanded === poi.id ? null : poi.id;
    setExpanded(next);
    if (next && summaries[poi.id] === undefined) {
      fetchPoiSummary(poi).then((s) => setSummaries((prev) => ({ ...prev, [poi.id]: s })));
    }
  };

  const add = (poi: Poi) => {
    const errors = onAdd(poi);
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
              <div className="flex items-center gap-2 flex-wrap mb-3">
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
                <select
                  value={radiusM}
                  onChange={(e) => setRadiusM(Number(e.target.value))}
                  aria-label="Search radius"
                  className="rounded px-2 py-1 text-xs font-semibold ml-auto"
                  style={{ border: `1px solid ${C.border}`, color: C.ink, background: C.card }}
                >
                  {RADII.map((r) => (
                    <option key={r.m} value={r.m}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs mb-2" style={{ color: C.sub }}>
                around {center.name} · data © OpenStreetMap contributors
              </p>

              {pois === null ? (
                <p className="text-sm" style={{ color: C.sub }}>
                  Searching…
                </p>
              ) : pois.length === 0 ? (
                <p className="text-sm" style={{ color: C.sub }}>
                  Nothing found — try a wider radius or more categories.
                </p>
              ) : (
                <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {pois.map((poi) => (
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
                          </span>
                        </button>
                        {canEdit &&
                          (addedIds.has(poi.id) ? (
                            <span className="text-xs font-semibold" style={{ color: C.ok }}>
                              Added ✓
                            </span>
                          ) : (
                            <button
                              onClick={() => add(poi)}
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
