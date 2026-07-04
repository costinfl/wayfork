// Time = integer minutes since midnight.

export const fmtTime = (m: number): string => {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

export const fmtDur = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + "m" : ""}`.trim() : `${m}m`;

// Signed timezone offset for display, e.g. +1h, −30m, −1h 30m.
export const fmtOffset = (m: number): string => {
  const sign = m < 0 ? "−" : "+";
  return `${sign}${fmtDur(Math.abs(m))}`;
};
