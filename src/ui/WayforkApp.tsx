import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { TRIPS } from "../data";
import { createLocalStorageStore } from "../data/localStorageStore";
import { mergeWithBuiltins, migrateLocalTrips, TripConflictError, tripsEqual } from "../data/repository";
import type { TripStore } from "../data/repository";
import { slotMarkerNumbers } from "../domain/geometry";
import { mergeTrip } from "../domain/merge";
import { createAuthClient } from "../data/supabaseAuth";
import type { AuthClient, Session } from "../data/supabaseAuth";
import { ADMIN_EMAIL, SUPABASE_CONFIG } from "../data/supabaseConfig";
import { createSupabaseStore } from "../data/supabaseStore";
import { convert, money, RATES_EUR } from "../domain/currency";
import type { RateMatrix } from "../domain/currency";
import { computeBalances, settle } from "../domain/ledger";
import {
  insertSlotAfter,
  moveSlot,
  newId,
  newUid,
  nextDate,
  removeDay,
  removeExpense,
  removeSlot,
  removeVariant,
  starterSlot,
  upsertDay,
  upsertExpense,
  upsertSlot,
  upsertVariant,
} from "../domain/mutate";
import type { Poi } from "../domain/poi";
import { estimateLeg } from "../domain/route";
import { fetchTransitPlan, previousPlace, transitItineraryToVariant } from "../domain/transit";
import DiscoverPanel, { anchorSlot } from "./DiscoverPanel";
import type { DiscoverQuery } from "./DiscoverPanel";
import { fetchRatesEUR } from "../domain/rates";
import { scaffoldMismatches } from "../domain/scaffold";
import { computeSchedule } from "../domain/schedule";
import { fmtDur, fmtOffset, fmtTime } from "../domain/time";
import { fetchDayWeather, RAIN_RISK_THRESHOLD } from "../domain/weather";
import type { DayWeather } from "../domain/weather";
import type { CurrencyView, Day, ExpenseItem, ItinerarySlot, Trip, VariantNode } from "../domain/types";
import { validateTrip } from "../domain/validate";
import { CheckpointBanner } from "./CheckpointBanner";
import { DayForm } from "./DayForm";
import { EstBadge } from "./EstBadge";
import { ExpenseForm } from "./ExpenseForm";
import { SlotForm } from "./SlotForm";
import { TripForm } from "./TripForm";
import { StepChip } from "./StepChip";
import { C, mono } from "./theme";
import { createCollabClient } from "../data/collab";
import type { MyMembership, TripInvite, TripMember, TripRole } from "../data/collab";
import { AuthBar } from "./AuthBar";
import AdminPanel from "./AdminPanel";
import { InvitesInbox } from "./InvitesInbox";
import { SharePanel } from "./SharePanel";
import { MigrationBanner } from "./MigrationBanner";
import { PlanTripForm } from "./PlanTripForm";
import { SyncNotice } from "./SyncNotice";
import { UploadTrip } from "./UploadTrip";
import type { AddTripResult } from "./UploadTrip";
import { VariantCard } from "./VariantCard";
import { VariantForm } from "./VariantForm";
import { WeatherBadge } from "./WeatherBadge";
import type { DayMapHandle } from "./DayMap";

// Leaflet + its CSS load only when the map actually renders (kept out of the
// entry bundle). See DayMap.tsx.
const DayMap = lazy(() => import("./DayMap"));

// Reactive media query — drives the timeline/map two-column split. Guards
// against environments without matchMedia (jsdom).
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const CCY_VIEWS: CurrencyView[] = ["home", "local", "intl"];

// A trip's client identity: its surrogate uid, falling back to the logical id
// for any fixture predating it (production trips always carry a uid). Keying
// selection by uid keeps trips distinct even once they can be shared across
// accounts, where logical ids may repeat.
const uidOf = (t: Trip): string => t.uid ?? t.id;

// Background sync cadence: how often a signed-in session re-polls the account
// store so edits made on another device appear here.
const SYNC_INTERVAL_MS = 15000;
// After a local write, ignore poll results briefly so an in-flight save's stale
// read can't momentarily revert the optimistic update.
const SYNC_WRITE_GRACE_MS = 4000;

const DEFAULT_LOCAL_STORE = createLocalStorageStore();
// Auth + per-user remote store. Signed-in requests carry the user's JWT so
// row-level security scopes trips to their account; signed-out users stay on
// localStorage and never consult the remote store.
const DEFAULT_AUTH = SUPABASE_CONFIG.url ? createAuthClient(SUPABASE_CONFIG) : null;
const DEFAULT_REMOTE_STORE = DEFAULT_AUTH
  ? createSupabaseStore(
      SUPABASE_CONFIG,
      fetch,
      () => DEFAULT_AUTH.getAccessToken(),
      async () => DEFAULT_AUTH.getSession()?.user.id ?? null
    )
  : null;
// Collaboration API (invites + membership); shares the auth token with the store.
const DEFAULT_COLLAB = DEFAULT_AUTH
  ? createCollabClient(SUPABASE_CONFIG, fetch, () => DEFAULT_AUTH.getAccessToken())
  : null;

// Test seam: every external client is injectable, defaulting to the real
// module-level instance — runtime behavior is unchanged. The locals shadow the
// old constant names so the component body reads exactly as before.
export interface WayforkDeps {
  localStore?: TripStore;
  auth?: AuthClient | null;
  remoteStore?: TripStore | null;
  collab?: ReturnType<typeof createCollabClient> | null;
}

export default function WayforkApp({ deps = {} }: { deps?: WayforkDeps } = {}) {
  const LOCAL_STORE = deps.localStore ?? DEFAULT_LOCAL_STORE;
  const AUTH = deps.auth !== undefined ? deps.auth : DEFAULT_AUTH;
  const REMOTE_STORE = deps.remoteStore !== undefined ? deps.remoteStore : DEFAULT_REMOTE_STORE;
  const COLLAB = deps.collab !== undefined ? deps.collab : DEFAULT_COLLAB;
  const [storedTrips, setStoredTrips] = useState<Trip[]>([]);
  const [tripUid, setTripUid] = useState(uidOf(TRIPS[0]));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tripForm, setTripForm] = useState<"new" | "settings" | null>(null);
  const [store, setStore] = useState<TripStore>(LOCAL_STORE);
  const [storeLabel, setStoreLabel] = useState("local browser");
  const [session, setSession] = useState<Session | null>(() => AUTH?.getSession() ?? null);
  // Trips still in this browser that could be imported into the account.
  const [migratable, setMigratable] = useState<Trip[]>([]);
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  // Transient banner about background reconciliation (a co-editor's change was
  // auto-merged, or an unmergeable edit was reloaded to the latest).
  const [syncNote, setSyncNote] = useState<{ message: string; tone: "info" | "warn" } | null>(null);
  // Last server-confirmed snapshot per uid — the common ancestor a re-merge
  // builds on when a save is rejected. Fed by every store read (initial load and
  // background poll) and by successful saves, never the optimistic local edit,
  // so it holds exactly the version the pending edit descended from.
  const lastSyncedRef = useRef<Map<string, Trip>>(new Map());
  const rememberSynced = (trips: Trip[]) => {
    for (const t of trips) lastSyncedRef.current.set(uidOf(t), t);
  };
  // Collaboration: invites addressed to me (inbox) and the share panel for the
  // current trip. reloadKey re-runs the trip load after accepting an invite.
  const [reloadKey, setReloadKey] = useState(0);
  const [myInvites, setMyInvites] = useState<TripInvite[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [tripInvites, setTripInvites] = useState<TripInvite[]>([]);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // My role on each trip I can access (owner rows are implicit — not stored here).
  const [myMemberships, setMyMemberships] = useState<MyMembership[]>([]);

  // Complete a magic-link sign-in: exchange the tokens in the redirect
  // fragment for a session, then scrub them out of the URL.
  useEffect(() => {
    if (!AUTH) return;
    let cancelled = false;
    void AUTH.consumeUrlTokens(window.location.hash).then((s) => {
      if (!s || cancelled) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setSession(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load trips from the store that matches the auth state: the per-user remote
  // store when signed in, the browser store otherwise. Re-runs on sign in/out.
  useEffect(() => {
    let cancelled = false;
    const signedIn = !!session && !!REMOTE_STORE;
    const active = signedIn ? REMOTE_STORE! : LOCAL_STORE;
    const useLocal = () =>
      LOCAL_STORE.list().then((trips) => {
        if (cancelled) return;
        setStore(LOCAL_STORE);
        setStoreLabel("local browser");
        rememberSynced(trips);
        setStoredTrips(trips);
        setMigratable([]);
      });
    active
      .list()
      .then(async (trips) => {
        if (cancelled) return;
        setStore(active);
        setStoreLabel(signedIn ? "Supabase (your account)" : "local browser");
        rememberSynced(trips);
        setStoredTrips(trips);
        if (signedIn) {
          // Offer to import any trips still sitting in this browser.
          const accountIds = new Set(trips.map((t) => t.id));
          const pending = (await LOCAL_STORE.list()).filter((t) => !accountIds.has(t.id));
          if (!cancelled) setMigratable(pending);
        } else {
          setMigratable([]);
        }
      })
      .catch(() => {
        if (!cancelled && active !== LOCAL_STORE) void useLocal(); // remote unreachable
      });
    return () => {
      cancelled = true;
    };
  }, [session, reloadKey]);

  // Load pending invitations addressed to the signed-in user (the inbox) and my
  // role on each shared trip (to enforce viewer read-only).
  useEffect(() => {
    if (!COLLAB || !session) {
      setMyInvites([]);
      setMyMemberships([]);
      return;
    }
    let cancelled = false;
    if (session.user.email) {
      COLLAB.listMyInvites(session.user.email)
        .then((invites) => !cancelled && setMyInvites(invites))
        .catch(() => {});
    }
    COLLAB.listMyMemberships(session.user.id)
      .then((m) => !cancelled && setMyMemberships(m))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, reloadKey]);

  const importLocalTrips = async () => {
    if (!REMOTE_STORE) return;
    setMigrating(true);
    setMigrateError(null);
    markLocalWrite();
    try {
      const { imported, failed } = await migrateLocalTrips(
        LOCAL_STORE,
        REMOTE_STORE,
        storedTrips.map((t) => t.id)
      );
      const moved = migratable.filter((t) => imported.includes(t.id));
      if (moved.length) {
        setStoredTrips((prev) => [...prev.filter((t) => !imported.includes(t.id)), ...moved]);
      }
      // Keep only trips that failed to import in the banner, and say why.
      setMigratable((prev) => prev.filter((t) => failed.some((f) => f.id === t.id)));
      if (failed.length) {
        setMigrateError(
          `Couldn't import ${failed.length} trip${failed.length > 1 ? "s" : ""} — ${failed[0].error}. They're still saved in this browser.`
        );
      }
    } catch (e) {
      setMigrateError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setMigrating(false);
    }
  };

  // Keep the trip list live: signed in, poll the account store on an interval
  // (and immediately when the tab regains focus) so edits from another device
  // appear; signed out, react to localStorage writes from other tabs. A poll
  // only replaces state when the content actually changed (tripsEqual), and is
  // skipped right after a local write so it can't revert an optimistic update.
  // An informational merge note clears itself; a warning stays until dismissed.
  useEffect(() => {
    if (syncNote?.tone !== "info") return;
    const id = setTimeout(() => setSyncNote(null), 6000);
    return () => clearTimeout(id);
  }, [syncNote]);

  const syncPausedUntil = useRef(0);
  const markLocalWrite = () => {
    syncPausedUntil.current = Date.now() + SYNC_WRITE_GRACE_MS;
  };
  useEffect(() => {
    let cancelled = false;
    const refreshFrom = (s: TripStore, guardEmpty = false) =>
      s
        .list()
        .then((trips) => {
          if (cancelled) return;
          // A background poll that suddenly returns nothing is almost always a
          // transient blip (a lapsed access token answered as anon, RLS yielding
          // an empty set), not a real "every trip was deleted". Replacing state
          // with [] would drop the selected trip and snap the picker back to a
          // built-in — so ignore an empty poll while we still hold trips. The
          // next non-empty poll (or a reload) reconciles.
          if (guardEmpty && trips.length === 0) return;
          rememberSynced(trips); // these are the merge bases for later saves
          setStoredTrips((prev) => (tripsEqual(prev, trips) ? prev : trips));
        })
        .catch(() => {
          /* transient — try again next tick */
        });

    if (session && REMOTE_STORE) {
      const tick = async () => {
        if (document.hidden || Date.now() < syncPausedUntil.current) return;
        // Signed in but the token has lapsed and can't refresh: skip this poll
        // rather than fetch as anon (which RLS answers with an empty list).
        if (AUTH && !(await AUTH.getAccessToken())) return;
        void refreshFrom(REMOTE_STORE, true);
      };
      const id = setInterval(tick, SYNC_INTERVAL_MS);
      const onVisible = () => {
        if (!document.hidden) void tick();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        cancelled = true;
        clearInterval(id);
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "wayfork.trips") void refreshFrom(LOCAL_STORE);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, [session]);

  const signIn = async (email: string) => {
    if (!AUTH) throw new Error("Sign-in is not configured.");
    await AUTH.sendMagicLink(email, window.location.href.split("#")[0]);
  };
  const signOut = () => {
    AUTH?.signOut().catch(() => {
      /* session already cleared locally */
    });
    setSession(null);
  };

  // Live ECB rates, fetched once at load; the built-in snapshot is the fallback.
  const [rates, setRates] = useState<RateMatrix>(RATES_EUR);
  const [ratesLabel, setRatesLabel] = useState("built-in snapshot");
  useEffect(() => {
    let cancelled = false;
    fetchRatesEUR(Object.keys(RATES_EUR))
      .then(({ rates: live, date }) => {
        if (!cancelled) {
          setRates(live);
          setRatesLabel(`ECB ${date}`);
        }
      })
      .catch(() => {
        /* offline or blocked — stay on the built-in snapshot */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allTrips = mergeWithBuiltins(TRIPS, storedTrips);
  const trip = allTrips.find((t) => uidOf(t) === tripUid) ?? TRIPS[0];
  const isStored = storedTrips.some((t) => t.id === trip.id);
  const isBuiltin = TRIPS.some((b) => b.id === trip.id);
  const isOverride = isStored && isBuiltin; // edited copy of a shipped trip

  // Collaboration derived state. A trip is "shared with me" when its row is
  // owned by someone else; I can share a trip that lives in my account and
  // isn't itself shared in. tripOwnerId is the row owner to address invites to.
  const myId = session?.user.id ?? null;
  const isSharedWithMe = !!(myId && trip.owner && trip.owner !== myId);
  const canShare = !!(session && isStored && !isSharedWithMe);
  const tripOwnerId = trip.owner ?? myId;

  // My role on the current trip: owner for my own/local trips, else my
  // membership role (default viewer). Viewers get a read-only view.
  const membershipRole = myMemberships.find(
    (m) => m.trip_owner === trip.owner && m.trip_id === trip.id
  )?.role;
  const myRole = !session || !trip.owner || trip.owner === myId ? "owner" : membershipRole ?? "viewer";
  const canEdit = myRole !== "viewer";

  // Close the share panel when switching trips.
  useEffect(() => {
    setShareOpen(false);
    setShareError(null);
  }, [tripUid]);

  const refreshShare = () => {
    if (!COLLAB || !tripOwnerId) return;
    COLLAB.listTripInvites(tripOwnerId, trip.id)
      .then(setTripInvites)
      .catch(() => setTripInvites([]));
    COLLAB.listMembers(tripOwnerId, trip.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  };

  const openShare = () => {
    setShareError(null);
    setTripInvites([]);
    setMembers([]);
    setShareOpen(true);
    refreshShare();
  };

  const inviteToTrip = async (email: string, role: TripRole) => {
    if (!COLLAB || !session?.user.email || !tripOwnerId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      await COLLAB.createInvite({
        tripOwner: tripOwnerId,
        tripId: trip.id,
        tripName: trip.name,
        email,
        role,
        invitedBy: session.user.id,
        invitedByEmail: session.user.email,
      });
      refreshShare();
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not send the invite.");
    } finally {
      setShareBusy(false);
    }
  };

  const revokeInvite = (id: string) => {
    if (!COLLAB) return;
    COLLAB.revokeInvite(id)
      .then(refreshShare)
      .catch((e) => setShareError(e instanceof Error ? e.message : "Could not revoke the invite."));
  };

  const removeMember = (userId: string) => {
    if (!COLLAB || !tripOwnerId) return;
    COLLAB.removeMember(tripOwnerId, trip.id, userId)
      .then(refreshShare)
      .catch((e) => setShareError(e instanceof Error ? e.message : "Could not remove the member."));
  };

  const leaveTrip = () => {
    if (!COLLAB || !trip.owner || !myId) return;
    COLLAB.leaveTrip(trip.owner, trip.id, myId)
      .then(() => {
        setTripUid(uidOf(TRIPS[0]));
        setReloadKey((k) => k + 1);
      })
      .catch((e) => console.error("leave trip failed:", e));
  };

  const acceptInvite = async (id: string) => {
    if (!COLLAB) return;
    setAcceptingId(id);
    setInboxError(null);
    try {
      await COLLAB.acceptInvite(id);
      setMyInvites((prev) => prev.filter((i) => i.id !== id));
      setReloadKey((k) => k + 1); // pull in the newly-shared trip
    } catch (e) {
      setInboxError(e instanceof Error ? e.message : "Could not accept the invite.");
    } finally {
      setAcceptingId(null);
    }
  };

  // Persist an edit with the optimistic-concurrency guard. On a rejected save
  // (a co-editor saved first) re-merge the local intent onto the latest remote
  // over their common ancestor and retry against the fresh version. Bails to the
  // caller's reload path if the merge can't be validated or the trip is gone.
  const persist = async (next: Trip): Promise<{ saved: Trip; merged: boolean }> => {
    let attempt = next;
    let merged = false;
    for (let i = 0; i < 3; i++) {
      try {
        return { saved: await store.save(attempt), merged };
      } catch (e) {
        if (!(e instanceof TripConflictError) || !e.remote) throw e;
        const base = lastSyncedRef.current.get(uidOf(next)) ?? e.remote;
        const result = mergeTrip(base, next, e.remote);
        if (validateTrip(result.merged).length) throw e;
        attempt = { ...result.merged, version: e.remote.version };
        merged = true;
      }
    }
    throw new TripConflictError(null); // retries exhausted (rapid third-party writes)
  };

  const saveTrip = (next: Trip) => {
    markLocalWrite();
    setStoredTrips((prev) => [...prev.filter((t) => t.id !== next.id), next]); // optimistic
    void persist(next)
      .then(({ saved, merged }) => {
        markLocalWrite(); // the merge round-trip may have outlasted the first grace
        lastSyncedRef.current.set(uidOf(saved), saved);
        setStoredTrips((prev) => [...prev.filter((t) => t.id !== saved.id), saved]);
        if (merged) setSyncNote({ message: "Merged an update from another editor.", tone: "info" });
      })
      .catch(async (e) => {
        if (!(e instanceof TripConflictError)) {
          console.error("trip save failed:", e);
          return;
        }
        // Unmergeable (invalid merge or deleted remotely): reload the latest so
        // the user is editing real state, and say what happened.
        try {
          const trips = await store.list();
          rememberSynced(trips);
          setStoredTrips(trips);
        } catch {
          /* transient — the poll will reconcile */
        }
        setSyncNote({
          message: "This trip changed elsewhere and couldn't be auto-merged — reloaded to the latest.",
          tone: "warn",
        });
      });
  };

  const addTrip = (t: Trip): AddTripResult => {
    if (TRIPS.some((b) => b.id === t.id)) {
      return { error: `A built-in trip already uses the id "${t.id}" — give the trip a different id.` };
    }
    // A pasted trip whose id matches an existing (non-built-in) trip is an AI
    // enrichment of that scaffold: overwrite the same row in place (reuse its
    // uid/owner/version) instead of creating a duplicate, and soft-compare the
    // days/dates/locations that were meant to be copied verbatim.
    const scaffold = storedTrips.find((x) => x.id === t.id);
    let warnings: string[] | undefined;
    let trip: Trip;
    if (scaffold) {
      warnings = scaffoldMismatches(scaffold, t);
      trip = { ...t, uid: scaffold.uid ?? newUid(), owner: scaffold.owner, version: scaffold.version };
    } else {
      // Stamp a stable uid now (uploaded JSON usually has none) so the trip keeps
      // one identity across reads and can later be shared.
      trip = t.uid ? t : { ...t, uid: newUid() };
    }
    saveTrip(trip);
    setTripUid(uidOf(trip));
    if (!warnings?.length) setUploadOpen(false);
    return { warnings };
  };

  // A freshly planned scaffold: persist it and open it (its id is newly minted,
  // so there is no collision or replacement to worry about).
  const createScaffold = (t: Trip) => {
    saveTrip(t);
    setTripUid(uidOf(t));
  };

  const removeCurrentTrip = () => {
    markLocalWrite();
    store.remove(trip.id).catch((e) => console.error("trip remove failed:", e));
    setStoredTrips((prev) => prev.filter((t) => t.id !== trip.id));
    if (!isBuiltin) setTripUid(uidOf(TRIPS[0])); // resetting an override keeps it selected
  };

  const saveTripForm = (t: Trip): string[] => {
    const errors = validateTrip(t);
    if (errors.length) return errors;
    saveTrip(t);
    setTripUid(uidOf(t));
    setTripForm(null);
    return [];
  };

  const [adminOpen, setAdminOpen] = useState(false);
  const isAdmin =
    !!session && (session.user.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // Desktop wide view: ~92% of the window instead of the mobile-first 672px
  // column. Default on (persisted per browser); the toggle hides below lg.
  const [wide, setWide] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wayfork.wideView") !== "0";
    } catch {
      return true;
    }
  });
  const toggleWide = () =>
    setWide((w) => {
      try {
        localStorage.setItem("wayfork.wideView", w ? "0" : "1");
      } catch {
        /* storage unavailable — session-only toggle */
      }
      return !w;
    });

  return (
    <div className="min-h-screen py-6 px-4" style={{ background: C.bg, color: C.ink }}>
      <div className={wide ? "w-[92%] max-w-none mx-auto" : "max-w-2xl mx-auto"}>
        {AUTH && (
          <AuthBar
            session={session}
            onSignIn={signIn}
            onSignOut={signOut}
            isAdmin={isAdmin}
            onAdmin={() => setAdminOpen((o) => !o)}
          />
        )}
        {isAdmin && adminOpen && session && (
          <AdminPanel session={session} onClose={() => setAdminOpen(false)} />
        )}
        {migratable.length > 0 && (
          <MigrationBanner
            trips={migratable}
            busy={migrating}
            error={migrateError}
            onImport={importLocalTrips}
            onDismiss={() => {
              setMigratable([]);
              setMigrateError(null);
            }}
          />
        )}
        {myInvites.length > 0 && (
          <InvitesInbox invites={myInvites} busyId={acceptingId} error={inboxError} onAccept={acceptInvite} />
        )}
        {syncNote && (
          <SyncNotice
            message={syncNote.message}
            tone={syncNote.tone}
            onDismiss={() => setSyncNote(null)}
          />
        )}
        <div className="mb-4 flex justify-end gap-2 flex-wrap">
          <button
            onClick={toggleWide}
            title={wide ? "Center the app in a narrow column" : "Use the whole window width"}
            className="hidden lg:inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
          >
            {wide ? "⇥ Narrow" : "⇔ Wide"}
          </button>
          {allTrips.length > 1 && (
            <select
              value={uidOf(trip)}
              onChange={(e) => setTripUid(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
            >
              {allTrips.map((t) => {
                const stored = storedTrips.some((s) => s.id === t.id);
                const builtin = TRIPS.some((b) => b.id === t.id);
                return (
                  <option key={uidOf(t)} value={uidOf(t)}>
                    {t.name}
                    {stored ? (builtin ? " (edited)" : " (uploaded)") : ""}
                  </option>
                );
              })}
            </select>
          )}
          {isStored && !isSharedWithMe && (
            <button
              onClick={removeCurrentTrip}
              title={isOverride ? "Reset to the built-in version" : "Remove this uploaded trip"}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.red }}
            >
              {isOverride ? "↺" : "✕"}
            </button>
          )}
          {isSharedWithMe && (
            <button
              onClick={leaveTrip}
              title="Leave this shared trip"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.red }}
            >
              Leave
            </button>
          )}
          {canShare && (
            <button
              onClick={() => (shareOpen ? setShareOpen(false) : openShare())}
              title="Invite people to plan this trip with you"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{
                border: `1px solid ${shareOpen ? C.line : C.border}`,
                background: shareOpen ? C.lineSoft : C.card,
                color: C.line,
              }}
            >
              Share
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setTripForm(tripForm === "settings" ? null : "settings")}
              title="Trip settings (name, currencies, participants)"
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{
                border: `1px solid ${tripForm === "settings" ? C.line : C.border}`,
                background: tripForm === "settings" ? C.lineSoft : C.card,
                color: C.sub,
              }}
            >
              ⚙
            </button>
          )}
          <button
            onClick={() => setTripForm(tripForm === "new" ? null : "new")}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{
              border: `1px solid ${tripForm === "new" ? C.line : C.border}`,
              background: tripForm === "new" ? C.lineSoft : C.card,
              color: C.line,
            }}
          >
            + New trip
          </button>
          <button
            onClick={() => setUploadOpen((o) => !o)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{
              border: `1px solid ${uploadOpen ? C.line : C.border}`,
              background: uploadOpen ? C.lineSoft : C.card,
              color: C.line,
            }}
          >
            + Add trip
          </button>
        </div>
        {shareOpen && canShare && (
          <SharePanel
            tripName={trip.name}
            invites={tripInvites}
            members={members}
            busy={shareBusy}
            error={shareError}
            onInvite={inviteToTrip}
            onRevoke={revokeInvite}
            onRemoveMember={removeMember}
            onClose={() => setShareOpen(false)}
          />
        )}
        {uploadOpen && (
          <>
            <PlanTripForm onCreate={createScaffold} />
            <UploadTrip onLoaded={addTrip} />
          </>
        )}
        {tripForm !== null && (
          <TripForm
            key={`${tripForm}-${uidOf(trip)}`}
            initial={tripForm === "settings" ? trip : null}
            onSave={saveTripForm}
            onCancel={() => setTripForm(null)}
          />
        )}
        <TripView
          key={uidOf(trip)}
          trip={trip}
          rates={rates}
          ratesLabel={ratesLabel}
          storeLabel={storeLabel}
          canEdit={canEdit}
          onTripChange={saveTrip}
        />
      </div>
    </div>
  );
}

// Exported for component tests only — the app always renders it via WayforkApp.
export function TripView({
  trip,
  rates,
  ratesLabel,
  storeLabel,
  canEdit,
  onTripChange,
}: {
  trip: Trip;
  rates: RateMatrix;
  ratesLabel: string;
  storeLabel: string;
  canEdit: boolean;
  onTripChange: (next: Trip) => void;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  const day = trip.days[dayIdx] ?? trip.days[0];

  const [dayStarts, setDayStarts] = useState<Record<string, number>>(() =>
    Object.fromEntries(trip.days.map((d) => [d.id, d.startTimeMin]))
  );
  const [activeVariants, setActiveVariants] = useState<Record<string, string>>(() =>
    Object.fromEntries(trip.days.flatMap((d) => d.slots).map((s) => [s.id, s.defaultVariantId]))
  );
  const [ccyView, setCcyView] = useState<CurrencyView>("local");

  // Per-day forecast, fetched once per day (null = no forecast available).
  const [weather, setWeather] = useState<Record<string, DayWeather | null>>({});
  useEffect(() => {
    const loc = day.location;
    if (!loc || weather[day.id] !== undefined) return;
    let cancelled = false;
    fetchDayWeather(loc, day.date).then((w) => {
      if (!cancelled) setWeather((prev) => ({ ...prev, [day.id]: w }));
    });
    return () => {
      cancelled = true;
    };
  }, [day.id, day.date, day.location, weather]);
  const dayWeather = day.location ? weather[day.id] : undefined;

  const viewCcy = trip.currencies[ccyView];
  const dayStart = dayStarts[day.id] ?? day.startTimeMin;

  const schedule = useMemo(
    () => computeSchedule({ ...day, startTimeMin: dayStart }, activeVariants),
    [day, dayStart, activeVariants]
  );
  // Same numbering as the day map's numbered markers (slotMarkerNumbers is
  // shared with DayMap.tsx) — lets the timeline show which marker a slot is.
  const markerNumbers = useMemo(() => slotMarkerNumbers(day), [day]);

  // Projection covers the active variants of ALL days, not just the visible one.
  const variantCostEUR = useMemo(
    () =>
      trip.days.reduce(
        (total, d) =>
          total +
          computeSchedule({ ...d, startTimeMin: dayStarts[d.id] ?? d.startTimeMin }, activeVariants).reduce(
            (s, r) => s + convert(r.variant.cost.amount, r.variant.cost.currency, "EUR", rates),
            0
          ),
        0
      ),
    [trip.days, dayStarts, activeVariants, rates]
  );

  const expensesEUR = useMemo(
    () => trip.expenses.reduce((s, e) => s + convert(e.amount, e.currency, "EUR", rates), 0),
    [trip.expenses, rates]
  );

  const balances = useMemo(() => computeBalances(trip, rates), [trip, rates]);
  const txns = useMemo(() => settle(balances), [balances]);
  const pName = (id: string) => trip.participants.find((p) => p.id === id)?.name || id;

  // Expense CRUD: null = closed, "new" = add form, otherwise the expense being edited.
  const [expenseForm, setExpenseForm] = useState<"new" | ExpenseItem | null>(null);

  // Itinerary CRUD state.
  const [editMode, setEditMode] = useState(false);
  const [slotForm, setSlotForm] = useState<"new" | ItinerarySlot | null>(null);
  const [variantForm, setVariantForm] = useState<{ slotId: string; variant: VariantNode | null } | null>(null);
  const [editError, setEditError] = useState<string[]>([]);

  // Day-journey map: always shown beside the timeline on wide viewports, a
  // toggleable panel below the breakpoint.
  const isWide = useMediaQuery("(min-width: 1024px)");
  const [mapOpen, setMapOpen] = useState(false);
  const showMap = isWide || mapOpen;
  const dayMapRef = useRef<DayMapHandle>(null);
  const focusVariant = (slotId: string, variantId: string) => {
    setMapOpen(true);
    // Let the (lazy) map mount/paint before panning to the segment.
    setTimeout(() => dayMapRef.current?.focusSegment(slotId, variantId), 60);
  };
  const activateVariant = (slotId: string, variantId: string) =>
    setActiveVariants((s) => ({ ...s, [slotId]: variantId }));

  // Validate, then persist through the repository; returns the problems.
  const applyTrip = (next: Trip): string[] => {
    const errors = validateTrip(next);
    if (!errors.length) {
      onTripChange(next);
      setEditError([]);
    }
    return errors;
  };

  const saveExpense = (exp: ExpenseItem): string[] => {
    const errors = applyTrip(upsertExpense(trip, exp));
    if (!errors.length) setExpenseForm(null);
    return errors;
  };

  const saveSlot = (slot: ItinerarySlot): string[] => {
    const errors = applyTrip(upsertSlot(trip, day.id, slot));
    if (!errors.length) setSlotForm(null);
    return errors;
  };

  // Discover state shared between panel and map: the anchor slot new places
  // chain after (null = last placed slot), and the last executed search so
  // the map can draw its center/radius/pins. Both reset when the day changes.
  const [discoverAnchorId, setDiscoverAnchorId] = useState<string | null>(null);
  const [discoverQuery, setDiscoverQuery] = useState<DiscoverQuery | null>(null);
  useEffect(() => {
    setDiscoverAnchorId(null);
    setDiscoverQuery(null);
  }, [day.id]);

  // One-click add from the Discover panel: a slot at the POI's place,
  // inserted right after the anchor, connected by a real (estimated) leg —
  // OSRM-routed walk ≤2.5km, drive beyond, haversine fallback. The anchor
  // then advances to the new slot so subsequent adds chain onwards.
  const addPoiSlot = async (poi: Poi): Promise<string[]> => {
    const anchor = anchorSlot(day, discoverAnchorId);
    const slot = starterSlot(trip.currencies.local, poi.name);
    slot.place = { name: poi.name, lat: poi.lat, lon: poi.lon };
    if (anchor?.place) {
      const leg = await estimateLeg(anchor.place, slot.place);
      slot.variants[0].microSteps = [
        {
          id: newId("ms"),
          type: leg.type,
          label: `${leg.type === "walk" ? "Walk" : "Drive"} from ${anchor.place.name}`,
          durationMin: leg.durationMin,
          distanceKm: leg.distanceKm,
        },
      ];
      slot.variants[0].estimated = true;
    }
    const errors = applyTrip(insertSlotAfter(trip, day.id, anchor?.id ?? null, slot));
    if (!errors.length) setDiscoverAnchorId(slot.id);
    return errors;
  };

  const saveVariant = (slotId: string) => (variant: VariantNode): string[] => {
    const errors = applyTrip(upsertVariant(trip, slotId, variant));
    if (!errors.length) setVariantForm(null);
    return errors;
  };

  // One-click "add a real transit option" beside "+ variant": routes from the
  // nearest earlier placed slot to this one via Transitous, and saves the
  // best itinerary as a new variant (with its own route geometry for the map).
  const [transitBusyId, setTransitBusyId] = useState<string | null>(null);
  const [transitError, setTransitError] = useState<{ slotId: string; message: string } | null>(null);

  const addTransitOption = async (slot: ItinerarySlot) => {
    const origin = previousPlace(day, slot.id);
    if (!origin || !slot.place) return;
    setTransitBusyId(slot.id);
    setTransitError(null);
    try {
      const itinerary = await fetchTransitPlan(origin, slot.place);
      if (!itinerary) {
        setTransitError({
          slotId: slot.id,
          message: "No transit options found — the routing service may be unavailable.",
        });
        return;
      }
      const variant = transitItineraryToVariant(itinerary, trip.currencies.local);
      const errors = saveVariant(slot.id)(variant);
      if (errors.length) setTransitError({ slotId: slot.id, message: errors.join("; ") });
    } finally {
      setTransitBusyId(null);
    }
  };

  const [dayForm, setDayForm] = useState<"new" | Day | null>(null);

  const saveDay = (d: Day): string[] => {
    const errors = applyTrip(upsertDay(trip, d));
    if (!errors.length) {
      setDayForm(null);
      setDayStarts((s) => ({ ...s, [d.id]: d.startTimeMin }));
    }
    return errors;
  };

  const removeCurrentDay = () => {
    const errors = applyTrip(removeDay(trip, day.id));
    setEditError(errors);
    if (!errors.length) setDayIdx(0);
  };

  const editBtn = { border: `1px solid ${C.border}`, background: C.card, color: C.sub };

  const projectedEUR = expensesEUR + variantCostEUR;

  const dateRange =
    trip.days.length > 1
      ? `${trip.days[0].date} → ${trip.days[trip.days.length - 1].date}`
      : trip.days[0].date;

  return (
    <>
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs font-bold tracking-widest uppercase" style={{ color: C.line }}>
              Wayfork
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{trip.name}</h1>
            <div className="text-sm" style={{ color: C.sub }}>
              {trip.participants.map((p) => p.name).join(" · ")} — {dateRange}
            </div>
          </div>
          {/* Tri-currency toggle */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {CCY_VIEWS.map((k) => (
              <button
                key={k}
                onClick={() => setCcyView(k)}
                className="px-3 py-1.5 text-sm font-semibold"
                style={{
                  background: ccyView === k ? C.ink : C.card,
                  color: ccyView === k ? "#fff" : C.sub,
                }}
              >
                {trip.currencies[k]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Day tabs */}
      {(trip.days.length > 1 || editMode) && (
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          {trip.days.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setDayIdx(i)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{
                background: i === dayIdx ? C.line : C.card,
                color: i === dayIdx ? "#fff" : C.sub,
                border: `1px solid ${i === dayIdx ? C.line : C.border}`,
              }}
            >
              Day {i + 1}
              <span className="ml-2 text-xs font-normal" style={{ ...mono, opacity: 0.8 }}>
                {d.date.slice(5)}
              </span>
            </button>
          ))}
          {editMode && (
            <>
              <button
                onClick={() => setDayForm(dayForm !== "new" && dayForm?.id === day.id ? null : day)}
                className="text-xs px-2 py-1 rounded"
                style={editBtn}
              >
                ✎ day
              </button>
              <button
                onClick={() => setDayForm(dayForm === "new" ? null : "new")}
                className="text-xs px-2 py-1 rounded"
                style={{ ...editBtn, color: C.line }}
              >
                + day
              </button>
              {trip.days.length > 1 && (
                <button
                  onClick={removeCurrentDay}
                  title="Delete the selected day"
                  className="text-xs px-2 py-1 rounded"
                  style={{ ...editBtn, color: C.red }}
                >
                  ✕ day
                </button>
              )}
            </>
          )}
        </div>
      )}
      {editMode && dayForm !== null && (
        <DayForm
          key={dayForm === "new" ? "new" : dayForm.id}
          trip={trip}
          initial={dayForm === "new" ? null : dayForm}
          defaultDate={nextDate(trip.days[trip.days.length - 1].date)}
          onSave={saveDay}
          onCancel={() => setDayForm(null)}
        />
      )}

      {/* Mobile map toggle (desktop shows the map beside the timeline) */}
      <div className="lg:hidden mb-3">
        <button
          onClick={() => setMapOpen((o) => !o)}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{
            border: `1px solid ${mapOpen ? C.line : C.border}`,
            background: mapOpen ? C.lineSoft : C.card,
            color: C.line,
          }}
        >
          🗺 {mapOpen ? "Hide map" : "Show journey map"}
        </button>
      </div>

      {/* Timeline + day-journey map (two columns on wide viewports) */}
      <div className="flex flex-col lg:flex-row lg:gap-6 lg:items-start mb-6">
        {showMap && (
          <div className="order-first lg:order-2 lg:w-2/5 lg:sticky lg:top-4 mb-4 lg:mb-0">
            <Suspense
              fallback={
                <div
                  className="rounded-xl flex items-center justify-center text-sm"
                  style={{ height: 420, border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
                >
                  Loading map…
                </div>
              }
            >
              <DayMap
                ref={dayMapRef}
                day={day}
                activeVariants={activeVariants}
                onActivate={activateVariant}
                discover={discoverQuery}
              />
            </Suspense>
            <DiscoverPanel
              day={day}
              canEdit={canEdit}
              anchorId={discoverAnchorId}
              onAnchorChange={setDiscoverAnchorId}
              onAdd={addPoiSlot}
              onResults={setDiscoverQuery}
            />
          </div>
        )}
      <section className="rounded-xl p-4 lg:order-1 lg:flex-1 lg:min-w-0" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold flex items-center gap-2 flex-wrap">
            Day {dayIdx + 1} — {day.date}
            {dayWeather && <WeatherBadge weather={dayWeather} place={day.location!.name} />}
          </h2>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={() => {
                  setEditMode((e) => !e);
                  setSlotForm(null);
                  setVariantForm(null);
                  setEditError([]);
                }}
                className="px-3 py-1 rounded-lg text-sm font-semibold"
                style={{
                  border: `1px solid ${editMode ? C.line : C.border}`,
                  background: editMode ? C.lineSoft : C.card,
                  color: C.line,
                }}
              >
                {editMode ? "Done" : "Edit"}
              </button>
            )}
          <label className="flex items-center gap-2 text-sm" style={{ color: C.sub }}>
            Depart
            <input
              type="time"
              value={fmtTime(dayStart)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (!Number.isNaN(h)) setDayStarts((s) => ({ ...s, [day.id]: h * 60 + m }));
              }}
              className="rounded px-2 py-1 text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, ...mono, color: C.ink }}
            />
          </label>
          </div>
        </div>

        {editError.length > 0 && (
          <div className="rounded-md px-3 py-2 mb-3 text-xs" style={{ background: C.redBg, color: C.red }}>
            {editError.map((e, i) => (
              <div key={i}>• {e}</div>
            ))}
          </div>
        )}

        <div className="relative" style={{ borderLeft: `3px solid ${C.line}`, marginLeft: 8 }}>
          {schedule.map((row) => (
            <div key={row.slot.id} className="relative pl-5 pb-6">
              <span
                className="absolute rounded-full"
                style={{ left: -8, top: 4, width: 13, height: 13, background: C.card, border: `3px solid ${C.line}` }}
              />
              <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                <span className="text-sm font-bold" style={{ ...mono, color: C.line }}>
                  {fmtTime(row.start)}–{fmtTime(row.end)}
                </span>
                {row.tzOffsetMin !== 0 && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "#EEF2F6", color: C.sub, ...mono }}
                    title={`Local time here is ${fmtOffset(row.tzOffsetMin)} from the day's start zone${day.tz ? ` (${day.tz})` : ""}`}
                  >
                    🕓 {fmtOffset(row.tzOffsetMin)}
                  </span>
                )}
                {showMap && markerNumbers.has(row.slot.id) && (
                  <span
                    title={`Map marker ${markerNumbers.get(row.slot.id)}`}
                    className="inline-flex items-center justify-center rounded-full text-xs font-semibold"
                    style={{ width: 18, height: 18, background: C.line, color: "#fff" }}
                  >
                    {markerNumbers.get(row.slot.id)}
                  </span>
                )}
                <span className="font-semibold">{row.slot.title}</span>
                <span className="text-xs" style={{ color: C.sub, ...mono }}>
                  {fmtDur(row.duration)}
                </span>
                {row.tzShiftMin !== 0 && (
                  <span className="text-xs font-medium" style={{ color: C.line }}>
                    🕓 clocks {fmtOffset(row.tzShiftMin)}
                  </span>
                )}
              </div>

              {row.checkpoint && <CheckpointBanner cp={row.checkpoint} />}

              {row.slot.variants.length > 1 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {row.slot.variants.map((v) => (
                    <VariantCard
                      key={v.id}
                      variant={v}
                      active={v.id === row.variant.id}
                      ccyView={ccyView}
                      tripCcy={trip.currencies}
                      rates={rates}
                      rainRisk={!!dayWeather && dayWeather.precipProb >= RAIN_RISK_THRESHOLD}
                      onSelect={() => setActiveVariants((s) => ({ ...s, [row.slot.id]: v.id }))}
                      onFocus={row.slot.place ? () => focusVariant(row.slot.id, v.id) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {row.variant.microSteps.map((ms) => (
                    <StepChip key={ms.id} ms={ms} />
                  ))}
                </div>
              )}

              {editMode && (
                <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                  <button
                    onClick={() => {
                      setSlotForm(row.slot);
                      setVariantForm(null);
                    }}
                    className="text-xs px-2 py-0.5 rounded"
                    style={editBtn}
                  >
                    ✎ slot
                  </button>
                  <button onClick={() => setEditError(applyTrip(moveSlot(trip, row.slot.id, -1)))} title="Move up" className="text-xs px-2 py-0.5 rounded" style={editBtn}>
                    ↑
                  </button>
                  <button onClick={() => setEditError(applyTrip(moveSlot(trip, row.slot.id, 1)))} title="Move down" className="text-xs px-2 py-0.5 rounded" style={editBtn}>
                    ↓
                  </button>
                  {day.slots.length > 1 && (
                    <button
                      onClick={() => setEditError(applyTrip(removeSlot(trip, row.slot.id)))}
                      title="Delete slot"
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ ...editBtn, color: C.red }}
                    >
                      ✕ slot
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setVariantForm({ slotId: row.slot.id, variant: null });
                      setSlotForm(null);
                    }}
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ ...editBtn, color: C.line }}
                  >
                    + variant
                  </button>
                  {row.slot.place && previousPlace(day, row.slot.id) && (
                    <button
                      onClick={() => void addTransitOption(row.slot)}
                      disabled={transitBusyId === row.slot.id}
                      title="Fetch a real public-transit itinerary between the previous stop and here"
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ ...editBtn, color: C.line, opacity: transitBusyId === row.slot.id ? 0.6 : 1 }}
                    >
                      {transitBusyId === row.slot.id ? "🚆 Searching…" : "🚆 Transit"}
                    </button>
                  )}
                  {row.slot.variants.map((v) => (
                    <span key={v.id} className="inline-flex items-center gap-0.5">
                      <button
                        onClick={() => {
                          setVariantForm({ slotId: row.slot.id, variant: v });
                          setSlotForm(null);
                        }}
                        className="text-xs px-2 py-0.5 rounded"
                        style={editBtn}
                      >
                        ✎ {v.name}
                      </button>
                      {row.slot.variants.length > 1 && (
                        <button
                          onClick={() => setEditError(applyTrip(removeVariant(trip, row.slot.id, v.id)))}
                          title={`Delete variant ${v.name}`}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ ...editBtn, color: C.red }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {editMode && slotForm !== null && slotForm !== "new" && slotForm.id === row.slot.id && (
                <SlotForm trip={trip} initial={slotForm} onSave={saveSlot} onCancel={() => setSlotForm(null)} />
              )}
              {editMode && variantForm?.slotId === row.slot.id && (
                <VariantForm
                  initial={variantForm.variant}
                  defaultCurrency={trip.currencies.local}
                  onSave={saveVariant(row.slot.id)}
                  onCancel={() => setVariantForm(null)}
                />
              )}
              {transitError?.slotId === row.slot.id && (
                <div className="text-xs mt-1" style={{ color: C.amber }}>
                  {transitError.message}
                </div>
              )}
            </div>
          ))}
        </div>
        {editMode && (
          <div className="mt-1">
            {slotForm === "new" ? (
              <SlotForm trip={trip} initial={null} onSave={saveSlot} onCancel={() => setSlotForm(null)} />
            ) : (
              <button
                onClick={() => {
                  setSlotForm("new");
                  setVariantForm(null);
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={{ border: `1px dashed ${C.border}`, background: C.card, color: C.line }}
              >
                + Add slot
              </button>
            )}
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: C.sub }}>
          Change the departure time or switch a variant — every downstream time and the checkpoint buffer recalculate instantly.
        </p>
      </section>
      </div>

      {/* Ledger */}
      <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Shared ledger</h2>
          {canEdit && (
            <button
              onClick={() => setExpenseForm(expenseForm === "new" ? null : "new")}
              className="px-3 py-1 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.line }}
            >
              + Add expense
            </button>
          )}
        </div>
        {expenseForm === "new" && (
          <ExpenseForm trip={trip} initial={null} onSave={saveExpense} onCancel={() => setExpenseForm(null)} />
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {(
            [
              ["Paid expenses", expensesEUR],
              ["Active variants", variantCostEUR],
              ["Projected total", projectedEUR],
            ] as const
          ).map(([label, eur], idx) => (
            <div key={label} className="rounded-lg p-3" style={{ background: idx === 2 ? C.lineSoft : "#F1F4F7" }}>
              <div className="text-xs mb-1" style={{ color: C.sub }}>
                {label}
              </div>
              <div className="font-bold" style={mono}>
                {money(convert(eur, "EUR", viewCcy, rates), viewCcy)}
              </div>
            </div>
          ))}
        </div>

        {(["pre-trip", "mid-trip"] as const).map((phase) => (
          <div key={phase} className="mb-3">
            <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
              {phase.replace("-", " ")}
            </div>
            {trip.expenses
              .filter((e) => e.phase === phase)
              .map((e) =>
                expenseForm !== "new" && expenseForm?.id === e.id ? (
                  <ExpenseForm
                    key={e.id}
                    trip={trip}
                    initial={e}
                    onSave={saveExpense}
                    onCancel={() => setExpenseForm(null)}
                  />
                ) : (
                  <div key={e.id} className="flex items-center justify-between py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      {e.label}
                      <span className="ml-2 text-xs" style={{ color: C.sub }}>
                        {pName(e.payerId)} paid · {e.split.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {e.estimated && <EstBadge />}
                      <span style={mono}>{money(convert(e.amount, e.currency, viewCcy, rates), viewCcy)}</span>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => setExpenseForm(e)}
                            title="Edit expense"
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ border: `1px solid ${C.border}`, color: C.sub }}
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => onTripChange(removeExpense(trip, e.id))}
                            title="Delete expense"
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ border: `1px solid ${C.border}`, color: C.red }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              )}
          </div>
        ))}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg p-3" style={{ background: "#F1F4F7" }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.sub }}>
              Net balances
            </div>
            {trip.participants.map((p) => {
              const v = balances[p.id];
              return (
                <div key={p.id} className="flex justify-between text-sm py-0.5">
                  <span>{p.name}</span>
                  <span style={{ ...mono, color: v >= 0 ? C.ok : C.red }}>
                    {v >= 0 ? "+" : ""}
                    {money(convert(v, "EUR", viewCcy, rates), viewCcy)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg p-3" style={{ background: C.lineSoft }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: C.line }}>
              Settle up
            </div>
            {txns.length === 0 ? (
              <div className="text-sm" style={{ color: C.sub }}>
                All square.
              </div>
            ) : (
              txns.map((t, i) => (
                <div key={i} className="text-sm py-0.5">
                  <b>{pName(t.from)}</b> owes <b>{pName(t.to)}</b>{" "}
                  <span style={mono}>{money(convert(t.amountEUR, "EUR", viewCcy, rates), viewCcy)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: C.sub }}>
          Balances cover paid expenses only; active variant costs are projected and split equally once spent. Rates: {ratesLabel} (EUR pivot). Storage: {storeLabel}.
        </p>
      </section>
    </>
  );
}
