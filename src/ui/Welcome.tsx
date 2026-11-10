import { C } from "./theme";

// First-run card: what Wayfork is for and where to start. Shown until
// dismissed (any action dismisses it), never to someone with their own trips.

export const WELCOMED_KEY = "wayfork.welcomed";

export function hasBeenWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, "1");
  } catch {
    /* per-session only */
  }
}

export function Welcome({
  onPlan,
  onExplore,
  onImport,
  onDismiss,
}: {
  onPlan: () => void;
  onExplore: () => void;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const primary = { background: C.line, color: C.onLine };
  const secondary = { border: `1px solid ${C.border}`, background: C.card, color: C.line };
  return (
    <section
      className="rounded-xl p-4 mb-4"
      style={{ background: C.lineSoft, border: `1px solid ${C.line}`, color: C.ink }}
      aria-label="Welcome to Wayfork"
    >
      <div className="flex items-start gap-2">
        <h2 className="font-bold text-lg flex-1">Welcome to Wayfork 👋</h2>
        <button onClick={onDismiss} aria-label="Dismiss welcome" style={{ color: C.sub }}>
          ✕
        </button>
      </div>
      <p className="text-sm mt-1 mb-3">
        Plan a trip where every leg can have <b>several options</b> — metro or taxi, museum or park. Pick one and the
        whole day recalculates: times, costs and the route on the map.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={onPlan} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={primary}>
          ✈️ Plan a new trip
        </button>
        <button onClick={onExplore} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={secondary}>
          👀 Explore the example
        </button>
        <button onClick={onImport} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={secondary}>
          📥 Import a trip
        </button>
      </div>
    </section>
  );
}
