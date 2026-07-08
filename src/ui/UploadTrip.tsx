import { useState } from "react";
import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import { C, mono } from "./theme";

// Loading a trip either creates it or, when its id matches an existing scaffold,
// replaces that scaffold in place — in which case any drift from the scaffold's
// verbatim days/dates/locations comes back as non-blocking warnings.
export type AddTripResult = { error: string } | { warnings?: string[] };

// Panel for loading an AI-generated trip: pick a .json file or paste the JSON
// the assistant returns (the prompt itself now comes from PlanTripForm).
// onLoaded reports a hard rejection or soft warnings.
export function UploadTrip({ onLoaded }: { onLoaded: (trip: Trip) => AddTripResult }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  const handleRaw = (raw: string) => {
    setWarnings(null);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      setErrors([`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    const { trip, errors: parseErrors } = parseTrip(data);
    if (!trip) {
      setErrors(parseErrors.slice(0, 8));
      return;
    }
    const result = onLoaded(trip);
    if ("error" in result) {
      setErrors([result.error]);
      return;
    }
    setErrors(null);
    setText("");
    setWarnings(result.warnings?.length ? result.warnings : null);
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="text-sm font-bold mb-1">Load a generated trip</div>
      <p className="text-xs mb-3" style={{ color: C.sub }}>
        Already ran the prompt from “Plan a trip” above (or have a trip .json)? Choose the file or
        paste the JSON — it is validated before it appears in the picker, and replaces its scaffold
        in place when the ids match.
      </p>
      <input
        type="file"
        accept=".json,application/json"
        className="text-sm mb-3 block"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            file.text().then(handleRaw);
            e.target.value = "";
          }
        }}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='…or paste the generated trip JSON here ({"id": "trip-…", …})'
        rows={4}
        className="w-full rounded-md p-2 text-xs mb-2"
        style={{ border: `1px solid ${C.border}`, ...mono }}
      />
      <button
        onClick={() => text.trim() && handleRaw(text)}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: C.line, color: "#fff", opacity: text.trim() ? 1 : 0.5 }}
      >
        Load pasted JSON
      </button>
      {errors && (
        <div className="rounded-md px-3 py-2 mt-3 text-sm" style={{ background: C.redBg, color: C.red }}>
          <div className="font-semibold mb-1">This file is not a valid Wayfork trip:</div>
          <ul className="list-disc ml-5 text-xs">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings && (
        <div className="rounded-md px-3 py-2 mt-3 text-sm" style={{ background: C.amberBg, color: C.amber }}>
          <div className="font-semibold mb-1">
            Scaffold replaced — but the pasted trip drifted from it:
          </div>
          <ul className="list-disc ml-5 text-xs">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
