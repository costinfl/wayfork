import type { CSSProperties } from "react";
import type { StepType } from "../domain/types";

// Colours are CSS variables (values in index.css), so the planner follows the
// map's light/dark toggle without re-rendering.
export const C = {
  bg: "var(--wf-bg)",
  sheet: "var(--wf-sheet)", // the floating planner surface (translucent)
  card: "var(--wf-card)",
  panel: "var(--wf-panel)", // inset form / summary blocks
  chip: "var(--wf-chip)",
  ink: "var(--wf-ink)",
  sub: "var(--wf-sub)",
  line: "var(--wf-line)", // active route blue
  onLine: "var(--wf-on-line)", // text on a `line`/`amber` fill
  lineSoft: "var(--wf-line-soft)",
  ghost: "var(--wf-ghost)", // inactive variant
  ok: "var(--wf-ok)",
  okBg: "var(--wf-ok-bg)",
  amber: "var(--wf-amber)",
  amberBg: "var(--wf-amber-bg)",
  red: "var(--wf-red)",
  redBg: "var(--wf-red-bg)",
  border: "var(--wf-border)",
};

// One light/dark switch for the whole app: the map's toggle (TripMap) calls
// this; the stored choice is applied at load so nothing flashes.
export function applyTheme(dark: boolean): void {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = dark ? "dark" : "light";
}
export function storedDark(): boolean {
  try {
    return localStorage.getItem("wayfork.mapDark") !== "0"; // dark by default
  } catch {
    return true;
  }
}
applyTheme(storedDark());


export const STEP_ICON: Record<StepType, string> = {
  walk: "🚶",
  metro: "🚇",
  bus: "🚌",
  train: "🚆",
  car: "🚕",
  shuttle: "🚐",
  flight: "✈️",
  wait: "⏳",
  transfer: "↔️",
};

export const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
