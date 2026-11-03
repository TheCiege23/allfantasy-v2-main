import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { loadCouncilContext } from './survivorCouncilService'
import { submitVote } from './survivorVoteService'
import { playIdol } from './idolEngine'
import { postChimmyCastawayLine } from './chimmyCastawayChat'
import { CHIMMY_PROTECTIVE_POWERS, chimmyAtRisk, chimmyVoteTarget, councilIsMerged, type ChimmyTarget } from './chimmyCastawayStrategy'

export { CHIMMY_PROTECTIVE_POWERS, chimmyAtRisk, chimmyVoteTarget, councilIsMerged, type ChimmyTarget } from './chimmyCastawayStrategy'

/**
 * How Chimmy plays Survivor for a castaway it runs ("Chimmy as a manager", 2026-10-31). Rules-based and
 * explainable, like the rest of Chimmy's management:
 *
 *  - Before the merge, keep the tribe strong: vote out the weakest scorer over the season, so the tribe
 *    wins more immunity later.
 *  - After the merge, it is every castaway for themselves: vote out the biggest threat, the highest
 *    season scorer still in the game.
 *  - Play a protective idol when Chimmy is the likely target: before the merge, among the two weakest
 *    in its tribe; after the merge, the biggest threat or the weakest left.
 *
 * Chimmy sees no ballots — they are secret until the read — so it judges risk only from public scores.
 * It votes through the ordinary ballot service, with every eligibility rule, while voting is open.
 */

export type ChimmyCouncilTurn = { voted: string[]; idolsPlayed: string[]; skipped: Record<string, string> }

/**
 * Chimmy's turn at an open council, for every castaway it runs: vote (once) and, when at risk, play a
 * protective idol it holds. Idempotent: a castaway that has voted is not voted again, and a played
 * idol is no longer hidden. Called by the season runner on every tick while voting is open.
 */
export async function runChimmyCouncilTurn(leagueId: string, councilId: string): Promise<ChimmyCouncilTurn> {
  const turn: ChimmyCouncilTurn = { voted: [], idolsPlayed: [], skipped: {} }
  const ctx = await loadCouncilContext(leagueId, councilId)
  if (!ctx || ctx.council.status !== 'voting_open' || ctx.council.isRevealed) return turn
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
  if (!league) return turn
  const managed = await readPlayableChimmyLineups(league)
  const chimmyVoters = ctx.eligibility.voterUserIds.filter((userId) => {
    const rosterId = ctx.userToRoster[userId]
    return Boolean(rosterId) && isSeatPlaceholderUserId(userId) && isChimmyRunning(managed, rosterId!, userId)
  })
  if (chimmyVoters.length === 0) return turn

  const merged = councilIsMerged(ctx.council.phase, ctx.council.attendingTribeId)
  const fieldIds = [...new Set([...ctx.eligibility.targetUserIds, ...chimmyVoters])]
  const scores = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, userId: { in: fieldIds }, week: { lte: ctx.council.week } },
    select: { userId: true, week: true, finalScore: true, isFinalized: true },
  })
  const field = new Map<string, ChimmyTarget>(fieldIds.map((userId) => [userId, { userId, seasonPoints: 0, weekPoints: 0 }]))
  for (const row of scores) {
    const entry = field.get(row.userId)
    if (!entry) continue
    if (row.isFinalized || row.week === ctx.council.week) entry.seasonPoints += row.finalScore
    if (row.week === ctx.council.week) entry.weekPoints = row.finalScore
  }
  const voted = new Set((await prisma.survivorVote.findMany({ where: { councilId, doesNotCount: false }, select: { voterUserId: true } })).map((v) => v.voterUserId))

  for (const userId of chimmyVoters) {
    // Idol first: once a ballot is in, the risk read does not change, and an idol must be played while voting is open.
    const fieldRows = ctx.eligibility.targetUserIds.map((id) => field.get(id)!).filter(Boolean)
    if (chimmyAtRisk(userId, fieldRows, merged)) {
      const rosterId = ctx.userToRoster[userId]!
      const idol = await prisma.survivorIdol.findFirst({
        where: { leagueId, status: 'hidden', powerType: { in: [...CHIMMY_PROTECTIVE_POWERS] }, OR: [{ currentOwnerUserId: userId }, { currentOwnerUserId: null, rosterId }] },
        select: { id: true },
      })
      if (idol) {
        const played = await playIdol(idol.id, userId, councilId)
        if (played.ok) turn.idolsPlayed.push(userId)
      }
    }
    if (voted.has(userId)) continue
    const targets = (ctx.eligibility.targetsByVoter[userId] ?? []).map((id) => field.get(id)).filter((t): t is ChimmyTarget => Boolean(t))
    const target = chimmyVoteTarget(targets, merged)
    if (!target) {
      turn.skipped[userId] = 'no_target'
      continue
    }
    const result = await submitVote(leagueId, userId, target)
    if (result.ok) {
      turn.voted.push(userId)
      await postChimmyCastawayLine(leagueId, userId, { kind: 'vote', week: ctx.council.week })
    }
    else turn.skipped[userId] = 'code' in result ? String(result.code) : 'refused'
  }
  return turn
}
