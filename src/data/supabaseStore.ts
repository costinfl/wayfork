import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import { TripConflictError, type TripStore } from "./repository";

const enc = encodeURIComponent;

// The version token lives in its own column, not the jsonb document, so strip a
// (possibly stale) copy before persisting; it is re-injected from the column on
// read, exactly like `owner`.
function stripVersion(trip: Trip): Omit<Trip, "version"> {
  const { version: _drop, ...rest } = trip;
  return rest;
}

// Re-inject the row's authoritative owner/version onto a parsed trip.
function withRowFields(trip: Trip, row: { owner?: unknown; version?: unknown }): Trip {
  return {
    ...trip,
    ...(typeof row.owner === "string" ? { owner: row.owner } : {}),
    ...(typeof row.version === "number" ? { version: row.version } : {}),
  };
}

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
  // Read the current stored row (owner/data/version) to re-merge against after a
  // rejected write. Returns null when the row is gone (deleted remotely).
  const fetchCurrent = async (owner: string | null, id: string): Promise<Trip | null> => {
    const scope = owner ? `owner=eq.${enc(owner)}&id=eq.${enc(id)}` : `id=eq.${enc(id)}`;
    const res = await fetchFn(`${endpoint}?${scope}&select=owner,data,version`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    const row = body[0] as { owner?: unknown; data?: unknown; version?: unknown };
    const { trip } = parseTrip(row.data);
    return trip ? withRowFields(trip, row) : null;
  };
  return {
    async list() {
      // Under collaboration RLS this returns owned AND shared trips; the row's
      // owner and version are injected onto each trip so writes route back to the
      // right row and carry the concurrency token.
      const res = await fetchFn(`${endpoint}?select=owner,data,version&order=updated_at.asc`, {
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
          return withRowFields(trip, r as { owner?: unknown; version?: unknown });
        })
        .filter((t): t is Trip => t !== null);
    },
    async save(trip) {
      // The owner is the trip's own owner when known (so editing a shared trip
      // updates the owner's row, permitted by RLS for editors), else the signed
      // -in user (a new/own trip). No owner at all only happens in the anon test
      // adapter; a signed-out app never writes remotely.
      const owner = trip.owner ?? (await getOwner());
      const data = stripVersion(trip);

      // A trip that was never read from the remote (no version) is new: insert
      // it. A primary-key collision (409) means the row already exists — a
      // conflict to re-merge, not a blind overwrite.
      if (trip.version === undefined) {
        const row = owner ? { id: trip.id, data, owner } : { id: trip.id, data };
        const res = await fetchFn(`${endpoint}?select=owner,data,version`, {
          method: "POST",
          headers: { ...(await authHeaders()), Prefer: "return=representation" },
          body: JSON.stringify([row]),
        });
        if (res.status === 409) throw new TripConflictError(await fetchCurrent(owner, trip.id));
        if (!res.ok) throw new Error(`Supabase save failed: HTTP ${res.status}`);
        const body = await res.json();
        const created = Array.isArray(body) && body[0] ? (body[0] as Record<string, unknown>) : {};
        return withRowFields({ ...trip, version: 0 }, created);
      }

      // Existing trip: a conditional update guarded on the expected version. The
      // BEFORE-UPDATE trigger bumps version, so a matched row comes back with the
      // new value; an empty result means the version moved (or the row is gone).
      const scope = owner
        ? `owner=eq.${enc(owner)}&id=eq.${enc(trip.id)}&version=eq.${trip.version}`
        : `id=eq.${enc(trip.id)}&version=eq.${trip.version}`;
      const res = await fetchFn(`${endpoint}?${scope}&select=owner,data,version`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), Prefer: "return=representation" },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) throw new Error(`Supabase save failed: HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (Array.isArray(body) && body.length > 0) {
        return withRowFields({ ...trip }, body[0] as Record<string, unknown>);
      }
      throw new TripConflictError(await fetchCurrent(owner, trip.id));
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
