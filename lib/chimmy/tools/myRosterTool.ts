import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import type { AiRosterPlayerRef } from '@/lib/ai-payload/types'

/**
 * THE USER'S OWN ROSTER, FOR THE LEAGUE IN SCOPE.
 *
 * "Who should I start?" is the most-asked fantasy question and Chimmy could not
 * answer it at all — there was no roster tool, so the model correctly reported
 * "no roster or lineup data is stored", which read as a claim about the data
 * rather than about the toolset.
 *
 * ⚠ WRAPS `resolveAiTeamContext` RATHER THAN QUERYING ROSTERS DIRECTLY. That
 * resolver already owns the hard part: a team is claimed via
 * `LeagueTeam.claimedByUserId`, NOT via `Roster.platformUserId`, which is the
 * PLATFORM's user id and not an AppUser id at all. Writing a second roster
 * lookup here would be a second chance to get that join wrong.
 *
 * ⚠ IT REPORTS ITS OWN GAPS. The payload carries `dataGaps`, and they are passed
 * through verbatim: a roster that resolved but could not name its players is a
 * different answer from a roster nobody has synced, and collapsing the two is
 * how a model ends up describing a lineup it never saw.
 */

/** Enough to reason about a lineup; more would crowd the model's context. */
const MAX_PER_GROUP = 30

function describePlayer(p: AiRosterPlayerRef): string {
  const bits = [p.position, p.team].filter(Boolean).join(' ')
  const injury = p.injuryStatus ? ` — ${p.injuryStatus}` : ''
  const name = p.name ?? `(unnamed player ${p.playerId})`
  return bits ? `${name} (${bits})${injury}` : `${name}${injury}`
}

function group(label: string, players: AiRosterPlayerRef[]): string | null {
  if (!players.length) return null
  const shown = players.slice(0, MAX_PER_GROUP).map(describePlayer)
  const more = players.length > shown.length ? ` (+${players.length - shown.length} more)` : ''
  return `${label}: ${shown.join('; ')}${more}`
}

/**
 * Prose describing the user's roster, or a sentence saying why there is none.
 *
 * Never throws — a tool that blew up must come back as words, because an
 * exception here aborts a conversation somebody is waiting on.
 */
export async function buildMyRosterContext(
  leagueId: string,
  userId: string,
): Promise<string> {
  if (!leagueId || !userId) {
    return 'No league is selected, so there is no roster to read. Ask the user to pick a league; do not describe one.'
  }

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { sport: true, season: true, name: true },
    })
    .catch(() => null)

  if (!league) {
    return 'That league could not be read, so its roster is unavailable. Say so; do not describe a lineup.'
  }

  const team = await resolveAiTeamContext({
    userId,
    leagueId,
    sport: String(league.sport ?? 'NFL'),
    season: Number(league.season ?? new Date().getFullYear()),
    /*
     * Week 1 as the floor rather than a guess at "now": this tool answers WHO
     * IS ON THE ROSTER, and the period only colours the opponent line. Inventing
     * a current week would put a wrong matchup in front of the model.
     */
    currentPeriod: 1,
  }).catch(() => null)

  if (!team) {
    return [
      `No team in "${league.name ?? 'this league'}" is claimed by this user, so there is no roster to read.`,
      'This is NOT a statement that the league is empty — it means their team has not been claimed or synced.',
      'Tell them to claim their team; do not name any players.',
    ].join(' ')
  }

  const lines: string[] = [
    `ROSTER for ${team.teamName ?? 'this user'} in ${league.name ?? 'the league'} (${league.sport}, ${league.season}).`,
  ]

  if (team.record) {
    const { wins, losses, ties } = team.record
    lines.push(`Record: ${wins}-${losses}${ties ? `-${ties}` : ''}.`)
  }

  const groups = [
    group('STARTERS', team.starters),
    group('BENCH', team.bench),
    group('INJURED RESERVE', team.injuredReserve),
    group('TAXI', team.taxi),
  ].filter(Boolean) as string[]

  if (groups.length === 0) {
    return [
      `${team.teamName ?? 'This team'} is claimed, but NO players are stored for it (${team.rosterPlayerCount} rows).`,
      'Say the roster has not synced. Do NOT name players or suggest a lineup.',
    ].join(' ')
  }

  lines.push(...groups)

  /*
   * ⚠ THE GAPS TRAVEL WITH THE DATA. A partially-resolved roster looks complete
   * to a model unless it is told otherwise, and "start X over Y" built on half a
   * lineup is confident and wrong.
   */
  if (team.dataGaps.length > 0) {
    lines.push(`⚠ KNOWN GAPS in this roster: ${team.dataGaps.join('; ')}. Say so if it affects the answer.`)
  }

  /*
   * ⚠ NO PROJECTIONS ARE INCLUDED, DELIBERATELY. This block is who is on the
   * roster and what their listed position and injury status are. It carries no
   * points, no start percentages and no snap share — those do not exist here,
   * and a model handed a bare roster will otherwise imply it ranked them.
   */
  lines.push(
    'These are roster facts only — no projections, points or start percentages are stored in this block. ' +
      'You may reason about positions, injury status and roles, but do NOT state projected points or invent rankings.',
  )

  return lines.join('\n')
}
