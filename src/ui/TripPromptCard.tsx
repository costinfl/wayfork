import { useState } from "react";
import TRIP_PROMPT from "../../docs/trip-prompt.md?raw";
import { C, mono } from "./theme";

// The public trip-generation contract, shown copy-ready in the app. Sourced
// from docs/trip-prompt.md so the in-app prompt and the repo doc never drift.
export function TripPromptCard() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TRIP_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-lg p-3 mb-3" style={{ background: C.bg, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <div className="text-sm font-bold">Generate a trip with any AI</div>
        <button
          onClick={copy}
          className="px-3 py-1 rounded-lg text-sm font-semibold"
          style={{ border: `1px solid ${C.line}`, background: copied ? C.line : C.lineSoft, color: copied ? "#fff" : C.line }}
        >
          {copied ? "Copied ✓" : "Copy prompt"}
        </button>
      </div>
      <p className="text-xs mb-2" style={{ color: C.sub }}>
        Copy this prompt, replace <span style={mono}>{"{DESTINATION}"}</span>,{" "}
        <span style={mono}>{"{START_DATE}"}</span> and <span style={mono}>{"{END_DATE}"}</span>, and
        run it in any AI assistant — one with web or API access will fill it with real flights,
        stations and prices. Paste the JSON it returns below.
      </p>
      <pre
        className="text-xs rounded-md p-2 overflow-auto"
        style={{ background: C.card, border: `1px solid ${C.border}`, color: C.ink, maxHeight: 260, ...mono, whiteSpace: "pre-wrap" }}
      >
        {TRIP_PROMPT}
      </pre>
    </div>
  );
}
