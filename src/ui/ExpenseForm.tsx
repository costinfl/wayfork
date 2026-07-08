import { useState } from "react";
import { RATES_EUR } from "../domain/currency";
import { newExpenseId } from "../domain/mutate";
import type { ExpenseItem, ExpensePhase, SplitDef, Trip } from "../domain/types";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

// Add/edit form for one expense. onSave returns validation problems (empty
// array = saved, parent closes the form).
export function ExpenseForm({
  trip,
  initial,
  onSave,
  onCancel,
}: {
  trip: Trip;
  initial: ExpenseItem | null;
  onSave: (exp: ExpenseItem) => string[];
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? trip.currencies.local);
  const [payerId, setPayerId] = useState(initial?.payerId ?? trip.participants[0].id);
  const [phase, setPhase] = useState<ExpensePhase>(initial?.phase ?? "mid-trip");
  const [splitType, setSplitType] = useState<SplitDef["type"]>(initial?.split.type ?? "equal");
  const [estimated, setEstimated] = useState(initial?.estimated ?? false);
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      trip.participants.map((p) => {
        const init =
          initial && initial.split.type !== "equal" ? initial.split.shares[p.id] : undefined;
        const shown =
          init === undefined ? "" : initial!.split.type === "percent" ? init * 100 : init;
        return [p.id, shown === "" ? "" : String(Math.round((shown as number) * 100) / 100)];
      })
    )
  );
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const amt = parseFloat(amount);
    const pre: string[] = [];
    if (!label.trim()) pre.push("label must not be empty");
    if (!Number.isFinite(amt) || amt <= 0) pre.push("amount must be a positive number");
    if (pre.length) {
      setErrors(pre);
      return;
    }
    let split: SplitDef = { type: "equal" };
    if (splitType !== "equal") {
      const entries = trip.participants.map((p) => {
        const v = parseFloat(shares[p.id] || "0");
        return [p.id, splitType === "percent" ? v / 100 : v] as const;
      });
      split = { type: splitType, shares: Object.fromEntries(entries) };
    }
    const exp: ExpenseItem = {
      id: initial?.id ?? newExpenseId(),
      phase,
      label: label.trim(),
      payerId,
      amount: amt,
      currency,
      split,
      ...(estimated ? { estimated: true } : {}),
    };
    setErrors(onSave(exp));
  };

  return (
    <div className="rounded-lg p-3 my-2" style={{ background: "#F1F4F7" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <label className="text-xs" style={{ color: C.sub }}>
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Dinner in Trastevere"
            className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          />
        </label>
        <div className="flex gap-2">
          <label className="text-xs flex-1" style={{ color: C.sub }}>
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ ...inputStyle, ...mono }}
            />
          </label>
          <label className="text-xs" style={{ color: C.sub }}>
            Currency
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            >
              {Object.keys(RATES_EUR).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-xs" style={{ color: C.sub }}>
          Paid by
          <select
            value={payerId}
            onChange={(e) => setPayerId(e.target.value)}
            className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          >
            {trip.participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="text-xs flex-1" style={{ color: C.sub }}>
            Phase
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value as ExpensePhase)}
              className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            >
              <option value="pre-trip">pre-trip</option>
              <option value="mid-trip">mid-trip</option>
            </select>
          </label>
          <label className="text-xs flex-1" style={{ color: C.sub }}>
            Split
            <select
              value={splitType}
              onChange={(e) => setSplitType(e.target.value as SplitDef["type"])}
              className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            >
              <option value="equal">equal</option>
              <option value="percent">percent</option>
              <option value="fixed">fixed</option>
            </select>
          </label>
        </div>
        <label className="text-xs flex items-center gap-1.5" style={{ color: C.sub }}>
          <input
            type="checkbox"
            checked={estimated}
            onChange={(e) => setEstimated(e.target.checked)}
          />
          Estimated amount
        </label>
      </div>

      {splitType !== "equal" && (
        <div className="flex gap-2 flex-wrap mb-2">
          {trip.participants.map((p) => (
            <label key={p.id} className="text-xs" style={{ color: C.sub }}>
              {p.name} {splitType === "percent" ? "(%)" : `(${currency})`}
              <input
                value={shares[p.id] ?? ""}
                onChange={(e) => setShares((s) => ({ ...s, [p.id]: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
                className="w-24 block rounded px-2 py-1.5 text-sm mt-0.5"
                style={{ ...inputStyle, ...mono }}
              />
            </label>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-md px-3 py-2 mb-2 text-xs" style={{ background: C.redBg, color: C.red }}>
          {errors.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: C.line, color: "#fff" }}
        >
          {initial ? "Save expense" : "Add expense"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
