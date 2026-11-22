/**
 * DB-backed loader for the post-draft roster lock and the derived `post_draft` → `in_season` phase.
 * The policy and all date arithmetic live in `lib/league/postDraftRosterLock.ts`; this file only reads
 * the three facts that policy needs, all from Postgres (no provider call):
 *
 *   1. when the league's current draft session completed  — `DraftSession.completedAt`
 *   2. the first completed waiver run after that           — `WaiverRun.runAt`
 *   3. when the league's week 1 starts                     — `SportsGame` (NFL) or the daily-sport
 *                                                            opener table (NBA / NHL / MLB)
 *
 * Reads happen ONLY for a league stored in `post_draft`; every other league costs nothing.
 */
import type { LeagueLifecycleState } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { toScheduleSportKey } from '@/lib/season-week/sportWeekSignal'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import {
  POST_DRAFT_LOCK_SPORTS,
  postDraftRosterLockRefusal,
  resolveDailySportWeek1Start,
  resolveEffectiveLifecyclePhase,
  resolveNflWeek1Start,
  resolvePostDraftRosterLock,
  type PostDraftRosterLockRefusal,
  type PostDraftRosterLockStatus,
  type RosterMoveKind,
} from '@/lib/league/postDraftRosterLock'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type PostDraftLockDeps = { db?: Db; now?: Date }

export type PostDraftLeagueRow = {
  id: string
  lifecycleState: LeagueLifecycleState | null
  sport?: string | null
  season?: number | null
  isDynasty?: boolean | null
  leagueType?: string | null
  timezone?: string | null
}

export type PostDraftContext = {
  /** The phase the gate acts on — `in_season` once week 1 has started for a stored `post_draft`. */
  effectiveState: LeagueLifecycleState
  lock: PostDraftRosterLockStatus
  week1StartsAt: Date | null
  timezone: string | null
}

/**
 * The run types that do NOT end the lock. An FCFS-immediate run fires on each claim POST, and the
 * claims route skips it while the lock is on, so one that slipped through must not unlock the league.
 */
const NON_UNLOCKING_RUN_TYPES = ['fcfs_immediate']

async function loadWeek1Start(db: Db, sport: string, season: number, draftCompletedAt: Date | null, now: Date) {
  if (sport === 'NFL') {
    const rows = await db.sportsGame.findMany({
      where: { sport: 'NFL', season, seasonType: 'regular' },
      select: { week: true, seasonType: true, startTime: true },
    })
    return resolveNflWeek1Start(rows ?? [], draftCompletedAt)
  }
  // Primes a schedule-derived opener for a season past the curated table (a no-op for curated years).
  await ensureDailySportSeasonStart(sport, season, { db, now }).catch(() => null)
  return resolveDailySportWeek1Start(sport, season, draftCompletedAt)
}

/**
 * Resolve the post-draft context for a league row. Fails OPEN: any read error leaves the stored
 * phase in force and the lock off — a product lock that strands every manager on a DB blip is worse
 * than the move it would have refused.
 */
export async function resolvePostDraftContext(
  row: PostDraftLeagueRow,
  deps: PostDraftLockDeps = {},
): Promise<PostDraftContext> {
  const stored: LeagueLifecycleState = row.lifecycleState ?? 'in_season'
  const timezone = row.timezone ?? null
  const off = (reason: 'not_post_draft' | 'no_draft_completion'): PostDraftContext => ({
    effectiveState: stored,
    lock: { locked: false, reason },
    week1StartsAt: null,
    timezone,
  })
  if (stored !== 'post_draft') return off('not_post_draft')

  const sport = toScheduleSportKey(String(row.sport ?? 'NFL'))
  const season = Number(row.season)
  if (!POST_DRAFT_LOCK_SPORTS.has(sport) || !Number.isInteger(season)) return off('not_post_draft')

  const db = deps.db ?? defaultPrisma
  const now = deps.now ?? new Date()
  try {
    const session = await db.draftSession.findFirst({
      where: { leagueId: row.id },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true, completedAt: true },
    })
    const draftCompletedAt: Date | null =
      session?.status === 'completed' && session.completedAt ? new Date(session.completedAt) : null

    const week1StartsAt = await loadWeek1Start(db, sport, season, draftCompletedAt, now)
    const effectiveState = resolveEffectiveLifecyclePhase({ storedState: stored, week1StartsAt, now })

    // A dynasty-family league's (dynasty, devy, C2C) draft is a startup or rookie draft — the redraft
    // lock does not apply. It still gets the derived phase, which is a fact about the calendar.
    if (isDynastyFamilyLeague(row)) {
      return { effectiveState, lock: { locked: false, reason: 'not_post_draft' }, week1StartsAt, timezone }
    }

    let firstWaiverRunAfterDraftAt: Date | null = null
    if (draftCompletedAt && effectiveState === 'post_draft') {
      const run = await db.waiverRun.findFirst({
        where: {
          leagueId: row.id,
          status: 'completed',
          runType: { notIn: NON_UNLOCKING_RUN_TYPES },
          runAt: { gt: draftCompletedAt, lte: now },
        },
        orderBy: { runAt: 'asc' },
        select: { runAt: true },
      })
      firstWaiverRunAfterDraftAt = run?.runAt ? new Date(run.runAt) : null
    }

    const lock = resolvePostDraftRosterLock({
      storedState: stored,
      draftCompletedAt,
      firstWaiverRunAfterDraftAt,
      week1StartsAt,
      now,
    })
    return { effectiveState, lock, week1StartsAt, timezone }
  } catch (e) {
    console.warn('[postDraftRosterLock] context read failed — failing open', e)
    return off('not_post_draft')
  }
}

/**
 * For write paths that do not go through the lifecycle gate (the legacy `/api/redraft/*` trade
 * routes): the refusal for `kind`, or null when it is allowed. Loads the league itself.
 */
export async function postDraftRosterMoveRefusal(
  leagueId: string,
  kind: RosterMoveKind,
  deps: PostDraftLockDeps = {},
): Promise<PostDraftRosterLockRefusal | null> {
  const db = deps.db ?? defaultPrisma
  let row: PostDraftLeagueRow | null = null
  try {
    row = await db.league.findUnique({
      where: { id: leagueId },
      select: { id: true, lifecycleState: true, sport: true, season: true, isDynasty: true, leagueType: true, timezone: true },
    })
  } catch {
    return null // fail open, as resolvePostDraftContext does
  }
  if (!row) return null
  const ctx = await resolvePostDraftContext(row, deps)
  return postDraftRosterLockRefusal(kind, ctx.lock, ctx.timezone)
}
