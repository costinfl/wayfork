import { C } from "./theme";

// Muted "est." chip marking data (a variant cost, an expense amount) that is a
// placeholder or approximation the user has not yet verified.
export function EstBadge() {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: "#EEF2F6", color: C.sub }}
      title="Estimated — not yet verified"
    >
      est.
    </span>
  );
}
