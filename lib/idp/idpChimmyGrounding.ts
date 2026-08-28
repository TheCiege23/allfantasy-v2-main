import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
import { resolveUserRosterInLeague } from '@/lib/league/resolveUserRoster'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'

/**
 * Chimmy grounding for IDP leagues — the defensive board, priced by THIS league's own rules.
 *
 * ⚠ WHY THIS EXISTS. Every other league format Chimmy answers for has a grounding module
 * (redraft, dynasty, keeper, best-ball, guillotine war rooms). IDP had none, so a question
 * about a defender reached the model with no values, no projections and no indication that
 * defenders even score in this league — and the model answered anyway, from priors. The
 * valuation itself has been live for a while; only the seam into Chimmy was missing.
 *
 * ⚠ DO NOT COPY `lib/chimmy/devy-chimmy-brief.ts` AS THE TEMPLATE. It exports a capability
 * brief that NOTHING imports — verified against a positive control, not by a bare grep. It is
 * the same wired-but-inert shape this module exists to avoid; the live pattern is a
 * `build*Context` function called from `app/api/chat/chimmy/route.ts`.
 */

/** How much of the board to spell out. The result passes through `applyGroundingBudget`. */
const BOARD_LIMIT = 15

export async function buildIdpContext(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null

  try {
    /*
     * ⚠ BOTH ID SPACES. `League.id` is an AllFantasy uuid and `platformLeagueId` is Sleeper's
     * numeric string; callers pass either. `loadLeagueIdpVorp` resolves both internally, but
     * the roster read below needs the uuid specifically, so resolve it here too.
     */
    const league =
      (await prisma.league
        .findUnique({
          where: { id: leagueId },
          select: { id: true, settings: true, leagueSize: true, isDynasty: true },
        })
        .catch(() => null)) ??
      (await prisma.league
        .findFirst({
          where: { platformLeagueId: leagueId },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, settings: true, leagueSize: true, isDynasty: true },
        })
        .catch(() => null))

    if (!league) return null

    const settings = (league.settings ?? {}) as Record<string, unknown>
    const rosterPositions = Array.isArray(settings.roster_positions)
      ? (settings.roster_positions as string[])
      : null

    const rosters = await prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { playerData: true },
    })
    if (rosters.length === 0) return null

    const rosterPlayerIds = Array.from(
      new Set(rosters.flatMap((r) => getRosterPlayerIds(r.playerData))),
    )
    if (rosterPlayerIds.length === 0) return null

    const vorp = await loadLeagueIdpVorp({
      prisma,
      leagueId: league.id,
      rosterPositions,
      rosterPlayerIds,
      numTeams: league.leagueSize ?? rosters.length,
      isDynasty: Boolean(league.isDynasty),
    })

    /*
     * `skipped` covers the ordinary case rather than an error: `not_an_idp_league` is the
     * answer for ~100 of ~110 leagues, and it means this block should be silent, not that
     * anything went wrong. Returning null keeps it out of the prompt entirely.
     */
    if (vorp.skipped) return null
    if (vorp.valueBySleeperId.size === 0) return null

    const ranked = [...vorp.valueBySleeperId.entries()].sort((a, b) => b[1] - a[1])
    const top = ranked.slice(0, BOARD_LIMIT)

    /*
     * Whose defenders these are. Resolves for a manager who has CLAIMED their team and for
     * nobody else, which is correct: an unclaimed Sleeper manager is not an AllFantasy user
     * and has no team here to point at. A null resolution degrades to the league-wide board
     * rather than guessing — naming the wrong manager's players is worse than naming none.
     */
    const mine = await resolveUserRosterInLeague(league.id, userId)
    const ownedIds = new Set(mine?.playerIds ?? [])
    const ownedPriced = ranked.filter(([id]) => ownedIds.has(id))

    /*
     * Names for the top board AND the asker's own defenders — his may sit well below the
     * cutoff, and a line reading "player 6801" would be worse than useless in an answer.
     */
    const needNames = Array.from(new Set([...top, ...ownedPriced].map(([id]) => id)))
    const players = await prisma.sportsPlayer.findMany({
      where: { sport: 'NFL', source: 'sleeper', sleeperId: { in: needNames } },
      select: { sleeperId: true, name: true, position: true, team: true },
    })
    const byId = new Map(players.map((p) => [p.sleeperId as string, p]))

    const renderPlayer = (sleeperId: string, value: number): string => {
      const p = byId.get(sleeperId)
      const name = p?.name ?? `player ${sleeperId}`
      const pos = p?.position ?? '?'
      const team = p?.team ? ` ${p.team}` : ''
      const proj = vorp.projectionBySleeperId.get(sleeperId)
      const rank = vorp.positionRankBySleeperId.get(sleeperId)
      const rankPart = rank ? `, ${pos}${rank}` : ''
      /*
       * A projection the league could not compute is stated as unavailable, never as 0 — a
       * zero here would read as "projected to score nothing", which is a different claim.
       */
      const projPart =
        typeof proj === 'number' ? `, ${proj.toFixed(1)} proj pts` : ', projection unavailable'
      return `${name} (${pos}${team}${rankPart}): ${value}${projPart}`
    }

    const lines: string[] = []
    lines.push('IDP VALUES for this league (defenders score here, and these are real prices):')
    /*
     * State the scale explicitly. The ceiling was anchored deliberately against the offensive
     * FantasyCalc board — dynasty 5500 sits at 49% of the top offensive asset and above 95.8%
     * of that board — so these numbers ARE comparable to offensive values in a trade. That is
     * the opposite of the devy scale, which is separate and must never be mixed; without
     * saying so, the safe assumption is "different scale, do not compare", which would make
     * every IDP trade look ungradeable.
     */
    lines.push(
      '- Scale: same 0-10000 convention as offensive player values, deliberately calibrated ' +
        'against the FantasyCalc board. An IDP value and an offensive value CAN be compared ' +
        'directly in a trade. (This is unlike devy values, which are a separate scale.)',
    )
    lines.push(
      "- Priced from this league's own scoring and starting requirements, so the same defender " +
        'is worth a different amount in a different league.',
    )
    lines.push(
      `- Coverage: ${vorp.coverage.priced} of ${vorp.coverage.defenders} rostered defenders ` +
        `priced (${vorp.coverage.projected} had enough history to project).`,
    )
    /*
     * ⚠ SAY WHAT THE FLOOR MEANS, OR THE COVERAGE NUMBER OVERSELLS ITSELF. The tier curve
     * saturates: measured on NFC Dreaming!, 121 of 250 priced defenders (48.4%) sit at the
     * floor and the median is 106 against a floor of 88. "250 priced" is true, but the board
     * only genuinely SEPARATES the top half. Without this line the model reads two
     * floor-priced players as equal assets and grades a trade on them — the same failure as
     * surfacing a "C" trade grade that actually means no data.
     */
    const floorValue = ranked[ranked.length - 1][1]
    const atFloor = ranked.filter(([, v]) => v === floorValue).length
    if (atFloor > 1) {
      lines.push(
        `- ⚠ ${atFloor} of ${ranked.length} priced defenders sit at the FLOOR value ` +
          `(${floorValue}). A floor price means "below this league's meaningful board", not a ` +
          'measured market value. Do not treat two floor-priced defenders as equivalent ' +
          'assets, and do not grade a trade on the difference between them.',
      )
    }
    lines.push('')
    lines.push(`Top ${top.length} defenders by value in this league:`)

    for (const [sleeperId, value] of top) {
      lines.push(`- ${renderPlayer(sleeperId, value)}${ownedIds.has(sleeperId) ? '  [YOURS]' : ''}`)
    }

    if (ranked.length > top.length) {
      lines.push(`- ...and ${ranked.length - top.length} more priced defenders not listed here.`)
    }

    /*
     * The asker's own defenders, when his team is resolvable. Listed in full rather than
     * capped: this is the half of the board an answer is usually about, and it is bounded by
     * a roster rather than by the league.
     */
    if (mine && ownedPriced.length > 0) {
      lines.push('')
      lines.push(`The asker's OWN defenders in this league (${ownedPriced.length} priced):`)
      for (const [sleeperId, value] of ownedPriced) {
        lines.push(`- ${renderPlayer(sleeperId, value)}`)
      }
      const unpriced = mine.playerIds.filter(
        (id) => !vorp.valueBySleeperId.has(id) && vorp.projectionBySleeperId.has(id),
      ).length
      if (unpriced > 0) {
        lines.push(
          `- (${unpriced} more of his players project but could not be priced as defenders.)`,
        )
      }
    }

    lines.push('')
    /*
     * State ownership resolution honestly either way. A manager who has not CLAIMED his team
     * is not an AllFantasy user in this league and resolves to nothing — saying so stops the
     * model inferring ownership from the board, which is the failure this section prevents.
     */
    lines.push(
      mine
        ? 'Not available: IDP snap-share or usage rates (not collected).'
        : "Not available: which of these the asker owns (his team in this league is not claimed, " +
            'so ownership cannot be resolved — do not guess), and IDP snap-share or usage ' +
            'rates (not collected).',
    )

    return lines.join('\n')
  } catch {
    return null
  }
}
