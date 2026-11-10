import { useEffect, useRef, useState } from "react";
import { searchNear } from "../domain/geocode";
import { fetchPoiPhotos } from "../domain/photos";
import type { Day } from "../domain/types";
import { fetchIdeas, guideTitle, WIKIVOYAGE, type Idea, type IdeaKind } from "../domain/wikivoyage";
import { C } from "./theme";

// Destination ideas from the city's Wikivoyage guide (See / Do / Eat), each
// addable to the day. Fetched only when opened. Listings without coordinates
// are placed by a Photon search near the city when added.

const TABS: { kind: IdeaKind; label: string }[] = [
  { kind: "see", label: "👁 See" },
  { kind: "do", label: "🎟 Do" },
  { kind: "eat", label: "🍽 Eat" },
];

export function IdeasPanel({
  day,
  canEdit,
  onAdd,
}: {
  day: Day;
  canEdit: boolean;
  onAdd: (p: { name: string; lat: number; lon: number; title: string }) => Promise<string[]>;
}) {
  const center = day.location ?? day.slots.find((s) => s.place)?.place ?? null;
  const city = center ? guideTitle(center.name) : null;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ city: string; status: "loading" | "done" | "none"; title?: string; ideas: Idea[] } | null>(null);
  const [tab, setTab] = useState<IdeaKind>("see");
  const [added, setAdded] = useState<Record<string, string>>({}); // name → "ok" | error
  const [photos, setPhotos] = useState<Record<string, string>>({}); // idea key → image URL
  const keyOf = (i: Idea) => `${i.kind}:${i.name}`;

  // One request per city; a result for a city no longer shown is dropped.
  const requested = useRef<string | null>(null);
  const cityRef = useRef(city);
  cityRef.current = city;
  useEffect(() => {
    if (!open || !city || requested.current === city) return;
    requested.current = city;
    setState({ city, status: "loading", ideas: [] });
    void fetchIdeas(city).then((r) => {
      if (cityRef.current !== city) return;
      setState(r && r.ideas.length ? { city, status: "done", title: r.title, ideas: r.ideas } : { city, status: "none", ideas: [] });
      if (r?.ideas.length) {
        setPhotos({});
        void fetchPoiPhotos(
          r.ideas.map((i) => ({ id: keyOf(i), commons: i.image, wikidata: i.wikidata, wikipedia: i.wikipedia }))
        ).then((p) => cityRef.current === city && setPhotos(p));
      }
    });
  }, [open, city]);

  const add = async (i: Idea) => {
    let at = i.lat !== null && i.lon !== null ? { lat: i.lat, lon: i.lon } : null;
    if (!at && center) {
      const found = await searchNear(i.name, center);
      at = found ? { lat: found.lat, lon: found.lon } : null;
    }
    if (!at) {
      setAdded((a) => ({ ...a, [i.name]: "couldn't find it on the map" }));
      return;
    }
    const errors = await onAdd({ name: `${i.name}, ${city}`, ...at, title: i.name });
    setAdded((a) => ({ ...a, [i.name]: errors.length ? errors.join("; ") : "ok" }));
  };

  const shown = state?.ideas.filter((i) => i.kind === tab) ?? [];
  return (
    <div className="rounded-xl mt-3" style={{ background: C.card, border: `1px solid ${C.border}` }} data-testid="ideas-panel">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 font-semibold text-sm flex items-center justify-between"
        style={{ color: C.ink }}
      >
        <span>💡 Ideas{city ? ` for ${city}` : ""} — Wikivoyage</span>
        <span style={{ color: C.sub }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm">
          {!city && <p style={{ color: C.sub }}>Give this day a location to see ideas for it.</p>}
          {state?.status === "loading" && <p style={{ color: C.sub }}>Reading the {city} guide…</p>}
          {state?.status === "none" && (
            <p style={{ color: C.sub }}>No Wikivoyage guide with listings for {city} (or it can't be reached right now).</p>
          )}
          {state?.status === "done" && (
            <>
              <div className="flex gap-1.5 mb-2" role="tablist">
                {TABS.map((t) => {
                  const n = state.ideas.filter((i) => i.kind === t.kind).length;
                  return (
                    <button
                      key={t.kind}
                      role="tab"
                      aria-selected={tab === t.kind}
                      onClick={() => setTab(t.kind)}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        border: `1px solid ${tab === t.kind ? C.line : C.border}`,
                        background: tab === t.kind ? C.lineSoft : C.card,
                        color: tab === t.kind ? C.line : C.sub,
                      }}
                    >
                      {t.label} · {n}
                    </button>
                  );
                })}
              </div>
              {shown.length === 0 && <p style={{ color: C.sub }}>Nothing listed here.</p>}
              <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {shown.map((i) => (
                  <li key={`${i.kind}-${i.name}`} className="rounded-lg px-3 py-2" style={{ border: `1px solid ${C.border}` }}>
                    <div className="flex items-start justify-between gap-2">
                      {photos[keyOf(i)] && (
                        <img
                          src={photos[keyOf(i)]}
                          alt=""
                          loading="lazy"
                          className="w-14 h-14 object-cover rounded-md shrink-0"
                          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold" style={{ color: C.ink }}>
                          {i.name}
                          {i.page !== state.title && (
                            <span className="font-normal text-xs ml-2" style={{ color: C.sub }}>
                              {i.page.split("/").pop()}
                            </span>
                          )}
                        </div>
                        {i.description && (
                          <p className="text-xs mt-0.5" style={{ color: C.sub }}>
                            {i.description}
                          </p>
                        )}
                      </div>
                      {canEdit &&
                        (added[i.name] === "ok" ? (
                          <span className="text-xs font-semibold shrink-0" style={{ color: C.ok }}>
                            Added ✓
                          </span>
                        ) : (
                          <button
                            onClick={() => void add(i)}
                            className="px-2 py-0.5 rounded-lg text-xs font-semibold shrink-0"
                            style={{ border: `1px solid ${C.line}`, background: C.lineSoft, color: C.line }}
                          >
                            + Add to day
                          </button>
                        ))}
                    </div>
                    {added[i.name] && added[i.name] !== "ok" && (
                      <p className="text-xs mt-1" style={{ color: C.amber }}>
                        {added[i.name]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-2" style={{ color: C.sub }}>
                From the{" "}
                <a href={`${WIKIVOYAGE}/wiki/${encodeURIComponent(state.title!.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer" style={{ color: C.line }}>
                  {state.title} guide on Wikivoyage ↗
                </a>{" "}
                (CC BY-SA)
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
