/**
 * Which specialty formats the commish past-week lineup editor may re-score
 * (lib/league/commishLineupEdits.ts), and what the commish must be told when it does.
 *
 * The editor rewrites a week's saved lineup and re-runs `updateMatchupScores` + `updateStandings`. That
 * is only meaningful where the week WAS a head-to-head matchup scored from the saved lineup, and it never
 * replays a format's own weekly outcome. Surveyed per format:
 *
 *   ALLOWED, SCORES ONLY — the matchup and standings change; the format's outcome for that week does not:
 *     zombie       infections, serums, bashings, maulings and weapons were resolved when the week closed
 *                  (`runWeeklyResolution` skips a completed week) and are not replayed
 *     big_brother  HOH, Veto and eviction read `TeamWeekResult`, which this does not rewrite; they stay final
 *     tournament   feeder-league advancement reads wins/points ONCE per round — refused outright once the
 *                  league's round has completed (`TournamentLeague.round`), because standings would then
 *                  disagree with who advanced
 *   ALLOWED — idp: ordinary head-to-head weeks with no weekly outcome.
 *
 *   REFUSED:
 *     guillotine, survivor_guillotine, survivor — no head-to-head rows; the week decided a chop or an
 *                  elimination from its own score table, which this cannot reach or undo
 *     devy, merged_devy_c2c — scored by their own engines from TODAY's player buckets; the saved lineup
 *                  is not what scores, and re-running C2C marks a final matchup active again
 *     any other registered format not listed here — refused until someone checks it
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

export type PastWeekFormatNote = 'zombie' | 'big_brother' | 'tournament'

export type PastWeekFormatDecision = { ok: true; note: PastWeekFormatNote | null } | { ok: false; reason: string }

const SCORES_ONLY: Record<string, PastWeekFormatNote> = { zombie: 'zombie', big_brother: 'big_brother', tournament: 'tournament' }
const ALLOWED = new Set(['idp'])

/** Pure: the decision from what is known about the league. `specId` is the registry id, or null for none. */
export function decidePastWeekFormat(input: {
  specId: string | null
  leagueVariant: string | null
  guillotineMode: boolean
  survivorMode: boolean
  usesDevyEngine: boolean
  usesC2CEngine: boolean
  tournamentRoundCompleted: boolean
}): PastWeekFormatDecision {
  const variant = (input.leagueVariant ?? '').toLowerCase().trim()
  const refuse = (what: string): PastWeekFormatDecision => ({
    ok: false,
    reason: `Past lineups cannot be changed in ${what}: ${
      what === 'this Devy or C2C league'
        ? 'its scores come from its own player buckets, not the saved lineup.'
        : 'that week already decided a chop or an elimination, which a re-score would not undo.'
    }`,
  })
  if (input.usesDevyEngine || input.usesC2CEngine || input.specId === 'devy' || input.specId === 'merged_devy_c2c') {
    return refuse('this Devy or C2C league')
  }
  if (variant === 'survivor_guillotine' || input.guillotineMode || input.specId === 'guillotine') return refuse('a Guillotine league')
  if (input.survivorMode || input.specId === 'survivor') return refuse('a Survivor league')
  if (!input.specId) return { ok: true, note: null }
  if (ALLOWED.has(input.specId)) return { ok: true, note: null }
  const note = SCORES_ONLY[input.specId]
  if (!note) return { ok: false, reason: 'Past lineups cannot be changed in this league format yet.' }
  if (note === 'tournament' && input.tournamentRoundCompleted) {
    return { ok: false, reason: 'This tournament round has finished and teams have advanced, so its lineups can no longer change.' }
  }
  return { ok: true, note }
}

/** Gather what `decidePastWeekFormat` needs. */
export async function resolvePastWeekFormat(leagueId: string): Promise<PastWeekFormatDecision> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true, guillotineMode: true, survivorMode: true },
  })
  const { getSpecialtySpecByVariant } = await import('@/lib/specialty-league/registry')
  const spec = getSpecialtySpecByVariant(league?.leagueVariant ?? null)
  const [{ leagueUsesDevyEngine }, { leagueUsesC2CEngine }] = await Promise.all([
    import('@/lib/devy/scoringEligibilityEngine'),
    import('@/lib/c2c/scoringEngine'),
  ])
  const [usesDevyEngine, usesC2CEngine] = await Promise.all([leagueUsesDevyEngine(leagueId), leagueUsesC2CEngine(leagueId)])
  let tournamentRoundCompleted = false
  if (spec?.id === 'tournament') {
    const tl = await prisma.tournamentLeague.findUnique({
      where: { leagueId },
      select: { round: { select: { status: true, roundCompletedAt: true } } },
    })
    tournamentRoundCompleted = Boolean(tl?.round && (tl.round.status === 'completed' || tl.round.roundCompletedAt))
  }
  return decidePastWeekFormat({
    specId: spec?.id ?? null,
    leagueVariant: league?.leagueVariant ?? null,
    guillotineMode: Boolean(league?.guillotineMode),
    survivorMode: Boolean(league?.survivorMode),
    usesDevyEngine,
    usesC2CEngine,
    tournamentRoundCompleted,
  })
}
