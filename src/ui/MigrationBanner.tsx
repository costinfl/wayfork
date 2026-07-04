import type { Trip } from "../domain/types";
import { C } from "./theme";

// Offered once after sign-in when trips created while signed out are still in
// this browser: import (move) them into the account, or dismiss to leave them
// local.
export function MigrationBanner({
  trips,
  busy,
  error,
  onImport,
  onDismiss,
}: {
  trips: Trip[];
  busy: boolean;
  error?: string | null;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const n = trips.length;
  return (
    <div
      className="rounded-xl p-3 mb-4 text-sm flex flex-col gap-2"
      style={{ background: C.lineSoft, border: `1px solid ${C.line}`, color: C.ink }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
      <span>
        {n} trip{n > 1 ? "s" : ""} saved in this browser
        {n <= 3 && <> — {trips.map((t) => t.name).join(", ")}</>}. Import{" "}
        {n > 1 ? "them" : "it"} into your account?
      </span>
      <div className="flex gap-2 whitespace-nowrap">
        <button
          onClick={onImport}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, background: C.line, color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Importing…" : "Import"}
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
        >
          Not now
        </button>
      </div>
      </div>
      {error && (
        <div className="text-xs" style={{ color: C.red }}>
          {error}
        </div>
      )}
    </div>
  );
}
