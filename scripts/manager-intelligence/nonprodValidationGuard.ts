/**
 * Decision OS Manager Intelligence Platform — Phase 6.
 *
 * PURE, dependency-injected safety + readiness logic for the non-prod live
 * validation script. No prisma, no I/O, no env mutation — so it is fully
 * unit-testable without a database. The runnable script
 * (`validate-nonprod-readonly.ts`) wires this to a read-only prisma reader ONLY
 * after the safety gate passes.
 *
 * Safety philosophy: SAFE BY DEFAULT. It refuses to touch any database unless
 * the operator has explicitly acknowledged a read-only non-prod run AND the
 * target is confirmed non-production. It never writes and never targets a
 * recommendation endpoint.
 */

// ── safety gate ──────────────────────────────────────────────────────────────

export interface NonprodSafetyEnv {
  NONPROD_VALIDATION_ACK?: string
  NODE_ENV?: string
  VERCEL_ENV?: string
  APP_ENV?: string
  DATABASE_URL?: string
  /** Operator override to confirm an unmarked remote DB is non-prod. */
  NONPROD_DB_CONFIRMED?: string
}

export interface SafetyAssessment {
  ok: boolean
  /** Reasons it is NOT safe to query (empty when ok). */
  blockers: string[]
  /** Safety conditions that passed (for transparent logging). */
  acknowledgements: string[]
}

const PROD_ENV_VALUES = new Set(['production', 'prod'])
const PROD_URL_MARKERS = ['prod', 'production']
const NONPROD_URL_MARKERS = ['localhost', '127.0.0.1', 'staging', 'stage', 'dev', 'test', 'nonprod', 'preview', 'sandbox']

/**
 * Decide whether it is safe to run a read-only validation against the current
 * environment. All conditions must hold: explicit acknowledgement, a non-prod
 * runtime, and a DATABASE_URL that is confirmed non-production.
 */
export function assessNonprodSafety(env: NonprodSafetyEnv): SafetyAssessment {
  const blockers: string[] = []
  const acknowledgements: string[] = []

  if (env.NONPROD_VALIDATION_ACK === 'true') {
    acknowledgements.push('NONPROD_VALIDATION_ACK=true (read-only non-prod run acknowledged)')
  } else {
    blockers.push('NONPROD_VALIDATION_ACK is not "true" — set it to explicitly acknowledge a read-only non-prod run')
  }

  for (const [key, value] of [
    ['NODE_ENV', env.NODE_ENV],
    ['VERCEL_ENV', env.VERCEL_ENV],
    ['APP_ENV', env.APP_ENV],
  ] as const) {
    if (value && PROD_ENV_VALUES.has(value.toLowerCase())) {
      blockers.push(`${key}=${value} is production-like — refuse`)
    }
  }

  const url = (env.DATABASE_URL ?? '').trim()
  if (!url) {
    blockers.push('DATABASE_URL is not set — there is nothing to validate against')
  } else {
    const lower = url.toLowerCase()
    if (PROD_URL_MARKERS.some((m) => lower.includes(m))) {
      blockers.push('DATABASE_URL looks production-like (contains "prod"/"production") — refuse')
    } else if (NONPROD_URL_MARKERS.some((m) => lower.includes(m))) {
      acknowledgements.push('DATABASE_URL carries a recognizable non-prod marker')
    } else if (env.NONPROD_DB_CONFIRMED === 'true') {
      acknowledgements.push('NONPROD_DB_CONFIRMED=true (operator confirms this DB is non-prod)')
    } else {
      blockers.push(
        'DATABASE_URL has no recognizable non-prod marker; set NONPROD_DB_CONFIRMED=true only if you are certain it is non-prod (refuse by default)',
      )
    }
  }

  return { ok: blockers.length === 0, blockers, acknowledgements }
}

// ── required feature flags ───────────────────────────────────────────────────

export const REQUIRED_HUB_FLAGS = [
  'NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED',
  'NEXT_PUBLIC_MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED',
  'MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED',
  'MANAGER_TEAM_HEALTH_ENABLED',
  'MANAGER_WEEKLY_OUTLOOK_ENABLED',
  'MANAGER_TRANSACTION_READINESS_ENABLED',
] as const

export function checkRequiredFlags(env: Record<string, string | undefined>): { flag: string; enabled: boolean }[] {
  return REQUIRED_HUB_FLAGS.map((flag) => ({ flag, enabled: env[flag] === 'true' }))
}

// ── validation plan (static; printed before any query) ───────────────────────

export interface ValidationTarget {
  module: string
  /** Internal, session-authed, READ-ONLY route (never a recommendation endpoint). */
  route: string
  contract: string
}

export const VALIDATION_TARGETS: ValidationTarget[] = [
  { module: 'Historical Replay', route: '/api/leagues/[leagueId]/replay-insights', contract: 'ManagerReplayInsightSetV1' },
  { module: 'League Context', route: '/api/app/leagues/[leagueId]/standings', contract: 'standings payload' },
  { module: 'Team Health', route: '/api/app/leagues/[leagueId]/team-health', contract: 'ManagerTeamHealthV1' },
  { module: 'Weekly Outlook', route: '/api/app/leagues/[leagueId]/weekly-outlook', contract: 'ManagerWeeklyOutlookV1' },
  { module: 'Transaction Readiness', route: '/api/app/leagues/[leagueId]/transaction-readiness', contract: 'ManagerTransactionReadinessV1' },
]

// ── readiness probe (dependency-injected; read-only by construction) ──────────

export interface ReadinessCounts {
  seasonFound: boolean
  rosterCount: number
  activePlayerCount: number
  matchupCount: number
  /** Approximate — replay readiness ultimately depends on the replay pipeline. */
  completedTradeCount: number
}

/**
 * The ONLY capability the probe is given: a single read-only count read. There
 * is deliberately no write method and no recommendation call on this interface,
 * so the probe cannot mutate data or invoke recommendation logic by construction.
 */
export interface ReadinessReader {
  readLeagueReadiness(leagueId: string): Promise<ReadinessCounts | null>
}

export interface ModuleReadiness {
  module: string
  ready: boolean
  note: string
}

export function deriveModuleReadiness(counts: ReadinessCounts | null): ModuleReadiness[] {
  if (!counts || !counts.seasonFound) {
    return VALIDATION_TARGETS.map((t) => ({
      module: t.module,
      ready: false,
      note: 'no imported redraft season found for this league',
    }))
  }
  const players = counts.activePlayerCount
  return [
    { module: 'Historical Replay', ready: counts.completedTradeCount > 0, note: `${counts.completedTradeCount} completed trade(s) (approx.)` },
    { module: 'League Context', ready: counts.rosterCount > 0, note: `${counts.rosterCount} roster(s)` },
    { module: 'Team Health', ready: players > 0, note: `${players} active roster player(s)` },
    { module: 'Weekly Outlook', ready: counts.matchupCount > 0, note: `${counts.matchupCount} matchup(s) (projections optional)` },
    { module: 'Transaction Readiness', ready: players > 0, note: `${players} active roster player(s)` },
  ]
}

export async function probeModuleReadiness(reader: ReadinessReader, leagueId: string): Promise<ModuleReadiness[]> {
  const counts = await reader.readLeagueReadiness(leagueId)
  return deriveModuleReadiness(counts)
}
