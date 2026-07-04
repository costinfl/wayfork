import { useEffect, useMemo, useState } from "react";
import { TRIPS } from "../data";
import { createLocalStorageStore } from "../data/localStorageStore";
import { mergeWithBuiltins } from "../data/repository";
import type { TripStore } from "../data/repository";
import { SUPABASE_CONFIG } from "../data/supabaseConfig";
import { createSupabaseStore } from "../data/supabaseStore";
import { convert, money, RATES_EUR } from "../domain/currency";
import type { RateMatrix } from "../domain/currency";
import { computeBalances, settle } from "../domain/ledger";
import {
  moveSlot,
  nextDate,
  removeDay,
  removeExpense,
  removeSlot,
  removeVariant,
  upsertDay,
  upsertExpense,
  upsertSlot,
  upsertVariant,
} from "../domain/mutate";
import { fetchRatesEUR } from "../domain/rates";
import { computeSchedule } from "../domain/schedule";
import { fmtDur, fmtOffset, fmtTime } from "../domain/time";
import { fetchDayWeather, RAIN_RISK_THRESHOLD } from "../domain/weather";
import type { DayWeather } from "../domain/weather";
import type { CurrencyView, Day, ExpenseItem, ItinerarySlot, Trip, VariantNode } from "../domain/types";
import { validateTrip } from "../domain/validate";
import { CheckpointBanner } from "./CheckpointBanner";
import { DayForm } from "./DayForm";
import { ExpenseForm } from "./ExpenseForm";
import { SlotForm } from "./SlotForm";
import { TripForm } from "./TripForm";
import { StepChip } from "./StepChip";
import { C, mono } from "./theme";
import { UploadTrip } from "./UploadTrip";
import { VariantCard } from "./VariantCard";
import { VariantForm } from "./VariantForm";
import { WeatherBadge } from "./WeatherBadge";

const CCY_VIEWS: CurrencyView[] = ["home", "local", "intl"];

// Shared Supabase database when configured & reachable; localStorage otherwise.
const LOCAL_STORE = createLocalStorageStore();
const REMOTE_STORE = SUPABASE_CONFIG.url ? createSupabaseStore(SUPABASE_CONFIG) : null;

export default function WayforkApp() {
  const [storedTrips, setStoredTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState(TRIPS[0].id);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [tripForm, setTripForm] = useState<"new" | "settings" | null>(null);
  const [store, setStore] = useState<TripStore>(LOCAL_STORE);
  const [storeLabel, setStoreLabel] = useState("local browser");

  useEffect(() => {
    let cancelled = false;
    const useLocal = () =>
      LOCAL_STORE.list().then((trips) => {
        if (!cancelled) setStoredTrips(trips);
      });
    if (!REMOTE_STORE) {
      void useLocal();
      return;
    }
    REMOTE_STORE.list()
      .then((trips) => {
        if (!cancelled) {
          setStore(REMOTE_STORE);
          setStoreLabel("Supabase (shared)");
          setStoredTrips(trips);
        }
      })
      .catch(() => {
        void useLocal(); // offline or DB unreachable — degrade to the browser store
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const trip = allTrips.find((t) => t.id === tripId) ?? TRIPS[0];
  const isStored = storedTrips.some((t) => t.id === trip.id);
  const isBuiltin = TRIPS.some((b) => b.id === trip.id);
  const isOverride = isStored && isBuiltin; // edited copy of a shipped trip

  const saveTrip = (next: Trip) => {
    store.save(next).catch((e) => console.error("trip save failed:", e));
    setStoredTrips((prev) => [...prev.filter((t) => t.id !== next.id), next]);
  };

  const addTrip = (t: Trip): string | null => {
    if (TRIPS.some((b) => b.id === t.id)) {
      return `A built-in trip already uses the id "${t.id}" — give the trip a different id.`;
    }
    saveTrip(t);
    setTripId(t.id);
    setUploadOpen(false);
    return null;
  };

  const removeCurrentTrip = () => {
    store.remove(trip.id).catch((e) => console.error("trip remove failed:", e));
    setStoredTrips((prev) => prev.filter((t) => t.id !== trip.id));
    if (!isBuiltin) setTripId(TRIPS[0].id); // resetting an override keeps it selected
  };

  const saveTripForm = (t: Trip): string[] => {
    const errors = validateTrip(t);
    if (errors.length) return errors;
    saveTrip(t);
    setTripId(t.id);
    setTripForm(null);
    return [];
  };

  return (
    <div className="min-h-screen py-6 px-4" style={{ background: C.bg, color: C.ink }}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex justify-end gap-2 flex-wrap">
          {allTrips.length > 1 && (
            <select
              value={trip.id}
              onChange={(e) => setTripId(e.target.value)}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.ink }}
            >
              {allTrips.map((t) => {
                const stored = storedTrips.some((s) => s.id === t.id);
                const builtin = TRIPS.some((b) => b.id === t.id);
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {stored ? (builtin ? " (edited)" : " (uploaded)") : ""}
                  </option>
                );
              })}
            </select>
          )}
          {isStored && (
            <button
              onClick={removeCurrentTrip}
              title={isOverride ? "Reset to the built-in version" : "Remove this uploaded trip"}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.red }}
            >
              {isOverride ? "↺" : "✕"}
            </button>
          )}
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
        {uploadOpen && <UploadTrip onLoaded={addTrip} />}
        {tripForm !== null && (
          <TripForm
            key={`${tripForm}-${trip.id}`}
            initial={tripForm === "settings" ? trip : null}
            onSave={saveTripForm}
            onCancel={() => setTripForm(null)}
          />
        )}
        <TripView
          key={trip.id}
          trip={trip}
          rates={rates}
          ratesLabel={ratesLabel}
          storeLabel={storeLabel}
          onTripChange={saveTrip}
        />
      </div>
    </div>
  );
}

function TripView({
  trip,
  rates,
  ratesLabel,
  storeLabel,
  onTripChange,
}: {
  trip: Trip;
  rates: RateMatrix;
  ratesLabel: string;
  storeLabel: string;
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

  const saveVariant = (slotId: string) => (variant: VariantNode): string[] => {
    const errors = applyTrip(upsertVariant(trip, slotId, variant));
    if (!errors.length) setVariantForm(null);
    return errors;
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

      {/* Timeline */}
      <section className="rounded-xl p-4 mb-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold flex items-center gap-2 flex-wrap">
            Day {dayIdx + 1} — {day.date}
            {dayWeather && <WeatherBadge weather={dayWeather} place={day.location!.name} />}
          </h2>
          <div className="flex items-center gap-2">
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

      {/* Ledger */}
      <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">Shared ledger</h2>
          <button
            onClick={() => setExpenseForm(expenseForm === "new" ? null : "new")}
            className="px-3 py-1 rounded-lg text-sm font-semibold"
            style={{ border: `1px solid ${C.border}`, background: C.card, color: C.line }}
          >
            + Add expense
          </button>
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
                      <span style={mono}>{money(convert(e.amount, e.currency, viewCcy, rates), viewCcy)}</span>
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
