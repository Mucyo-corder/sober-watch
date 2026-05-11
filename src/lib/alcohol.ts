export type AlcoholStatus = "SAFE" | "WARNING" | "DANGER";

export const ALCOHOL_THRESHOLDS = {
  warning: 0.02,
  danger: 0.05,
} as const;

export function classifyAlcohol(level: number): AlcoholStatus {
  if (level >= ALCOHOL_THRESHOLDS.danger) return "DANGER";
  if (level >= ALCOHOL_THRESHOLDS.warning) return "WARNING";
  return "SAFE";
}

export function statusColorClasses(status: AlcoholStatus | string) {
  switch (status) {
    case "SAFE":
      return {
        text: "text-green-700",
        bg: "bg-green-100",
        dot: "bg-green-500",
        badge: "bg-green-600 text-white",
        progress: "bg-green-500",
      };
    case "WARNING":
      return {
        text: "text-orange-700",
        bg: "bg-orange-100",
        dot: "bg-orange-500",
        badge: "bg-orange-500 text-white",
        progress: "bg-orange-500",
      };
    case "DANGER":
      return {
        text: "text-red-700",
        bg: "bg-red-100",
        dot: "bg-red-500",
        badge: "bg-red-600 text-white",
        progress: "bg-red-500",
      };
    default:
      return {
        text: "text-slate-700",
        bg: "bg-slate-100",
        dot: "bg-slate-500",
        badge: "bg-slate-600 text-white",
        progress: "bg-slate-500",
      };
  }
}

export function formatAlcoholLevel(level: number | string): string {
  const numLevel = typeof level === 'string' ? parseFloat(level) : level;
  return `${numLevel.toFixed(3)} mg/L`;
}

export function formatAlcoholPercentage(level: number | string): string {
  const numLevel = typeof level === 'string' ? parseFloat(level) : level;
  const percentage = (numLevel * 100).toFixed(1);
  return `${percentage}%`;
}

export function getAlcoholRange(level: number): string {
  if (level >= 0.05) return "DANGER";
  if (level >= 0.02) return "WARNING";
  return "SAFE";
}
