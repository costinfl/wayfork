import TRIP_PROMPT from "../../docs/trip-prompt.md?raw";
import type { PlanInput } from "./scaffold";
import type { Trip } from "./types";

// Turn a plan + its scaffold trip into the concrete AI prompt: the repo
// template (docs/trip-prompt.md, imported ?raw so doc and app never drift) with
// every placeholder substituted and the scaffold's day table injected. The
// scaffold is the contract — the AI must reproduce these days/dates/locations
// verbatim and only enrich them.

const fmtCoord = (n: number): string => String(Number(n.toFixed(4)));

const destinationList = (input: PlanInput): string =>
  input.destinations
    .map((d, i) => `  ${i + 1}. ${d.name} — lat ${fmtCoord(d.lat)}, lon ${fmtCoord(d.lon)}`)
    .join("\n");

const dayTable = (scaffold: Trip): string =>
  scaffold.days
    .map((d, i) => {
      const loc = d.location;
      const place = loc ? loc.name : "—";
      const lat = loc ? fmtCoord(loc.lat) : "—";
      const lon = loc ? fmtCoord(loc.lon) : "—";
      return `| ${i + 1} | ${d.date} | ${place} | ${lat} | ${lon} |`;
    })
    .join("\n");

export function buildTripPrompt(input: PlanInput, scaffold: Trip): string {
  const subs: Record<string, string> = {
    "{START_POINT}": `${input.startPoint.name} (lat ${fmtCoord(input.startPoint.lat)}, lon ${fmtCoord(input.startPoint.lon)})`,
    "{DESTINATION_LIST}": destinationList(input),
    "{START_DATE}": input.startDate,
    "{NUM_DAYS}": String(input.numDays),
    "{RETURN_FLAG}": input.returnToStart ? "yes" : "no",
    "{TRIP_ID}": scaffold.id,
    "{DAY_SCAFFOLD}": dayTable(scaffold),
  };
  let out = TRIP_PROMPT;
  for (const [token, value] of Object.entries(subs)) {
    out = out.split(token).join(value);
  }
  return out;
}
