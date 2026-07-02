import type { MicroStep } from "../domain/types";
import { Chip } from "./Chip";
import { mono, STEP_ICON } from "./theme";

export function StepChip({ ms }: { ms: MicroStep }) {
  return (
    <Chip>
      {STEP_ICON[ms.type]} {ms.label} · <span style={mono}>{ms.durationMin}m</span>
      {ms.distanceKm !== null && (
        <span style={{ ...mono, opacity: 0.7 }}>· {ms.distanceKm}km</span>
      )}
    </Chip>
  );
}
