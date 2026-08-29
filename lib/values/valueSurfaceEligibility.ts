/**
 * Should this reader be shown the published values page — and for which positions?
 *
 * 🛑 THE LINK IS CONDITIONAL BECAUSE THE PAGE IS ONLY RELEVANT TO SOME LEAGUES. `/player-values`
 * explains how defenders and kickers are priced. A manager in a 12-team PPR league that starts
 * neither has no use for it, and a permanent link would be noise on every screen forever.
 *
 * The rule, stated once here so three surfaces cannot drift into three different versions:
 *   IDP + kickers → offer both
 *   IDP only      → offer defenders
 *   kickers only  → offer kickers
 *   neither       → offer NOTHING, and render no element at all
 *
 * ⚠ TWO SCOPES, DELIBERATELY, BECAUSE THE QUESTION IS DIFFERENT IN EACH PLACE. A league page
 * asks about THAT league. `/core` is not a league — it is the manager's home across all of
 * them — so it asks whether ANY league he is in qualifies. Answering the second with the first
 * would hide the link from someone whose only IDP league is not the one currently selected.
 */

import type { PrismaClient } from '@prisma/client'

import { resolveLeagueIdpScoring } from '@/lib/idp-projections/leagueIdpVorp'
import { resolveLeagueKickerValue } from '@/lib/kicker-values/leagueKickerValue'
import { extractLeagueRosterPositions } from '@/lib/kicker-values/loadLeagueKickerValue'

export interface ValueSurfaceEligibility {
  /** The league scores IDP, so defenders are priced from its own rules. */
  hasIdp: boolean
  /** The league starts at least one kicker, so a kicker is an asset in it. */
  hasKicker: boolean
  /** Nothing to offer. Callers render no element rather than an empty one. */
  eligible: boolean
}

const NONE: ValueSurfaceEligibility = { hasIdp: false, hasKicker: false, eligible: false }

const finish = (hasIdp: boolean, hasKicker: boolean): ValueSurfaceEligibility => ({
  hasIdp,
  hasKicker,
  eligible: hasIdp || hasKicker,
})

/**
 * One league.
 *
 * Never throws — a link is not worth failing a page over, and an error degrades to "do not
 * show it", which is the same safe direction as a league that genuinely qualifies for nothing.
 */
export async function resolveLeagueValueSurfaces(
  prisma: PrismaClient,
  leagueId: string,
): Promise<ValueSurfaceEligibility> {
  try {
    const league =
      (await prisma.league
        .findUnique({ where: { id: leagueId }, select: { id: true, settings: true } })
        .catch(() => null)) ??
      (await prisma.league
        .findFirst({
          where: { platformLeagueId: leagueId },
          orderBy: { updatedAt: 'desc' },
          select: { id: true, settings: true },
        })
        .catch(() => null))
    if (!league) return NONE

    /*
     * The kicker half is answered from the slot list alone — no team count needed, because
     * "does this league start a kicker" does not depend on how many teams are in it. Reusing
     * `resolveLeagueKickerValue` rather than counting slots here keeps ONE definition of what
     * counts as a kicker slot, including the AF-native slot-map spelling.
     */
    const hasKicker =
      resolveLeagueKickerValue({
        rosterPositions: extractLeagueRosterPositions(league.settings),
        numTeams: 12,
        isDynasty: true,
      }).value != null

    const idp = await resolveLeagueIdpScoring(prisma, league.id)
    return finish(idp.ok, hasKicker)
  } catch {
    return NONE
  }
}

/**
 * Every league this manager is in.
 *
 * ⚠ CLAIMED TEAMS **AND** OWNED LEAGUES, WHICH IS THE PAIR THE REST OF THE CODEBASE USES
 * (see `CrossLeagueRollup.leagueIdsForUser`). Reading only `League.userId` misses every league
 * a manager joined rather than created, which is most of them.
 *
 * ⚠ SHORT-CIRCUITS ONCE BOTH ARE TRUE. A manager in thirty leagues should not pay thirty
 * scoring lookups to render one link.
 */
export async function resolveUserValueSurfaces(
  prisma: PrismaClient,
  userId: string,
): Promise<ValueSurfaceEligibility> {
  try {
    const [claimed, owned] = await Promise.all([
      prisma.leagueTeam
        .findMany({ where: { claimedByUserId: userId }, select: { leagueId: true } })
        .catch(() => [] as Array<{ leagueId: string }>),
      prisma.league.findMany({ where: { userId }, select: { id: true } }).catch(() => [] as Array<{ id: string }>),
    ])

    const ids = [...new Set([...claimed.map((t) => t.leagueId), ...owned.map((l) => l.id)])]
    if (ids.length === 0) return NONE

    let hasIdp = false
    let hasKicker = false
    for (const id of ids) {
      const one = await resolveLeagueValueSurfaces(prisma, id)
      hasIdp = hasIdp || one.hasIdp
      hasKicker = hasKicker || one.hasKicker
      if (hasIdp && hasKicker) break
    }
    return finish(hasIdp, hasKicker)
  } catch {
    return NONE
  }
}
