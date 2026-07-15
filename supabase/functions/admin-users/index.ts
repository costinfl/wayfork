// Owner-only user administration. All operations here need the service-role
// key (auth admin API + cross-user rows), which must never reach the client
// bundle — the browser calls this function with the caller's JWT and the
// function gates on ADMIN_EMAIL before touching anything.
//
// POST { action: "list" }                       → { users: AdminUser[] }
// POST { action: "disable" | "enable", userId } → { ok: true }   (auth ban)
// POST { action: "revoke", userId }             → { ok: true }   (drop non-owner
//                                                 memberships + pending invites;
//                                                 owned trips are kept)
// POST { action: "delete", userId }             → { ok: true }   (owned trips,
//                                                 memberships, invites, account)
//
// Deploy with the ADMIN_EMAIL secret set; SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// A ban this long is "disabled"; ban_duration "none" lifts it.
const DISABLE_BAN = "876000h"; // ~100 years

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Resolve the caller from their JWT and gate on the admin email.
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt);
  const caller = callerData?.user;
  // The ADMIN_EMAIL secret overrides the baked-in default (which is already
  // public knowledge — the client bundle carries the same constant).
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") ?? "costinfl@gmail.com").toLowerCase();
  if (callerError || !caller || (caller.email ?? "").toLowerCase() !== adminEmail) {
    return json(403, { error: "Not authorized" });
  }

  let body: { action?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { action, userId } = body;

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return json(500, { error: error.message });
    const { data: tripRows, error: tripsError } = await admin.from("trips").select("owner");
    if (tripsError) return json(500, { error: tripsError.message });
    const ownedCounts = new Map<string, number>();
    for (const row of tripRows ?? []) {
      ownedCounts.set(row.owner, (ownedCounts.get(row.owner) ?? 0) + 1);
    }
    const users = data.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      // banned_until is set while a ban is active; exact-shape typing varies
      // across gotrue versions, so read it defensively.
      disabled: (() => {
        const until = (u as unknown as { banned_until?: string }).banned_until;
        return !!until && new Date(until).getTime() > Date.now();
      })(),
      ownedTrips: ownedCounts.get(u.id) ?? 0,
      isAdmin: (u.email ?? "").toLowerCase() === adminEmail,
    }));
    return json(200, { users });
  }

  if (!userId) return json(400, { error: "userId required" });
  if (userId === caller.id) return json(400, { error: "Refusing to modify the admin account" });

  const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(userId);
  if (targetError || !targetData?.user) return json(404, { error: "User not found" });
  const target = targetData.user;

  switch (action) {
    case "disable":
    case "enable": {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: action === "disable" ? DISABLE_BAN : "none",
      });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    case "revoke": {
      // Back to a normal user: no shared-trip access, no pending invites.
      // Trips they own (and memberships ON their owned trips) are untouched.
      const { error: memberError } = await admin
        .from("trip_members")
        .delete()
        .eq("user_id", userId)
        .neq("role", "owner");
      if (memberError) return json(500, { error: memberError.message });
      if (target.email) {
        const { error: inviteError } = await admin
          .from("trip_invites")
          .delete()
          .ilike("email", target.email)
          .eq("status", "pending");
        if (inviteError) return json(500, { error: inviteError.message });
      }
      return json(200, { ok: true });
    }

    case "delete": {
      // Owned trips cascade to their members/invites; the auth.users delete
      // then cascades any remaining memberships. Pending invites addressed to
      // the email have no FK, so clear them explicitly.
      const { error: tripsError } = await admin.from("trips").delete().eq("owner", userId);
      if (tripsError) return json(500, { error: tripsError.message });
      if (target.email) {
        await admin.from("trip_invites").delete().ilike("email", target.email);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    default:
      return json(400, { error: `Unknown action: ${action}` });
  }
});
