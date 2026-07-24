/**
 * Date bucketing is LOCAL, not UTC: a daily word goal that rolls over at
 * 17:00 local time (UTC midnight in the Pacific timezone) is wrong for the
 * player, and the trend chart must agree with it about what "today" means.
 */

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Epoch ms of local midnight starting the day that contains `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
