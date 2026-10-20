/**
 * SURVIVOR WEEKLY IMMUNITY NECKLACE (weekly-loop handoff, section 2).
 *
 * Each week the top score in each tribe headed to Tribal Council wins individual immunity.
 * It is stored as one `SurvivorTribeImmunity` row per tribe per week (`immunityWinnerRosterId`),
 * keeps the winner off the ballot at that week's council, and is worn until the next lineup lock.
 *
 * Pure helpers live at the top so the award rule is unit-testable without a database. The DB layer
 * degrades to a no-op when the table has not been migrated yet.
 */

import { prisma } from '@/lib/prisma'
import { getNextLineupLock } from './sportScheduleEngine'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { resolveWeekImmuneTribeIds } from './survivorCouncilImmunity'
import { getActiveSurpriseTribeWeek } from './survivorSurpriseTribes'

/** tribeId used for the single post-merge immunity row. */
export const MERGED_IMMUNITY_TRIBE = 'merge'

export interface ImmunityScoreRow {
  userId: string
  tribeId: string | null
  finalScore: number
  countedTowardTribeTotal?: boolean
}

export interface ImmunityCandidate {
  userId: string
  rosterId: string | null
  displayName: string
  tribeId: string | null
}

export interface ImmunityWinner {
  tribeId: string
  userId: string
  rosterId: string
  displayName: string
  score: number
}

/**
 * Pick the immunity winner(s) for a week.
 *
 * Pre-merge: every tribe except the one(s) that won tribe immunity is headed to Tribal Council, and
 * the top scorer inside each of those tribes wins individual immunity. Post-merge everyone is one
 * tribe, so the single top scorer wins. Only active managers with a counted score and a main roster
 * can win. Ties break on userId so the award is reproducible.
 */
export function computeTribeImmunityWinners(input: {
  scores: ImmunityScoreRow[]
  candidates: ImmunityCandidate[]
  immuneTribeId: string | null
  /** Every safe tribe this week (two-highest rule, challenge immunity). Adds to immuneTribeId. */
  immuneTribeIds?: readonly string[]
  merged: boolean
}): ImmunityWinner[] {
  const byUser = new Map(input.candidates.map(candidate => [candidate.userId, candidate]))
  const immuneTribes = new Set([...(input.immuneTribeIds ?? []), ...(input.immuneTribeId ? [input.immuneTribeId] : [])])
  const groups = new Map<string, ImmunityWinner[]>()
  for (const score of input.scores) {
    if (score.countedTowardTribeTotal === false || !Number.isFinite(score.finalScore)) continue
    const candidate = byUser.get(score.userId)
    if (!candidate?.rosterId) continue
    const tribeId = input.merged ? MERGED_IMMUNITY_TRIBE : candidate.tribeId ?? score.tribeId
    if (!tribeId) continue
    if (!input.merged && immuneTribes.has(tribeId)) continue
    const list = groups.get(tribeId) ?? []
    list.push({ tribeId, userId: candidate.userId, rosterId: candidate.rosterId, displayName: candidate.displayName, score: score.finalScore })
    groups.set(tribeId, list)
  }
  const winners: ImmunityWinner[] = []
  for (const [, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const top = [...list].sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))[0]
    if (top) winners.push(top)
  }
  return winners
}

export interface ImmunityRowLike {
  expiresAt: Date | string | null
  clearedAt: Date | string | null
}

/** Worn until the next lineup lock: active while not cleared and the lock has not passed. */
export function isImmunityActive(row: ImmunityRowLike, now: Date = new Date()): boolean {
  if (row.clearedAt) return false
  if (!row.expiresAt) return true
  return new Date(row.expiresAt).getTime() > now.getTime()
}

/** The chat/tribe-channel system line. Original wording. */
export function immunityChatLine(name: string): string {
  return `${name} won immunity`
}

// ---------------------------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------------------------

type TribeImmunityRow = {
  id: string
  leagueId: string
  week: number
  tribeId: string
  immunityWinnerRosterId: string
  immunityWinnerUserId: string
  winnerName: string | null
  score: number
  awardedAt: Date
  expiresAt: Date | null
  clearedAt: Date | null
  announcedAt: Date | null
}

// The delegate is absent on clients generated before the migration; treat that as "no rows".
function immunityTable(): {
  findMany: (args: unknown) => Promise<TribeImmunityRow[]>
  upsert: (args: unknown) => Promise<TribeImmunityRow>
  updateMany: (args: unknown) => Promise<{ count: number }>
  deleteMany: (args: unknown) => Promise<{ count: number }>
} | null {
  const delegate = (prisma as unknown as Record<string, unknown>).survivorTribeImmunity
  return delegate && typeof delegate === 'object' ? (delegate as ReturnType<typeof immunityTable>) : null
}

/** False only on a Prisma client generated before the immunity table existed. */
export function isTribeImmunityTableAvailable(): boolean {
  return immunityTable() !== null
}

/** Rows for a week (all tribes), oldest tribe first. Empty when the table is not migrated. */
export async function getTribeImmunityForWeek(leagueId: string, week: number): Promise<TribeImmunityRow[]> {
  const table = immunityTable()
  if (!table) return []
  try {
    return await table.findMany({ where: { leagueId, week }, orderBy: { tribeId: 'asc' } })
  } catch {
    return []
  }
}

/** Every necklace still being worn (not cleared, lock not passed). */
export async function getActiveTribeImmunity(leagueId: string, now: Date = new Date()): Promise<TribeImmunityRow[]> {
  const table = immunityTable()
  if (!table) return []
  try {
    const rows = await table.findMany({ where: { leagueId, clearedAt: null }, orderBy: [{ week: 'desc' }, { tribeId: 'asc' }] })
    return rows.filter(row => isImmunityActive(row, now))
  } catch {
    return []
  }
}

/**
 * User ids safe from the vote at a council, from that week's necklace rows. Pre-merge only the
 * attending tribe's winner counts; post-merge (no attending tribe) every row for the week counts.
 * Council eligibility deliberately ignores expiry: the necklace was won for that week's council.
 */
export async function getCouncilImmuneUserIds(leagueId: string, week: number, attendingTribeId: string | null): Promise<string[]> {
  const rows = await getTribeImmunityForWeek(leagueId, week)
  return rows
    .filter(row => !row.clearedAt || new Date(row.clearedAt).getTime() > Date.now())
    .filter(row => !attendingTribeId || row.tribeId === attendingTribeId)
    .map(row => row.immunityWinnerUserId)
}

/**
 * Stamp clearedAt on necklaces whose lineup lock has passed and take the badge off the player.
 * Called from the score sync, which first runs after the next lock, so it doubles as the lock hook.
 */
export async function clearExpiredTribeImmunity(leagueId: string, now: Date = new Date()): Promise<number> {
  const table = immunityTable()
  if (!table) return 0
  try {
    const expired = await table.findMany({ where: { leagueId, clearedAt: null, expiresAt: { lte: now } } })
    if (!expired.length) return 0
    await table.updateMany({ where: { id: { in: expired.map(row => row.id) } }, data: { clearedAt: now } })
    await prisma.survivorPlayer.updateMany({
      where: { leagueId, userId: { in: expired.map(row => row.immunityWinnerUserId) }, immunitySource: 'tribe_top_score' },
      data: { hasImmunityThisWeek: false, immunitySource: null },
    })
    return expired.length
  } catch {
    return 0
  }
}

export interface AwardTribeImmunityResult {
  winners: ImmunityWinner[]
  /** Rows announced in chat by this call (first award only). */
  announced: ImmunityWinner[]
}

/**
 * Award the week's necklaces once scores are final. Idempotent: re-running updates the same
 * tribe/week rows, and the chat line is posted only the first time a row is announced.
 */
export async function awardTribeImmunity(leagueId: string, week: number, opts: { now?: Date; post?: (winner: ImmunityWinner, week: number) => Promise<void> } = {}): Promise<AwardTribeImmunityResult> {
  const table = immunityTable()
  if (!table) return { winners: [], announced: [] }
  const now = opts.now ?? new Date()
  const [game, league, players] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { immuneTribeId: true, phase: true, mergeTriggeredAt: true } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, survivorPhase: true, settings: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, redraftRosterId: true, displayName: true, tribeId: true } }),
  ])
  // A surprise two-tribe week after the merge is scored like a pre-merge week: the lower temporary
  // tribe heads to council and its top scorer wears the necklace. Only the two temporary tribes
  // play that week; a benched manager (odd cast) stays on the merged tribe, safe and necklace-less.
  const surprise = await getActiveSurpriseTribeWeek(leagueId, week)
  const merged = !surprise && (Boolean(game?.mergeTriggeredAt) || ['merge', 'post_merge', 'jury', 'finale'].includes(String(league?.survivorPhase ?? game?.phase ?? '')))
  const cast = surprise ? players.filter(player => player.tribeId && surprise.tribeIds.includes(player.tribeId)) : players
  const scores = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week, userId: { in: cast.map(player => player.userId) } },
    select: { userId: true, tribeId: true, finalScore: true, countedTowardTribeTotal: true },
  })
  // The same resolver the council opener uses: the tribe told it is safe is never sent to council.
  const immunity = merged
    ? null
    : await resolveWeekImmuneTribeIds(leagueId, week, {
        settings: normalizeSurvivorFoundationSettings(league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}),
        scores,
        tribeIds: surprise ? surprise.tribeIds : [...new Set(players.map(player => player.tribeId).filter((tribeId): tribeId is string => Boolean(tribeId)))],
        scoreImmuneTribeId: surprise ? null : game?.immuneTribeId ?? null,
      })
  const winners = computeTribeImmunityWinners({
    scores,
    candidates: cast.map(player => ({ userId: player.userId, rosterId: player.redraftRosterId, displayName: player.displayName, tribeId: player.tribeId })),
    immuneTribeId: merged ? null : game?.immuneTribeId ?? null,
    immuneTribeIds: immunity?.immuneTribeIds ?? [],
    merged,
  })
  const expiresAt = getNextLineupLock(league?.sport ?? 'NFL', now)
  const announced: ImmunityWinner[] = []
  try {
    const before = await table.findMany({ where: { leagueId, week } })
    const previousByTribe = new Map(before.map(row => [row.tribeId, row]))
    for (const winner of winners) {
      const previous = previousByTribe.get(winner.tribeId)
      const changedWinner = previous && previous.immunityWinnerUserId !== winner.userId
      await table.upsert({
        where: { leagueId_week_tribeId: { leagueId, week, tribeId: winner.tribeId } },
        create: { leagueId, week, tribeId: winner.tribeId, immunityWinnerRosterId: winner.rosterId, immunityWinnerUserId: winner.userId, winnerName: winner.displayName, score: winner.score, awardedAt: now, expiresAt },
        update: { immunityWinnerRosterId: winner.rosterId, immunityWinnerUserId: winner.userId, winnerName: winner.displayName, score: winner.score, expiresAt, clearedAt: null, ...(changedWinner ? { awardedAt: now, announcedAt: null } : {}) },
      })
      if (!previous?.announcedAt || changedWinner) announced.push(winner)
      if (changedWinner) {
        await prisma.survivorPlayer.updateMany({
          where: { leagueId, userId: previous.immunityWinnerUserId, immunitySource: 'tribe_top_score' },
          data: { hasImmunityThisWeek: false, immunitySource: null },
        })
      }
    }
    const winnerIds = winners.map(winner => winner.userId)
    // Mirror onto the existing per-week and per-player flags so older readers agree.
    await prisma.survivorWeeklyScore.updateMany({ where: { leagueId, week, wonIndividualImmunity: true, userId: { notIn: winnerIds } }, data: { wonIndividualImmunity: false } })
    if (winnerIds.length) {
      await prisma.survivorWeeklyScore.updateMany({ where: { leagueId, week, userId: { in: winnerIds } }, data: { wonIndividualImmunity: true } })
      await prisma.survivorPlayer.updateMany({ where: { leagueId, userId: { in: winnerIds } }, data: { hasImmunityThisWeek: true, immunitySource: 'tribe_top_score' } })
    }
    for (const winner of announced) {
      if (opts.post) await opts.post(winner, week).catch(() => {})
      await table.updateMany({ where: { leagueId, week, tribeId: winner.tribeId }, data: { announcedAt: now } })
    }
  } catch {
    return { winners: [], announced: [] }
  }
  return { winners, announced }
}
