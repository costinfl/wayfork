import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { C } from "./theme";

// The map-first canvas: the trip map fills the viewport (TripMap renders into
// a body-level layer) and the planning UI — timeline, variants, ledger, forms —
// lives in this sheet floating over it. Desktop: a panel docked right that
// collapses to a tab. Mobile: a bottom sheet with three snap heights (peek /
// half / full), dragged by its handle or tapped to cycle.
//
// The sheet publishes how much of the viewport it covers so the map can keep
// fitted content out from under it (camera padding).

export interface SheetInset {
  right: number; // px covered on the right (desktop panel)
  bottom: number; // px covered at the bottom (mobile sheet)
}

const SheetInsetContext = createContext<SheetInset>({ right: 0, bottom: 0 });
export const useSheetInset = () => useContext(SheetInsetContext);

const DESKTOP_WIDTH = 460;
const GUTTER = 12;
type Snap = "peek" | "half" | "full";
const SNAP_ORDER: Snap[] = ["peek", "half", "full"];
const snapHeight = (snap: Snap, vh: number) =>
  snap === "peek" ? 132 : snap === "half" ? Math.round(vh * 0.5) : Math.round(vh * 0.92);

function useIsDesktop(): boolean {
  const query = "(min-width: 1024px)";
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return matches;
}

function useViewportHeight(): number {
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vh;
}

export function SideSheet({ children }: { children: ReactNode }) {
  const desktop = useIsDesktop();
  const vh = useViewportHeight();
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState<Snap>("half");
  // Live drag height (mobile), null when not dragging.
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y0: number; h0: number; moved: boolean } | null>(null);

  const mobileH = dragH ?? snapHeight(snap, vh);
  const inset: SheetInset = desktop
    ? { right: open ? DESKTOP_WIDTH + GUTTER * 2 : 0, bottom: 0 }
    : { right: 0, bottom: mobileH };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y0: e.clientY, h0: mobileH, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y0 - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragH(Math.min(vh * 0.95, Math.max(96, d.h0 + dy)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // A tap cycles peek → half → full → peek.
      setSnap((s) => SNAP_ORDER[(SNAP_ORDER.indexOf(s) + 1) % SNAP_ORDER.length]);
    } else if (dragH !== null) {
      // Snap to the nearest height.
      const nearest = SNAP_ORDER.reduce((best, s) =>
        Math.abs(snapHeight(s, vh) - dragH) < Math.abs(snapHeight(best, vh) - dragH) ? s : best
      );
      setSnap(nearest);
    }
    setDragH(null);
  };

  const surface = {
    background: "rgba(244,246,248,0.97)",
    color: C.ink,
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
    backdropFilter: "blur(8px)",
  };

  return (
    <SheetInsetContext.Provider value={inset}>
      {desktop ? (
        <>
          <aside
            aria-label="Trip planner"
            className="fixed rounded-2xl overflow-y-auto"
            style={{
              ...surface,
              zIndex: 10,
              top: GUTTER,
              bottom: GUTTER,
              right: GUTTER,
              width: DESKTOP_WIDTH,
              maxWidth: `calc(100vw - ${GUTTER * 2}px)`,
              transform: open ? "none" : `translateX(calc(100% + ${GUTTER * 2}px))`,
              transition: "transform 200ms ease",
            }}
          >
            <div className="sticky top-0 flex justify-end px-2 pt-2" style={{ zIndex: 5 }}>
              <button
                onClick={() => setOpen(false)}
                title="Hide the planner — show the whole map"
                aria-label="Hide planner"
                className="w-8 h-8 rounded-lg text-sm font-bold"
                style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
              >
                ⟩
              </button>
            </div>
            <div className="px-4 pb-6 -mt-6">{children}</div>
          </aside>
          {!open && (
            <button
              onClick={() => setOpen(true)}
              className="fixed px-3 py-2 rounded-xl text-sm font-semibold"
              style={{ zIndex: 10, top: GUTTER, right: GUTTER, background: C.card, color: C.line, boxShadow: surface.boxShadow }}
            >
              ⟨ Planner
            </button>
          )}
        </>
      ) : (
        <aside
          aria-label="Trip planner"
          className="fixed left-0 right-0 bottom-0 rounded-t-2xl flex flex-col"
          style={{
            ...surface,
            zIndex: 10,
            height: mobileH,
            transition: dragH === null ? "height 180ms ease" : "none",
          }}
        >
          <div
            role="button"
            aria-label="Resize planner"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSnap((s) => SNAP_ORDER[(SNAP_ORDER.indexOf(s) + 1) % SNAP_ORDER.length]);
              }
            }}
            className="flex justify-center py-2.5 shrink-0"
            style={{ touchAction: "none", cursor: "grab" }}
          >
            <span className="block w-10 h-1.5 rounded-full" style={{ background: C.ghost }} />
          </div>
          <div className="overflow-y-auto px-4 pb-6 flex-1">{children}</div>
        </aside>
      )}
    </SheetInsetContext.Provider>
  );
}
