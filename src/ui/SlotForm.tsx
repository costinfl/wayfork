import { useState } from "react";
import { starterSlot } from "../domain/mutate";
import { fmtTime } from "../domain/time";
import type { Checkpoint, ItinerarySlot, Trip } from "../domain/types";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

// Add/edit form for a slot's title and checkpoint. New slots are created with
// one starter variant so the schema invariant (>= 1 variant) always holds.
export function SlotForm({
  trip,
  initial,
  onSave,
  onCancel,
}: {
  trip: Trip;
  initial: ItinerarySlot | null;
  onSave: (slot: ItinerarySlot) => string[];
  onCancel: () => void;
}) {
  const cp = initial?.checkpoint ?? null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hasCheckpoint, setHasCheckpoint] = useState(cp !== null);
  const [cpLabel, setCpLabel] = useState(cp?.label ?? "");
  const [cpTime, setCpTime] = useState(cp ? fmtTime(cp.timeMin) : "12:00");
  const [cpBuffer, setCpBuffer] = useState(cp ? String(cp.bufferMin) : "15");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const pre: string[] = [];
    if (!title.trim()) pre.push("title must not be empty");
    let checkpoint: Checkpoint | null = null;
    if (hasCheckpoint) {
      const [h, m] = cpTime.split(":").map(Number);
      const bufferMin = parseInt(cpBuffer, 10);
      if (!cpLabel.trim()) pre.push("checkpoint label must not be empty");
      if (Number.isNaN(h) || Number.isNaN(m)) pre.push("checkpoint time is invalid");
      if (!Number.isFinite(bufferMin) || bufferMin < 0)
        pre.push("checkpoint buffer must be a non-negative number of minutes");
      checkpoint = { label: cpLabel.trim(), timeMin: (h || 0) * 60 + (m || 0), bufferMin };
    }
    if (pre.length) {
      setErrors(pre);
      return;
    }
    const slot: ItinerarySlot = initial
      ? { ...initial, title: title.trim(), checkpoint }
      : { ...starterSlot(trip.currencies.local, title.trim()), checkpoint };
    setErrors(onSave(slot));
  };

  return (
    <div className="rounded-lg p-3 my-2" style={{ background: "#F1F4F7" }}>
      <label className="text-xs block mb-2" style={{ color: C.sub }}>
        Slot title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Hotel → Airport"
          className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
          style={inputStyle}
        />
      </label>
      <label className="text-xs flex items-center gap-2 mb-2" style={{ color: C.sub }}>
        <input
          type="checkbox"
          checked={hasCheckpoint}
          onChange={(e) => setHasCheckpoint(e.target.checked)}
        />
        Hard checkpoint (boarding, timed entry, departure…)
      </label>
      {hasCheckpoint && (
        <div className="flex gap-2 flex-wrap mb-2">
          <label className="text-xs flex-1 min-w-40" style={{ color: C.sub }}>
            Label
            <input
              value={cpLabel}
              onChange={(e) => setCpLabel(e.target.value)}
              placeholder="e.g. Boarding starts 10:00"
              className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            />
          </label>
          <label className="text-xs" style={{ color: C.sub }}>
            Time
            <input
              type="time"
              value={cpTime}
              onChange={(e) => setCpTime(e.target.value)}
              className="block rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ ...inputStyle, ...mono }}
            />
          </label>
          <label className="text-xs" style={{ color: C.sub }}>
            Buffer (min)
            <input
              value={cpBuffer}
              onChange={(e) => setCpBuffer(e.target.value)}
              inputMode="numeric"
              className="w-20 block rounded px-2 py-1.5 text-sm mt-0.5"
              style={{ ...inputStyle, ...mono }}
            />
          </label>
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
          {initial ? "Save slot" : "Add slot"}
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
