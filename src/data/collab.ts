import type { SupabaseConfig } from "./supabaseStore";

// Collaboration data layer over the PostgREST tables + accept_invite RPC (see
// supabase/migrations/0004_trip_collaboration.sql). Row-level security scopes
// every call: owners manage their trips' invites/members, invitees see and
// accept invites addressed to their email. Library-free, like the TripStore.

export type TripRole = "editor" | "viewer";

export interface TripInvite {
  id: string;
  trip_owner: string;
  trip_id: string;
  trip_name: string | null;
  email: string;
  role: TripRole;
  invited_by_email: string | null;
  status: string;
  created_at: string;
}

export interface TripMember {
  trip_owner: string;
  trip_id: string;
  user_id: string;
  role: string;
  added_at: string;
}

export interface NewInvite {
  tripOwner: string;
  tripId: string;
  tripName: string;
  email: string;
  role: TripRole;
  invitedBy: string;
  invitedByEmail: string;
}

export interface CollabClient {
  createInvite(input: NewInvite): Promise<void>;
  listTripInvites(tripOwner: string, tripId: string): Promise<TripInvite[]>;
  revokeInvite(id: string): Promise<void>;
  listMyInvites(myEmail: string): Promise<TripInvite[]>;
  acceptInvite(id: string): Promise<void>;
  listMembers(tripOwner: string, tripId: string): Promise<TripMember[]>;
}

export function createCollabClient(
  config: SupabaseConfig,
  fetchFn: typeof fetch = fetch,
  getToken: () => Promise<string | null> = async () => null
): CollabClient {
  const rest = `${config.url}/rest/v1`;
  const headers = async () => {
    const token = (await getToken()) ?? config.anonKey;
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  };
  const getJson = async <T>(path: string): Promise<T[]> => {
    const res = await fetchFn(`${rest}${path}`, { headers: await headers() });
    if (!res.ok) throw new Error(`Collab request failed: HTTP ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? (rows as T[]) : [];
  };
  const q = encodeURIComponent;
  return {
    async createInvite(i) {
      const res = await fetchFn(`${rest}/trip_invites`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify([
          {
            trip_owner: i.tripOwner,
            trip_id: i.tripId,
            trip_name: i.tripName,
            email: i.email.trim().toLowerCase(),
            role: i.role,
            invited_by: i.invitedBy,
            invited_by_email: i.invitedByEmail,
          },
        ]),
      });
      if (!res.ok) throw new Error(`Could not send the invite: HTTP ${res.status}`);
    },
    listTripInvites(tripOwner, tripId) {
      return getJson<TripInvite>(
        `/trip_invites?trip_owner=eq.${q(tripOwner)}&trip_id=eq.${q(tripId)}&status=eq.pending&select=*&order=created_at.asc`
      );
    },
    async revokeInvite(id) {
      const res = await fetchFn(`${rest}/trip_invites?id=eq.${q(id)}`, {
        method: "PATCH",
        headers: await headers(),
        body: JSON.stringify({ status: "revoked" }),
      });
      if (!res.ok) throw new Error(`Could not revoke the invite: HTTP ${res.status}`);
    },
    listMyInvites(myEmail) {
      return getJson<TripInvite>(
        `/trip_invites?email=eq.${q(myEmail.trim().toLowerCase())}&status=eq.pending&select=*&order=created_at.asc`
      );
    },
    async acceptInvite(id) {
      const res = await fetchFn(`${rest}/rpc/accept_invite`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ p_invite: id }),
      });
      if (!res.ok) throw new Error(`Could not accept the invite: HTTP ${res.status}`);
    },
    listMembers(tripOwner, tripId) {
      return getJson<TripMember>(
        `/trip_members?trip_owner=eq.${q(tripOwner)}&trip_id=eq.${q(tripId)}&select=*&order=added_at.asc`
      );
    },
  };
}
