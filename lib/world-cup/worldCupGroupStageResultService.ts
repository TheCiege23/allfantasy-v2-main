import "server-only"
import { prisma } from "@/lib/prisma"
import { recalculateWorldCupChallenge } from "./worldCupScoringService"
import { ensureWorldCupGroupsForChallenge } from "./worldCupGroupStageService"
import { validateWorldCupGroupRanking, validateWorldCupThirdPlaceSelections } from "./worldCupGroups"
import { rankWorldCupGroupTeams, resolveWorldCupRoundOf32Slots, type WorldCupGroupStanding, type WorldCupRoundOf32MappingRow } from "./worldCupGroupResolver"
import { getWorldCupDataProvider, WorldCupProviderConfigError, type WorldCupProviderGroupStanding, type WorldCupProviderName } from "./worldCupDataProvider"

type WorldCupGroupStageResultSummary = {
  challengeId: string
  groupsUpdated: number
  groupTeamsUpdated: number
  thirdPlaceTeamsUpdated: number
  leaderboard: Awaited<ReturnType<typeof recalculateWorldCupChallenge>>
  warnings?: string[]
}

type WorldCupProviderStandingsIngestionResult = WorldCupGroupStageResultSummary & {
  standingsReceived: number
}

type WorldCupRoundOf32PopulationResult = {
  challengeId: string
  slotsUpdated: number
  matchesUpdated: number
  warnings: string[]
}

async function getGroupTeamRows(challengeId: string) {
  return prisma.worldCupGroupTeam.findMany({
    where: { challengeId },
    include: { group: true, team: true },
    orderBy: [{ group: { sortOrder: "asc" } }, { seedOrder: "asc" }],
  })
}

function normalizeGroupName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/^GROUP\s+/, "")
  return normalized && /^[A-L]$/.test(normalized) ? normalized : null
}

function toStanding(row: Awaited<ReturnType<typeof getGroupTeamRows>>[number]): WorldCupGroupStanding | null {
  if (row.points == null || row.goalDifference == null || row.goalsFor == null) return null
  return {
    group: row.group.groupKey,
    teamId: row.teamId,
    teamName: row.team.name,
    points: row.points,
    goalDifference: row.goalDifference,
    goalsFor: row.goalsFor,
  }
}

function providerStandingKey(standing: WorldCupProviderGroupStanding) {
  return [
    standing.providerId ? `api:${standing.providerId}` : null,
    standing.fifaCode ? `fifa:${standing.fifaCode.toUpperCase()}` : null,
    `name:${standing.teamName.trim().toLowerCase()}`,
  ].filter(Boolean)
}

export async function setWorldCupGroupActualStandings(input: {
  challengeId: string
  groupId: string
  orderedTeamIds: string[]
  actorUserId: string
}): Promise<WorldCupGroupStageResultSummary> {
  void input.actorUserId
  const validation = validateWorldCupGroupRanking(input.orderedTeamIds)
  if (!validation.ok) throw new Error(validation.error)

  const group = await prisma.worldCupGroup.findFirst({
    where: { id: input.groupId, challengeId: input.challengeId },
    include: { teams: { select: { teamId: true } } },
  })
  if (!group) throw new Error("Group not found")

  const groupTeamIds = new Set(group.teams.map((team) => team.teamId))
  if (input.orderedTeamIds.some((teamId) => !groupTeamIds.has(teamId))) {
    throw new Error("Every result team must belong to this group.")
  }

  await prisma.$transaction(async (tx) => {
    await tx.worldCupGroupTeam.updateMany({
      where: { challengeId: input.challengeId, groupId: input.groupId },
      data: { actualRank: null },
    })
    for (const [index, teamId] of input.orderedTeamIds.entries()) {
      await tx.worldCupGroupTeam.updateMany({
        where: { challengeId: input.challengeId, groupId: input.groupId, teamId },
        data: { actualRank: index + 1 },
      })
    }
  })

  const leaderboard = await recalculateWorldCupChallenge(input.challengeId)
  return {
    challengeId: input.challengeId,
    groupsUpdated: 1,
    groupTeamsUpdated: input.orderedTeamIds.length,
    thirdPlaceTeamsUpdated: 0,
    leaderboard,
  }
}

export async function setWorldCupThirdPlaceActualAdvancers(input: {
  challengeId: string
  selectedTeamIds: string[]
  actorUserId: string
}): Promise<WorldCupGroupStageResultSummary> {
  void input.actorUserId
  const validation = validateWorldCupThirdPlaceSelections(input.selectedTeamIds)
  if (!validation.ok) throw new Error(validation.error)

  const groupTeams = await getGroupTeamRows(input.challengeId)
  const validTeamIds = new Set(groupTeams.map((row) => row.teamId))
  if (input.selectedTeamIds.some((teamId) => !validTeamIds.has(teamId))) {
    throw new Error("Every third-place advancer must belong to a World Cup group.")
  }

  await prisma.$transaction(async (tx) => {
    await tx.worldCupThirdPlaceAdvancerPick.updateMany({
      where: { challengeId: input.challengeId },
      data: { actualAdvanced: false },
    })
    await tx.worldCupThirdPlaceAdvancerPick.updateMany({
      where: { challengeId: input.challengeId, teamId: { in: input.selectedTeamIds } },
      data: { actualAdvanced: true },
    })
  })

  const leaderboard = await recalculateWorldCupChallenge(input.challengeId)
  return {
    challengeId: input.challengeId,
    groupsUpdated: 0,
    groupTeamsUpdated: 0,
    thirdPlaceTeamsUpdated: input.selectedTeamIds.length,
    leaderboard,
  }
}

export async function applyWorldCupProviderGroupStandings(input: {
  challengeId: string
  standings: WorldCupProviderGroupStanding[]
  actorUserId?: string
}): Promise<WorldCupProviderStandingsIngestionResult> {
  void input.actorUserId
  const groupTeams = await getGroupTeamRows(input.challengeId)
  const rowsByGroup = new Map<string, typeof groupTeams>()
  const rowsByProviderKey = new Map<string, (typeof groupTeams)[number]>()

  for (const row of groupTeams) {
    const groupKey = normalizeGroupName(row.group.groupKey)
    if (!groupKey) continue
    const rows = rowsByGroup.get(groupKey) ?? []
    rows.push(row)
    rowsByGroup.set(groupKey, rows)
    if (row.team.apiTeamId != null) rowsByProviderKey.set(`api:${row.team.apiTeamId}`, row)
    if (row.team.fifaCode) rowsByProviderKey.set(`fifa:${row.team.fifaCode.toUpperCase()}`, row)
    rowsByProviderKey.set(`name:${row.team.name.trim().toLowerCase()}`, row)
  }

  const warnings: string[] = []
  const matchedByGroup = new Map<string, Array<WorldCupGroupStanding & { row: (typeof groupTeams)[number] }>>()

  for (const standing of input.standings) {
    const group = normalizeGroupName(standing.groupName)
    if (!group) {
      warnings.push(`Ignored standings row for ${standing.teamName}: missing valid group A-L.`)
      continue
    }
    const matched = providerStandingKey(standing)
      .map((key) => rowsByProviderKey.get(key))
      .find((row): row is (typeof groupTeams)[number] => Boolean(row))
    if (!matched) {
      warnings.push(`Ignored standings row for ${standing.teamName}: team was not found in challenge groups.`)
      continue
    }
    if (normalizeGroupName(matched.group.groupKey) !== group) {
      warnings.push(`Ignored standings row for ${standing.teamName}: provider group ${group} does not match challenge group ${matched.group.groupKey}.`)
      continue
    }
    const rows = matchedByGroup.get(group) ?? []
    rows.push({
      group,
      teamId: matched.teamId,
      teamName: matched.team.name,
      points: standing.points,
      goalDifference: standing.goalDifference,
      goalsFor: standing.goalsFor,
      fairPlayPoints: standing.fairPlayPoints ?? null,
      row: matched,
    })
    matchedByGroup.set(group, rows)
  }

  let groupTeamsUpdated = 0
  await prisma.$transaction(async (tx) => {
    for (const [groupKey, rows] of matchedByGroup.entries()) {
      if (rows.length !== 4) {
        warnings.push(`Skipped Group ${groupKey}: provider returned ${rows.length}/4 matched teams.`)
        continue
      }
      const ranked = rankWorldCupGroupTeams(rows)
      for (const [index, standing] of ranked.entries()) {
        await tx.worldCupGroupTeam.updateMany({
          where: { challengeId: input.challengeId, groupId: standing.row.groupId, teamId: standing.teamId },
          data: {
            actualRank: index + 1,
            points: standing.points,
            goalDifference: standing.goalDifference,
            goalsFor: standing.goalsFor,
          },
        })
        groupTeamsUpdated++
      }
    }
  })

  const thirdPlaceResult = await deriveWorldCupThirdPlaceActualAdvancers({
    challengeId: input.challengeId,
    actorUserId: input.actorUserId,
    recalculate: false,
  })
  const leaderboard = await recalculateWorldCupChallenge(input.challengeId)

  return {
    challengeId: input.challengeId,
    standingsReceived: input.standings.length,
    groupsUpdated: Math.floor(groupTeamsUpdated / 4),
    groupTeamsUpdated,
    thirdPlaceTeamsUpdated: thirdPlaceResult.thirdPlaceTeamsUpdated,
    leaderboard,
    warnings: [...warnings, ...(thirdPlaceResult.warnings ?? [])],
  }
}

export async function syncWorldCupProviderGroupStandings(input: {
  challengeId: string
  provider?: WorldCupProviderName | string | null
  seasonYear?: number
  actorUserId?: string
}): Promise<WorldCupProviderStandingsIngestionResult> {
  const provider = await getWorldCupDataProvider(input.provider)
  if (!provider.getGroupStandings) {
    return {
      challengeId: input.challengeId,
      standingsReceived: 0,
      groupsUpdated: 0,
      groupTeamsUpdated: 0,
      thirdPlaceTeamsUpdated: 0,
      leaderboard: await recalculateWorldCupChallenge(input.challengeId),
      warnings: [`Provider ${provider.name} does not expose group standings yet. Use manual/admin result entry as fallback.`],
    }
  }

  try {
    const standings = await provider.getGroupStandings(input.seasonYear ?? 2026)
    return applyWorldCupProviderGroupStandings({
      challengeId: input.challengeId,
      standings,
      actorUserId: input.actorUserId,
    })
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      return {
        challengeId: input.challengeId,
        standingsReceived: 0,
        groupsUpdated: 0,
        groupTeamsUpdated: 0,
        thirdPlaceTeamsUpdated: 0,
        leaderboard: await recalculateWorldCupChallenge(input.challengeId),
        warnings: [err.message],
      }
    }
    throw err
  }
}

export async function deriveWorldCupThirdPlaceActualAdvancers(input: {
  challengeId: string
  actorUserId?: string
  recalculate?: boolean
}): Promise<WorldCupGroupStageResultSummary> {
  void input.actorUserId
  const groupTeams = await getGroupTeamRows(input.challengeId)
  const byGroup = new Map<string, WorldCupGroupStanding[]>()
  for (const row of groupTeams) {
    const standing = toStanding(row)
    if (!standing) continue
    const rows = byGroup.get(row.group.groupKey) ?? []
    rows.push(standing)
    byGroup.set(row.group.groupKey, rows)
  }

  const warnings: string[] = []
  for (const groupKey of "ABCDEFGHIJKL".split("")) {
    if ((byGroup.get(groupKey)?.length ?? 0) !== 4) {
      warnings.push(`Cannot derive third-place actuals: Group ${groupKey} does not have 4 official standings rows.`)
    }
  }
  if (warnings.length > 0) {
    return {
      challengeId: input.challengeId,
      groupsUpdated: 0,
      groupTeamsUpdated: 0,
      thirdPlaceTeamsUpdated: 0,
      leaderboard: input.recalculate === false ? [] : await recalculateWorldCupChallenge(input.challengeId),
      warnings,
    }
  }

  const thirds = [...byGroup.entries()]
    .map(([group, rows]) => rankWorldCupGroupTeams(rows)[2])
    .filter((row): row is WorldCupGroupStanding => Boolean(row))
    .sort((a, b) => rankWorldCupGroupTeams([a, b])[0] === a ? -1 : 1)
    .slice(0, 8)
  const selectedTeamIds = thirds.map((row) => row.teamId)
  const validation = validateWorldCupThirdPlaceSelections(selectedTeamIds)
  if (!validation.ok) throw new Error(validation.error)

  await prisma.$transaction(async (tx) => {
    await tx.worldCupThirdPlaceAdvancerPick.updateMany({
      where: { challengeId: input.challengeId },
      data: { actualAdvanced: false },
    })
    await tx.worldCupThirdPlaceAdvancerPick.updateMany({
      where: { challengeId: input.challengeId, teamId: { in: selectedTeamIds } },
      data: { actualAdvanced: true },
    })
  })

  return {
    challengeId: input.challengeId,
    groupsUpdated: 0,
    groupTeamsUpdated: 0,
    thirdPlaceTeamsUpdated: selectedTeamIds.length,
    leaderboard: input.recalculate === false ? [] : await recalculateWorldCupChallenge(input.challengeId),
    warnings,
  }
}

export async function populateWorldCupRoundOf32FromGroupResults(input: {
  challengeId: string
  mappingTable?: WorldCupRoundOf32MappingRow[]
  confirmBestThirdMapping?: boolean
}): Promise<WorldCupRoundOf32PopulationResult> {
  const map = input.mappingTable
  if (!input.confirmBestThirdMapping || !map) {
    throw new Error("Official FIFA best-third Round of 32 mapping is not confirmed. Provide an explicit mappingTable and confirmBestThirdMapping before populating best-third slots.")
  }

  const groupTeams = await getGroupTeamRows(input.challengeId)
  const grouped: Record<string, WorldCupGroupStanding[]> = {}
  for (const row of groupTeams) {
    const standing = toStanding(row)
    if (!standing) continue
    grouped[row.group.groupKey] = [...(grouped[row.group.groupKey] ?? []), standing]
  }

  const resolved = resolveWorldCupRoundOf32Slots(grouped, map)
  const writableSlots = resolved.slots.filter((slot) => slot.teamId)
  let slotsUpdated = 0
  let matchesUpdated = 0

  await prisma.$transaction(async (tx) => {
    for (const slot of writableSlots) {
      await tx.worldCupBracketSlot.updateMany({
        where: { challengeId: input.challengeId, slotKey: slot.slotKey },
        data: { teamId: slot.teamId, displayName: slot.teamName, isPlaceholder: false },
      })
      slotsUpdated++
      const home = await tx.worldCupBracketMatch.updateMany({
        where: { challengeId: input.challengeId, homeSlotKey: slot.slotKey },
        data: { homeTeamId: slot.teamId, homeTeamName: slot.teamName },
      })
      const away = await tx.worldCupBracketMatch.updateMany({
        where: { challengeId: input.challengeId, awaySlotKey: slot.slotKey },
        data: { awayTeamId: slot.teamId, awayTeamName: slot.teamName },
      })
      matchesUpdated += (home as { count?: number }).count ?? 0
      matchesUpdated += (away as { count?: number }).count ?? 0
    }
  })

  return {
    challengeId: input.challengeId,
    slotsUpdated,
    matchesUpdated,
    warnings: resolved.warnings,
  }
}

export async function loadWorldCupTestGroupResults(input: {
  challengeId: string
  actorUserId: string
}): Promise<WorldCupGroupStageResultSummary & { warnings: string[] }> {
  void input.actorUserId
  const ensured = await ensureWorldCupGroupsForChallenge(input.challengeId)
  const groups = ensured.groups
  const warnings = [...ensured.warnings.map((warning) => warning.message)]
  const completeGroups = groups.filter((group) => group.teams.length >= 4)

  await prisma.$transaction(async (tx) => {
    for (const group of completeGroups) {
      const orderedTeams = group.teams.slice().sort((a, b) => a.seedOrder - b.seedOrder).slice(0, 4)
      for (const [index, row] of orderedTeams.entries()) {
        await tx.worldCupGroupTeam.updateMany({
          where: { challengeId: input.challengeId, groupId: group.id, teamId: row.teamId },
          data: { actualRank: index + 1 },
        })
      }
    }
    const thirdPlaceTeamIds = completeGroups
      .slice(0, 8)
      .map((group) => group.teams.slice().sort((a, b) => a.seedOrder - b.seedOrder)[2]?.teamId)
      .filter((teamId): teamId is string => Boolean(teamId))

    await tx.worldCupThirdPlaceAdvancerPick.updateMany({
      where: { challengeId: input.challengeId },
      data: { actualAdvanced: false },
    })
    if (thirdPlaceTeamIds.length > 0) {
      await tx.worldCupThirdPlaceAdvancerPick.updateMany({
        where: { challengeId: input.challengeId, teamId: { in: thirdPlaceTeamIds } },
        data: { actualAdvanced: true },
      })
    }
  })

  const leaderboard = await recalculateWorldCupChallenge(input.challengeId)
  return {
    challengeId: input.challengeId,
    groupsUpdated: completeGroups.length,
    groupTeamsUpdated: completeGroups.length * 4,
    thirdPlaceTeamsUpdated: Math.min(8, completeGroups.length),
    leaderboard,
    warnings,
  }
}
