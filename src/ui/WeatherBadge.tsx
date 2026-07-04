import type { DayWeather } from "../domain/weather";
import { RAIN_RISK_THRESHOLD, weatherIcon } from "../domain/weather";
import { C, mono } from "./theme";

// Compact forecast chip for a day header. Rendered only when a forecast is
// available (day has a location and the date is within range).
export function WeatherBadge({ weather, place }: { weather: DayWeather; place: string }) {
  const { icon, label } = weatherIcon(weather.code);
  const wet = weather.precipProb >= RAIN_RISK_THRESHOLD;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs"
      style={{ background: wet ? C.amberBg : "#EEF2F6", color: wet ? C.amber : C.sub }}
      title={`${place}: ${label}, ${Math.round(weather.tMin)}–${Math.round(weather.tMax)}°C, ${weather.precipProb}% rain`}
    >
      <span>{icon}</span>
      <span style={mono}>
        {Math.round(weather.tMax)}°/{Math.round(weather.tMin)}°
      </span>
      <span style={mono}>💧{weather.precipProb}%</span>
    </span>
  );
}
