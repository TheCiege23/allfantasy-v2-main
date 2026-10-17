/**
 * End a native guillotine season the way every other format's season ends: a champion on record,
 * the season archived, the league in the offseason.
 *
 * 🛑 A GUILLOTINE SEASON ENDED BY WRITING `complete` AND NOTHING ELSE. The playoff finalizer is what
 * crowns a champion (`LeagueChampionship`), archives the season (`LeagueSeason` +
 * `FranchiseSeason`) and moves the league to `offseason` — and a guillotine league has no bracket,
 * so `rollPostseason` never picks it up. Its last chop marked the season complete, and the league
 * then sat with no champion, no history, and no offseason, while score-sync stopped looking at it
 * because complete seasons leave the scoring set.
 *
 * ⚠ THE ARCHIVE IS RANKED BY SURVIVAL, NOT BY WINS. A guillotine league plays no head-to-head
 * games, so `enterRedraftOffseason`'s default order (wins, then points) would be noise. The order
 * is: the champion; the other final-stage survivors by final-stage points; then chopped teams,
 * the latest chop first (surviving longer is finishing higher), ties within a chop by that week's
 * points.
 *
 * ⚠ RE-RUNNABLE, AND IT MUST BE. score-sync re-offers a complete guillotine season until its league
 * leaves `completed`, so a failure part-way (the archive is deliberately non-fatal elsewhere too)
 * is retried rather than lost. Every write here is an upsert or a guarded update.
 */
import { prisma } from '@/lib/prisma'
import { determineFinalChampion } from './endgameEngine'
import { enterRedraftOffseason } from '@/lib/redraft/offseason/RedraftOffseasonService'

export const GUILLOTINE_SEASON_ACTOR = 'system:guillotine-season'

/** Lifecycle states in which a finished guillotine season still owes its archive. */
export const GUILLOTINE_UNARCHIVED_LIFECYCLE_STATES = ['setup', 'pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs', 'completed'] as const

/**
 * States the season end moves to `completed`. ⚠ EVERY NON-TERMINAL STATE, NOT THE ONES A SEASON
 * "SHOULD" BE IN: the first real-database run found a finished league still in a draft-phase state,
 * the archive refused it (`LEAGUE_NOT_COMPLETED`), and a narrower list would have stranded it
 * forever. The playoff finalizer's own write is unconditional for the same reason.
 */
const LIFECYCLE_STATES_BEFORE_COMPLETION = ['setup', 'pre_draft', 'drafting', 'post_draft', 'in_season', 'playoffs'] as const

/** How long score-sync keeps re-offering a finished, unarchived guillotine season. */
export const GUILLOTINE_ARCHIVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000

/** A season roster's owner -> the league roster: `roster:<id>` names it, a user id is its manager. */
export function rosterIdForOwner(ownerId: string, rosters: Array<{ id: string; platformUserId: string | null }>): string | null {
  if (ownerId.startsWith('roster:')) {
    const id = ownerId.slice('roster:'.length)
    return rosters.some((r) => r.id === id) ? id : null
  }
  return rosters.find((r) => r.platformUserId === ownerId)?.id ?? null
}

export type GuillotineFinishInput = {
  /** Season rosters (redraft id space). */
  rosters: Array<{ id: string; isEliminated: boolean; pointsFor: number }>
  championId: string | null
  /** Redraft roster id -> the scoring period it was chopped in, and its points that period. */
  chopped: Map<string, { period: number; periodPoints: number }>
  /** Redraft roster id -> points scored in the final stage (or the whole season, lacking one). */
  finalStagePoints: Map<string, number>
}

/** Pure: the season's finishing order, first place first, every roster exactly once. */
export function rankGuillotineFinish(input: GuillotineFinishInput): string[] {
  const byPoints = (a: { id: string; pointsFor: number }, b: { id: string; pointsFor: number }) =>
    (input.finalStagePoints.get(b.id) ?? 0) - (input.finalStagePoints.get(a.id) ?? 0) ||
    b.pointsFor - a.pointsFor ||
    a.id.localeCompare(b.id)

  const champion = input.rosters.find((r) => r.id === input.championId) ?? null
  const survivors = input.rosters
    .filter((r) => r.id !== champion?.id && !input.chopped.has(r.id) && !r.isEliminated)
    .sort(byPoints)
  const chopped = input.rosters
    .filter((r) => r.id !== champion?.id && input.chopped.has(r.id))
    .sort((a, b) => {
      const ca = input.chopped.get(a.id)!
      const cb = input.chopped.get(b.id)!
      return cb.period - ca.period || cb.periodPoints - ca.periodPoints || a.id.localeCompare(b.id)
    })
  // Eliminated but with no chop on record (a hand edit, or a chop from a lost audit): last.
  const placed = new Set([champion?.id, ...survivors.map((r) => r.id), ...chopped.map((r) => r.id)])
  const rest = input.rosters.filter((r) => !placed.has(r.id)).sort(byPoints)

  return [...(champion ? [champion] : []), ...survivors, ...chopped, ...rest].map((r) => r.id)
}

export type FinishGuillotineSeasonResult = {
  championRosterId: string | null
  archived: boolean
  reason?: string
}

export async function finishGuillotineSeason(input: {
  seasonId: string
  guillotineSeasonId: string | null
  actorUserId?: string
}): Promise<FinishGuillotineSeasonResult> {
  const actorUserId = input.actorUserId ?? GUILLOTINE_SEASON_ACTOR

  await prisma.redraftSeason.updateMany({ where: { id: input.seasonId, status: { not: 'complete' } }, data: { status: 'complete' } })
  if (input.guillotineSeasonId) {
    await prisma.guillotineSeason.updateMany({ where: { id: input.guillotineSeasonId, status: { not: 'complete' } }, data: { status: 'complete' } })
  }

  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    select: {
      id: true,
      leagueId: true,
      season: true,
      rosters: { select: { id: true, ownerId: true, ownerName: true, teamName: true, pointsFor: true, isEliminated: true } },
    },
  })
  if (!season) return { championRosterId: null, archived: false, reason: 'season_not_found' }

  // A newer season means the league has already moved on (the commissioner started next year's
  // draft); archiving now would drag it back into the offseason under a live draft.
  const newer = await prisma.redraftSeason.findFirst({
    where: { leagueId: season.leagueId, season: { gt: season.season } },
    select: { id: true },
  })
  if (newer) return { championRosterId: null, archived: false, reason: 'newer_season_exists' }

  const gSeason = input.guillotineSeasonId
    ? await prisma.guillotineSeason.findUnique({
        where: { id: input.guillotineSeasonId },
        select: { createdAt: true, finalStageStartPeriod: true },
      })
    : null

  // Engine rosters (league `Roster`) -> season rosters (`RedraftRoster`).
  const leagueRosters = await prisma.roster.findMany({
    where: { leagueId: season.leagueId },
    select: { id: true, platformUserId: true, redraftRosterId: true },
  })
  const redraftForEngine = new Map<string, string>()
  for (const r of season.rosters) {
    const engineId = leagueRosters.find((x) => x.redraftRosterId === r.id)?.id ?? rosterIdForOwner(r.ownerId, leagueRosters)
    if (engineId) redraftForEngine.set(engineId, r.id)
  }

  // Only this season's chops: the engine's own bound (a previous year's rows predate the season).
  const states = await prisma.guillotineRosterState.findMany({
    where: {
      leagueId: season.leagueId,
      choppedInPeriod: { not: null },
      choppedAt: { not: null, ...(gSeason ? { gte: gSeason.createdAt } : {}) },
    },
    select: { rosterId: true, choppedInPeriod: true },
  })
  const scores = await prisma.guillotinePeriodScore.findMany({
    where: { leagueId: season.leagueId, season: season.season },
    select: { rosterId: true, weekOrPeriod: true, periodPoints: true },
  })

  const chopped = new Map<string, { period: number; periodPoints: number }>()
  for (const s of states) {
    const redraftId = redraftForEngine.get(s.rosterId)
    if (!redraftId || s.choppedInPeriod == null) continue
    const points = scores.find((p) => p.rosterId === s.rosterId && p.weekOrPeriod === s.choppedInPeriod)?.periodPoints ?? 0
    chopped.set(redraftId, { period: s.choppedInPeriod, periodPoints: points })
  }
  const finalStagePoints = new Map<string, number>()
  for (const p of scores) {
    if (gSeason?.finalStageStartPeriod != null && p.weekOrPeriod < gSeason.finalStageStartPeriod) continue
    const redraftId = redraftForEngine.get(p.rosterId)
    if (redraftId) finalStagePoints.set(redraftId, (finalStagePoints.get(redraftId) ?? 0) + p.periodPoints)
  }

  const alive = season.rosters.filter((r) => !r.isEliminated && !chopped.has(r.id))
  const engineChampion = input.guillotineSeasonId ? await determineFinalChampion(input.guillotineSeasonId) : null
  const finishOrder = rankGuillotineFinish({
    rosters: season.rosters,
    championId: engineChampion ?? (alive.length === 1 ? alive[0]!.id : null),
    chopped,
    finalStagePoints,
  })
  // With no single survivor and no engine verdict, the best-placed survivor is the champion.
  const championRosterId = engineChampion ?? finishOrder[0] ?? null
  const champion = season.rosters.find((r) => r.id === championRosterId) ?? null

  await prisma.$transaction(async (tx) => {
    if (champion) {
      const record = {
        championUserId: champion.ownerId,
        teamName: champion.teamName ?? champion.ownerName ?? null,
        pointsFor: champion.pointsFor,
        playoffRecord: null,
        recordedBy: actorUserId,
      }
      await tx.leagueChampionship.upsert({
        where: { leagueId_season: { leagueId: season.leagueId, season: season.season } },
        create: { leagueId: season.leagueId, season: season.season, ...record },
        update: record,
      })
    }
    // The playoff finalizer's step, which `enterRedraftOffseason` requires before it will archive.
    await tx.league.updateMany({
      where: { id: season.leagueId, lifecycleState: { in: [...LIFECYCLE_STATES_BEFORE_COMPLETION] } },
      data: { lifecycleState: 'completed' },
    })
  })

  try {
    const offseason = await enterRedraftOffseason(season.id, actorUserId, { finishOrder })
    if (!offseason.ok) {
      console.error('[guillotine] season archive declined', JSON.stringify({ seasonId: season.id, code: offseason.code }))
      return { championRosterId, archived: false, reason: offseason.code }
    }
    return { championRosterId, archived: true }
  } catch (error) {
    console.error('[guillotine] season archive failed', { seasonId: season.id, error })
    return { championRosterId, archived: false, reason: 'archive_failed' }
  }
}
