/**
 * Commish "Edit Playoff Bracket" for leagues hosted on AllFantasy: reseed the bracket (who is in, and
 * in what order) and pick the winner of a matchup in the round being played.
 *
 * 🛑 SEEDS ARE RE-DERIVED FROM THE STANDINGS ON EVERY READ. The playoff runtime does not read
 * `RedraftPlayoffSeed` back; it ranks the teams again each time it builds its state, and the round
 * advance reseeds and breaks ties from THAT ranking. So a reseed written only to the seed or matchup
 * rows would show for one round and then be quietly undone. The commish's order is stored on the
 * bracket row (`structure.manualSeeds`), which the runtime reads as a seed override, and the bracket
 * is then regenerated from it — one source, every reader.
 *
 * ⚠ A RESEED REGENERATES THE BRACKET, so it is allowed only until the first round is decided: no
 * score written, no winner picked. After that, matchup winners are the tool.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import {
  generateNflRedraftPlayoffRuntimeBracket,
  overrideNflRedraftPlayoffMatchup,
  resolveNflRedraftPlayoffRuntime,
  validSeedOverride,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime'

export class CommishPlayoffError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export type CommishPlayoffEdit =
  | { action: 'reseed'; seeds: string[] }
  | { action: 'reset_seeds' }
  | { action: 'set_winner'; matchupId: string; winnerRosterId: string }

/** Why the bracket cannot be reseeded right now, or null when it can. Exported for tests. */
export function reseedRefusal(state: NflRedraftPlayoffRuntimeState, seasonStatus: string): string | null {
  if (!state.bracket.generated) return 'not_generated'
  if (state.bracket.status === 'complete' || seasonStatus === 'complete') return 'season_complete'
  const first = state.bracket.rounds[0]
  if (!first || first.status === 'completed') return 'round_one_decided'
  const decided = first.matchups.some(
    (m) => !m.bye && (m.winnerRosterId != null || m.homeScore != null || m.awayScore != null),
  )
  return decided ? 'round_one_decided' : null
}

/** Why a winner cannot be picked for this matchup, or null. Exported for tests. */
export function winnerRefusal(
  state: NflRedraftPlayoffRuntimeState,
  seasonStatus: string,
  matchupId: string,
  winnerRosterId: string,
): string | null {
  if (state.bracket.status === 'complete' || seasonStatus === 'complete') return 'The season is over.'
  const round = state.bracket.rounds.find((r) => r.matchups.some((m) => m.matchupId === matchupId))
  const matchup = round?.matchups.find((m) => m.matchupId === matchupId)
  if (!round || !matchup) return 'That matchup is not in the bracket.'
  if (round.status === 'completed') return 'That round is over; its winners have already moved on.'
  if (matchup.bye || !matchup.homeRosterId || !matchup.awayRosterId) return 'Both teams must be set before a winner can be picked.'
  if (winnerRosterId !== matchup.homeRosterId && winnerRosterId !== matchup.awayRosterId) return 'The winner must be one of the two teams.'
  return null
}

async function loadNative(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) throw new CommishPlayoffError('League not found', 404)
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    throw new CommishPlayoffError('Imported leagues are edited on their host platform.', 409)
  }
  const resolved = await resolveNflRedraftPlayoffRuntime({ leagueId })
  if (!resolved.ok) {
    throw new CommishPlayoffError(
      resolved.reason === 'not_nfl_redraft' ? 'This league format has no playoff bracket to edit.' : 'This league has no AllFantasy season yet.',
      resolved.reason === 'not_nfl_redraft' ? 409 : 404,
    )
  }
  return resolved
}

export async function loadCommishPlayoffBracket(leagueId: string) {
  const { state, season } = await loadNative(leagueId)
  return { state, seasonStatus: season.status }
}

export async function executeCommishPlayoffEdit(
  leagueId: string,
  edit: CommishPlayoffEdit,
  actorUserId: string,
): Promise<{ state: NflRedraftPlayoffRuntimeState; seasonStatus: string }> {
  const { state, season } = await loadNative(leagueId)

  if (edit.action === 'set_winner') {
    const refusal = winnerRefusal(state, season.status, edit.matchupId, edit.winnerRosterId)
    if (refusal) throw new CommishPlayoffError(refusal, 409)
    await overrideNflRedraftPlayoffMatchup({
      seasonId: season.id,
      matchupId: edit.matchupId,
      winnerRosterId: edit.winnerRosterId,
      actorUserId,
      reason: 'Picked by the commish in Edit Playoff Bracket',
    })
    return loadCommishPlayoffBracket(leagueId)
  }

  const refusal = reseedRefusal(state, season.status)
  if (refusal === 'not_generated') throw new CommishPlayoffError('The bracket is created when the regular season ends.', 409)
  if (refusal === 'season_complete') throw new CommishPlayoffError('The season is over.', 409)
  if (refusal) throw new CommishPlayoffError('The first round has been decided, so the bracket can no longer be reseeded.', 409)

  let manualSeeds: string[] | null = null
  if (edit.action === 'reseed') {
    manualSeeds = validSeedOverride(edit.seeds, state.teams.map((t) => t.rosterId), state.settings.playoffTeamCount)
    if (!manualSeeds) {
      throw new CommishPlayoffError(`Choose ${state.settings.playoffTeamCount} different teams, one for each seed.`)
    }
  } else if (state.seedingSource !== 'commissioner') {
    return { state, seasonStatus: season.status }
  }

  const row = await prisma.redraftPlayoffBracket.findUnique({ where: { seasonId: season.id }, select: { structure: true } })
  const previous = (row?.structure ?? {}) as Record<string, unknown>
  const { manualSeeds: _dropped, ...rest } = previous
  void _dropped
  await prisma.redraftPlayoffBracket.update({
    where: { seasonId: season.id },
    data: { structure: (manualSeeds ? { ...rest, manualSeeds } : rest) as never },
  })
  try {
    await generateNflRedraftPlayoffRuntimeBracket({
      seasonId: season.id,
      regenerate: true,
      lockBracket: state.bracket.status === 'locked',
      actorUserId,
    })
  } catch (e) {
    // The seed order and the bracket rows must never disagree: put the old order back.
    await prisma.redraftPlayoffBracket
      .update({ where: { seasonId: season.id }, data: { structure: previous as never } })
      .catch(() => undefined)
    throw new CommishPlayoffError((e as Error).message || 'The bracket could not be rebuilt.', 409)
  }
  return loadCommishPlayoffBracket(leagueId)
}
