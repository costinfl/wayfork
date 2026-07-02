import { useMemo, useState } from "react";
import { MOCK_TRIP } from "../data/mock";
import { convert, money } from "../domain/currency";
import { computeBalances, settle } from "../domain/ledger";
import { computeSchedule } from "../domain/schedule";
import { fmtDur, fmtTime } from "../domain/time";
import type { CurrencyView } from "../domain/types";
import { CheckpointBanner } from "./CheckpointBanner";
import { Chip } from "./Chip";
import { C, STEP_ICON, mono } from "./theme";
import { VariantCard } from "./VariantCard";

const CCY_VIEWS: CurrencyView[] = ["home", "local", "intl"];

export default function WayforkApp() {
  const trip = MOCK_TRIP;
  const day = trip.days[0];

  const [dayStart, setDayStart] = useState(day.startTimeMin);
  const [activeVariants, setActiveVariants] = useState<Record<string, string>>(() =>
    Object.fromEntries(day.slots.map((s) => [s.id, s.defaultVariantId]))
  );
  const [ccyView, setCcyView] = useState<CurrencyView>("local");

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
  const pName = (id: string) => trip.participants.find((p) => p.id === id)?.name || id;

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
                  {money(convert(eur, "EUR", viewCcy), viewCcy)}
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
