import type { CSSProperties, ReactNode } from "react";
import { C } from "./theme";

export function Chip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
      style={{ background: "#EEF2F6", color: C.sub, ...style }}
    >
      {children}
    </span>
  );
}
