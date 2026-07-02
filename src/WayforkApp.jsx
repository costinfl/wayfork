import { useMemo, useState } from "react";

/* =====================================================================
   WAYFORK — multi-variant travel planner & shared expense engine
   Prototype v0.1 — in-memory only, no persistence.
   Sections: 1) Domain model  2) Mock data  3) Engines  4) UI
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. DOMAIN MODEL (factory functions double as the schema definition)
   TRIP > DAY > ITINERARY_SLOT > VARIANT_NODE > MICRO_STEP
   EXPENSE_ITEM hangs off TRIP.
--------------------------------------------------------------------- */

const STEP_TYPES = ["walk", "metro", "bus", "train", "car", "shuttle", "flight", "wait", "transfer"];

const MicroStep = (type, label, durationMin, opts = {}) => ({
  id: opts.id || `${type}-${Math.random().toString(36).slice(2, 7)}`,
  type, // one of STEP_TYPES
  label,
  durationMin,
  distanceKm: opts.distanceKm ?? null,
});

const VariantNode = (id, name, microSteps, cost) => ({
  id,
  name,
  microSteps, // ordered array — durations sum to variant duration
  cost, // { amount, currency } — estimated, injected into projection
});

const ItinerarySlot = (id, title, variants, opts = {}) => ({
  id,
  title,
  variants, // >= 1 VariantNode; active one tracked in UI state
  defaultVariantId: opts.defaultVariantId || variants[0].id,
  checkpoint: opts.checkpoint || null, // { label, timeMin, bufferMin } — hard guardrail
});

const Day = (id, date, startTimeMin, slots) => ({ id, date, startTimeMin, slots });

const ExpenseItem = (id, def) => ({
  id,
  phase: def.phase, // 'pre-trip' | 'mid-trip'
  label: def.label,
  payerId: def.payerId,
  amount: def.amount,
  currency: def.currency, // stored natively in input currency
  split: def.split, // { type: 'equal' } | { type:'percent', shares:{pid:0.6,...} } | { type:'fixed', shares:{pid:amount,...} }
});

const Trip = (def) => ({
  id: def.id,
  name: def.name,
  participants: def.participants, // [{id, name}]
  currencies: def.currencies, // { home, local, intl }
  days: def.days,
  expenses: def.expenses,
});

/* ---------------------------------------------------------------------
   2. MOCK DATA — Bucharest → Rome, one travel day, 2 variant forks
--------------------------------------------------------------------- */

// Exchange rates cached once at app init (would come from ECB feed).
// Stored as EUR-pivot; convert() cross-derives any pair client-side.
const RATES_EUR = { EUR: 1, RON: 4.97, USD: 1.08 }; // 1 EUR = x

const P = { andrei: "p-andrei", ioana: "p-ioana" };

const MOCK_TRIP = Trip({
  id: "trip-rome-0526",
  name: "Rome · May 2026",
  participants: [
    { id: P.andrei, name: "Andrei" },
    { id: P.ioana, name: "Ioana" },
  ],
  currencies: { home: "RON", local: "EUR", intl: "USD" },
  days: [
    Day("day-1", "2026-05-14", 6 * 60 + 30, [
      ItinerarySlot(
        "slot-otp",
        "Hotel → Otopeni Airport",
        [
          VariantNode(
            "v-otp-public",
            "Public transit",
            [
              MicroStep("walk", "Walk to Piața Unirii", 9, { distanceKm: 0.7 }),
              MicroStep("metro", "Metro M2 → Pipera", 30),
              MicroStep("transfer", "Transfer to shuttle", 3),
              MicroStep("shuttle", "Shuttle 100 → Terminal", 20),
            ],
            { amount: 24, currency: "RON" }
          ),
          VariantNode(
            "v-otp-uber",
            "Uber",
            [
              MicroStep("wait", "Wait for pickup", 4),
              MicroStep("car", "Ride to Departures", 35, { distanceKm: 17 }),
            ],
            { amount: 95, currency: "RON" }
          ),
        ],
        { defaultVariantId: "v-otp-public" }
      ),
      ItinerarySlot("slot-sec", "Check-in, security & gate", [
        VariantNode(
          "v-sec",
          "Standard",
          [
            MicroStep("wait", "Bag drop + security", 45),
            MicroStep("walk", "Walk to gate", 10),
          ],
          { amount: 0, currency: "RON" }
        ),
      ]),
      ItinerarySlot(
        "slot-flight",
        "Flight W4 3105 → Rome FCO",
        [
          VariantNode(
            "v-flight",
            "Booked",
            [
              MicroStep("wait", "Boarding", 25),
              MicroStep("flight", "OTP → FCO", 145),
            ],
            { amount: 0, currency: "EUR" } // fare sits in pre-trip ledger
          ),
        ],
        {
          checkpoint: { label: "Boarding starts 10:00", timeMin: 10 * 60, bufferMin: 20 },
        }
      ),
      ItinerarySlot(
        "slot-fco",
        "FCO → Trastevere apartment",
        [
          VariantNode(
            "v-fco-train",
            "Leonardo Express + tram",
            [
              MicroStep("train", "Leonardo Express → Termini", 32),
              MicroStep("walk", "Walk to tram stop", 6),
              MicroStep("bus", "Tram 8 → Trastevere", 15),
            ],
            { amount: 30, currency: "EUR" }
          ),
          VariantNode(
            "v-fco-taxi",
            "Taxi (flat rate)",
            [
              MicroStep("wait", "Taxi rank queue", 8),
              MicroStep("car", "Ride to apartment", 45, { distanceKm: 31 }),
            ],
            { amount: 55, currency: "EUR" }
          ),
        ],
        { defaultVariantId: "v-fco-train" }
      ),
    ]),
  ],
  expenses: [
    ExpenseItem("e1", { phase: "pre-trip", label: "Flights ×2 (Wizz)", payerId: P.andrei, amount: 1240, currency: "RON", split: { type: "equal" } }),
    ExpenseItem("e2", { phase: "pre-trip", label: "Apartment · 4 nights", payerId: P.ioana, amount: 380, currency: "EUR", split: { type: "equal" } }),
    ExpenseItem("e3", { phase: "mid-trip", label: "Dinner in Trastevere", payerId: P.andrei, amount: 62, currency: "EUR", split: { type: "percent", shares: { [P.andrei]: 0.6, [P.ioana]: 0.4 } } }),
    ExpenseItem("e4", { phase: "mid-trip", label: "Metro tickets", payerId: P.ioana, amount: 24, currency: "RON", split: { type: "equal" } }),
  ],
});

/* ---------------------------------------------------------------------
   3. ENGINES — time math, currency, ripple scheduler, balances
--------------------------------------------------------------------- */

const fmtTime = (m) => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};
const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim() : `${m}m`);

const convert = (amount, from, to) => (from === to ? amount : (amount / RATES_EUR[from]) * RATES_EUR[to]);
const money = (amount, ccy) =>
  new Intl.NumberFormat("en", { style: "currency", currency: ccy, maximumFractionDigits: ccy === "RON" ? 0 : 0 }).format(amount);

const variantDuration = (v) => v.microSteps.reduce((s, ms) => s + ms.durationMin, 0);

// Ripple-effect scheduler: fold over slots, each start = previous end.
// Checkpoint status: ok (margin ≥ buffer) / amber (0 ≤ margin < buffer) / red (late).
function computeSchedule(day, activeVariantBySlot) {
  let cursor = day.startTimeMin;
  return day.slots.map((slot) => {
    const variant = slot.variants.find((v) => v.id === activeVariantBySlot[slot.id]) || slot.variants[0];
    const duration = variantDuration(variant);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    let checkpoint = null;
    if (slot.checkpoint) {
      const margin = slot.checkpoint.timeMin - start;
      const status = margin >= slot.checkpoint.bufferMin ? "ok" : margin >= 0 ? "amber" : "red";
      checkpoint = { ...slot.checkpoint, margin, status };
    }
    return { slot, variant, start, end, duration, checkpoint };
  });
}

// Per-participant shares of one expense, in the expense's native currency.
function expenseShares(exp, participants) {
  const ids = participants.map((p) => p.id);
  if (exp.split.type === "equal") {
    const each = exp.amount / ids.length;
    return Object.fromEntries(ids.map((id) => [id, each]));
  }
  if (exp.split.type === "percent") {
    return Object.fromEntries(ids.map((id) => [id, exp.amount * (exp.split.shares[id] || 0)]));
  }
  return Object.fromEntries(ids.map((id) => [id, exp.split.shares[id] || 0])); // fixed
}

// Net balances in EUR (positive = is owed money), from paid expenses only.
function computeBalances(trip) {
  const bal = Object.fromEntries(trip.participants.map((p) => [p.id, 0]));
  for (const exp of trip.expenses) {
    bal[exp.payerId] += convert(exp.amount, exp.currency, "EUR");
    const shares = expenseShares(exp, trip.participants);
    for (const [pid, share] of Object.entries(shares)) bal[pid] -= convert(share, exp.currency, "EUR");
  }
  return bal;
}

// Greedy debt netting → minimal transaction list.
function settle(balances) {
  const eps = 0.01;
  const debtors = Object.entries(balances).filter(([, v]) => v < -eps).map(([id, v]) => ({ id, amt: -v }));
  const creditors = Object.entries(balances).filter(([, v]) => v > eps).map(([id, v]) => ({ id, amt: v }));
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const txns = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    txns.push({ from: debtors[i].id, to: creditors[j].id, amountEUR: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < eps) i++;
    if (creditors[j].amt < eps) j++;
  }
  return txns;
}

/* ---------------------------------------------------------------------
   4. UI
--------------------------------------------------------------------- */

const C = {
  bg: "#F4F6F8",
  card: "#FFFFFF",
  ink: "#17222C",
  sub: "#5C6B78",
  line: "#1D5BD8", // active route blue
  lineSoft: "#DDE7FA",
  ghost: "#9AA7B4", // inactive variant
  ok: "#1E7F4F",
  amber: "#B26E00",
  amberBg: "#FDF3E1",
  red: "#C0392B",
  redBg: "#FBE9E7",
  border: "#E3E8ED",
};

const STEP_ICON = { walk: "🚶", metro: "🚇", bus: "🚌", train: "🚆", car: "🚕", shuttle: "🚐", flight: "✈️", wait: "⏳", transfer: "↔️" };

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontVariantNumeric: "tabular-nums" };

function Chip({ children, style }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs" style={{ background: "#EEF2F6", color: C.sub, ...style }}>
      {children}
    </span>
  );
}

function VariantCard({ variant, active, onSelect, ccyView, tripCcy }) {
  const dur = variantDuration(variant);
  const cost = convert(variant.cost.amount, variant.cost.currency, tripCcy[ccyView]);
  return (
    <button
      onClick={onSelect}
      className="text-left rounded-lg p-3 w-full transition-all"
      style={{
        background: active ? C.lineSoft : C.card,
        border: active ? `2px solid ${C.line}` : `2px dashed ${C.border}`,
        opacity: active ? 1 : 0.75,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: active ? C.line : C.sub }}>
          {variant.name}
        </span>
        {active && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: C.line, color: "#fff" }}>
            ACTIVE
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {variant.microSteps.map((ms) => (
          <Chip key={ms.id}>
            {STEP_ICON[ms.type]} {ms.label} · <span style={mono}>{ms.durationMin}m</span>
          </Chip>
        ))}
      </div>
      <div className="flex justify-between text-sm" style={{ color: C.ink }}>
        <span style={mono}>{fmtDur(dur)}</span>
        <span style={mono}>{variant.cost.amount === 0 ? "—" : money(cost, tripCcy[ccyView])}</span>
      </div>
    </button>
  );
}

function CheckpointBanner({ cp }) {
  const map = {
    ok: { bg: "#E7F4EC", fg: C.ok, msg: `Buffer ${fmtDur(cp.margin)} — on track` },
    amber: { bg: C.amberBg, fg: C.amber, msg: `Only ${fmtDur(cp.margin)} left — below ${fmtDur(cp.bufferMin)} safety buffer` },
    red: { bg: C.redBg, fg: C.red, msg: `Arriving ${fmtDur(-cp.margin)} LATE — checkpoint breached` },
  }[cp.status];
  return (
    <div className="rounded-md px-3 py-2 mb-2 text-sm font-medium flex items-center gap-2" style={{ background: map.bg, color: map.fg }}>
      <span>⏱</span>
      <span>
        <span style={mono}>{fmtTime(cp.timeMin)}</span> · {cp.label} — {map.msg}
      </span>
    </div>
  );
}

export default function WayforkApp() {
  const trip = MOCK_TRIP;
  const day = trip.days[0];

  const [dayStart, setDayStart] = useState(day.startTimeMin);
  const [activeVariants, setActiveVariants] = useState(() =>
    Object.fromEntries(day.slots.map((s) => [s.id, s.defaultVariantId]))
  );
  const [ccyView, setCcyView] = useState("local"); // home | local | intl

  const viewCcy = trip.currencies[ccyView];

  const schedule = useMemo(
    () => computeSchedule({ ...day, startTimeMin: dayStart }, activeVariants),
    [day, dayStart, activeVariants]
  );

  const variantCostEUR = useMemo(
    () => schedule.reduce((s, r) => s + convert(r.variant.cost.amount, r.variant.cost.currency, "EUR"), 0),
    [schedule]
  );

  const expensesEUR = useMemo(
    () => trip.expenses.reduce((s, e) => s + convert(e.amount, e.currency, "EUR"), 0),
    [trip.expenses]
  );

  const balances = useMemo(() => computeBalances(trip), [trip]);
  const txns = useMemo(() => settle(balances), [balances]);
  const pName = (id) => trip.participants.find((p) => p.id === id)?.name || id;

  const projectedEUR = expensesEUR + variantCostEUR;

  return (
    <div className="min-h-screen py-6 px-4" style={{ background: C.bg, color: C.ink }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs font-bold tracking-widest uppercase" style={{ color: C.line }}>
                Wayfork
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{trip.name}</h1>
              <div className="text-sm" style={{ color: C.sub }}>
                {trip.participants.map((p) => p.name).join(" · ")} — {day.date}
              </div>
            </div>
            {/* Tri-currency toggle */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              {["home", "local", "intl"].map((k) => (
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

        {/* Timeline */}
        <section className="rounded-xl p-4 mb-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">Day 1 — travel day</h2>
            <label className="flex items-center gap-2 text-sm" style={{ color: C.sub }}>
              Depart
              <input
                type="time"
                value={fmtTime(dayStart)}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (!Number.isNaN(h)) setDayStart(h * 60 + m);
                }}
                className="rounded px-2 py-1 text-sm font-semibold"
                style={{ border: `1px solid ${C.border}`, ...mono, color: C.ink }}
              />
            </label>
          </div>

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
                  <span className="font-semibold">{row.slot.title}</span>
                  <span className="text-xs" style={{ color: C.sub, ...mono }}>
                    {fmtDur(row.duration)}
                  </span>
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
                        onSelect={() => setActiveVariants((s) => ({ ...s, [row.slot.id]: v.id }))}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {row.variant.microSteps.map((ms) => (
                      <Chip key={ms.id}>
                        {STEP_ICON[ms.type]} {ms.label} · <span style={mono}>{ms.durationMin}m</span>
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs mt-1" style={{ color: C.sub }}>
            Change the departure time or switch a variant — every downstream time and the checkpoint buffer recalculate instantly.
          </p>
        </section>

        {/* Ledger */}
        <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <h2 className="font-bold mb-3">Shared ledger</h2>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              ["Paid expenses", expensesEUR],
              ["Active variants", variantCostEUR],
              ["Projected total", projectedEUR],
            ].map(([label, eur], idx) => (
              <div key={label} className="rounded-lg p-3" style={{ background: idx === 2 ? C.lineSoft : "#F1F4F7" }}>
                <div className="text-xs mb-1" style={{ color: C.sub }}>
                  {label}
                </div>
                <div className="font-bold" style={mono}>
                  {money(convert(eur, "EUR", viewCcy), viewCcy)}
                </div>
              </div>
            ))}
          </div>

          {["pre-trip", "mid-trip"].map((phase) => (
            <div key={phase} className="mb-3">
              <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
                {phase.replace("-", " ")}
              </div>
              {trip.expenses
                .filter((e) => e.phase === phase)
                .map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      {e.label}
                      <span className="ml-2 text-xs" style={{ color: C.sub }}>
                        {pName(e.payerId)} paid · {e.split.type}
                      </span>
                    </div>
                    <div style={mono}>{money(convert(e.amount, e.currency, viewCcy), viewCcy)}</div>
                  </div>
                ))}
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
                      {money(convert(v, "EUR", viewCcy), viewCcy)}
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
                    <span style={mono}>{money(convert(t.amountEUR, "EUR", viewCcy), viewCcy)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <p className="text-xs mt-3" style={{ color: C.sub }}>
            Balances cover paid expenses only; active variant costs are projected and split equally once spent. Rates cached at load (EUR pivot).
          </p>
        </section>
      </div>
    </div>
  );
}
