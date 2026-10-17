/**
 * Past-week lineup edits for PLAYOFF weeks — the playoff half of the commish past-week editor
 * (lib/league/commishLineupEdits.ts).
 *
 * A playoff week is not a `RedraftMatchup`. It belongs to a title-bracket `RedraftPlayoffMatchup`
 * whose score is the sum of the round's weeks (`scoreActivePlayoffRound`, `playoffRoundWeeks`), and
 * whose winner MOVES ON into `nextMatchupId`. So after the lineup is rewritten the round is re-scored
 * from its weeks, and the result can change who advanced — which is safe only while the next round is
 * still unplayed.
 *
 * `planPlayoffRescore` decides, purely:
 *   - not decided yet (scored, waiting on the roller)  → write the scores; the roller decides
 *   - same winner                                      → write the scores
 *   - winner flips, next round unplayed                → write the scores and the winner, and put the new
 *                                                        winner in the old winner's seat next round
 *   - winner flips, anything else                      → REFUSE, and the caller restores the lineup
 *
 * Refused flips: the next round has a score or a winner (it was played with the other team); the
 * championship (the champion is decided); a league that reseeds after each round (next-round pairings
 * come from every winner, not one seat); a winner the commish picked by hand in Edit Playoff Bracket;
 * and a re-score that ties two equal seeds.
 *
 * ⚠ TITLE BRACKET ONLY. Consolation rounds (`roundNumber >= 100`) are not scored by the round scorer
 * and are not offered here.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { resolveNflRedraftPlayoffRuntime, type NflRedraftPlayoffRuntimeState } from '@/lib/playoff-runtime'
import { CHAMPIONSHIP_ROUND_WHERE, isChampionshipRoundNumber, playoffRoundWeeks } from '@/lib/playoff-runtime/playoffRoundWeeks'

export type PlayoffWeekMatchup = {
  matchupId: string
  roundNumber: number
  weeks: number[]
  homeRosterId: string
  awayRosterId: string
  homeScore: number | null
  awayScore: number | null
  /** The commish picked this winner in Edit Playoff Bracket; its lineups are not re-scored. */
  winnerPicked: boolean
}

type MatchupRow = {
  id: string
  homeRosterId: string | null
  awayRosterId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string
  metadata: unknown
}

/** A title-bracket matchup two teams played to a final score. */
function playedFinal(m: MatchupRow): m is MatchupRow & { homeRosterId: string; awayRosterId: string } {
  return Boolean(m.homeRosterId && m.awayRosterId) && m.status === 'final' && m.homeScore != null && m.awayScore != null
}

/** Every playoff matchup this team played to a final score, with the weeks each round covered. */
export async function playedPlayoffMatchups(input: {
  seasonId: string
  redraftRosterId: string
  playoffStartWeek: number | null
  weeksPerRound: number | null
}): Promise<PlayoffWeekMatchup[]> {
  if (input.playoffStartWeek == null) return []
  const rounds = await prisma.redraftPlayoffRound.findMany({
    where: { seasonId: input.seasonId, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
    orderBy: { roundNumber: 'asc' },
    select: {
      roundNumber: true,
      matchups: {
        where: { OR: [{ homeRosterId: input.redraftRosterId }, { awayRosterId: input.redraftRosterId }] },
        select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true, metadata: true },
      },
    },
  })
  const out: PlayoffWeekMatchup[] = []
  for (const r of rounds) {
    if (!isChampionshipRoundNumber(r.roundNumber)) continue
    for (const m of r.matchups) {
      if (!playedFinal(m)) continue
      out.push({
        matchupId: m.id,
        roundNumber: r.roundNumber,
        weeks: playoffRoundWeeks({ playoffStartWeek: input.playoffStartWeek, roundNumber: r.roundNumber, weeksPerRound: input.weeksPerRound }),
        homeRosterId: m.homeRosterId,
        awayRosterId: m.awayRosterId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        winnerPicked: Boolean((m.metadata as Record<string, unknown> | null)?.commissionerOverride),
      })
    }
  }
  return out
}

export type PlayoffRescorePlan =
  | {
      ok: true
      /** The winner to write; null leaves the column as it is (not decided yet). */
      winnerRosterId: string | null
      flipped: boolean
      /** When flipped: the next-round seat the new winner takes over. */
      next: { matchupId: string; slot: 'home' | 'away'; rosterId: string; seed: number | null } | null
    }
  | { ok: false; reason: string }

/** Who wins on these scores, by the runtime's own rule: points, then the better (lower) seed. */
export function winnerOnScores(m: {
  homeRosterId: string
  awayRosterId: string
  homeSeed: number | null
  awaySeed: number | null
  homeScore: number
  awayScore: number
}): string | null {
  if (m.homeScore > m.awayScore) return m.homeRosterId
  if (m.awayScore > m.homeScore) return m.awayRosterId
  if (m.homeSeed != null && m.awaySeed != null && m.homeSeed !== m.awaySeed) {
    return m.homeSeed < m.awaySeed ? m.homeRosterId : m.awayRosterId
  }
  return null
}

export function planPlayoffRescore(input: {
  state: NflRedraftPlayoffRuntimeState
  seasonComplete: boolean
  matchupId: string
  homeScore: number
  awayScore: number
}): PlayoffRescorePlan {
  const rounds = input.state.bracket.rounds.filter((r) => isChampionshipRoundNumber(r.roundNumber))
  const round = rounds.find((r) => r.matchups.some((m) => m.matchupId === input.matchupId))
  const m = round?.matchups.find((x) => x.matchupId === input.matchupId)
  if (!round || !m || !m.homeRosterId || !m.awayRosterId) return { ok: false, reason: 'That playoff matchup is not in the bracket.' }
  if (m.metadata?.commissionerOverride) {
    return { ok: false, reason: 'The commish picked this matchup’s winner in Edit Playoff Bracket, so its lineups are not re-scored.' }
  }

  const decided = m.winnerRosterId
  const winner = winnerOnScores({ ...m, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, homeScore: input.homeScore, awayScore: input.awayScore })
  if (!decided) return { ok: true, winnerRosterId: null, flipped: false, next: null }
  if (winner === decided) return { ok: true, winnerRosterId: decided, flipped: false, next: null }

  const roundLabel = `round ${round.roundNumber}`
  if (!winner) return { ok: false, reason: `This change ties ${roundLabel} on points and seed. Pick the winner in Edit Playoff Bracket instead.` }
  if (!m.nextMatchupId || input.seasonComplete || input.state.bracket.status === 'complete') {
    return { ok: false, reason: 'This change would make a different team champion, and the championship has been decided.' }
  }
  if (input.state.settings.reseedAfterEachRound) {
    return { ok: false, reason: `This change would flip ${roundLabel}, and this league reseeds after every round, so the next round’s pairings cannot be patched. Nothing was saved.` }
  }
  const next = rounds.flatMap((r) => r.matchups).find((x) => x.matchupId === m.nextMatchupId)
  if (!next) return { ok: false, reason: 'The next round’s matchup could not be found.' }
  if (next.winnerRosterId || next.homeScore != null || next.awayScore != null || next.status === 'final') {
    return { ok: false, reason: `This change would flip ${roundLabel}, but the next round has already been played. Nothing was saved.` }
  }
  const slot = next.homeRosterId === decided ? 'home' : next.awayRosterId === decided ? 'away' : null
  if (!slot) return { ok: false, reason: 'The bracket’s next round does not hold this matchup’s winner.' }
  const seed = winner === m.homeRosterId ? m.homeSeed : m.awaySeed
  return { ok: true, winnerRosterId: winner, flipped: true, next: { matchupId: next.matchupId, slot, rosterId: winner, seed } }
}

/**
 * Re-score one played playoff matchup from its round's weeks and apply the plan. Returns the refusal
 * WITHOUT writing anything when the plan refuses, so the caller can restore the lineup it changed.
 */
export async function rescorePlayoffMatchup(input: {
  leagueId: string
  seasonId: string
  seasonYear: number
  matchup: PlayoffWeekMatchup
}): Promise<
  | { ok: true; homeScore: number; awayScore: number; flipped: boolean; winnerRosterId: string | null }
  | { ok: false; reason: string }
> {
  const total = async (rosterId: string) => {
    let points = 0
    for (const week of input.matchup.weeks) {
      const s = await scoreRosterForWeek({ leagueId: input.leagueId, rosterId, week, seasonYear: input.seasonYear })
      points += s.points
    }
    return Math.round(points * 100) / 100
  }
  const homeScore = await total(input.matchup.homeRosterId)
  const awayScore = await total(input.matchup.awayRosterId)

  const resolved = await resolveNflRedraftPlayoffRuntime({ seasonId: input.seasonId })
  if (!resolved.ok) return { ok: false, reason: 'This league’s playoffs cannot be edited here.' }
  const plan = planPlayoffRescore({
    state: resolved.state,
    seasonComplete: resolved.season.status === 'complete',
    matchupId: input.matchup.matchupId,
    homeScore,
    awayScore,
  })
  if (!plan.ok) return plan

  await prisma.$transaction(async (tx) => {
    const row = await tx.redraftPlayoffMatchup.findUnique({ where: { id: input.matchup.matchupId }, select: { metadata: true } })
    const metadata = { ...((row?.metadata as Record<string, unknown> | null) ?? {}), commishLineupRescoredAt: new Date().toISOString() }
    await tx.redraftPlayoffMatchup.update({
      where: { id: input.matchup.matchupId },
      data: {
        homeScore,
        awayScore,
        ...(plan.flipped ? { winnerRosterId: plan.winnerRosterId } : {}),
        metadata: metadata as Prisma.InputJsonObject,
      },
    })
    if (plan.next) {
      await tx.redraftPlayoffMatchup.update({
        where: { id: plan.next.matchupId },
        data:
          plan.next.slot === 'home'
            ? { homeRosterId: plan.next.rosterId, homeSeed: plan.next.seed }
            : { awayRosterId: plan.next.rosterId, awaySeed: plan.next.seed },
      })
    }
  })
  return { ok: true, homeScore, awayScore, flipped: plan.flipped, winnerRosterId: plan.winnerRosterId }
}
