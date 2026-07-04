import type { Trip } from "../domain/types";
import { C } from "./theme";

// Offered once after sign-in when trips created while signed out are still in
// this browser: import (move) them into the account, or dismiss to leave them
// local.
export function MigrationBanner({
  trips,
  busy,
  onImport,
  onDismiss,
}: {
  trips: Trip[];
  busy: boolean;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const n = trips.length;
  return (
    <div
      className="rounded-xl p-3 mb-4 text-sm flex items-center justify-between gap-3 flex-wrap"
      style={{ background: C.lineSoft, border: `1px solid ${C.line}`, color: C.ink }}
    >
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
  );
}
