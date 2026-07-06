import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import type { TripStore } from "./repository";

// Supabase-backed TripStore over the PostgREST API. Trips are stored as one
// jsonb document per row (table public.trips: primary key (owner, id), data
// jsonb), mirroring the TripStore granularity. The publishable anon key is the
// API gateway key (safe in the client bundle); when a user is signed in their
// JWT rides in the Authorization header so per-user row-level security scopes
// every read and write to their own trips. Trip identity is per-user, so the
// owner is sent on writes and used as the upsert conflict target.
export interface SupabaseConfig {
  url: string; // e.g. https://xyzcompany.supabase.co
  anonKey: string;
}

export function createSupabaseStore(
  config: SupabaseConfig,
  fetchFn: typeof fetch = fetch,
  getToken: () => Promise<string | null> = async () => null,
  getOwner: () => Promise<string | null> = async () => null
): TripStore {
  const endpoint = `${config.url}/rest/v1/trips`;
  // Built per request: the access token may be refreshed between calls.
  const authHeaders = async () => {
    const token = (await getToken()) ?? config.anonKey;
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  };
  return {
    async list() {
      // Under collaboration RLS this returns owned AND shared trips; the row's
      // owner is injected onto each trip so writes route back to the right row.
      const res = await fetchFn(`${endpoint}?select=owner,data&order=updated_at.asc`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`Supabase list failed: HTTP ${res.status}`);
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) throw new Error("Supabase list: unexpected response shape");
      return rows
        .map((r) => {
          if (typeof r !== "object" || r === null) return null;
          const { trip } = parseTrip((r as { data?: unknown }).data);
          if (!trip) return null;
          const owner = (r as { owner?: unknown }).owner;
          return typeof owner === "string" ? { ...trip, owner } : trip;
        })
        .filter((t): t is Trip => t !== null);
    },
    async save(trip) {
      // Upsert on (owner, id) — the table's per-user primary key. The row's
      // owner is the trip's own owner when known (so editing a shared trip
      // updates the owner's row, permitted by RLS for editors), else the signed
      // -in user (a new/own trip). No owner at all only happens in the anon test
      // adapter; a signed-out app never writes remotely.
      const owner = trip.owner ?? (await getOwner());
      const row = owner ? { id: trip.id, data: trip, owner } : { id: trip.id, data: trip };
      const url = owner ? `${endpoint}?on_conflict=owner,id` : endpoint;
      const res = await fetchFn(url, {
        method: "POST",
        headers: { ...(await authHeaders()), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([row]),
      });
      if (!res.ok) throw new Error(`Supabase save failed: HTTP ${res.status}`);
    },
    async remove(id) {
      const res = await fetchFn(`${endpoint}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`Supabase remove failed: HTTP ${res.status}`);
    },
  };
}
