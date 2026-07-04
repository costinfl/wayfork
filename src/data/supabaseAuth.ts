import type { SupabaseConfig } from "./supabaseStore";

// Minimal GoTrue (Supabase Auth) client over fetch, matching the library-free
// style of the PostgREST TripStore adapter. Implements passwordless email
// magic-link sign-in: request a link, then exchange the tokens the link
// redirects back with, persisting the session so a reload stays signed in.
// The access token is a short-lived JWT; the refresh token mints a new one
// when it nears expiry. Only three claims (sub/email/exp) are read from the
// JWT for display — the server verifies the signature on every request.

export interface AuthUser {
  id: string;
  email: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds when the access token expires
  user: AuthUser;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AuthClient {
  /** The current persisted session, or null when signed out. */
  getSession(): Session | null;
  /** Email a magic sign-in link that redirects the browser back to redirectTo. */
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  /** Parse tokens out of a magic-link redirect fragment (window.location.hash);
   *  persists and returns the session, or null when the fragment carries none. */
  consumeUrlTokens(hash: string): Promise<Session | null>;
  /** A valid access token, transparently refreshing one that is near expiry;
   *  null when signed out or the refresh is rejected. */
  getAccessToken(): Promise<string | null>;
  /** Revoke the session server-side (best effort) and clear it locally. */
  signOut(): Promise<void>;
}

const SESSION_KEY = "wayfork.session";
const EXPIRY_SKEW_S = 60; // refresh a minute before the token actually lapses

// Decode a JWT payload without verifying it — the values are only used for the
// signed-in display; the API enforces the signature on the wire.
function decodeJwt(token: string): { sub?: string; email?: string; exp?: number } {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function sessionFromTokens(
  accessToken: string,
  refreshToken: string,
  expiresAt?: number
): Session | null {
  const claims = decodeJwt(accessToken);
  if (!claims.sub) return null; // not a usable Supabase access token
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt ?? claims.exp ?? 0,
    user: { id: claims.sub, email: claims.email ?? "" },
  };
}

export function createAuthClient(
  config: SupabaseConfig,
  fetchFn: typeof fetch = fetch,
  storage: StorageLike = localStorage
): AuthClient {
  const authBase = `${config.url}/auth/v1`;
  const baseHeaders = { apikey: config.anonKey, "Content-Type": "application/json" };

  const load = (): Session | null => {
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      if (typeof s?.accessToken !== "string" || typeof s?.refreshToken !== "string") return null;
      return s;
    } catch {
      return null;
    }
  };

  let session: Session | null = load();

  const persist = (s: Session | null) => {
    session = s;
    try {
      if (s) storage.setItem(SESSION_KEY, JSON.stringify(s));
      else storage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable — keep the in-memory session */
    }
  };

  const refresh = async (): Promise<Session | null> => {
    if (!session) return null;
    const res = await fetchFn(`${authBase}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    }).catch(() => null);
    if (!res || !res.ok) {
      persist(null); // refresh token rejected/expired — force a fresh sign-in
      return null;
    }
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
    };
    if (!body.access_token || !body.refresh_token) {
      persist(null);
      return null;
    }
    const expiresAt =
      body.expires_at ?? Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600);
    const next = sessionFromTokens(body.access_token, body.refresh_token, expiresAt);
    persist(next);
    return next;
  };

  return {
    getSession() {
      return session;
    },

    async sendMagicLink(email, redirectTo) {
      const res = await fetchFn(`${authBase}/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ email, create_user: true }),
      });
      if (!res.ok) throw new Error(`Sign-in email failed: HTTP ${res.status}`);
    },

    async consumeUrlTokens(hash) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) return null;
      const expiresIn = Number(params.get("expires_in"));
      const expiresAt =
        Number.isFinite(expiresIn) && expiresIn > 0
          ? Math.floor(Date.now() / 1000) + expiresIn
          : undefined;
      const next = sessionFromTokens(accessToken, refreshToken, expiresAt);
      persist(next);
      return next;
    },

    async getAccessToken() {
      if (!session) return null;
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt && session.expiresAt - EXPIRY_SKEW_S <= now) {
        const refreshed = await refresh();
        return refreshed ? refreshed.accessToken : null;
      }
      return session.accessToken;
    },

    async signOut() {
      const current = session;
      persist(null);
      if (current) {
        await fetchFn(`${authBase}/logout`, {
          method: "POST",
          headers: { ...baseHeaders, Authorization: `Bearer ${current.accessToken}` },
        }).catch(() => {
          /* best effort — the session is already cleared locally */
        });
      }
    },
  };
}
