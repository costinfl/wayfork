import { useRef, useState } from "react";
import { buildTripPrompt } from "../domain/prompt";
import { scaffoldTrip, type Place, type PlanInput } from "../domain/scaffold";
import type { Trip } from "../domain/types";
import { PlaceInput, type SearchFn } from "./PlaceInput";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

let rowSeq = 0;
const newRowKey = () => `dest-${rowSeq++}`;

interface DestRow {
  key: string;
  place: Place | null;
}

// The "Plan a trip" form: starting point + ordered destinations (place
// autocomplete), start date, number of days, and a return-to-start toggle.
// Submitting builds a scaffold trip (persisted + opened via onCreate) and shows
// the tailored AI prompt to copy.
export function PlanTripForm({
  onCreate,
  search,
}: {
  onCreate: (trip: Trip) => void;
  search?: SearchFn;
}) {
  const [startPoint, setStartPoint] = useState<Place | null>(null);
  const [destinations, setDestinations] = useState<DestRow[]>(() => [{ key: newRowKey(), place: null }]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [numDays, setNumDays] = useState("5");
  const [returnToStart, setReturnToStart] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLDivElement | null>(null);

  const setDest = (key: string, place: Place | null) =>
    setDestinations((rows) => rows.map((r) => (r.key === key ? { ...r, place } : r)));

  const addDest = () => setDestinations((rows) => [...rows, { key: newRowKey(), place: null }]);

  const removeDest = (key: string) =>
    setDestinations((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));

  const moveDest = (index: number, dir: -1 | 1) =>
    setDestinations((rows) => {
      const j = index + dir;
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const startName = startPoint?.name ?? "the starting point";

  const submit = () => {
    setError(null);
    setPrompt(null);
    if (!startPoint) return setError("Choose a starting point.");
    const dests = destinations.map((r) => r.place).filter((p): p is Place => p !== null);
    if (dests.length === 0) return setError("Add at least one destination.");
    if (!startDate) return setError("Choose a start date.");
    const n = parseInt(numDays, 10);
    if (!Number.isFinite(n) || n < 1) return setError("Number of days must be a positive number.");
    const input: PlanInput = { startPoint, destinations: dests, startDate, numDays: n, returnToStart };
    try {
      const scaffold = scaffoldTrip(input);
      onCreate(scaffold);
      setPrompt(buildTripPrompt(input, scaffold));
      setTimeout(() => {
        if (typeof promptRef.current?.scrollIntoView === "function") {
          promptRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 0);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="text-sm font-bold mb-1">Plan a trip</div>
      <p className="text-xs mb-3" style={{ color: C.sub }}>
        Pick where you start and where you're going. We'll build a day-by-day scaffold and a tailored
        AI prompt to fill it with real flights, stations and prices.
      </p>

      <div className="mb-3">
        <PlaceInput
          label="Starting point"
          placeholder="e.g. Bucharest"
          value={startPoint}
          onChange={setStartPoint}
          search={search}
        />
      </div>

      <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.sub }}>
        Destinations
      </div>
      {destinations.map((row, i) => (
        <div key={row.key} className="flex gap-1.5 items-start mb-2">
          <div className="flex-1">
            <PlaceInput
              label={`Destination ${i + 1}`}
              placeholder="e.g. Rome"
              value={row.place}
              onChange={(p) => setDest(row.key, p)}
              search={search}
            />
          </div>
          <div className="flex gap-1 pt-4">
            <button
              type="button"
              onClick={() => moveDest(i, -1)}
              disabled={i === 0}
              title="Move up"
              className="text-xs px-1.5 py-1 rounded"
              style={{ border: `1px solid ${C.border}`, color: C.sub, opacity: i === 0 ? 0.4 : 1 }}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveDest(i, 1)}
              disabled={i === destinations.length - 1}
              title="Move down"
              className="text-xs px-1.5 py-1 rounded"
              style={{
                border: `1px solid ${C.border}`,
                color: C.sub,
                opacity: i === destinations.length - 1 ? 0.4 : 1,
              }}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => removeDest(row.key)}
              disabled={destinations.length === 1}
              title="Remove destination"
              className="text-xs px-1.5 py-1 rounded"
              style={{
                border: `1px solid ${C.border}`,
                color: C.red,
                opacity: destinations.length === 1 ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addDest}
        className="text-xs px-2 py-1 rounded mb-3"
        style={{ border: `1px solid ${C.border}`, color: C.line }}
      >
        + destination
      </button>

      <div className="flex gap-2 flex-wrap mb-3">
        <label className="text-xs" style={{ color: C.sub }}>
          Start date
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="block rounded px-2 py-1.5 text-sm mt-0.5"
            style={inputStyle}
          />
        </label>
        <label className="text-xs" style={{ color: C.sub }}>
          Number of days
          <input
            value={numDays}
            onChange={(e) => setNumDays(e.target.value)}
            inputMode="numeric"
            className="w-24 block rounded px-2 py-1.5 text-sm mt-0.5"
            style={{ ...inputStyle, ...mono }}
          />
        </label>
      </div>

      <label className="text-xs flex items-center gap-1.5 mb-3" style={{ color: C.sub }}>
        <input
          type="checkbox"
          checked={returnToStart}
          onChange={(e) => setReturnToStart(e.target.checked)}
        />
        Return to {startName} on the last day
      </label>

      {error && (
        <div className="rounded-md px-3 py-2 mb-3 text-xs" style={{ background: C.redBg, color: C.red }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        className="px-3 py-1.5 rounded-lg text-sm font-semibold"
        style={{ background: C.line, color: "#fff" }}
      >
        Create scaffold & prompt
      </button>

      {prompt && (
        <div
          ref={promptRef}
          className="rounded-lg p-3 mt-4"
          style={{ background: C.bg, border: `1px solid ${C.border}` }}
        >
          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
            <div className="text-sm font-bold">Your trip scaffold is ready</div>
            <button
              type="button"
              onClick={copyPrompt}
              className="px-3 py-1 rounded-lg text-sm font-semibold"
              style={{
                border: `1px solid ${C.line}`,
                background: copied ? C.line : C.lineSoft,
                color: copied ? "#fff" : C.line,
              }}
            >
              {copied ? "Copied ✓" : "Copy prompt"}
            </button>
          </div>
          <p className="text-xs mb-2" style={{ color: C.sub }}>
            The trip is already in your picker. Run this prompt in any AI assistant, then paste the
            AI's JSON back below to fill the trip with real data.
          </p>
          <pre
            className="text-xs rounded-md p-2 overflow-auto"
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.ink,
              maxHeight: 260,
              ...mono,
              whiteSpace: "pre-wrap",
            }}
          >
            {prompt}
          </pre>
        </div>
      )}
    </div>
  );
}
