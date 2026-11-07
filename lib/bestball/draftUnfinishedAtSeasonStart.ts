/**
 * A best ball league whose draft is still open when its first scoring week starts.
 *
 * 🛑 NOTHING SAID SO. A best ball league has no rosters and no native season until its draft finishes
 * (`ensureRedraftSeason` runs at draft finalisation), so a slow draft still running at kickoff means the
 * weeks being played are not scored for anyone — and no screen, log or alert told the commissioner.
 * How weeks played before the draft finishes are counted once it does is an unpublished policy
 * (see lib/redraft/bestBallWeekRoster.ts), so this states the fact and does not promise either way.
 *
 * Minimal and honest: ONE commissioner-only league-log row per league per season
 * ({@link BEST_BALL_DRAFT_UNFINISHED_ACTION}, `members: false` in lib/league-log/leagueLog.ts). No
 * manager notification. Called hourly from `/api/cron/season-week-roll`, the job that already decides
 * when a week starts; the week itself comes from the same schedule resolver (`resolveSportWeek`).
 *
 * DB-only: reads Postgres, never a provider.
 */
import type { PrismaClient } from '@prisma/client'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { OPEN_DRAFT_SESSION_STATUSES } from '@/lib/draft-room/currentDraftSession'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import type { SportWeekResolution } from '@/lib/season-week/types'

export const BEST_BALL_DRAFT_UNFINISHED_ACTION = 'best_ball_draft_unfinished_at_season_start'

/** True once the sport's regular-season week 1 has kicked off (or a later week is current). Pure. */
export function firstScoringWeekStarted(week: SportWeekResolution): boolean {
  if (!week.ok) return false
  if (week.seasonType !== 'regular') return false
  return week.sportWeek > 1 || week.state !== 'upcoming'
}

export type DraftUnfinishedSweepResult = {
  scanned: number
  /** Leagues whose first scoring week has started with the draft still open. */
  started: number
  recorded: number
  alreadyRecorded: number
  /** Sport/season pairs whose week could not be resolved (no schedule, etc.); their leagues are skipped. */
  unresolved: string[]
  errors: Array<{ leagueId: string; error: string }>
}

type Deps = {
  db?: PrismaClient
  now?: Date
  limit?: number
  dryRun?: boolean
  resolveWeek?: (sport: string, season: number, deps: { prisma?: PrismaClient; now?: Date }) => Promise<SportWeekResolution>
}

export async function recordBestBallDraftsUnfinishedAtSeasonStart(deps: Deps = {}): Promise<DraftUnfinishedSweepResult> {
  const db = deps.db ?? (await import('@/lib/prisma')).prisma
  const now = deps.now ?? new Date()
  const resolveWeek = deps.resolveWeek ?? resolveSportWeek
  const result: DraftUnfinishedSweepResult = { scanned: 0, started: 0, recorded: 0, alreadyRecorded: 0, unresolved: [], errors: [] }

  // At most one open draft per league (partial unique index), so each row is that league's current draft.
  const sessions = await db.draftSession.findMany({
    where: { status: { in: [...OPEN_DRAFT_SESSION_STATUSES] }, league: { bestBallMode: true } },
    select: { id: true, leagueId: true, status: true, league: { select: { sport: true, season: true, platform: true } } },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(500, deps.limit ?? 200)),
  })
  const candidates = sessions.filter(
    (s) => s.league && resolveWriteAuthority(s.league.platform) === 'NATIVE' && Number.isInteger(Number(s.league.season)),
  )
  result.scanned = candidates.length
  if (!candidates.length) return result

  // A native season for that year means its draft already finished once; this sweep is about the
  // season that has no scoring at all.
  const seasons = await db.redraftSeason.findMany({
    where: { leagueId: { in: candidates.map((c) => c.leagueId) } },
    select: { leagueId: true, season: true },
  })
  const hasSeason = new Set(seasons.map((s) => `${s.leagueId}:${s.season}`))

  const weekCache = new Map<string, SportWeekResolution | null>()
  for (const c of candidates) {
    const sport = String(c.league!.sport)
    const season = Number(c.league!.season)
    if (hasSeason.has(`${c.leagueId}:${season}`)) continue
    const key = `${sport}:${season}`
    if (!weekCache.has(key)) {
      try {
        weekCache.set(key, await resolveWeek(sport, season, { prisma: db, now }))
      } catch (error) {
        weekCache.set(key, null)
        result.errors.push({ leagueId: c.leagueId, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const week = weekCache.get(key)
    if (!week || !week.ok) {
      if (!result.unresolved.includes(key)) result.unresolved.push(key)
      continue
    }
    if (!firstScoringWeekStarted(week)) continue
    result.started++

    try {
      const entityId = String(season)
      const already = await db.leagueAuditLog.findFirst({
        where: { leagueId: c.leagueId, actionType: BEST_BALL_DRAFT_UNFINISHED_ACTION, entityId },
        select: { id: true },
      })
      if (already) {
        result.alreadyRecorded++
        continue
      }
      if (deps.dryRun) continue
      await db.leagueAuditLog.create({
        data: {
          leagueId: c.leagueId,
          userId: null,
          actionType: BEST_BALL_DRAFT_UNFINISHED_ACTION,
          entityType: 'league_season',
          entityId,
          afterState: { draftStatus: c.status, sessionId: c.id },
          metadata: { season, sport, sportWeek: week.sportWeek, draftStatus: c.status },
        },
      })
      result.recorded++
    } catch (error) {
      result.errors.push({ leagueId: c.leagueId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
