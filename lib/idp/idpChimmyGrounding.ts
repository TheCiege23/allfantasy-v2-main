import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadLeagueIdpVorp } from '@/lib/idp-projections/leagueIdpVorp'
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

    const players = await prisma.sportsPlayer.findMany({
      where: { sport: 'NFL', source: 'sleeper', sleeperId: { in: top.map(([id]) => id) } },
      select: { sleeperId: true, name: true, position: true, team: true },
    })
    const byId = new Map(players.map((p) => [p.sleeperId as string, p]))

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
    lines.push('')
    lines.push(`Top ${top.length} defenders by value in this league:`)

    for (const [sleeperId, value] of top) {
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
      lines.push(`- ${name} (${pos}${team}${rankPart}): ${value}${projPart}`)
    }

    if (ranked.length > top.length) {
      lines.push(`- ...and ${ranked.length - top.length} more priced defenders not listed here.`)
    }

    /*
     * ⚠ NO "YOUR TEAM" SECTION, AND THAT IS DELIBERATE. Naming which of these the asker owns
     * needs `userId` -> `Roster`, and `Roster.platformUserId` only equals the AppUser id for
     * NATIVE leagues; imported Sleeper leagues store Sleeper's own user id there. Every IDP
     * league in production is imported, so matching on it would attach the wrong manager's
     * defenders to the answer. A league-wide board is correct for everyone; a per-team one
     * needs a real resolver first.
     */
    lines.push('')
    lines.push(
      'Not available: which of these the asker owns (roster ownership is not resolved here), ' +
        'and IDP snap-share or usage rates (not collected).',
    )

    return lines.join('\n')
  } catch {
    return null
  }
}
