/**
 * worldCupEnvValidation.ts
 *
 * Startup/cron env validation for the World Cup bracket system.
 * Call `validateWorldCupEnv()` from any server-side entry point.
 * Returns a list of warnings/errors — callers decide whether to abort.
 */

export type WorldCupEnvCheck = {
  name: string
  status: "ok" | "warn" | "error"
  message: string
}

export type WorldCupEnvReport = {
  ok: boolean
  errors: WorldCupEnvCheck[]
  warnings: WorldCupEnvCheck[]
  all: WorldCupEnvCheck[]
}

/**
 * Validates all env vars required for the World Cup bracket system.
 *
 * - "error"  → system will fail at runtime without this var
 * - "warn"   → degraded experience; system has a fallback but it's suboptimal
 */
export function validateWorldCupEnv(): WorldCupEnvReport {
  const checks: WorldCupEnvCheck[] = []

  // ── App URL (invite links) ─────────────────────────────────────────────────
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL
  if (!appUrl) {
    checks.push({
      name: "NEXT_PUBLIC_APP_URL",
      status: "warn",
      message:
        "NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL / NEXTAUTH_URL are all unset. " +
        "Invite links will fall back to http://localhost:3000 in production.",
    })
  } else {
    checks.push({ name: "NEXT_PUBLIC_APP_URL", status: "ok", message: `→ ${appUrl}` })
  }

  // ── Data provider ─────────────────────────────────────────────────────────
  const dataProvider = process.env.WORLD_CUP_DATA_PROVIDER?.trim() || "mock"
  if (dataProvider === "mock") {
    checks.push({
      name: "WORLD_CUP_DATA_PROVIDER",
      status: "warn",
      message:
        'WORLD_CUP_DATA_PROVIDER is unset or "mock". ' +
        "Full fixture sync will use mock data — not suitable for production.",
    })
  } else {
    checks.push({ name: "WORLD_CUP_DATA_PROVIDER", status: "ok", message: `→ ${dataProvider}` })
  }

  // ── Live provider chain ────────────────────────────────────────────────────
  const liveChain = process.env.WORLD_CUP_LIVE_PROVIDER_CHAIN?.trim()
  if (!liveChain) {
    checks.push({
      name: "WORLD_CUP_LIVE_PROVIDER_CHAIN",
      status: "warn",
      message:
        "WORLD_CUP_LIVE_PROVIDER_CHAIN is unset. " +
        "Live score sync will use the default chain: api_sports → thesportsdb → manual.",
    })
  } else {
    checks.push({ name: "WORLD_CUP_LIVE_PROVIDER_CHAIN", status: "ok", message: `→ ${liveChain}` })
  }

  // ── Primary live score key: api-sports / api-football ─────────────────────
  const apiSportsKey =
    process.env.API_FOOTBALL_KEY?.trim() ||
    process.env.APISPORTS_FOOTBALL_KEY?.trim() ||
    process.env.API_SPORTS_KEY?.trim() ||
    process.env.RAPIDAPI_KEY?.trim()
  if (!apiSportsKey) {
    checks.push({
      name: "API_FOOTBALL_KEY",
      status: "warn",
      message:
        "API_FOOTBALL_KEY / APISPORTS_FOOTBALL_KEY / API_SPORTS_KEY / RAPIDAPI_KEY — none set. " +
        "api_sports live provider will be skipped; chain will fall through to next provider.",
    })
  } else {
    checks.push({ name: "API_FOOTBALL_KEY", status: "ok", message: "api_sports key present" })
  }

  // ── TheSportsDB ───────────────────────────────────────────────────────────
  const sportsDbKey = process.env.THESPORTSDB_API_KEY?.trim()
  if (!sportsDbKey) {
    checks.push({
      name: "THESPORTSDB_API_KEY",
      status: "warn",
      message:
        "THESPORTSDB_API_KEY is unset. " +
        "thesportsdb live provider will be skipped; chain will fall through.",
    })
  } else {
    checks.push({ name: "THESPORTSDB_API_KEY", status: "ok", message: "TheSportsDB key present" })
  }

  // ── Reality Sports ────────────────────────────────────────────────────────
  const realitySportsUrl = process.env.REALITY_SPORTS_WORLD_CUP_LIVE_URL?.trim()
  if (!realitySportsUrl) {
    checks.push({
      name: "REALITY_SPORTS_WORLD_CUP_LIVE_URL",
      status: "warn",
      message:
        "REALITY_SPORTS_WORLD_CUP_LIVE_URL is unset. reality_sports provider will be skipped.",
    })
  } else {
    checks.push({ name: "REALITY_SPORTS_WORLD_CUP_LIVE_URL", status: "ok", message: "Reality Sports URL present" })
  }

  // ── Clear Sports ─────────────────────────────────────────────────────────
  const clearSportsUrl = process.env.CLEARSPORTS_WORLD_CUP_LIVE_URL?.trim()
  if (!clearSportsUrl) {
    checks.push({
      name: "CLEARSPORTS_WORLD_CUP_LIVE_URL",
      status: "warn",
      message:
        "CLEARSPORTS_WORLD_CUP_LIVE_URL is unset. clear_sports provider will be skipped.",
    })
  } else {
    checks.push({ name: "CLEARSPORTS_WORLD_CUP_LIVE_URL", status: "ok", message: "ClearSports URL present" })
  }

  // ── Admin secret (commissioner auth) ────────────────────────────────────
  const adminSecret =
    process.env.BRACKET_ADMIN_SECRET?.trim() || process.env.ADMIN_PASSWORD?.trim()
  if (!adminSecret) {
    checks.push({
      name: "BRACKET_ADMIN_SECRET",
      status: "error",
      message:
        "BRACKET_ADMIN_SECRET / ADMIN_PASSWORD is unset. " +
        "Commissioner admin actions and recalculate endpoints are unprotected.",
    })
  } else {
    checks.push({ name: "BRACKET_ADMIN_SECRET", status: "ok", message: "Admin secret present" })
  }

  // ── Cron secret ──────────────────────────────────────────────────────────
  const cronSecret =
    process.env.CRON_SECRET?.trim() || process.env.LEAGUE_CRON_SECRET?.trim()
  if (!cronSecret) {
    checks.push({
      name: "CRON_SECRET",
      status: "error",
      message:
        "CRON_SECRET / LEAGUE_CRON_SECRET is unset. " +
        "World Cup live-sync cron endpoint is unprotected and will return 401.",
    })
  } else {
    checks.push({ name: "CRON_SECRET", status: "ok", message: "Cron secret present" })
  }

  const errors = checks.filter((c) => c.status === "error")
  const warnings = checks.filter((c) => c.status === "warn")

  return { ok: errors.length === 0, errors, warnings, all: checks }
}

/**
 * Logs the env report to console. Call once at boot or in cron preamble.
 * Silent when all checks pass.
 */
export function logWorldCupEnvReport(report: WorldCupEnvReport): void {
  for (const e of report.errors) {
    console.error(`[world-cup/env] ERROR ${e.name}: ${e.message}`)
  }
  for (const w of report.warnings) {
    console.warn(`[world-cup/env] WARN  ${w.name}: ${w.message}`)
  }
}
