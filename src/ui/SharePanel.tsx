import { useState } from "react";
import type { TripInvite, TripMember, TripRole } from "../data/collab";
import { C } from "./theme";

// Owner-facing panel: invite people to a trip by email (as editor or viewer),
// manage still-pending invitations, and see/remove the people who've joined.
export function SharePanel({
  tripName,
  invites,
  members,
  busy,
  error,
  onInvite,
  onRevoke,
  onRemoveMember,
  onClose,
}: {
  tripName: string;
  invites: TripInvite[];
  members: TripMember[];
  busy: boolean;
  error: string | null;
  onInvite: (email: string, role: TripRole) => void;
  onRevoke: (id: string) => void;
  onRemoveMember: (userId: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TripRole>("editor");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed && !busy) {
      onInvite(trimmed, role);
      setEmail("");
    }
  };

  const joined = members.filter((m) => m.role !== "owner");

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
        invitation and can accept. Editors can change the trip; viewers can only look.
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
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as TripRole)}
          className="rounded-lg px-2 py-1.5 text-sm font-semibold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
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
      {joined.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
            People with access
          </div>
          {joined.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between py-1 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span>
                {m.email || m.user_id}
                <span className="ml-2 text-xs" style={{ color: C.sub }}>
                  {m.role}
                </span>
              </span>
              <button
                onClick={() => onRemoveMember(m.user_id)}
                title="Remove this person"
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.red }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {invites.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
            Pending invites
          </div>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between py-1 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span>
                {inv.email}
                <span className="ml-2 text-xs" style={{ color: C.sub }}>
                  {inv.role}
                </span>
              </span>
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
