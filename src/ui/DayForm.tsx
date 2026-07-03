import { useState } from "react";
import { newId, starterSlot } from "../domain/mutate";
import { fmtTime } from "../domain/time";
import type { Day, Trip } from "../domain/types";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

// Add/edit form for a day's date and (persisted) departure time. New days get
// a starter slot so the >=1-slot invariant holds.
export function DayForm({
  trip,
  initial,
  defaultDate,
  onSave,
  onCancel,
}: {
  trip: Trip;
  initial: Day | null;
  defaultDate: string;
  onSave: (day: Day) => string[];
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [start, setStart] = useState(fmtTime(initial?.startTimeMin ?? 9 * 60));
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const pre: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) pre.push("date is required");
    const [h, m] = start.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) pre.push("departure time is invalid");
    if (pre.length) {
      setErrors(pre);
      return;
    }
    const day: Day = initial
      ? { ...initial, date, startTimeMin: h * 60 + m }
      : {
          id: newId("day"),
          date,
          startTimeMin: h * 60 + m,
          slots: [starterSlot(trip.currencies.local)],
        };
    setErrors(onSave(day));
  };

  return (
    <div className="rounded-lg p-3 mb-3" style={{ background: "#F1F4F7" }}>
      <div className="flex gap-2 flex-wrap mb-2 items-end">
        <label className="text-xs" style={{ color: C.sub }}>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: C.sub }}>
          Departure
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="block rounded px-2 py-1.5 text-sm mt-0.5"
            style={{ ...inputStyle, ...mono }}
          />
        </label>
        <button
          onClick={submit}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: C.line, color: "#fff" }}
        >
          {initial ? "Save day" : "Add day"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.border}`, background: C.card, color: C.sub }}
        >
          Cancel
        </button>
      </div>
      {errors.length > 0 && (
        <div className="rounded-md px-3 py-2 text-xs" style={{ background: C.redBg, color: C.red }}>
          {errors.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
