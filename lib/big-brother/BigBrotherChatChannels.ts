/**
 * Big Brother specialty chat channel registry.
 *
 * No new Prisma table — channels are virtual. Access is derived on demand
 * from live cycle state (HOH, jury, Have-Nots) + league config. UI consumes
 * this via /api/leagues/[leagueId]/big-brother/channels to decide which
 * rooms to render. Messages posted via the standard league chat API use
 * `metadata.bbChannel = <key>` for client-side filtering.
 */

import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'

export type BigBrotherChannelKey = 'main' | 'hoh_room' | 'have_nots' | 'jury' | 'nominees'

export interface BigBrotherChannelDefinition {
  key: BigBrotherChannelKey
  label: string
  description: string
  /** Who can read the channel. */
  readRule: 'everyone' | 'members_only'
  /** Who can post in the channel. */
  writeRule: 'everyone' | 'members_only' | 'commissioner_only'
}

export const BIG_BROTHER_CHANNELS: Record<BigBrotherChannelKey, BigBrotherChannelDefinition> = {
  main: {
    key: 'main',
    label: 'Main House',
    description: 'Full-league chat for all houseguests.',
    readRule: 'everyone',
    writeRule: 'everyone',
  },
  hoh_room: {
    key: 'hoh_room',
    label: 'HOH Room',
    description: 'Private strategy room for the current Head of Household.',
    readRule: 'members_only',
    writeRule: 'members_only',
  },
  nominees: {
    key: 'nominees',
    label: 'On the Block',
    description: 'Private room for the week’s nominees.',
    readRule: 'members_only',
    writeRule: 'members_only',
  },
  have_nots: {
    key: 'have_nots',
    label: 'Have-Not Room',
    description: 'Private room for this week’s Have-Nots.',
    readRule: 'members_only',
    writeRule: 'members_only',
  },
  jury: {
    key: 'jury',
    label: 'Jury House',
    description: 'Private deliberation room for jury members.',
    readRule: 'members_only',
    writeRule: 'members_only',
  },
}

export interface BbChannelAccess {
  key: BigBrotherChannelKey
  label: string
  description: string
  canRead: boolean
  canWrite: boolean
  memberRosterIds: string[]
  drawback?: string
}

/**
 * Resolve which BB channels the given user can see + write in, based on
 * live game state. Commissioner gets read access everywhere for moderation.
 */
export async function getAccessibleBbChannels(
  leagueId: string,
  userId: string,
): Promise<BbChannelAccess[]> {
  const [league, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, season: true } }),
    prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    }),
  ])
  const isCommissioner = league?.userId === userId
  const myRosterId = roster?.id ?? await acceptedCoOwnerRosterId(leagueId, userId)

  const cycle = await prisma.bigBrotherCycle.findFirst({
    where: { leagueId },
    orderBy: { week: 'desc' },
    select: {
      id: true,
      week: true,
      hohRosterId: true,
      nominee1RosterId: true,
      nominee2RosterId: true,
      replacementNomineeRosterId: true,
    },
  })
  const jury = await prisma.bigBrotherJuryMember.findMany({
    where: { leagueId },
    select: { rosterId: true },
  })

  const hoh = cycle?.hohRosterId ? [cycle.hohRosterId] : []
  const noms = [cycle?.nominee1RosterId, cycle?.nominee2RosterId, cycle?.replacementNomineeRosterId].filter(
    Boolean,
  ) as string[]

  // Load HOH room guests (invited by the HOH for this cycle).
  const hohRoomGuestRows = cycle
    ? await prisma.bigBrotherHohRoomGuest.findMany({
        where: { cycleId: cycle.id },
        select: { rosterId: true },
      })
    : []
  const hohRoomMembers = [...new Set([...hoh, ...hohRoomGuestRows.map((g) => g.rosterId)])]
  const haveNots = await resolveHaveNotRosterIds({
    leagueId,
    cycleWeek: cycle?.week ?? 1,
    seasonRaw: (league as { season?: unknown } | null)?.season,
    hohRosterId: cycle?.hohRosterId ?? null,
    nomineeRosterIds: noms,
  })
  const juryIds = jury.map((j) => j.rosterId)

  const membership: Record<BigBrotherChannelKey, string[]> = {
    main: [],
    hoh_room: hohRoomMembers,
    nominees: noms,
    have_nots: haveNots,
    jury: juryIds,
  }

  const result: BbChannelAccess[] = []
  for (const def of Object.values(BIG_BROTHER_CHANNELS)) {
    const members = membership[def.key]
    const isMember = myRosterId != null && members.includes(myRosterId)
    const canRead =
      def.readRule === 'everyone' ? true : isMember || isCommissioner
    const canWrite =
      def.writeRule === 'everyone'
        ? true
        : def.writeRule === 'commissioner_only'
          ? isCommissioner
          : isMember
    result.push({
      key: def.key,
      label: def.label,
      description: def.description,
      canRead,
      canWrite,
      memberRosterIds: members,
      drawback:
        def.key === 'have_nots'
          ? 'Have-Not drawback: reduced waiver priority and challenge disadvantage for this cycle.'
          : undefined,
    })
  }
  return result
}

/**
 * Public helper: resolve Have-Not roster IDs for a given cycle without needing
 * to run the full channel access check. Used by BigBrotherHaveNotPenaltyService.
 */
export async function resolveHaveNotRosterIdsForCycle(
  leagueId: string,
  cycleId: string,
): Promise<string[]> {
  const [cycle, league] = await Promise.all([
    prisma.bigBrotherCycle.findUnique({
      where: { id: cycleId },
      select: { week: true, hohRosterId: true, nominee1RosterId: true, nominee2RosterId: true, replacementNomineeRosterId: true },
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } }),
  ])
  if (!cycle) return []
  const noms = [cycle.nominee1RosterId, cycle.nominee2RosterId, cycle.replacementNomineeRosterId].filter(
    Boolean,
  ) as string[]
  return resolveHaveNotRosterIds({
    leagueId,
    cycleWeek: cycle.week,
    seasonRaw: (league as { season?: unknown } | null)?.season,
    hohRosterId: cycle.hohRosterId ?? null,
    nomineeRosterIds: noms,
  })
}

function parseSeasonValue(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw)
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed)
  }
  return new Date().getUTCFullYear()
}

async function resolveHaveNotRosterIds(input: {
  leagueId: string
  cycleWeek: number
  seasonRaw: unknown
  hohRosterId: string | null
  nomineeRosterIds: string[]
}): Promise<string[]> {
  const { leagueId, cycleWeek, seasonRaw, hohRosterId, nomineeRosterIds } = input
  const [allRosters, map] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    getRosterTeamMap(leagueId),
  ])

  const excluded = new Set<string>([...(hohRosterId ? [hohRosterId] : []), ...nomineeRosterIds])
  const eligibleRosterIds = allRosters.map((r) => r.id).filter((rid) => !excluded.has(rid))
  if (eligibleRosterIds.length === 0) return []

  const weekCandidates = [cycleWeek, cycleWeek - 1, cycleWeek - 2].filter((week, idx, all) => week > 0 && all.indexOf(week) === idx)
  if (weekCandidates.length === 0) return []

  const teamIds = eligibleRosterIds
    .map((rid) => map.rosterIdToTeamId.get(rid))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (teamIds.length === 0) return []

  const perfRows = await prisma.teamPerformance.findMany({
    where: {
      teamId: { in: teamIds },
      season: parseSeasonValue(seasonRaw),
      week: { in: weekCandidates },
    },
    select: { teamId: true, week: true, points: true },
  })

  const byTeamAndWeek = new Map<string, Map<number, number>>()
  for (const row of perfRows) {
    const weekMap = byTeamAndWeek.get(row.teamId) ?? new Map<number, number>()
    weekMap.set(row.week, row.points ?? 0)
    byTeamAndWeek.set(row.teamId, weekMap)
  }

  const scores = eligibleRosterIds.map((rosterId) => {
    const teamId = map.rosterIdToTeamId.get(rosterId)
    const weekMap = teamId ? byTeamAndWeek.get(teamId) : undefined
    let score = 0
    for (const week of weekCandidates) {
      if (weekMap?.has(week)) {
        score = weekMap.get(week) ?? 0
        break
      }
    }
    return { rosterId, score }
  })

  scores.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.rosterId.localeCompare(b.rosterId)
  })

  const haveNotCount = eligibleRosterIds.length >= 6 ? 2 : 1
  return scores.slice(0, haveNotCount).map((entry) => entry.rosterId)
}
