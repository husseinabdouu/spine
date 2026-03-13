/**
 * Returns the user's IANA timezone string (e.g. "America/New_York").
 * Safe to call only on the client side.
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

/**
 * Returns today's date as YYYY-MM-DD in the given timezone.
 * Falls back to America/New_York if tz is falsy or invalid.
 */
export function todayInTz(tz?: string | null): string {
  const timezone = tz || 'America/New_York';
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }
}

/**
 * Returns midnight of today in the given timezone as a UTC ISO string.
 * Used for filtering records created_at >= today.
 */
export function midnightInTz(tz?: string | null): string {
  const timezone = tz || 'America/New_York';
  const todayStr = todayInTz(timezone); // YYYY-MM-DD
  const [y, mo, d] = todayStr.split('-').map(Number);
  // Step 1: rough candidate — 05:00 UTC covers EST (UTC-5) and EDT (UTC-4)
  const candidate = new Date(Date.UTC(y, mo - 1, d, 5, 0, 0));
  // Step 2: find out what hour it is in the target TZ at that candidate
  const nycHour = parseInt(
    candidate.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }),
    10,
  );
  candidate.setUTCHours(candidate.getUTCHours() - nycHour);
  return candidate.toISOString();
}

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
