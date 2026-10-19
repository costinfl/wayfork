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

// Shown after the v1 → v2 upgrade pass wrote trips back (data/migrateStore.ts):
// how many were upgraded, how many places were guessed and need confirming,
// and the v1 originals kept in this browser for download.
export function V2MigrationBanner({
  upgraded,
  estimatedPlaces,
  failed,
  onReview,
  onDownloadBackup,
  onDismiss,
}: {
  upgraded: number;
  estimatedPlaces: number;
  failed: { id: string; error: string }[];
  onReview: (() => void) | null; // null = nothing to review
  onDownloadBackup: (() => void) | null; // null = no backup in this browser
  onDismiss: () => void;
}) {
  const btn = { border: `1px solid ${C.border}`, background: C.card, color: C.sub };
  return (
    <div
      className="rounded-xl p-3 mb-4 text-sm flex flex-col gap-2"
      style={{ background: C.amberBg, border: `1px solid ${C.amber}`, color: C.ink }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span>
          {upgraded > 0 && (
            <>
              {upgraded} trip{upgraded > 1 ? "s" : ""} upgraded to the new map format
              {estimatedPlaces > 0 && (
                <>
                  {" "}
                  · <b>{estimatedPlaces}</b> place{estimatedPlaces > 1 ? "s" : ""} estimated — please
                  confirm {estimatedPlaces > 1 ? "them" : "it"}
                </>
              )}
              .
            </>
          )}
        </span>
        <div className="flex gap-2 whitespace-nowrap">
          {onReview && (
            <button
              onClick={onReview}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.amber}`, background: C.amber, color: "#fff" }}
            >
              Review
            </button>
          )}
          {onDownloadBackup && (
            <button onClick={onDownloadBackup} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={btn}>
              Download v1 backup
            </button>
          )}
          <button onClick={onDismiss} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={btn}>
            Dismiss
          </button>
        </div>
      </div>
      {failed.length > 0 && (
        <div className="text-xs" style={{ color: C.red }}>
          Couldn't upgrade {failed.length} trip{failed.length > 1 ? "s" : ""} — {failed[0].error}. They still
          open normally and will be retried next time.
        </div>
      )}
    </div>
  );
}
