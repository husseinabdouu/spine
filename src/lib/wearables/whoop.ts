const WHOOP_BASE = "https://api.prod.whoop.com/developer/v1";
const TOKEN_URL  = "https://api.prod.whoop.com/oauth/oauth2/token";

// ─── Whoop API response shapes ────────────────────────────────────────────────

interface WhoopRecovery {
  cycle_id:    number;
  sleep_id:    number;
  user_id:     number;
  score_state: string;
  score: {
    recovery_score:    number;
    resting_heart_rate: number;
    hrv_rmssd_milli:   number;
    spo2_percentage:   number | null;
  } | null;
}

interface WhoopSleep {
  id:          number;
  user_id:     number;
  nap:         boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli:       number;
      total_awake_time_milli:        number;
      total_no_data_time_milli:      number;
      total_light_sleep_time_milli:  number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli:    number;
    };
    sleep_performance_percentage: number;
    sleep_efficiency_percentage:  number;
  } | null;
}

interface WhoopCycle {
  id:          number;
  user_id:     number;
  score_state: string;
  score: {
    strain:             number;
    kilojoule:          number;
    average_heart_rate: number;
    max_heart_rate:     number;
  } | null;
}

interface WhoopCollection<T> {
  records:    T[];
  next_token?: string;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WhoopTokens {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  token_type:    string;
}

export interface WhoopHealthSnapshot {
  date:                  string;
  sleep_hours:           number | null;
  sleep_quality:         "poor" | "fair" | "good";
  hrv_avg:               number | null;
  stress_level:          "low" | "medium" | "high";
  active_energy:         number | null;
  workout_minutes:       null;
  source_device:         "whoop";
  whoop_recovery_score:  number | null;
  whoop_strain:          number | null;
  whoop_sleep_score:     number | null;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export async function exchangeWhoopCode(
  code: string,
  redirectUri: string,
): Promise<WhoopTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri,
      client_id:     process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Whoop code exchange ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function refreshWhoopToken(refreshToken: string): Promise<WhoopTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Whoop token refresh ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function whoopGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${WHOOP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Whoop GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getWhoopUserId(accessToken: string): Promise<number> {
  const profile = await whoopGet<{ user_id: number }>(
    "/user/profile/basic",
    accessToken,
  );
  return profile.user_id;
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

function sleepQuality(score: number | null): "poor" | "fair" | "good" {
  if (score === null) return "fair";
  if (score >= 70)    return "good";
  if (score >= 50)    return "fair";
  return "poor";
}

function stressLevel(hrv: number | null): "low" | "medium" | "high" {
  if (hrv === null) return "medium";
  if (hrv >= 65)    return "low";
  if (hrv >= 50)    return "medium";
  return "high";
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchWhoopDayData(
  accessToken: string,
  date: string,
): Promise<WhoopHealthSnapshot> {
  // Whoop data for a calendar day spans midnight-to-midnight UTC
  const params =
    `?start=${encodeURIComponent(`${date}T00:00:00.000Z`)}` +
    `&end=${encodeURIComponent(`${date}T23:59:59.999Z`)}` +
    `&limit=5`;

  const [recoveryRes, sleepRes, cycleRes] = await Promise.allSettled([
    whoopGet<WhoopCollection<WhoopRecovery>>(`/recovery${params}`, accessToken),
    whoopGet<WhoopCollection<WhoopSleep>>(`/activity/sleep${params}`, accessToken),
    whoopGet<WhoopCollection<WhoopCycle>>(`/cycle${params}`, accessToken),
  ]);

  const recovery =
    recoveryRes.status === "fulfilled" && recoveryRes.value.records.length > 0
      ? recoveryRes.value.records[0]
      : null;

  // Prefer the first non-nap sleep record
  const sleep =
    sleepRes.status === "fulfilled"
      ? (sleepRes.value.records.find((s) => !s.nap) ?? sleepRes.value.records[0] ?? null)
      : null;

  const cycle =
    cycleRes.status === "fulfilled" && cycleRes.value.records.length > 0
      ? cycleRes.value.records[0]
      : null;

  // HRV + recovery score
  const hrv           = recovery?.score?.hrv_rmssd_milli ?? null;
  const recoveryScore = recovery?.score?.recovery_score  ?? null;

  // Sleep hours = total_in_bed minus awake and no-data periods
  let sleepHours: number | null = null;
  if (sleep?.score?.stage_summary) {
    const s = sleep.score.stage_summary;
    const asleepMs =
      s.total_in_bed_time_milli -
      s.total_awake_time_milli -
      s.total_no_data_time_milli;
    sleepHours = Math.round((Math.max(0, asleepMs) / 3_600_000) * 10) / 10;
  }
  const sleepScore = sleep?.score?.sleep_performance_percentage ?? null;

  // Whoop strain (0–21) → step-equivalent so the existing risk engine thresholds work
  // strain 10 ≈ 5,000 steps · strain 14 ≈ 7,000 · strain 21 ≈ 10,500
  const strain      = cycle?.score?.strain ?? null;
  const activeEnergy = strain !== null ? Math.round(strain * 500) : null;

  return {
    date,
    sleep_hours:          sleepHours,
    sleep_quality:        sleepQuality(sleepScore),
    hrv_avg:              hrv !== null ? Math.round(hrv) : null,
    stress_level:         stressLevel(hrv),
    active_energy:        activeEnergy,
    workout_minutes:      null,
    source_device:        "whoop",
    whoop_recovery_score: recoveryScore,
    whoop_strain:         strain !== null ? Math.round(strain * 10) / 10 : null,
    whoop_sleep_score:    sleepScore,
  };
}
