import { C } from "./theme";

// A transient, dismissible banner about background reconciliation: a co-editor's
// change was auto-merged into the trip, or an edit couldn't be merged and the
// trip was reloaded to the latest. `tone` picks a neutral or warning accent.
export function SyncNotice({
  message,
  tone = "info",
  onDismiss,
}: {
  message: string;
  tone?: "info" | "warn";
  onDismiss: () => void;
}) {
  const accent = tone === "warn" ? C.red : C.line;
  return (
    <div
      className="rounded-xl p-3 mb-4 text-sm flex items-center justify-between gap-3"
      style={{ background: C.lineSoft, border: `1px solid ${accent}`, color: C.ink }}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="px-2 py-0.5 rounded-lg text-sm font-semibold whitespace-nowrap"
        style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
      >
        ✕
      </button>
    </div>
  );
}
