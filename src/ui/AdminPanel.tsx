import { useCallback, useEffect, useState } from "react";
import type { Session } from "../data/supabaseAuth";
import { SUPABASE_CONFIG } from "../data/supabaseConfig";
import { C, mono } from "./theme";

// Owner-only user management, backed by the admin-users edge function (the
// service-role operations live there — the client only sends the admin's JWT).
// Rendered by WayforkApp when the signed-in email matches ADMIN_EMAIL; the
// function re-checks that server-side, so this panel is convenience, not
// security.

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  disabled: boolean;
  ownedTrips: number;
  isAdmin: boolean;
}

const DEFAULT_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/admin-users`;

export default function AdminPanel({
  session,
  onClose,
  endpoint = DEFAULT_ENDPOINT,
  fetchFn = fetch,
}: {
  session: Session;
  onClose: () => void;
  endpoint?: string;
  fetchFn?: typeof fetch;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const call = useCallback(
    async (action: string, userId?: string): Promise<unknown> => {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          apikey: SUPABASE_CONFIG.anonKey,
        },
        body: JSON.stringify(userId ? { action, userId } : { action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; users?: AdminUser[] };
      if (!res.ok) throw new Error(body?.error || `Admin request failed (${res.status})`);
      return body;
    },
    [endpoint, fetchFn, session.accessToken]
  );

  const refresh = useCallback(() => {
    setError("");
    call("list")
      .then((body) => setUsers((body as { users: AdminUser[] }).users))
      .catch((e) => {
        setUsers([]);
        setError(e instanceof Error ? e.message : "Could not load users.");
      });
  }, [call]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (action: string, u: AdminUser) => {
    setBusyId(u.id);
    setError("");
    try {
      await call(action, u.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = (u: AdminUser) => {
    if (
      window.confirm(
        `Revoke ${u.email}'s shared-trip access and pending invites? They stay a normal user and keep every trip they own.`
      )
    ) {
      void act("revoke", u);
    }
  };

  const remove = (u: AdminUser) => {
    if (
      window.confirm(`Delete ${u.email} AND the ${u.ownedTrips} trip(s) they own? This cannot be undone.`) &&
      window.confirm(`Really delete ${u.email}? Last chance.`)
    ) {
      void act("delete", u);
    }
  };

  const btn = (label: string, onClick: () => void, tone: "line" | "amber" | "red", disabled: boolean) => {
    const color = tone === "line" ? C.line : tone === "amber" ? C.amber : C.red;
    const bg = tone === "line" ? C.lineSoft : tone === "amber" ? C.amberBg : C.redBg;
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="px-2 py-0.5 rounded-lg text-xs font-semibold"
        style={{ border: `1px solid ${color}`, background: bg, color, opacity: disabled ? 0.5 : 1 }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="rounded-xl p-4 mb-4 text-sm"
      style={{ background: C.card, border: `1px solid ${C.border}` }}
      data-testid="admin-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold" style={{ color: C.ink }}>
          🛠 User administration
        </h2>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
        >
          Close
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 mb-3 text-xs" style={{ background: C.redBg, color: C.red }}>
          {error}
        </div>
      )}

      {users === null ? (
        <p style={{ color: C.sub }}>Loading users…</p>
      ) : users.length === 0 ? (
        !error && <p style={{ color: C.sub }}>No users found.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
              style={{ border: `1px solid ${C.border}`, opacity: u.disabled ? 0.65 : 1 }}
            >
              <div className="min-w-0">
                <div className="font-semibold truncate" style={{ color: C.ink }}>
                  {u.email || u.id}
                  {u.isAdmin && (
                    <span
                      className="ml-2 px-1.5 py-0.5 rounded text-xs font-semibold"
                      style={{ background: C.lineSoft, color: C.line }}
                    >
                      admin
                    </span>
                  )}
                  {u.disabled && (
                    <span
                      className="ml-2 px-1.5 py-0.5 rounded text-xs font-semibold"
                      style={{ background: C.redBg, color: C.red }}
                    >
                      disabled
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: C.sub, ...mono }}>
                  {u.ownedTrips} trip{u.ownedTrips === 1 ? "" : "s"} · joined {u.createdAt.slice(0, 10)}
                  {u.lastSignInAt ? ` · seen ${u.lastSignInAt.slice(0, 10)}` : " · never signed in"}
                </div>
              </div>
              {!u.isAdmin && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {u.disabled
                    ? btn("Enable", () => void act("enable", u), "line", busyId === u.id)
                    : btn("Disable", () => void act("disable", u), "amber", busyId === u.id)}
                  {btn("Revoke invites", () => revoke(u), "amber", busyId === u.id)}
                  {btn("Delete + trips", () => remove(u), "red", busyId === u.id)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
