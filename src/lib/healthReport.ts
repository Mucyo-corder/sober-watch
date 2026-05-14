/**
 * Alcohol Sensor Health Status Report Generator
 * Generates professional health reports based on IoT alcohol sensor readings
 */

export type AlcoholStatus = "SAFE" | "WARNING" | "DANGER";

export interface SensorReading {
  bac: number;
  timestamp: string;
  deviceId?: string;
  userId?: string;
}

export interface HealthReport {
  title: string;
  summary: {
    status: AlcoholStatus;
    interpretation: string;
  };
  detailedAnalysis: {
    bacValue: string;
    riskLevel: string;
    effects: string[];
  };
  recommendations: string[];
  finalStatusBadge: string;
  generatedAt: string;
}

/**
 * Classify alcohol level according to health guidelines
 */
export function classifyAlcoholLevel(bac: number): AlcoholStatus {
  if (bac > 0.08) return "DANGER";
  if (bac >= 0.02) return "WARNING";
  return "SAFE";
}

/**
 * Get status emoji for visual representation
 */
export function getStatusEmoji(status: AlcoholStatus): string {
  switch (status) {
    case "SAFE":
      return "🟢";
    case "WARNING":
      return "🟡";
    case "DANGER":
      return "🔴";
  }
}

/**
 * Format BAC value for display
 */
export function formatBAC(bac: number): string {
  return `${bac.toFixed(3)} mg/L`;
}

/**
 * Generate professional health status report
 */
export function generateHealthReport(reading: SensorReading): HealthReport {
  const status = classifyAlcoholLevel(reading.bac);
  const emoji = getStatusEmoji(status);

  const summaryMap: Record<AlcoholStatus, string> = {
    SAFE: `The current BAC level of ${formatBAC(reading.bac)} indicates a SAFE state. No significant alcohol detected or within safe limits.`,
    WARNING: `The current BAC level of ${formatBAC(reading.bac)} indicates a WARNING state. Mild alcohol intoxication detected with potential impact on concentration and judgment.`,
    DANGER: `The current BAC level of ${formatBAC(reading.bac)} indicates a DANGER state. High intoxication level detected with significant impairment of coordination and judgment.`,
  };

  const riskMap: Record<AlcoholStatus, string> = {
    SAFE: "Low risk - Normal functioning expected",
    WARNING: "Moderate risk - Reduced cognitive abilities",
    DANGER: "High risk - Severe impairment, safety critical",
  };

  const effectsMap: Record<AlcoholStatus, string[]> = {
    SAFE: [
      "Normal coordination and reflexes",
      "Clear judgment and decision-making",
      "No significant impairment detected",
      "User is fit for normal activities",
    ],
    WARNING: [
      "Mild reduction in concentration ability",
      "Slightly impaired judgment",
      "Decreased reaction time",
      "Reduced peripheral vision awareness",
      "Caution advised for precision tasks",
    ],
    DANGER: [
      "Severe coordination impairment",
      "Significantly compromised judgment",
      "Dangerously slowed reaction time",
      "Poor depth perception and balance",
      "Risk of nausea and health complications",
      "High probability of accidents or injury",
    ],
  };

  const recommendationMap: Record<AlcoholStatus, string[]> = {
    SAFE: [
      "Continue normal activities",
      "Monitor for any changes in condition",
      "No specific restrictions needed",
    ],
    WARNING: [
      "DO NOT drive or operate machinery",
      "Avoid high-focus or safety-critical tasks",
      "Drink water to stay hydrated",
      "Rest in a safe environment",
      "Wait for BAC to decrease before resuming activities",
      "Monitor for escalation to DANGER level",
    ],
    DANGER: [
      "IMMEDIATE ACTION REQUIRED",
      "DO NOT drive, operate vehicles, or use machinery under any circumstances",
      "Seek medical attention if symptoms are severe",
      "Stay hydrated with water only (no more alcohol)",
      "Rest in a safe, supervised location",
      "Do not leave alone - arrange for safe transport/supervision",
      "Call emergency services if unconsciousness, vomiting, or breathing difficulties occur",
      "Wait at least 6-12 hours before considering any activity requiring alertness",
    ],
  };

  return {
    title: "Alcohol Sensor Health Status Report",
    summary: {
      status,
      interpretation: summaryMap[status],
    },
    detailedAnalysis: {
      bacValue: formatBAC(reading.bac),
      riskLevel: riskMap[status],
      effects: effectsMap[status],
    },
    recommendations: recommendationMap[status],
    finalStatusBadge: `${emoji} ${status}`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format report as plain text for display/printing
 */
export function formatReportAsText(report: HealthReport, deviceId?: string): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push(report.title.toUpperCase());
  lines.push("=".repeat(60));
  lines.push("");
  lines.push("GENERATED AT: " + new Date(report.generatedAt).toLocaleString());
  if (deviceId) lines.push(`DEVICE ID: ${deviceId}`);
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("SUMMARY");
  lines.push("─".repeat(60));
  lines.push(`Status: ${report.finalStatusBadge}`);
  lines.push("");
  lines.push(report.summary.interpretation);
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("DETAILED ANALYSIS");
  lines.push("─".repeat(60));
  lines.push(`BAC Level: ${report.detailedAnalysis.bacValue}`);
  lines.push(`Risk Assessment: ${report.detailedAnalysis.riskLevel}`);
  lines.push("");
  lines.push("Physiological & Behavioral Effects:");
  report.detailedAnalysis.effects.forEach((effect) => {
    lines.push(`  • ${effect}`);
  });
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("RECOMMENDATIONS");
  lines.push("─".repeat(60));
  report.recommendations.forEach((rec) => {
    lines.push(`  • ${rec}`);
  });
  lines.push("");

  lines.push("─".repeat(60));
  lines.push("FINAL STATUS");
  lines.push("─".repeat(60));
  lines.push(`  ${report.finalStatusBadge}`);
  lines.push("");
  lines.push("=".repeat(60));
  lines.push("END OF REPORT");
  lines.push("=".repeat(60));

  return lines.join("\n");
}
