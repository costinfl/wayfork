import { parseTrip } from "../domain/parse";
import type { Trip } from "../domain/types";
import lisbonJson from "./trips/lisbon.json";
import neptunJson from "./trips/neptun.json";
import romeJson from "./trips/rome.json";
import sicilyJson from "./trips/sicily_to_puglia_inland_connection.json";

// Built-in trips ship as JSON — the same format the in-app "Add trip" upload
// accepts (see docs/MOCK_TRIP_PROMPT.md). Register new committed trips here;
// the header shows a picker when there is more than one.
const load = (raw: unknown, name: string): Trip => {
  const { trip, errors } = parseTrip(raw);
  if (!trip) throw new Error(`Invalid built-in trip "${name}":\n${errors.join("\n")}`);
  return trip;
};

export const TRIPS: Trip[] = [
  load(romeJson, "rome"),
  load(lisbonJson, "lisbon"),
  load(neptunJson, "neptun"),
  load(sicilyJson, "sicily"),
];
