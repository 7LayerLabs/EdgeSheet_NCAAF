import type { WeatherInput } from "./types";

export type FlagLevel = "note" | "flag" | "elevated";

export interface WeatherFlag {
  key: "wind" | "rain" | "heat" | "cold" | "storm" | "indoor" | "altitude";
  level: FlagLevel;
  title: string;
  effect: string;
}

export function heatIndex(t: number, rh: number): number {
  if (t < 80) return t;
  const hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  return Math.round(hi);
}

/**
 * Rules engine from the blueprint. Thresholds decide severity here;
 * the AI layer is only allowed to phrase the result.
 */
export function evaluateWeather(w: WeatherInput): WeatherFlag[] {
  const flags: WeatherFlag[] = [];

  if (w.roof === "fixed" || w.roof === "retractable-closed") {
    flags.push({
      key: "indoor",
      level: "note",
      title: "Indoor game",
      effect: "Roof is closed. Outdoor wind, rain, and temperature effects are suppressed.",
    });
    return flags;
  }

  if (w.roof === "retractable-unknown") {
    flags.push({
      key: "indoor",
      level: "note",
      title: "Retractable roof, status unknown",
      effect: "Treat outdoor conditions as possible until the roof decision is confirmed.",
    });
  }

  if (w.windMph >= 20 || w.gustMph >= 20) {
    flags.push({
      key: "wind",
      level: "elevated",
      title: `Wind ${w.windMph} mph, gusts ${w.gustMph}`,
      effect: `${w.crosswind ? "Crosswind" : "Wind"} strong enough to shorten field-goal range, punish deep passing, and make the sideline choice matter at the coin toss.`,
    });
  } else if (w.windMph >= 15) {
    flags.push({
      key: "wind",
      level: "flag",
      title: `Wind ${w.windMph} mph`,
      effect: "Enough to affect long field goals and punts. Watch whether deep-shot rate drops into the wind.",
    });
  }

  if (w.precipChance >= 50 && w.precipWindow) {
    flags.push({
      key: "rain",
      level: w.precipChance >= 70 ? "elevated" : "flag",
      title: `${w.precipChance}% rain ${w.precipWindow}`,
      effect: "Rain inside the game window. Expect more ball-security emphasis, worse footing on cuts, and a lower pass volume.",
    });
  }

  const hi = heatIndex(w.tempF, w.humidity);
  if (hi >= 95) {
    flags.push({
      key: "heat",
      level: hi >= 105 ? "elevated" : "flag",
      title: `Heat index ${hi}°`,
      effect: "Defensive line rotation and tempo become a factor. Depth on the defensive front matters more than usual.",
    });
  }

  if (w.tempF <= 36) {
    flags.push({
      key: "cold",
      level: w.tempF <= 28 ? "elevated" : "flag",
      title: `${w.tempF}° at kickoff`,
      effect: "Near-freezing. Kicking distance and ball handling may suffer, though the size of the effect varies by player.",
    });
  }

  if (w.stormRisk !== "none") {
    flags.push({
      key: "storm",
      level: w.stormRisk === "warning" ? "elevated" : "flag",
      title: w.stormRisk === "warning" ? "Storm warning" : "Storm watch",
      effect: "Lightning delay is possible. Kickoff conditions may differ from the current forecast.",
    });
  }

  if (w.elevationFt >= 4500) {
    flags.push({
      key: "altitude",
      level: "note",
      title: `${w.elevationFt.toLocaleString()} ft elevation`,
      effect: "Thin air adds kicking distance and taxes conditioning for the visiting team.",
    });
  }

  return flags;
}

export function weatherRisk(w?: WeatherInput): "none" | "low" | "high" {
  if (!w) return "none";
  const flags = evaluateWeather(w);
  if (flags.some((f) => f.level === "elevated")) return "high";
  if (flags.some((f) => f.level === "flag")) return "low";
  return "none";
}
