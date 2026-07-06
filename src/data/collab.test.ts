import { describe, expect, it } from "vitest";
import { createCollabClient } from "./collab";

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

describe("createCollabClient", () => {
  it("creates an invite with normalized email and the trip context", async () => {
    const { calls, fetchFn } = stub(201, null);
    const collab = createCollabClient(config, fetchFn, async () => "jwt");
    await collab.createInvite({
      tripOwner: "owner-1",
      tripId: "trip-x",
      tripName: "Rome",
      email: "  Friend@Example.com ",
      role: "editor",
      invitedBy: "owner-1",
      invitedByEmail: "me@example.com",
    });
    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/trip_invites");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body[0]).toMatchObject({
      trip_owner: "owner-1",
      trip_id: "trip-x",
      trip_name: "Rome",
      email: "friend@example.com", // trimmed + lowercased
      role: "editor",
      invited_by: "owner-1",
      invited_by_email: "me@example.com",
    });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("lists my pending invites filtered by lowercased email", async () => {
    const { calls, fetchFn } = stub(200, []);
    await createCollabClient(config, fetchFn).listMyInvites("Me@Example.com");
    expect(calls[0].url).toContain("email=eq.me%40example.com");
    expect(calls[0].url).toContain("status=eq.pending");
  });

  it("accepts an invite through the RPC", async () => {
    const { calls, fetchFn } = stub(204, null);
    await createCollabClient(config, fetchFn).acceptInvite("invite-9");
    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/rpc/accept_invite");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ p_invite: "invite-9" });
  });

  it("revokes an invite by patching its status", async () => {
    const { calls, fetchFn } = stub(204, null);
    await createCollabClient(config, fetchFn).revokeInvite("invite-9");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(calls[0].url).toContain("id=eq.invite-9");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ status: "revoked" });
  });

  it("throws on HTTP errors", async () => {
    const { fetchFn } = stub(403, null);
    const collab = createCollabClient(config, fetchFn, async () => "jwt");
    await expect(collab.acceptInvite("x")).rejects.toThrow("HTTP 403");
  });
});
