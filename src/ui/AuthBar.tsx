import { useState } from "react";
import type { Session } from "../data/supabaseAuth";
import { C } from "./theme";

// Sign-in bar. Signed out: an email field that requests a magic link. Signed
// in: who you are and a way out. Trips follow the auth state — your account
// when signed in, this browser only when signed out.
export function AuthBar({
  session,
  onSignIn,
  onSignOut,
  isAdmin = false,
  onAdmin,
}: {
  session: Session | null;
  onSignIn: (email: string) => Promise<void>;
  onSignOut: () => void;
  isAdmin?: boolean;
  onAdmin?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const wrap = "rounded-xl p-3 mb-4 text-sm";
  const wrapStyle = { background: C.card, border: `1px solid ${C.border}`, color: C.sub };

  if (session) {
    return (
      <div className={`${wrap} flex items-center justify-between gap-3 flex-wrap`} style={wrapStyle}>
        <span>
          Signed in as <b style={{ color: C.ink }}>{session.user.email || "your account"}</b> — trips
          sync to your account.
        </span>
        <span className="flex items-center gap-2">
          {isAdmin && onAdmin && (
            <button
              onClick={onAdmin}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
              style={{ border: `1px solid ${C.line}`, background: C.lineSoft, color: C.line }}
            >
              🛠 Admin
            </button>
          )}
          <button
            onClick={onSignOut}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
            style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
          >
            Sign out
          </button>
        </span>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className={wrap} style={wrapStyle}>
        Check <b style={{ color: C.ink }}>{email}</b> for a sign-in link. Open it in this browser to
        finish signing in.{" "}
        <button
          onClick={() => setStatus("idle")}
          className="underline"
          style={{ color: C.line }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await onSignIn(trimmed);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send the sign-in link.");
    }
  };

  return (
    <div className={wrap} style={wrapStyle}>
      <form onSubmit={submit} className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold" style={{ color: C.ink }}>
          Sign in
        </span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[12rem]"
          style={{ border: `1px solid ${C.border}`, background: C.bg, color: C.ink }}
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap"
          style={{
            border: `1px solid ${C.line}`,
            background: C.lineSoft,
            color: C.line,
            opacity: status === "sending" ? 0.6 : 1,
          }}
        >
          {status === "sending" ? "Sending…" : "Email me a link"}
        </button>
      </form>
      {status === "error" && (
        <div className="mt-1.5 text-xs" style={{ color: C.red }}>
          {error}
        </div>
      )}
      <div className="mt-1.5 text-xs" style={{ color: C.sub }}>
        Signed out, trips are saved in this browser only.
      </div>
    </div>
  );
}
