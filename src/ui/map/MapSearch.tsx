import { useEffect, useRef, useState } from "react";
import { searchPhoton, type PlaceHit } from "../../domain/geocode";

// Search box over the map: sights, streets and towns (Photon), biased to the
// map's centre. Debounced; a newer query aborts the older request.

export function MapSearch({
  near,
  onPick,
  theme,
}: {
  near: () => { lat: number; lon: number } | null;
  onPick: (hit: PlaceHit) => void;
  theme: { bg: string; fg: string; border: string };
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done">("idle");
  const [active, setActive] = useState(0);
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setHits([]);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setStatus("searching");
      void searchPhoton(query, nearRef.current(), fetch, ctrl.signal).then((r) => {
        if (ctrl.signal.aborted) return;
        setHits(r);
        setActive(0);
        setStatus("done");
      });
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const pick = (h: PlaceHit) => {
    onPick(h);
    setQ("");
    setHits([]);
    setStatus("idle");
  };

  return (
    <div className="relative w-64 max-w-[calc(100vw-24px)]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && hits[active]) pick(hits[active]);
          else if (e.key === "Escape") setQ("");
          else return;
          e.preventDefault();
        }}
        placeholder="🔍 Search places, sights, addresses"
        aria-label="Search the map"
        role="combobox"
        aria-expanded={hits.length > 0}
        className="w-full rounded-lg px-2.5 py-1.5 text-xs"
        style={{ background: theme.bg, color: theme.fg, border: `1px solid ${theme.border}` }}
      />
      {(hits.length > 0 || status === "searching" || (status === "done" && q.trim().length >= 3)) && (
        <ul
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg text-xs"
          style={{ background: theme.bg, color: theme.fg, border: `1px solid ${theme.border}`, zIndex: 3 }}
        >
          {status === "searching" && hits.length === 0 && <li className="px-2.5 py-2 opacity-70">Searching…</li>}
          {status === "done" && hits.length === 0 && <li className="px-2.5 py-2 opacity-70">Nothing found.</li>}
          {hits.map((h, i) => (
            <li key={`${h.title}-${h.place.lat}-${h.place.lon}`} role="option" aria-selected={i === active}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                onMouseEnter={() => setActive(i)}
                className="block w-full text-left px-2.5 py-1.5"
                style={{ background: i === active ? "rgba(59,130,246,0.25)" : "transparent" }}
              >
                <span className="font-semibold block">{h.title}</span>
                {h.detail && <span className="opacity-70 block">{h.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
