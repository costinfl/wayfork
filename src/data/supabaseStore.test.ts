import { describe, expect, it } from "vitest";
import { TRIPS } from "./index";
import { TripConflictError } from "./repository";
import { createSupabaseStore } from "./supabaseStore";
import type { Trip } from "../domain/types";

const config = { url: "https://example.supabase.co", anonKey: "anon-key" };

interface Call {
  url: string;
  init?: RequestInit;
}

// Single canned response for every call.
const stub = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

// A scripted sequence of responses (the last one repeats) — for save paths that
// make a follow-up GET to fetch the current row after a rejected write.
const stubSeq = (responses: { status: number; body: unknown }[]) => {
  const calls: Call[] = [];
  let i = 0;
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

const withVersion = (t: Trip, version: number, owner?: string): Trip => ({
  ...structuredClone(t),
  version,
  ...(owner ? { owner } : {}),
});

describe("createSupabaseStore", () => {
  it("lists trips from row data, injecting owner and version", async () => {
    const { calls, fetchFn } = stub(200, [
      { data: JSON.parse(JSON.stringify(TRIPS[0])), owner: "o1", version: 7 },
      { data: { nonsense: true } },
      "garbage",
    ]);
    const store = createSupabaseStore(config, fetchFn);
    const trips = await store.list();
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(TRIPS[0].id);
    expect(trips[0].owner).toBe("o1");
    expect(trips[0].version).toBe(7);
    expect(calls[0].url).toBe(
      "https://example.supabase.co/rest/v1/trips?select=owner,data,version&order=updated_at.asc"
    );
    expect((calls[0].init?.headers as Record<string, string>).apikey).toBe("anon-key");
  });

  it("inserts a brand-new trip (no version) and returns version 0", async () => {
    const { calls, fetchFn } = stub(201, [{ version: 0 }]);
    const saved = await createSupabaseStore(config, fetchFn).save(TRIPS[0]);
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>).Prefer).toBe("return=representation");
    expect(calls[0].url).not.toContain("on_conflict");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body[0].id).toBe(TRIPS[0].id);
    expect(body[0].data.name).toBe(TRIPS[0].name);
    expect(body[0].data.version).toBeUndefined(); // token lives in the column, not the document
    expect(saved.version).toBe(0);
  });

  it("inserts a new owned trip with its owner, not on_conflict", async () => {
    const { calls, fetchFn } = stub(201, [{ version: 0, owner: "user-1" }]);
    const store = createSupabaseStore(config, fetchFn, async () => "user-jwt", async () => "user-1");
    await store.save(TRIPS[0]);
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body[0].owner).toBe("user-1");
    expect(body[0].id).toBe(TRIPS[0].id);
  });

  it("updates an existing trip via a version-guarded PATCH and returns the bumped version", async () => {
    const { calls, fetchFn } = stub(200, [{ version: 3, owner: "user-1" }]);
    const store = createSupabaseStore(config, fetchFn, async () => "user-jwt", async () => "user-1");
    const saved = await store.save(withVersion(TRIPS[0], 2, "user-1"));
    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[0].url).toContain("owner=eq.user-1");
    expect(calls[0].url).toContain("version=eq.2"); // guarded on the expected version
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.data.name).toBe(TRIPS[0].name); // sends { data } only
    expect(body.data.version).toBeUndefined();
    expect(saved.version).toBe(3);
  });

  it("routes an editor's save of a shared trip to the owner's row", async () => {
    const shared = withVersion(TRIPS[0], 4, "other-owner");
    const { calls, fetchFn } = stub(200, [{ version: 5, owner: "other-owner" }]);
    const store = createSupabaseStore(config, fetchFn, async () => "jwt", async () => "me");
    await store.save(shared);
    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[0].url).toContain("owner=eq.other-owner"); // not the session user "me"
  });

  it("rejects a stale update with a TripConflictError carrying the current remote trip", async () => {
    const remote = JSON.parse(JSON.stringify(TRIPS[0]));
    const { fetchFn } = stubSeq([
      { status: 200, body: [] }, // PATCH matched no row (version moved)
      { status: 200, body: [{ owner: "user-1", data: remote, version: 9 }] }, // follow-up GET
    ]);
    const store = createSupabaseStore(config, fetchFn, async () => "jwt", async () => "user-1");
    const err = await store.save(withVersion(TRIPS[0], 2, "user-1")).catch((e) => e);
    expect(err).toBeInstanceOf(TripConflictError);
    expect((err as TripConflictError).remote?.version).toBe(9);
  });

  it("reports a delete as a conflict with a null remote", async () => {
    const { fetchFn } = stubSeq([
      { status: 200, body: [] }, // PATCH matched no row
      { status: 200, body: [] }, // follow-up GET finds nothing — row is gone
    ]);
    const store = createSupabaseStore(config, fetchFn, async () => "jwt", async () => "user-1");
    const err = await store.save(withVersion(TRIPS[0], 2, "user-1")).catch((e) => e);
    expect(err).toBeInstanceOf(TripConflictError);
    expect((err as TripConflictError).remote).toBeNull();
  });

  it("treats a 409 on insert as a conflict against the existing row", async () => {
    const remote = JSON.parse(JSON.stringify(TRIPS[0]));
    const { fetchFn } = stubSeq([
      { status: 409, body: null }, // INSERT hit the primary key
      { status: 200, body: [{ owner: "user-1", data: remote, version: 1 }] }, // GET current
    ]);
    const store = createSupabaseStore(config, fetchFn, async () => "jwt", async () => "user-1");
    const err = await store.save(TRIPS[0]).catch((e) => e);
    expect(err).toBeInstanceOf(TripConflictError);
    expect((err as TripConflictError).remote?.version).toBe(1);
  });

  it("sends the signed-in user's JWT as the bearer token", async () => {
    const { calls, fetchFn } = stub(200, []);
    const store = createSupabaseStore(config, fetchFn, async () => "user-jwt");
    await store.list();
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.apikey).toBe("anon-key"); // gateway key stays the anon key
    expect(headers.Authorization).toBe("Bearer user-jwt"); // RLS scopes to the user
  });

  it("falls back to the anon key when signed out", async () => {
    const { calls, fetchFn } = stub(200, []);
    await createSupabaseStore(config, fetchFn).list();
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer anon-key");
  });

  it("removes by id filter", async () => {
    const { calls, fetchFn } = stub(204, null);
    await createSupabaseStore(config, fetchFn).remove("trip x/1");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].url).toContain("id=eq.trip%20x%2F1");
  });

  it("throws on HTTP errors", async () => {
    const { fetchFn } = stub(500, null);
    const store = createSupabaseStore(config, fetchFn);
    await expect(store.list()).rejects.toThrow("HTTP 500");
    await expect(store.save(TRIPS[0])).rejects.toThrow("HTTP 500");
    await expect(store.remove("x")).rejects.toThrow("HTTP 500");
  });
});
