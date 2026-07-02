import type { CSSProperties } from "react";
import type { StepType } from "../domain/types";

export const C = {
  bg: "#F4F6F8",
  card: "#FFFFFF",
  ink: "#17222C",
  sub: "#5C6B78",
  line: "#1D5BD8", // active route blue
  lineSoft: "#DDE7FA",
  ghost: "#9AA7B4", // inactive variant
  ok: "#1E7F4F",
  amber: "#B26E00",
  amberBg: "#FDF3E1",
  red: "#C0392B",
  redBg: "#FBE9E7",
  border: "#E3E8ED",
};

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
