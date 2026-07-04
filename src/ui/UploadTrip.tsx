import { useState } from "react";
import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import { C, mono } from "./theme";
import { TripPromptCard } from "./TripPromptCard";

// Panel for loading an AI-generated trip: copy the in-app prompt contract
// (TripPromptCard), then pick a .json file or paste the JSON the assistant
// returns. onLoaded returns a rejection message or null.
export function UploadTrip({ onLoaded }: { onLoaded: (trip: Trip) => string | null }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);

  const handleRaw = (raw: string) => {
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
    const rejection = onLoaded(trip);
    if (rejection) {
      setErrors([rejection]);
      return;
    }
    setErrors(null);
    setText("");
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="text-sm font-bold mb-1">Add a trip</div>
      <p className="text-xs mb-3" style={{ color: C.sub }}>
        Generate a trip with the prompt below, then choose its .json file or paste the JSON. It is
        validated before it appears in the picker.
      </p>
      <TripPromptCard />
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
    </div>
  );
}
