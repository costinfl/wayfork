import type { Trip } from "./types";

// Three-way merge for the optimistic-concurrency guard. When a save is rejected
// because the trip's version moved under it (a co-editor saved first), the
// client re-merges its edit against the latest remote document over their common
// ancestor and retries. Edits to *different* days/expenses/participants by two
// editors both survive; a genuine same-item clash resolves local-wins and is
// recorded so the UI can say so. Pure and framework-free — unit-tested.

// Structural equality independent of object key order (jsonb round-trips through
// Postgres do not preserve it). Mirrors stableStringify in data/repository.ts,
// duplicated here so the domain layer stays free of data-layer imports.
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
const sameJson = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

// A scalar (or nested-object) field: keep whichever side changed it from base;
// if both changed it to different values, keep local and flag the clash.
function mergeScalar<T>(base: T, local: T, remote: T, label: string, conflicts: string[]): T {
  const localChanged = !sameJson(local, base);
  const remoteChanged = !sameJson(remote, base);
  if (localChanged && remoteChanged && !sameJson(local, remote)) {
    conflicts.push(label);
    return local;
  }
  return localChanged ? local : remoteChanged ? remote : local;
}

interface Ided {
  id: string;
}

// Merge a collection of id-keyed items three ways. For each id: an item changed
// on only one side takes that side's value; changed on both to different values
// keeps local (clash flagged); added on only one side is kept; deleted on one
// side and untouched on the other is dropped; deleted on one but edited on the
// other keeps the edit (clash flagged). Result order follows local, then any
// remote-only additions appended.
function mergeCollection<T extends Ided>(
  base: T[],
  local: T[],
  remote: T[],
  label: (item: T) => string,
  conflicts: string[]
): T[] {
  const byId = (list: T[]) => new Map(list.map((i) => [i.id, i]));
  const b = byId(base);
  const l = byId(local);
  const r = byId(remote);

  const resolve = (id: string): T | null => {
    const bi = b.get(id);
    const li = l.get(id);
    const ri = r.get(id);
    if (li && ri) {
      const localChanged = !bi || !sameJson(li, bi);
      const remoteChanged = !bi || !sameJson(ri, bi);
      if (localChanged && remoteChanged && !sameJson(li, ri)) {
        conflicts.push(label(li));
        return li;
      }
      return localChanged ? li : remoteChanged ? ri : li;
    }
    if (li && !ri) {
      // Remote deleted (or never had) this item.
      if (bi && !sameJson(li, bi)) {
        conflicts.push(label(li)); // local edited what remote deleted → keep the edit
        return li;
      }
      return bi ? null : li; // base+untouched → honor remote's delete; else local addition
    }
    if (!li && ri) {
      // Local deleted (or never had) this item.
      if (bi && !sameJson(ri, bi)) {
        conflicts.push(label(ri)); // remote edited what local deleted → keep the edit
        return ri;
      }
      return bi ? null : ri; // base+untouched → honor local's delete; else remote addition
    }
    return null;
  };

  const orderedIds = [...local.map((i) => i.id), ...remote.filter((i) => !l.has(i.id)).map((i) => i.id)];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const v = resolve(id);
    if (v) out.push(v);
  }
  return out;
}

// Merge `local` (the editor's intended document) onto the latest `remote` over
// their common ancestor `base`. Identity (uid/owner/id) is taken from local; the
// caller stamps the authoritative version before re-saving. `conflicts` lists
// human-readable labels of any same-item clashes that were resolved local-wins.
export function mergeTrip(
  base: Trip,
  local: Trip,
  remote: Trip
): { merged: Trip; conflicts: string[] } {
  const conflicts: string[] = [];
  const name = mergeScalar(base.name, local.name, remote.name, "trip name", conflicts);
  const currencies = mergeScalar(
    base.currencies,
    local.currencies,
    remote.currencies,
    "trip currencies",
    conflicts
  );
  const participants = mergeCollection(
    base.participants,
    local.participants,
    remote.participants,
    (p) => `participant "${p.name}"`,
    conflicts
  );
  const days = mergeCollection(
    base.days,
    local.days,
    remote.days,
    (d) => `day ${d.date}`,
    conflicts
  ).sort((a, z) => a.date.localeCompare(z.date));
  const expenses = mergeCollection(
    base.expenses,
    local.expenses,
    remote.expenses,
    (e) => `expense "${e.label}"`,
    conflicts
  );

  const merged: Trip = { ...local, name, currencies, participants, days, expenses };
  return { merged, conflicts };
}
