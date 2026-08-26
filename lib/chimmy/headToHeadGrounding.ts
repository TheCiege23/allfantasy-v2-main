import 'server-only'
import { prisma } from '@/lib/prisma'
import { getLeagueH2H, type LeagueH2HPayload } from '@/lib/league-history/sleeperH2HService'
import { getImportedLeagueH2H } from '@/lib/league-history/importedFactsH2HService'

/**
 * HEAD-TO-HEAD HISTORY, FOR ANSWERING "AM I ANY GOOD AGAINST HIM?"
 *
 * ⚠ CHIMMY HAD NO RIVALRY GROUNDING AT ALL. The aggregation behind this has
 * three live callers — the h2h route, the rivalry share card and the career
 * card — and the chat route referenced none of it, so the one question league
 * members ask each other most was the one Chimmy could not answer.
 *
 * ⚠ THIS REUSES THE EXISTING SERVICE RATHER THAN RE-DERIVING THE RECORDS.
 * `MatchupFact.teamA`/`teamB` hold roster SLOT NUMBERS — "1", "7" — so a naive
 * read of that table can only say "Team 3 beat Team 7", and it is tempting to
 * write a fresh join to fix that. `aggregateH2HSeasons` already does this math
 * for both Sleeper and imported leagues, and a second implementation would be
 * free to disagree with the number the same league shows on its own rivalry
 * card.
 *
 * ⚠ TWO SOURCES, PICKED THE SAME WAY THE ROUTE PICKS THEM. A Sleeper league
 * walks the live chain; everything else reads the imported facts warehouse.
 * Getting this backwards returns an empty record for a league with years of
 * history, which reads as "you have never played" rather than "I looked in the
 * wrong place".
 *
 * ⚠ NO HISTORY IS NOT AN EMPTY HISTORY. Roughly half the leagues in production
 * have no matchup facts at all. That is stated as unknown, never rendered as
 * 0-0 — a fabricated goose egg about a real rivalry is exactly the kind of
 * confident wrong answer this grounding exists to prevent.
 */

const MAX_RIVALS = 6

export type HeadToHeadGrounding = {
  text: string
  managers: number
  source: 'sleeper' | 'imported-facts' | 'none'
}

async function loadPayload(leagueId: string): Promise<{
  payload: LeagueH2HPayload | null
  source: HeadToHeadGrounding['source']
}> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true },
    })
    .catch(() => null)

  if (!league) return { payload: null, source: 'none' }

  if (league.platform === 'sleeper' && league.platformLeagueId) {
    const payload = await getLeagueH2H(league.platformLeagueId).catch(() => null)
    return { payload, source: payload ? 'sleeper' : 'none' }
  }

  const payload = await getImportedLeagueH2H(leagueId).catch(() => null)
  return { payload, source: payload ? 'imported-facts' : 'none' }
}

function record(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}

/**
 * A grounding block describing every manager's record against the others.
 *
 * Returns null when the league has no history, so the caller appends nothing
 * rather than a block saying there is nothing — an empty section still costs
 * prompt budget and still invites the model to reason from it.
 */
export async function buildHeadToHeadGrounding(
  leagueId: string,
  viewerName?: string | null,
): Promise<HeadToHeadGrounding | null> {
  if (!leagueId) return null

  const { payload, source } = await loadPayload(leagueId)
  if (!payload || payload.managers.length === 0) return null

  const nameOf = new Map(payload.managers.map((m) => [m.ownerId, m.name || m.teamName || 'Unknown']))

  const lines: string[] = []
  lines.push(
    `HEAD-TO-HEAD HISTORY (${payload.totalGames} games, seasons ${payload.seasons.join(', ') || 'unknown'}):`,
  )

  for (const manager of payload.managers) {
    const who = manager.name || manager.teamName || 'Unknown'

    /*
     * Strongest rivalries first — most games played, not best record. "Who do
     * you play most" is the rivalry; "who do you beat" is a different question
     * and ordering by it would misname the relationship.
     */
    const rivals = [...manager.byOpponent]
      .sort((a, b) => b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties))
      .slice(0, MAX_RIVALS)

    if (rivals.length === 0) continue

    const parts = rivals.map((r) => {
      const opponent = nameOf.get(r.opponentOwnerId) ?? 'Unknown'
      return `${opponent} ${record(r.wins, r.losses, r.ties)}`
    })

    lines.push(
      `- ${who} (${manager.games} games, ${manager.avgPoints.toFixed(1)} avg): ${parts.join('; ')}`,
    )
  }

  if (viewerName) {
    lines.push(`The person asking is ${viewerName}.`)
  }

  /*
   * `missing[]` is the service's own account of what it could not resolve. It
   * is surfaced rather than swallowed: a record built from a partial history is
   * still useful, and a model told the history is partial will say so.
   */
  if (payload.missing.length > 0) {
    lines.push(
      `INCOMPLETE: ${payload.missing.length} season(s) or team(s) could not be resolved, so these records are partial.`,
    )
  }

  lines.push(
    'RULES: these records are only the games listed above. Do not extrapolate a record for a pairing that is not shown, and do not describe a rivalry as even or one-sided beyond what these numbers say.',
  )

  return { text: lines.join('\n'), managers: payload.managers.length, source }
}
