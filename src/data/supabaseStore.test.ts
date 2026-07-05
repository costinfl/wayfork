import { describe, expect, it } from "vitest";
import { TRIPS } from "./index";
import { createSupabaseStore } from "./supabaseStore";

const config = { url: "https://example.supabase.co", anonKey: "anon-key" };

interface Call {
  url: string;
  init?: RequestInit;
}

const stub = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("createSupabaseStore", () => {
  it("lists trips from row data, dropping invalid entries", async () => {
    const { calls, fetchFn } = stub(200, [
      { data: JSON.parse(JSON.stringify(TRIPS[0])) },
      { data: { nonsense: true } },
      "garbage",
    ]);
    const store = createSupabaseStore(config, fetchFn);
    const trips = await store.list();
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(TRIPS[0].id);
    expect(calls[0].url).toBe(
      "https://example.supabase.co/rest/v1/trips?select=data&order=updated_at.asc"
    );
    expect((calls[0].init?.headers as Record<string, string>).apikey).toBe("anon-key");
  });

  it("saves via an upsert POST", async () => {
    const { calls, fetchFn } = stub(201, null);
    await createSupabaseStore(config, fetchFn).save(TRIPS[0]);
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>).Prefer).toBe(
      "resolution=merge-duplicates"
    );
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body[0].id).toBe(TRIPS[0].id);
    expect(body[0].data.name).toBe(TRIPS[0].name);
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

  it("sends the owner and upserts on (owner, id) when signed in", async () => {
    const { calls, fetchFn } = stub(201, null);
    const store = createSupabaseStore(config, fetchFn, async () => "user-jwt", async () => "user-1");
    await store.save(TRIPS[0]);
    expect(calls[0].url).toContain("on_conflict=owner,id");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body[0].owner).toBe("user-1");
    expect(body[0].id).toBe(TRIPS[0].id);
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
