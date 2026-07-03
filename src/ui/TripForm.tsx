import { useState } from "react";
import { RATES_EUR } from "../domain/currency";
import { newId, newTrip, setTripMeta } from "../domain/mutate";
import type { Participant, Trip, TripCurrencies } from "../domain/types";
import { C } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

// Trip settings (name, currencies, participants) — also used in "new trip"
// mode, where it additionally asks for the first day's date.
export function TripForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Trip | null; // null = create a new trip from scratch
  onSave: (trip: Trip) => string[];
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startDate, setStartDate] = useState("");
  const [currencies, setCurrencies] = useState<TripCurrencies>(
    initial?.currencies ?? { home: "RON", local: "EUR", intl: "USD" }
  );
  const [participants, setParticipants] = useState<Participant[]>(
    initial?.participants ?? [{ id: newId("p"), name: "" }]
  );
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const pre: string[] = [];
    if (!name.trim()) pre.push("trip name must not be empty");
    if (!initial && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) pre.push("start date is required");
    const cleaned = participants
      .map((p) => ({ ...p, name: p.name.trim() }))
      .filter((p) => p.name !== "");
    if (cleaned.length === 0) pre.push("at least one participant is required");
    if (pre.length) {
      setErrors(pre);
      return;
    }
    const trip = initial
      ? setTripMeta(initial, { name: name.trim(), currencies, participants: cleaned })
      : newTrip(name.trim(), startDate, cleaned, currencies);
    setErrors(onSave(trip));
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="text-sm font-bold mb-2">{initial ? "Trip settings" : "New trip"}</div>
      <div className="flex gap-2 flex-wrap mb-2">
        <label className="text-xs flex-1 min-w-44" style={{ color: C.sub }}>
          Trip name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Vienna · Oct 2026"
            className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          />
        </label>
        {!initial && (
          <label className="text-xs" style={{ color: C.sub }}>
            First day
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="block rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            />
          </label>
        )}
        {(["home", "local", "intl"] as const).map((k) => (
          <label key={k} className="text-xs" style={{ color: C.sub }}>
            {k}
            <select
              value={currencies[k]}
              onChange={(e) => setCurrencies((c) => ({ ...c, [k]: e.target.value }))}
              className="block rounded px-2 py-1.5 text-sm mt-0.5"
              style={inputStyle}
            >
              {Object.keys(RATES_EUR).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
        Participants
      </div>
      {participants.map((p) => (
        <div key={p.id} className="flex gap-1.5 items-center mb-1.5">
          <input
            value={p.name}
            onChange={(e) =>
              setParticipants((list) =>
                list.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x))
              )
            }
            placeholder="name"
            className="w-48 rounded px-2 py-1 text-sm"
            style={inputStyle}
          />
          {participants.length > 1 && (
            <button
              onClick={() => setParticipants((list) => list.filter((x) => x.id !== p.id))}
              title="Remove participant"
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ border: `1px solid ${C.border}`, color: C.red }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => setParticipants((list) => [...list, { id: newId("p"), name: "" }])}
        className="text-xs px-2 py-1 rounded mb-2"
        style={{ border: `1px solid ${C.border}`, color: C.line }}
      >
        + participant
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
          {initial ? "Save trip settings" : "Create trip"}
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
