import 'server-only'

import { createRunBudget } from '@/lib/cron/runBudget'
import { runLeagueDramaEngine } from '@/lib/drama-engine/LeagueDramaEngine'
import { prisma } from '@/lib/prisma'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runRivalryEngine } from '@/lib/rivalry-engine/RivalryEngine'
import { buildRivalryEngineSignals } from '@/lib/rivalry-engine/rivalryEngineInputs'
import { isSupportedRivalrySport } from '@/lib/rivalry-engine/SportRivalryResolver'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

/**
 * The scheduled writer for `rivalry_records` and `drama_events`.
 *
 * 🛑 WITHOUT THIS, THE COMMISSIONER STORYLINE AND RIVALRY FEEDS ARE PERMANENTLY EMPTY. Their
 * generators (lib/shared-services/league-hub/generators/commissioner/{storyline,rivalry}*) only READ
 * those tables, and until this pass nothing wrote them except two on-demand league routes
 * (`/api/leagues/[id]/rivalries` POST, `/api/leagues/[id]/drama/run`). Measured 2026-10-01: both
 * tables held 0 rows in production while 317 NFL leagues had 2026 matchup facts. A reader pointed at
 * a table nothing refreshes looks correct and fails silently (CLAUDE.md, the ingestCFBDStats lesson).
 *
 * NO CRON SLOT OF ITS OWN. `cron-schedule.json` is at its ceiling; like the trade agent this rides the
 * hourly `/api/cron/reap-sync-runs` with whatever budget the passes before it left, inside the same
 * 03:00–10:59 UTC window, so it never competes with game-time traffic.
 *
 * CHANGE-DRIVEN, NOT A FULL SWEEP. A league is processed only when its `dw_matchup_facts` have moved
 * since it was last refreshed, so an idle night costs one grouped read. The per-league watermark lives
 * in `sportsDataCache` under `relationship-refresh:v1:<leagueId>` (no new table, so no migration), and
 * it records the facts timestamp read BEFORE the run — a fact written during the run is newer than the
 * watermark and is picked up next hour instead of being skipped. A league that throws or that the
 * budget interrupts is not marked, so it is retried.
 *
 * ORDER MATTERS AND IS DELIBERATE: rivalries first, then drama. The drama detector reads rivalries
 * (`listRivalries`), and the rivalry score reads drama events; running rivalries first gives drama
 * today's rivalries, and next refresh folds today's drama back into the rivalry score.
 *
 * Neither engine calls a model, so this adds no AI spend.
 */

const JOB = 'cron-relationship-refresh'
const WATERMARK_PREFIX = 'relationship-refresh:v1:'
/**
 * The watermark is a durable record, not a cache entry. `/api/cron/reap-sync-runs` purges EXPIRED
 * sportsDataCache rows every hour, so an ordinary TTL would delete it and re-run every league.
 */
const WATERMARK_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000
/** Same nightly window as the trade agent this rides beside (03:00–10:59 UTC). */
const WINDOW_START_HOUR_UTC = 3
const WINDOW_END_HOUR_UTC = 11

export function inRelationshipRefreshWindow(now: Date): boolean {
  const h = now.getUTCHours()
  return h >= WINDOW_START_HOUR_UTC && h < WINDOW_END_HOUR_UTC
}

export type RelationshipRefreshPassResult =
  | { ran: false; reason: string }
  | {
      ran: true
      /** Leagues with matchup facts at all. */
      withFacts: number
      /** Of those, leagues whose facts moved since their last refresh (or never refreshed). */
      stale: number
      visited: number
      refreshed: number
      skippedUnsupportedSport: number
      failed: number
      rivalriesCreated: number
      rivalriesUpdated: number
      dramaCreated: number
      dramaUpdated: number
      stoppedEarly: boolean
    }

interface Candidate {
  leagueId: string
  factsAt: Date
  seasons: number[]
  lastRefreshedFactsAt: Date | null
}

/** Leagues whose matchup facts are newer than their watermark, never-refreshed first, then oldest. */
export async function staleRelationshipLeagues(): Promise<{ withFacts: number; stale: Candidate[] }> {
  const grouped = await prisma.matchupFact.groupBy({
    by: ['leagueId', 'season'],
    _max: { createdAt: true },
  })
  const byLeague = new Map<string, { factsAt: Date; seasons: Set<number> }>()
  for (const row of grouped) {
    const at = row._max.createdAt
    if (!at) continue
    const entry = byLeague.get(row.leagueId) ?? { factsAt: at, seasons: new Set<number>() }
    if (at > entry.factsAt) entry.factsAt = at
    if (typeof row.season === 'number') entry.seasons.add(row.season)
    byLeague.set(row.leagueId, entry)
  }

  const marks = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: WATERMARK_PREFIX } },
    select: { cacheKey: true, data: true },
  })
  const watermark = new Map<string, Date>()
  for (const m of marks) {
    const raw = (m.data as { factsAt?: unknown } | null)?.factsAt
    const at = typeof raw === 'string' ? new Date(raw) : null
    if (at && !Number.isNaN(at.getTime())) watermark.set(m.cacheKey.slice(WATERMARK_PREFIX.length), at)
  }

  const stale: Candidate[] = []
  for (const [leagueId, { factsAt, seasons }] of byLeague) {
    const last = watermark.get(leagueId) ?? null
    if (last && factsAt <= last) continue
    stale.push({ leagueId, factsAt, seasons: [...seasons].sort((a, b) => a - b), lastRefreshedFactsAt: last })
  }
  stale.sort((a, b) => {
    if (!a.lastRefreshedFactsAt !== !b.lastRefreshedFactsAt) return a.lastRefreshedFactsAt ? 1 : -1
    return (a.lastRefreshedFactsAt?.getTime() ?? 0) - (b.lastRefreshedFactsAt?.getTime() ?? 0)
  })
  return { withFacts: byLeague.size, stale }
}

async function markRefreshed(leagueId: string, factsAt: Date, now: Date): Promise<void> {
  const cacheKey = `${WATERMARK_PREFIX}${leagueId}`
  const data = { factsAt: factsAt.toISOString(), refreshedAt: now.toISOString() }
  const expiresAt = new Date(now.getTime() + WATERMARK_TTL_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data, expiresAt },
    update: { data, expiresAt },
  })
}

/** Rivalries across every season with facts, then drama for the league's current season. */
export async function refreshLeagueRelationships(candidate: Candidate): Promise<
  | { supported: false }
  | { supported: true; rivalriesCreated: number; rivalriesUpdated: number; dramaCreated: number; dramaUpdated: number }
> {
  const league = await prisma.league.findUnique({
    where: { id: candidate.leagueId },
    select: { sport: true, season: true, settings: true, teams: { select: { externalId: true } } },
  })
  if (!league) return { supported: false }
  const sport = normalizeToSupportedSport(league.sport ?? null)
  if (!isSupportedRivalrySport(sport) || candidate.seasons.length === 0) return { supported: false }

  const teamExternalIds = new Set(league.teams.map((t) => String(t.externalId)))
  const signals = await buildRivalryEngineSignals({
    leagueId: candidate.leagueId,
    sport,
    seasons: candidate.seasons,
    teamExternalIds,
    leagueSettings: league.settings,
  })
  const rivalries = await runRivalryEngine({ leagueId: candidate.leagueId, sport, seasons: candidate.seasons, ...signals })

  const season = league.season ?? candidate.seasons[candidate.seasons.length - 1] ?? null
  const drama = await runLeagueDramaEngine({ leagueId: candidate.leagueId, sport, season })

  return {
    supported: true,
    rivalriesCreated: rivalries.created,
    rivalriesUpdated: rivalries.updated,
    dramaCreated: drama.created,
    dramaUpdated: drama.updated,
  }
}

export async function runRelationshipRefreshPass(opts: {
  now?: Date
  budgetMs: number
  force?: boolean
}): Promise<RelationshipRefreshPassResult> {
  const now = opts.now ?? new Date()
  if (!opts.force && !inRelationshipRefreshWindow(now)) return { ran: false, reason: 'outside the nightly window' }
  if (opts.budgetMs <= 5_000) return { ran: false, reason: 'no time left in this run' }

  const startedAt = Date.now()
  const budget = createRunBudget(opts.budgetMs)
  const { withFacts, stale } = await staleRelationshipLeagues()

  let visited = 0
  let refreshed = 0
  let skippedUnsupportedSport = 0
  let failed = 0
  let rivalriesCreated = 0
  let rivalriesUpdated = 0
  let dramaCreated = 0
  let dramaUpdated = 0
  const errors: string[] = []
  for (const candidate of stale) {
    if (budget.exhausted()) break
    visited += 1
    try {
      const r = await refreshLeagueRelationships(candidate)
      if (r.supported) {
        refreshed += 1
        rivalriesCreated += r.rivalriesCreated
        rivalriesUpdated += r.rivalriesUpdated
        dramaCreated += r.dramaCreated
        dramaUpdated += r.dramaUpdated
      } else {
        skippedUnsupportedSport += 1
      }
      // Marked either way: an unsupported league stays skipped until its facts move again.
      await markRefreshed(candidate.leagueId, candidate.factsAt, now)
    } catch (error) {
      failed += 1
      if (errors.length < 5) errors.push(`${candidate.leagueId}: ${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`)
    }
  }
  const stoppedEarly = visited < stale.length

  await recordSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    {
      rowsRead: visited,
      rowsWritten: rivalriesCreated + dramaCreated,
      rowsUpdated: rivalriesUpdated + dramaUpdated,
      errors,
      ...(stoppedEarly || failed > 0 ? { status: 'partial' as const } : {}),
      metadata: { withFacts, stale: stale.length, refreshed, skippedUnsupportedSport, failed },
    },
    Date.now() - startedAt,
  ).catch(() => {})

  return {
    ran: true,
    withFacts,
    stale: stale.length,
    visited,
    refreshed,
    skippedUnsupportedSport,
    failed,
    rivalriesCreated,
    rivalriesUpdated,
    dramaCreated,
    dramaUpdated,
    stoppedEarly,
  }
}
