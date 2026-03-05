/**
 * Parses any date string as a LOCAL date — no UTC timezone shift.
 *
 * Handles every format Supabase / Plaid might return:
 *   "2024-09-05"
 *   "2024-09-05T00:00:00"
 *   "2024-09-05T00:00:00+00:00"
 *   "2024-09-05T00:00:00.000Z"
 *
 * The naive approach (new Date("2024-09-05") or parseISO) treats the value
 * as UTC midnight and then shifts to local time, making US timezones show
 * the previous day. This function extracts year/month/day with a regex so
 * no timezone conversion ever takes place.
 */
export function parseLocalDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(dateStr);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}
