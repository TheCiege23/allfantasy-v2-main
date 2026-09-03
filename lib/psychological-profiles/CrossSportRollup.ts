import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueIdsForUser } from './CrossLeagueRollup'
import { listProfilesByLeague } from './ManagerBehaviorQueryService'
import type { ProfileLabel } from './types'

/**
 * CrossSportRollup — one manager's own psychology, compared across the SPORTS they play (P7).
 *
 * ── SELF ONLY, AND DELIBERATELY NARROWER THAN `CrossLeagueRollup` ──────────────────────────────
 * `CrossLeagueRollup` answers "how does a manager present across the leagues YOU BOTH share" —
 * a viewer/subject question with a real privacy boundary (P5). "Does this manager play aggressive
 * football and passive basketball" is a question about ONE person's own consistency, and the
 * privacy boundary that already applies is the SAME one: nothing here reads outside leagues the
 * caller themselves manages. Scoping to self sidesteps re-deriving a second privacy model for a
 * question P5's answer never actually separated from P7's — both are "this account's own leagues".
 *
 * ── WITHIN A SPORT, UNION; ACROSS SPORTS, MAJORITY — the same two-level rule `CrossLeagueRollup`
 * uses on the league axis, moved one level up. A user with one NFL league and one NBA league has
 * too few leagues per sport for a within-sport consistency threshold to mean anything, so every
 * label seen in a sport counts as characteristic of it; the "does it travel" question is then
 * asked ACROSS the sport buckets, where `CrossLeagueRollup`'s own majority rule (label seen in
 * more than half the observed groups) still applies.
 *
 * ONE SPORT IS NOT A PATTERN, same rule as `CrossLeagueRollup`'s "one league is not a pattern" —
 * if the sport count is 1, the result says so and reports no cross-sport read.
 */

export type CrossSportRollup = {
  userId: string
  /** Sports with at least one usable profile. */
  sportsObserved: number
  /** Sports the user has a league in, but nothing usable was recorded there. */
  sportsWithoutProfile: number
  /** Labels seen in more than half the observed sports. */
  consistentLabels: ProfileLabel[]
  /** Labels seen in exactly one observed sport — the "does NOT carry across" half of P7. */
  sportSpecificLabels: ProfileLabel[]
  /** Plain-language limit on the claim, or null when the roll-up stands on its own. */
  caveat: string | null
}

function empty(userId: string, caveat: string): CrossSportRollup {
  return {
    userId,
    sportsObserved: 0,
    sportsWithoutProfile: 0,
    consistentLabels: [],
    sportSpecificLabels: [],
    caveat,
  }
}

export async function rollUpManagerAcrossSports(input: { userId: string }): Promise<CrossSportRollup> {
  const leagueIds = await leagueIdsForUser(input.userId)
  if (leagueIds.size === 0) return empty(input.userId, 'Not a manager in any recorded league.')

  const leagues = await prisma.league
    .findMany({ where: { id: { in: [...leagueIds] } }, select: { id: true, sport: true } })
    .catch(() => [] as { id: string; sport: string }[])

  // Own team per league, the same shape CrossLeagueRollup resolves the subject's identity from.
  const ownTeams = await prisma.leagueTeam
    .findMany({
      where: { leagueId: { in: [...leagueIds] }, claimedByUserId: input.userId },
      select: { leagueId: true, externalId: true },
    })
    .catch(() => [] as { leagueId: string; externalId: string }[])
  const managerIdByLeague = new Map(ownTeams.map((t) => [t.leagueId, t.externalId]))

  // Union of labels per sport, and whether each sport observed anything usable at all.
  const labelsBySport = new Map<string, Set<ProfileLabel>>()
  const sportsSeen = new Set<string>()
  let withoutProfile = 0

  for (const league of leagues) {
    const managerId = managerIdByLeague.get(league.id)
    if (!managerId) continue
    sportsSeen.add(league.sport)

    const profiles = await listProfilesByLeague(league.id, { limit: 64 }).catch(() => [])
    const profile = profiles.find((p) => p.managerId === managerId)
    if (!profile || !profile.evidenceSummary?.anySufficient) {
      withoutProfile += 1
      continue
    }

    const labels = Array.isArray(profile.profileLabels) ? (profile.profileLabels as ProfileLabel[]) : []
    const bucket = labelsBySport.get(league.sport) ?? new Set<ProfileLabel>()
    for (const label of labels) bucket.add(label)
    labelsBySport.set(league.sport, bucket)
  }

  const observed = labelsBySport.size
  if (observed === 0) {
    return {
      ...empty(input.userId, 'None of your leagues has enough recorded behaviour to compare across sports.'),
      sportsWithoutProfile: withoutProfile,
    }
  }
  if (observed === 1) {
    return {
      ...empty(input.userId, 'Only one sport has a usable profile — this is a single-sport read, not a cross-sport pattern.'),
      sportsObserved: 1,
      sportsWithoutProfile: withoutProfile,
    }
  }

  const countBySportLabel = new Map<ProfileLabel, number>()
  for (const labels of labelsBySport.values()) {
    for (const label of labels) countBySportLabel.set(label, (countBySportLabel.get(label) ?? 0) + 1)
  }

  const consistentLabels: ProfileLabel[] = []
  const sportSpecificLabels: ProfileLabel[] = []
  for (const [label, sportCount] of countBySportLabel) {
    if (sportCount * 2 > observed) consistentLabels.push(label)
    else if (sportCount === 1) sportSpecificLabels.push(label)
  }

  return {
    userId: input.userId,
    sportsObserved: observed,
    sportsWithoutProfile: withoutProfile,
    consistentLabels: consistentLabels.sort(),
    sportSpecificLabels: sportSpecificLabels.sort(),
    caveat: null,
  }
}
