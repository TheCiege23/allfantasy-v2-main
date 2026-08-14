import 'server-only'

import { prisma } from '@/lib/prisma'
import { listProfilesByLeague } from './ManagerBehaviorQueryService'
import type { PsychDimension } from './ProfileEvidenceFloor'
import type { ProfileLabel } from './types'

/**
 * CrossLeagueRollup — one manager across the leagues you share with them.
 *
 * THE SCOPE IS AN INTERSECTION, ON PURPOSE. A person can be in dozens of leagues
 * (one account here is in 56). Rolling up all of them would tell a viewer in
 * league A how that person behaves in leagues A, B and C — including leagues the
 * viewer has no relationship with and no business seeing. Nothing about paying
 * for a subscription earns that. So the roll-up covers only leagues BOTH people
 * are in, which is exactly the set the viewer could already observe by opening
 * each league one at a time.
 *
 * ONE LEAGUE IS NOT A PATTERN. If the shared set is a single league, the result
 * says so and is explicitly not presented as a cross-league read. A label seen
 * once is a league observation that happens to have been rolled up.
 *
 * Identity across leagues is the Sleeper user id (LeagueTeam.platformUserId), not
 * the roster id, which is per-league and would collide constantly.
 */

export type CrossLeagueRollup = {
  subjectPlatformUserId: string
  subjectName: string | null
  isSelf: boolean
  /** Leagues the viewer and subject share AND that have a profile. */
  leaguesObserved: number
  /** Shared leagues that had no usable profile — reported, not hidden. */
  leaguesWithoutProfile: number
  labels: Array<{ label: ProfileLabel; leagues: number; consistency: number }>
  /** Labels seen in more than half the observed leagues. */
  consistentLabels: ProfileLabel[]
  dimensions: Record<PsychDimension, { leaguesObserved: number; totalEvidence: number }>
  /** Plain-language limit on the claim, or null when the roll-up stands on its own. */
  caveat: string | null
  locked: boolean
}

const EMPTY_DIMENSIONS = (): CrossLeagueRollup['dimensions'] => ({
  trade: { leaguesObserved: 0, totalEvidence: 0 },
  draft: { leaguesObserved: 0, totalEvidence: 0 },
  roster: { leaguesObserved: 0, totalEvidence: 0 },
})

/** League ids where this user is a claimed manager or the owner. */
async function leagueIdsForUser(userId: string): Promise<Set<string>> {
  const [claimed, owned] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId },
      select: { leagueId: true },
    }),
    prisma.league.findMany({ where: { userId }, select: { id: true } }),
  ])
  return new Set([...claimed.map((t) => t.leagueId), ...owned.map((l) => l.id)])
}

export async function rollUpManagerAcrossLeagues(input: {
  viewerUserId: string
  subjectPlatformUserId: string
  /**
   * Whether the viewer may see OTHER managers. Passed in rather than resolved
   * here: the caller has already made this decision via resolveProfileAccess, and
   * re-deriving it would both duplicate the entitlement lookup and pull the whole
   * subscription stack into a module that otherwise only needs the database.
   */
  canSeeOthers: boolean
}): Promise<CrossLeagueRollup> {
  const base: CrossLeagueRollup = {
    subjectPlatformUserId: input.subjectPlatformUserId,
    subjectName: null,
    isSelf: false,
    leaguesObserved: 0,
    leaguesWithoutProfile: 0,
    labels: [],
    consistentLabels: [],
    dimensions: EMPTY_DIMENSIONS(),
    caveat: 'No shared leagues with this manager.',
    locked: false,
  }

  const viewerLeagueIds = await leagueIdsForUser(input.viewerUserId)
  if (viewerLeagueIds.size === 0) return base

  // The subject's teams, restricted to leagues the viewer is also in.
  const subjectTeams = await prisma.leagueTeam.findMany({
    where: {
      platformUserId: input.subjectPlatformUserId,
      leagueId: { in: [...viewerLeagueIds] },
    },
    select: { leagueId: true, externalId: true, ownerName: true, claimedByUserId: true },
  })
  if (subjectTeams.length === 0) return base

  base.subjectName = subjectTeams[0]?.ownerName ?? null
  base.isSelf = subjectTeams.some((t) => t.claimedByUserId === input.viewerUserId)

  // Own roll-up is free; anyone else's is the premium half, same as per-league.
  if (!base.isSelf && !input.canSeeOthers) {
    return {
      ...base,
      locked: true,
      caveat: 'Manager psychology for other managers is a premium capability.',
    }
  }

  const managerIdByLeague = new Map(subjectTeams.map((t) => [t.leagueId, t.externalId]))
  const labelLeagues = new Map<ProfileLabel, number>()
  const dimensions = EMPTY_DIMENSIONS()
  let observed = 0
  let withoutProfile = 0

  for (const [leagueId, managerId] of managerIdByLeague) {
    const profiles = await listProfilesByLeague(leagueId, { limit: 64 }).catch(() => [])
    const profile = profiles.find((p) => p.managerId === managerId)
    const summary = profile?.evidenceSummary

    if (!profile || !summary?.anySufficient) {
      withoutProfile += 1
      continue
    }
    observed += 1

    for (const dimension of ['trade', 'draft', 'roster'] as PsychDimension[]) {
      const d = summary.dimensions[dimension]
      if (d?.sufficient) {
        dimensions[dimension].leaguesObserved += 1
        dimensions[dimension].totalEvidence += d.evidenceCount
      }
    }

    const labels = Array.isArray(profile.profileLabels) ? profile.profileLabels : []
    for (const label of labels) {
      labelLeagues.set(label, (labelLeagues.get(label) ?? 0) + 1)
    }
  }

  const labels = [...labelLeagues.entries()]
    .map(([label, leagues]) => ({
      label,
      leagues,
      consistency: observed > 0 ? Math.round((leagues / observed) * 100) : 0,
    }))
    .sort((a, b) => b.leagues - a.leagues || a.label.localeCompare(b.label))

  return {
    ...base,
    leaguesObserved: observed,
    leaguesWithoutProfile: withoutProfile,
    labels,
    // A trait shown in most of the shared leagues travels with the manager; one
    // shown in a single league out of five is a fact about that league.
    consistentLabels: observed >= 2 ? labels.filter((l) => l.leagues * 2 > observed).map((l) => l.label) : [],
    dimensions,
    caveat:
      observed === 0
        ? 'None of your shared leagues has enough recorded behaviour to characterise this manager.'
        : observed === 1
          ? 'Seen in one shared league only — this is a single-league read, not a cross-league pattern.'
          : null,
  }
}
