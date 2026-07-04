import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import type { TripStore } from "./repository";

// Supabase-backed TripStore over the PostgREST API. Trips are stored as one
// jsonb document per row (table public.trips: id text pk, data jsonb, owner
// uuid), mirroring the TripStore granularity. The publishable anon key is the
// API gateway key (safe in the client bundle); when a user is signed in their
// JWT rides in the Authorization header so per-user row-level security scopes
// every read and write to their own trips.
export interface SupabaseConfig {
  url: string; // e.g. https://xyzcompany.supabase.co
  anonKey: string;
}

export function createSupabaseStore(
  config: SupabaseConfig,
  fetchFn: typeof fetch = fetch,
  getToken: () => Promise<string | null> = async () => null
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
      const res = await fetchFn(`${endpoint}?select=data&order=updated_at.asc`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`Supabase list failed: HTTP ${res.status}`);
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) throw new Error("Supabase list: unexpected response shape");
      return rows
        .map((r) =>
          typeof r === "object" && r !== null
            ? parseTrip((r as { data?: unknown }).data).trip
            : null
        )
        .filter((t): t is Trip => t !== null);
    },
    async save(trip) {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { ...(await authHeaders()), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{ id: trip.id, data: trip }]),
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
