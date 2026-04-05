/**
 * Mock health data for landing page demos.
 * Generates realistic-looking 90-day datasets for chart previews.
 */

export interface DataPoint {
  date: string;
  value: number;
}

function generateData(
  days: number,
  min: number,
  max: number,
  trend: "up" | "flat" | "wave" = "flat",
  volatility = 0.3,
): DataPoint[] {
  const data: DataPoint[] = [];
  const range = max - min;
  let current = min + range * 0.5;

  for (let i = 0; i < days; i++) {
    const date = new Date(2026, 0, 1 + i);
    const dateStr = date.toISOString().slice(0, 10);

    // Add trend bias
    let trendBias = 0;
    if (trend === "up") trendBias = (range * 0.3 * i) / days;
    if (trend === "wave")
      trendBias = Math.sin((i / days) * Math.PI * 3) * range * 0.15;

    // Random walk with mean reversion
    const noise = (Math.random() - 0.5) * range * volatility;
    const meanReversion = (min + range * 0.5 - current) * 0.1;
    current = Math.max(
      min,
      Math.min(max, current + noise + meanReversion + trendBias * 0.02),
    );

    data.push({ date: dateStr, value: Math.round(current) });
  }
  return data;
}

export const mockSleepScore = generateData(90, 62, 95, "up", 0.25);
export const mockHrv = generateData(90, 22, 58, "wave", 0.35);
export const mockRhr = generateData(90, 54, 72, "flat", 0.2);
export const mockSteps = generateData(90, 3200, 13000, "wave", 0.4);
export const mockReadiness = generateData(90, 55, 92, "up", 0.25);

/** Last 30 days subset for compact sparkline previews */
export const sparkSleep = mockSleepScore.slice(-30);
export const sparkHrv = mockHrv.slice(-30);
export const sparkRhr = mockRhr.slice(-30);
export const sparkSteps = mockSteps.slice(-30);
export const sparkReadiness = mockReadiness.slice(-30);
