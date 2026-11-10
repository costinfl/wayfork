import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { nextStep, TOUR_STEPS } from "../domain/tour";
import { C } from "./theme";

// The guided tour: a popover beside each anchored element, with a ring
// around it. Body-level and fixed, so it sits above the map and the sheet.

const anchorEl = (anchor: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);

export function Tour({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState<number | null>(() => nextStep(TOUR_STEPS, -1, 1, (a) => !!anchorEl(a)));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = idx === null ? null : TOUR_STEPS[idx];

  useEffect(() => {
    if (idx === null) onClose();
  }, [idx, onClose]);

  // Bring the anchor into view, then track its position.
  useLayoutEffect(() => {
    if (!step) return;
    const el = anchorEl(step.anchor);
    if (!el) return;
    if (step.anchor !== "map") el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    let raf = 0;
    const measure = () => {
      setRect(el.getBoundingClientRect());
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!step || idx === null) return null;
  const present = (a: string) => !!anchorEl(a);
  const back = nextStep(TOUR_STEPS, idx, -1, present);
  const next = nextStep(TOUR_STEPS, idx, 1, present);
  const shown = TOUR_STEPS.filter((s) => present(s.anchor));
  const position = shown.indexOf(step) + 1;

  // Popover: below the anchor when there is room, else above; the map step
  // (the whole viewport) gets a centred card.
  const W = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMap = step.anchor === "map";
  let style: React.CSSProperties = { left: Math.max(12, (vw - W) / 2 - (vw > 1024 ? 230 : 0)), top: vh / 2 - 80 };
  if (rect && !isMap) {
    const left = Math.min(Math.max(12, rect.left), vw - W - 12);
    style = rect.bottom + 180 < vh ? { left, top: rect.bottom + 10 } : { left, top: Math.max(12, rect.top - 190) };
  }

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 60, pointerEvents: "none" }}>
      {rect && !isMap && (
        <div
          className="fixed rounded-xl"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            border: `3px solid ${C.line}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
            transition: "all 0.2s",
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={`Tour: ${step.title}`}
        className="fixed rounded-xl p-4 shadow-2xl"
        style={{ ...style, width: W, background: C.card, color: C.ink, border: `1px solid ${C.border}`, pointerEvents: "auto" }}
      >
        <div className="text-xs font-semibold mb-1" style={{ color: C.sub }}>
          {position} of {shown.length}
        </div>
        <div className="font-bold mb-1">{step.title}</div>
        <p className="text-sm mb-3" style={{ color: C.sub }}>
          {step.body}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-sm underline" style={{ color: C.sub }}>
            Skip tour
          </button>
          <span className="flex-1" />
          {back !== null && (
            <button
              onClick={() => setIdx(back)}
              className="px-3 py-1 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, color: C.ink }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => (next === null ? onClose() : setIdx(next))}
            className="px-3 py-1 rounded-lg text-sm font-semibold"
            style={{ background: C.line, color: C.onLine }}
          >
            {next === null ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
