import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import type { TripStore } from "./repository";

// Supabase-backed TripStore over the PostgREST API. Trips are stored as one
// jsonb document per row (table public.trips: id text pk, data jsonb),
// mirroring the TripStore granularity. Uses the publishable anon key — safe
// to ship in the client bundle; row-level security governs access.
export interface SupabaseConfig {
  url: string; // e.g. https://xyzcompany.supabase.co
  anonKey: string;
}

export function createSupabaseStore(
  config: SupabaseConfig,
  fetchFn: typeof fetch = fetch
): TripStore {
  const endpoint = `${config.url}/rest/v1/trips`;
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    "Content-Type": "application/json",
  };
  return {
    async list() {
      const res = await fetchFn(`${endpoint}?select=data&order=updated_at.asc`, { headers });
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
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([{ id: trip.id, data: trip }]),
      });
      if (!res.ok) throw new Error(`Supabase save failed: HTTP ${res.status}`);
    },
    async remove(id) {
      const res = await fetchFn(`${endpoint}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(`Supabase remove failed: HTTP ${res.status}`);
    },
  };
}
