import { createPortal } from "react-dom";
import { convert, money, type RateMatrix } from "../domain/currency";
import type { SettlementTxn } from "../domain/ledger";
import { computeSchedule, variantDuration } from "../domain/schedule";
import { fmtDur, fmtTime } from "../domain/time";
import type { Trip } from "../domain/types";
import { STEP_ICON } from "./theme";

// The whole trip as a printable document — what "Export PDF" prints (the
// browser's print dialog saves it as a PDF). Rendered into a body-level
// element that only shows in print (index.css), in fixed print colours.

export interface PrintTripProps {
  trip: Trip;
  activeVariants: Record<string, string>;
  dayStarts: Record<string, number>;
  rates: RateMatrix;
  ccy: string; // the currency to show amounts in
  balances: Record<string, number>; // EUR, + = is owed
  txns: SettlementTxn[];
  mapImage: string | null; // data URL of the map as shown
}

const ink = "#111827";
const sub = "#4b5563";
const rule = "#d1d5db";

export function PrintTrip({ trip, activeVariants, dayStarts, rates, ccy, balances, txns, mapImage }: PrintTripProps) {
  const name = (id: string) => trip.participants.find((p) => p.id === id)?.name ?? id;
  const m = (amount: number, from: string) => money(convert(amount, from, ccy, rates), ccy);
  const days = trip.days.map((d) => ({
    day: d,
    rows: computeSchedule({ ...d, startTimeMin: dayStarts[d.id] ?? d.startTimeMin }, activeVariants),
  }));
  const optionsEUR = days.reduce(
    (t, { rows }) => t + rows.reduce((s, r) => s + convert(r.variant.cost.amount, r.variant.cost.currency, "EUR", rates), 0),
    0
  );
  const expensesEUR = trip.expenses.reduce((s, e) => s + convert(e.amount, e.currency, "EUR", rates), 0);

  return createPortal(
    <div id="print-root" style={{ color: ink, background: "#fff", fontSize: 11, lineHeight: 1.4 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{trip.name}</h1>
      <div style={{ color: sub, marginBottom: 10 }}>
        {trip.days[0]?.date}
        {trip.days.length > 1 ? ` – ${trip.days[trip.days.length - 1].date}` : ""} · {trip.participants.map((p) => p.name).join(", ")}
      </div>
      {mapImage && (
        <img src={mapImage} alt="Trip map" style={{ width: "100%", maxHeight: 340, objectFit: "cover", borderRadius: 6, marginBottom: 12 }} />
      )}

      {days.map(({ day, rows }, i) => (
        <section key={day.id} style={{ breakInside: "avoid-page", marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, borderBottom: `2px solid ${ink}`, paddingBottom: 2, margin: "8px 0 6px" }}>
            Day {i + 1} — {day.date}
            {day.location ? <span style={{ fontWeight: 400, color: sub }}> · {day.location.name}</span> : null}
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((r) => {
                const others = r.slot.variants.filter((v) => v.id !== r.variant.id);
                return (
                  <tr key={r.slot.id} style={{ borderBottom: `1px solid ${rule}`, breakInside: "avoid" }}>
                    <td style={{ width: 86, verticalAlign: "top", padding: "4px 6px 4px 0", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {fmtTime(r.start)}–{fmtTime(r.end)}
                    </td>
                    <td style={{ verticalAlign: "top", padding: "4px 0" }}>
                      <div style={{ fontWeight: 700 }}>
                        {r.slot.title}
                        <span style={{ fontWeight: 400, color: sub }}> · {r.slot.place.name}</span>
                      </div>
                      <div>
                        <b>{r.variant.name}</b> · {fmtDur(r.duration)}
                        {r.variant.cost.amount > 0 && <> · {m(r.variant.cost.amount, r.variant.cost.currency)}</>}
                      </div>
                      <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>
                        {r.variant.microSteps.map((s) => (
                          <li key={s.id}>
                            {STEP_ICON[s.type]} {s.label} · {s.durationMin} min
                            {s.ride && (s.ride.board || s.ride.alight) && (
                              <span style={{ color: sub }}>
                                {" "}
                                — board at {s.ride.board ?? "?"}
                                {s.ride.track ? ` (platform ${s.ride.track})` : ""}, get off at {s.ride.alight ?? "?"}
                                {s.ride.stops !== undefined ? ` after ${s.ride.stops} stop${s.ride.stops === 1 ? "" : "s"}` : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {r.checkpoint && (
                        <div style={{ color: sub }}>
                          ⏱ {fmtTime(r.checkpoint.timeMin)} {r.checkpoint.label} — buffer {fmtDur(r.checkpoint.margin)}
                        </div>
                      )}
                      {others.length > 0 && (
                        <div style={{ color: sub }}>
                          Other options:{" "}
                          {others
                            .map((v) => `${v.name} (${fmtDur(variantDuration(v))}${v.cost.amount > 0 ? `, ${m(v.cost.amount, v.cost.currency)}` : ""})`)
                            .join("; ")}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <section style={{ breakInside: "avoid-page" }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, borderBottom: `2px solid ${ink}`, paddingBottom: 2, margin: "8px 0 6px" }}>
          Costs
        </h2>
        <div>
          Chosen options {money(convert(optionsEUR, "EUR", ccy, rates), ccy)} · Paid expenses{" "}
          {money(convert(expensesEUR, "EUR", ccy, rates), ccy)} · <b>Projected total {money(convert(optionsEUR + expensesEUR, "EUR", ccy, rates), ccy)}</b>
        </div>
        {trip.expenses.length > 0 && (
          <ul style={{ margin: "4px 0", paddingLeft: 14 }}>
            {trip.expenses.map((e) => (
              <li key={e.id}>
                {e.label} — {m(e.amount, e.currency)}, paid by {name(e.payerId)}
              </li>
            ))}
          </ul>
        )}
        {txns.length > 0 ? (
          <div>
            <b>To settle up:</b>{" "}
            {txns.map((t) => `${name(t.from)} pays ${name(t.to)} ${money(convert(t.amountEUR, "EUR", ccy, rates), ccy)}`).join("; ")}
          </div>
        ) : (
          Object.keys(balances).length > 0 && <div>Everyone is settled up.</div>
        )}
      </section>
      <div style={{ color: sub, marginTop: 12, fontSize: 9 }}>
        Made with Wayfork · map data © OpenStreetMap contributors, OpenFreeMap
      </div>
    </div>,
    document.body
  );
}
