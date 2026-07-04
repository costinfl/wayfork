import { beforeEach, describe, expect, it } from "vitest";
import { createAuthClient } from "./supabaseAuth";

const config = { url: "https://example.supabase.co", anonKey: "anon-key" };

// A fake but structurally-valid JWT: header.payload.signature. decodeJwt reads
// the (standard-base64) payload; the signature is never checked client-side.
const makeJwt = (payload: Record<string, unknown>) =>
  `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify(payload))}.sig`;

interface Call {
  url: string;
  init?: RequestInit;
}

const stub = (responder: (url: string, init?: RequestInit) => { status: number; body?: unknown }) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const { status, body } = responder(u, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
  };
};

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;

describe("createAuthClient", () => {
  let storage: ReturnType<typeof memStorage>;
  beforeEach(() => {
    storage = memStorage();
  });

  it("emails a magic link to the OTP endpoint with the redirect", async () => {
    const { calls, fetchFn } = stub(() => ({ status: 200 }));
    const auth = createAuthClient(config, fetchFn, storage);
    await auth.sendMagicLink("traveler@example.com", "https://app/wayfork/");
    expect(calls[0].url).toBe(
      "https://example.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fapp%2Fwayfork%2F"
    );
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ email: "traveler@example.com", create_user: true });
    expect((calls[0].init?.headers as Record<string, string>).apikey).toBe("anon-key");
  });

  it("throws when the sign-in email fails", async () => {
    const { fetchFn } = stub(() => ({ status: 429 }));
    const auth = createAuthClient(config, fetchFn, storage);
    await expect(auth.sendMagicLink("x@y.z", "https://app/")).rejects.toThrow("HTTP 429");
  });

  it("consumes redirect tokens into a persisted session", async () => {
    const { fetchFn } = stub(() => ({ status: 200 }));
    const auth = createAuthClient(config, fetchFn, storage);
    const token = makeJwt({ sub: "user-1", email: "traveler@example.com", exp: future });
    const session = await auth.consumeUrlTokens(
      `#access_token=${token}&refresh_token=r1&expires_in=3600&token_type=bearer`
    );
    expect(session?.user).toEqual({ id: "user-1", email: "traveler@example.com" });
    expect(auth.getSession()?.accessToken).toBe(token);
    // A fresh client on the same storage stays signed in.
    const reloaded = createAuthClient(config, fetchFn, storage);
    expect(reloaded.getSession()?.user.id).toBe("user-1");
  });

  it("returns null (and stays signed out) for a hash without tokens", async () => {
    const { fetchFn } = stub(() => ({ status: 200 }));
    const auth = createAuthClient(config, fetchFn, storage);
    expect(await auth.consumeUrlTokens("#error=access_denied")).toBeNull();
    expect(auth.getSession()).toBeNull();
  });

  it("hands back the current token while it is still fresh", async () => {
    const { calls, fetchFn } = stub(() => ({ status: 200 }));
    const auth = createAuthClient(config, fetchFn, storage);
    const token = makeJwt({ sub: "u", exp: future });
    await auth.consumeUrlTokens(`#access_token=${token}&refresh_token=r1&expires_in=3600`);
    expect(await auth.getAccessToken()).toBe(token);
    expect(calls.some((c) => c.url.includes("grant_type=refresh_token"))).toBe(false);
  });

  it("refreshes an expired token", async () => {
    const fresh = makeJwt({ sub: "u", email: "e", exp: future });
    const { calls, fetchFn } = stub((url) =>
      url.includes("grant_type=refresh_token")
        ? { status: 200, body: { access_token: fresh, refresh_token: "r2", expires_in: 3600 } }
        : { status: 200 }
    );
    const auth = createAuthClient(config, fetchFn, storage);
    const stale = makeJwt({ sub: "u", exp: past });
    await auth.consumeUrlTokens(`#access_token=${stale}&refresh_token=r1&expires_in=-10`);
    expect(await auth.getAccessToken()).toBe(fresh);
    const refreshCall = calls.find((c) => c.url.includes("grant_type=refresh_token"));
    expect(JSON.parse(String(refreshCall?.init?.body)).refresh_token).toBe("r1");
    expect(auth.getSession()?.refreshToken).toBe("r2");
  });

  it("clears the session when the refresh token is rejected", async () => {
    const { fetchFn } = stub((url) =>
      url.includes("grant_type=refresh_token") ? { status: 400 } : { status: 200 }
    );
    const auth = createAuthClient(config, fetchFn, storage);
    const stale = makeJwt({ sub: "u", exp: past });
    await auth.consumeUrlTokens(`#access_token=${stale}&refresh_token=r1&expires_in=-10`);
    expect(await auth.getAccessToken()).toBeNull();
    expect(auth.getSession()).toBeNull();
  });

  it("signs out server-side and locally", async () => {
    const { calls, fetchFn } = stub(() => ({ status: 204 }));
    const auth = createAuthClient(config, fetchFn, storage);
    const token = makeJwt({ sub: "u", exp: future });
    await auth.consumeUrlTokens(`#access_token=${token}&refresh_token=r1&expires_in=3600`);
    await auth.signOut();
    expect(auth.getSession()).toBeNull();
    expect(storage.getItem("wayfork.session")).toBeNull();
    const logout = calls.find((c) => c.url.endsWith("/auth/v1/logout"));
    expect((logout?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });
});
