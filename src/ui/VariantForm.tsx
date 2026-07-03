import { useState } from "react";
import { RATES_EUR } from "../domain/currency";
import { newId } from "../domain/mutate";
import { STEP_TYPES } from "../domain/types";
import type { StepType, VariantNode } from "../domain/types";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

interface StepDraft {
  id: string;
  type: StepType;
  label: string;
  durationMin: string;
  distanceKm: string;
}

const blankStep = (): StepDraft => ({
  id: newId("ms"),
  type: "walk",
  label: "",
  durationMin: "",
  distanceKm: "",
});

// Add/edit form for a variant: name, estimated cost, ordered micro-steps.
export function VariantForm({
  initial,
  defaultCurrency,
  onSave,
  onCancel,
}: {
  initial: VariantNode | null;
  defaultCurrency: string;
  onSave: (variant: VariantNode) => string[];
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.cost.amount) : "0");
  const [currency, setCurrency] = useState(initial?.cost.currency ?? defaultCurrency);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    initial
      ? initial.microSteps.map((ms) => ({
          id: ms.id,
          type: ms.type,
          label: ms.label,
          durationMin: String(ms.durationMin),
          distanceKm: ms.distanceKm === null ? "" : String(ms.distanceKm),
        }))
      : [blankStep()]
  );
  const [errors, setErrors] = useState<string[]>([]);

  const setStep = (id: string, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const submit = () => {
    const pre: string[] = [];
    if (!name.trim()) pre.push("variant name must not be empty");
    const cost = parseFloat(amount || "0");
    if (!Number.isFinite(cost) || cost < 0) pre.push("cost must be a number >= 0");
    const microSteps = steps.map((s, i) => {
      const durationMin = parseInt(s.durationMin, 10);
      if (!s.label.trim()) pre.push(`step ${i + 1}: label must not be empty`);
      if (!Number.isFinite(durationMin) || durationMin <= 0)
        pre.push(`step ${i + 1}: duration must be a positive number of minutes`);
      const distanceKm = s.distanceKm.trim() === "" ? null : parseFloat(s.distanceKm);
      if (distanceKm !== null && !Number.isFinite(distanceKm))
        pre.push(`step ${i + 1}: distance must be a number or empty`);
      return { id: s.id, type: s.type, label: s.label.trim(), durationMin, distanceKm };
    });
    if (pre.length) {
      setErrors(pre);
      return;
    }
    setErrors(
      onSave({
        id: initial?.id ?? newId("v"),
        name: name.trim(),
        microSteps,
        cost: { amount: cost, currency },
      })
    );
  };

  return (
    <div className="rounded-lg p-3 my-2" style={{ background: "#F1F4F7" }}>
      <div className="flex gap-2 flex-wrap mb-2">
        <label className="text-xs flex-1 min-w-40" style={{ color: C.sub }}>
          Variant name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Public transit"
            className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: C.sub }}>
          Est. cost
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-20 block rounded px-2 py-1.5 text-sm mt-0.5"
            style={{ ...inputStyle, ...mono }}
          />
        </label>
        <label className="text-xs" style={{ color: C.sub }}>
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="block rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          >
            {Object.keys(RATES_EUR).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
        Micro-steps
      </div>
      {steps.map((s) => (
        <div key={s.id} className="flex gap-1.5 flex-wrap items-center mb-1.5">
          <select
            value={s.type}
            onChange={(e) => setStep(s.id, { type: e.target.value as StepType })}
            className="rounded px-1.5 py-1 text-xs"
            style={inputStyle}
          >
            {STEP_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            value={s.label}
            onChange={(e) => setStep(s.id, { label: e.target.value })}
            placeholder="label, e.g. Metro M2 → Pipera"
            className="flex-1 min-w-36 rounded px-2 py-1 text-xs"
            style={inputStyle}
          />
          <input
            value={s.durationMin}
            onChange={(e) => setStep(s.id, { durationMin: e.target.value })}
            placeholder="min"
            inputMode="numeric"
            className="w-14 rounded px-2 py-1 text-xs"
            style={{ ...inputStyle, ...mono }}
          />
          <input
            value={s.distanceKm}
            onChange={(e) => setStep(s.id, { distanceKm: e.target.value })}
            placeholder="km"
            inputMode="decimal"
            className="w-14 rounded px-2 py-1 text-xs"
            style={{ ...inputStyle, ...mono }}
          />
          {steps.length > 1 && (
            <button
              onClick={() => setSteps((list) => list.filter((x) => x.id !== s.id))}
              title="Remove step"
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ border: `1px solid ${C.border}`, color: C.red }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => setSteps((list) => [...list, blankStep()])}
        className="text-xs px-2 py-1 rounded mb-2"
        style={{ border: `1px solid ${C.border}`, color: C.line }}
      >
        + step
      </button>

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
          {initial ? "Save variant" : "Add variant"}
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
