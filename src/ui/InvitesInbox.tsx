import type { TripInvite } from "../data/collab";
import { C } from "./theme";

// Shown above the app when you have pending trip invitations. Accepting one
// adds you to the trip and it appears in your picker.
export function InvitesInbox({
  invites,
  busyId,
  error,
  onAccept,
}: {
  invites: TripInvite[];
  busyId: string | null;
  error: string | null;
  onAccept: (id: string) => void;
}) {
  return (
    <div
      className="rounded-xl p-3 mb-4 text-sm flex flex-col gap-2"
      style={{ background: C.lineSoft, border: `1px solid ${C.line}`, color: C.ink }}
    >
      <div className="font-semibold" style={{ color: C.ink }}>
        {invites.length === 1 ? "You have a trip invitation" : `You have ${invites.length} trip invitations`}
      </div>
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between gap-3 flex-wrap">
          <span>
            <b>{inv.invited_by_email || "Someone"}</b> invited you to{" "}
            <b>{inv.trip_name || "a trip"}</b>
            {inv.role === "viewer" ? " (view only)" : ""}.
          </span>
          <button
            onClick={() => onAccept(inv.id)}
            disabled={busyId === inv.id}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
            style={{ border: `1px solid ${C.line}`, background: C.line, color: "#fff", opacity: busyId === inv.id ? 0.6 : 1 }}
          >
            {busyId === inv.id ? "Accepting…" : "Accept"}
          </button>
        </div>
      ))}
      {error && (
        <div className="text-xs" style={{ color: C.red }}>
          {error}
        </div>
      )}
    </div>
  );
}
