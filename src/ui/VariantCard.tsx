import { convert, money } from "../domain/currency";
import { variantDuration } from "../domain/schedule";
import { fmtDur } from "../domain/time";
import type { CurrencyView, TripCurrencies, VariantNode } from "../domain/types";
import { Chip } from "./Chip";
import { C, STEP_ICON, mono } from "./theme";

export function VariantCard({
  variant,
  active,
  onSelect,
  ccyView,
  tripCcy,
}: {
  variant: VariantNode;
  active: boolean;
  onSelect: () => void;
  ccyView: CurrencyView;
  tripCcy: TripCurrencies;
}) {
  const dur = variantDuration(variant);
  const cost = convert(variant.cost.amount, variant.cost.currency, tripCcy[ccyView]);
  return (
    <button
      onClick={onSelect}
      className="text-left rounded-lg p-3 w-full transition-all"
      style={{
        background: active ? C.lineSoft : C.card,
        border: active ? `2px solid ${C.line}` : `2px dashed ${C.border}`,
        opacity: active ? 1 : 0.75,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: active ? C.line : C.sub }}>
          {variant.name}
        </span>
        {active && (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ background: C.line, color: "#fff" }}
          >
            ACTIVE
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {variant.microSteps.map((ms) => (
          <Chip key={ms.id}>
            {STEP_ICON[ms.type]} {ms.label} · <span style={mono}>{ms.durationMin}m</span>
          </Chip>
        ))}
      </div>
      <div className="flex justify-between text-sm" style={{ color: C.ink }}>
        <span style={mono}>{fmtDur(dur)}</span>
        <span style={mono}>{variant.cost.amount === 0 ? "—" : money(cost, tripCcy[ccyView])}</span>
      </div>
    </button>
  );
}
