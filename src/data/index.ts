import type { Trip } from "../domain/types";
import { LISBON_TRIP } from "./trips/lisbon";
import { ROME_TRIP } from "./trips/rome";

// All trips available in the app. Register newly generated mock trips here
// (see docs/MOCK_TRIP_PROMPT.md); the header shows a picker when there is
// more than one.
export const TRIPS: Trip[] = [ROME_TRIP, LISBON_TRIP];
