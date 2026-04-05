/**
 * Rolling Averages Computation Service
 *
 * Computes simple moving averages over 7-day or 30-day windows.
 * Used by the Trend view endpoint to smooth daily metric data.
 *
 * For each date in the input, the rolling average is the arithmetic mean
 * of all available data points in the window [D − (windowDays − 1), D].
 * Missing days are skipped — the average is computed over available points
 * only (no zero-fill).
 *
 * See: /docs/dashboard-backend-lld.md §5.4
 */

/**
 * Compute rolling averages over the given data with the specified window size.
 *
 * For each date D in the input, computes the mean of all data points
 * whose date falls within [D − (windowDays − 1), D] inclusive. Only
 * data points that actually exist in the input are used — missing days
 * are skipped, not zero-filled.
 *
 * Input MUST be sorted by date ascending. Early dates with fewer than
 * windowDays points of history use whatever points are available.
 *
 * @param data - Array of {date, value} objects sorted by date ascending
 * @param windowDays - Window size: 7 or 30 days
 * @returns Array of {date, value} with smoothed values, same length as input
 */
export function computeRollingAverages(
  data: { date: string; value: number }[],
  windowDays: 7 | 30,
): { date: string; value: number }[] {
  if (data.length === 0) {
    return [];
  }

  const result: { date: string; value: number }[] = [];

  for (let i = 0; i < data.length; i++) {
    const currentDate = new Date(data[i]!.date + "T00:00:00Z");
    const windowStart = new Date(currentDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));

    // Collect all data points in [windowStart, currentDate]
    let sum = 0;
    let count = 0;

    for (let j = i; j >= 0; j--) {
      const pointDate = new Date(data[j]!.date + "T00:00:00Z");

      // If this point is before the window start, stop looking
      if (pointDate < windowStart) {
        break;
      }

      sum += data[j]!.value;
      count++;
    }

    result.push({
      date: data[i]!.date,
      value: count > 0 ? sum / count : 0,
    });
  }

  return result;
}
