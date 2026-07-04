import type { CheckpointResult } from "../domain/schedule";
import { fmtDur, fmtTime } from "../domain/time";
import { C, mono } from "./theme";

export function CheckpointBanner({ cp }: { cp: CheckpointResult }) {
  const map = {
    ok: { bg: "#E7F4EC", fg: C.ok, msg: `Buffer ${fmtDur(cp.margin)} — on track` },
    amber: {
      bg: C.amberBg,
      fg: C.amber,
      msg: `Only ${fmtDur(cp.margin)} left — below ${fmtDur(cp.bufferMin)} safety buffer`,
    },
    red: { bg: C.redBg, fg: C.red, msg: `Arriving ${fmtDur(-cp.margin)} LATE — checkpoint breached` },
  }[cp.status];
  const window = cp.opensMin != null;
  return (
    <div
      className="rounded-md px-3 py-2 mb-2 text-sm font-medium"
      style={{ background: map.bg, color: map.fg }}
    >
      <div className="flex items-center gap-2">
        <span>⏱</span>
        <span>
          <span style={mono}>
            {window ? `${fmtTime(cp.opensMin!)}–${fmtTime(cp.timeMin)}` : fmtTime(cp.timeMin)}
          </span>{" "}
          · {cp.label} — {map.msg}
        </span>
      </div>
      {cp.waitMin > 0 && (
        <div className="text-xs mt-0.5" style={{ opacity: 0.85 }}>
          Arriving before it opens — you'd wait {fmtDur(cp.waitMin)}.
        </div>
      )}
    </div>
  );
}
