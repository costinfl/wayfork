import { convert, money } from "../domain/currency";
import type { RateMatrix } from "../domain/currency";
import { variantDuration } from "../domain/schedule";
import { fmtDur } from "../domain/time";
import type { CurrencyView, TripCurrencies, VariantNode } from "../domain/types";
import { exposedMinutes } from "../domain/weather";
import { EstBadge } from "./EstBadge";
import { StepChip } from "./StepChip";
import { C, mono } from "./theme";

export function VariantCard({
  variant,
  active,
  onSelect,
  onFocus,
  ccyView,
  tripCcy,
  rates,
  rainRisk = false,
}: {
  variant: VariantNode;
  active: boolean;
  onSelect: () => void;
  // Present only when the slot has a map place: focuses the map on this variant.
  onFocus?: () => void;
  ccyView: CurrencyView;
  tripCcy: TripCurrencies;
  rates: RateMatrix;
  rainRisk?: boolean;
}) {
  const dur = variantDuration(variant);
  const cost = convert(variant.cost.amount, variant.cost.currency, tripCcy[ccyView], rates);
  const exposed = exposedMinutes(variant);
  return (
    // A role=button div (not a <button>) so the ⌖ focus control can nest without
    // an invalid button-in-button.
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="text-left rounded-lg p-3 w-full transition-all cursor-pointer"
      style={{
        background: active ? C.lineSoft : C.card,
        border: active ? `2px solid ${C.line}` : `2px dashed ${C.border}`,
        opacity: active ? 1 : 0.75,
      }}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-sm font-semibold" style={{ color: active ? C.line : C.sub }}>
          {variant.name}
        </span>
        <span className="flex items-center gap-1.5">
          {onFocus && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFocus();
              }}
              title="Focus this variant on the map"
              aria-label="Focus on map"
              className="text-xs leading-none px-1.5 py-1 rounded"
              style={{ border: `1px solid ${C.border}`, color: C.line, background: C.card }}
            >
              ⌖
            </button>
          )}
          {active && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ background: C.line, color: "#fff" }}
            >
              ACTIVE
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {variant.microSteps.map((ms) => (
          <StepChip key={ms.id} ms={ms} />
        ))}
      </div>
      <div className="flex justify-between text-sm" style={{ color: C.ink }}>
        <span style={mono}>{fmtDur(dur)}</span>
        <span className="flex items-center gap-1.5">
          {variant.estimated && <EstBadge />}
          <span style={mono}>{variant.cost.amount === 0 ? "—" : money(cost, tripCcy[ccyView])}</span>
        </span>
      </div>
      {rainRisk && exposed > 0 && (
        <div className="mt-1.5 text-xs font-medium" style={{ color: C.amber }}>
          ☔ {fmtDur(exposed)} outdoors — rain likely
        </div>
      )}
    </div>
  );
}
