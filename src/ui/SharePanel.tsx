import { useState } from "react";
import type { TripInvite } from "../data/collab";
import { C } from "./theme";

// Owner-facing panel to invite people to a trip by email and manage the
// still-pending invitations. Accepted collaborators simply gain access; the
// invite disappears from this list once accepted.
export function SharePanel({
  tripName,
  invites,
  busy,
  error,
  onInvite,
  onRevoke,
  onClose,
}: {
  tripName: string;
  invites: TripInvite[];
  busy: boolean;
  error: string | null;
  onInvite: (email: string) => void;
  onRevoke: (id: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed && !busy) {
      onInvite(trimmed);
      setEmail("");
    }
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-bold">Share “{tripName}”</div>
        <button onClick={onClose} className="text-xs px-2 py-0.5 rounded" style={{ border: `1px solid ${C.border}`, color: C.sub }}>
          Done
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: C.sub }}>
        Invite someone by email. When they sign in to Wayfork with that address they’ll see the
        invitation and can accept to edit this trip with you.
      </p>
      <form onSubmit={submit} className="flex items-center gap-2 flex-wrap mb-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@example.com"
          className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[12rem]"
          style={{ border: `1px solid ${C.border}`, background: C.bg, color: C.ink }}
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
          style={{ border: `1px solid ${C.line}`, background: C.line, color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Inviting…" : "Invite"}
        </button>
      </form>
      {error && (
        <div className="text-xs mb-2" style={{ color: C.red }}>
          {error}
        </div>
      )}
      {invites.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
            Pending invites
          </div>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between py-1 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span>{inv.email}</span>
              <button
                onClick={() => onRevoke(inv.id)}
                title="Revoke this invite"
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.red }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
