import "server-only"
import { prisma } from "@/lib/prisma"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { recordProviderSync } from "@/lib/provider-sync-logger"
import { recalculateWorldCupChallenge } from "./worldCupScoringService"
import {
  getWorldCupDataProvider,
  WorldCupProviderConfigError,
  type WorldCupProviderName,
  type WorldCupProviderTeam,
  type WorldCupProviderFixture,
  type WorldCupProviderGroupStanding,
  type WorldCupProviderInjury,
} from "./worldCupDataProvider"
import { normalizeWorldCupRound } from "./apiSportsWorldCup"
import { normalizeFifaTeamCode } from "./worldCupSeedData"
import type { WorldCupRound } from "./types"
import { emitWorldCupMatchTransitionEvents } from "./worldCupBracketLiveEventHooks"
import { getBestThirdPlaceTeams, type WorldCupGroupStanding } from "./worldCupGroupResolver"
import { resolveWorldCup2026OfficialGroup } from "./worldCupOfficialGroups"

// ── Shared option types ───────────────────────────────────────────────────────

export type WorldCupSyncOptions = {
  provider?: WorldCupProviderName | string | null
  dryRun?: boolean
  seasonYear?: number
}

export type WorldCupOfficialGroupsReadiness = {
  ready: boolean
  assignedTeams: number
  incompleteGroups: Array<{ groupName: string; teamCount: number; missingTeams: number }>
}

// ── Team sync ────────────────────────────────────────────────────────────────

export type WorldCupTeamSyncResult = {
  created: number
  updated: number
  skipped: number
  warnings: string[]
  teams: Array<{ id?: string; providerId: string; name: string; action: "created" | "updated" | "skipped" | "error" }>
}

export async function syncWorldCupTeams(
  options: WorldCupSyncOptions = {}
): Promise<WorldCupTeamSyncResult> {
  const { dryRun = false, seasonYear = 2026 } = options
  const result: WorldCupTeamSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
    teams: [],
  }

  let providerTeams: WorldCupProviderTeam[]
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    providerTeams = await provider.getTeams(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      result.warnings.push(err.message)
      await recordWorldCupSyncState("world_cup_teams", options, {
        skipped: 0,
        error: err.message,
      })
      return result
    }
    throw err
  }

  if (providerTeams.length === 0) {
    result.warnings.push(
      "Provider returned 0 teams. Check provider configuration and season year."
    )
    await recordWorldCupSyncState("world_cup_teams", options, {
      skipped: 0,
      error: result.warnings[0],
    })
    return result
  }

  for (const team of providerTeams) {
    try {
      const apiTeamId =
        team.providerId && !Number.isNaN(Number(team.providerId))
          ? Number(team.providerId)
          : null
      const fifaCode = normalizeFifaTeamCode(team.fifaCode)

      // Find existing record for deduplication
      const existing = apiTeamId
        ? await (prisma as any).worldCupTeam.findUnique({
            where: { apiTeamId },
            select: { id: true },
          })
        : fifaCode
        ? await (prisma as any).worldCupTeam.findFirst({
            where: { fifaCode },
            select: { id: true },
          })
        : null

      if (dryRun) {
        result.teams.push({
          providerId: team.providerId,
          name: team.displayName,
          action: existing ? "updated" : "created",
        })
        if (existing) result.updated++
        else result.created++
        continue
      }

      const officialGroupName = team.groupName ?? resolveWorldCup2026OfficialGroup({
        fifaCode,
        name: team.displayName,
        country: team.countryName,
      })

      const upsertData = {
        name: team.displayName,
        country: team.countryName,
        fifaCode: fifaCode ?? undefined,
        flagUrl: team.flagUrl ?? undefined,
        logoUrl: team.flagUrl ?? undefined,
        groupName: officialGroupName ?? undefined,
        qualificationStatus: team.qualificationStatus ?? "qualified",
        sourcePayload: (team as any).raw ?? undefined,
      }

      let dbId: string
      if (apiTeamId) {
        const row = await (prisma as any).worldCupTeam.upsert({
          where: { apiTeamId },
          create: { apiTeamId, ...upsertData },
          update: { ...upsertData, updatedAt: new Date() },
          select: { id: true },
        })
        dbId = row.id
      } else if (existing) {
        const row = await (prisma as any).worldCupTeam.update({
          where: { id: existing.id },
          data: { ...upsertData, updatedAt: new Date() },
          select: { id: true },
        })
        dbId = row.id
      } else {
        const row = await (prisma as any).worldCupTeam.create({
          data: upsertData,
          select: { id: true },
        })
        dbId = row.id
      }

      if (!officialGroupName) {
        result.warnings.push(`Team ${team.displayName} is missing an official 2026 group assignment.`)
      }

      result.teams.push({
        id: dbId,
        providerId: team.providerId,
        name: team.displayName,
        action: existing ? "updated" : "created",
      })
      if (existing) result.updated++
      else result.created++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.warnings.push(`Team ${team.displayName} (${team.providerId}): ${msg}`)
      result.teams.push({
        providerId: team.providerId,
        name: team.displayName,
        action: "error",
      })
    }
  }

  return result
}

export async function getWorldCupOfficialGroupsReadiness(
  options: Pick<WorldCupSyncOptions, "seasonYear"> = {}
): Promise<WorldCupOfficialGroupsReadiness> {
  void options.seasonYear
  const rows = await (prisma as any).worldCupTeam.groupBy({
    by: ["groupName"],
    where: {
      groupName: { not: null },
      qualificationStatus: { notIn: ["test", "test_placeholder"] },
      /*
       * ⚠ THE TWO `sourcePayload` CLAUSES THAT USED TO SIT HERE RETURNED ZERO ROWS.
       * Prisma emits a json path read as `NOT (source_payload #> '{testFixture}') = $1`,
       * and `#>` yields SQL NULL when the KEY IS ABSENT — not only when the column is.
       * `NOT (NULL = ...)` is UNKNOWN, so the WHERE dropped every ordinary team.
       * Measured on the test branch: 144 rows, 96 after the id exclusions, **0** once the
       * payload clauses were added, so this groupBy returned nothing at all.
       *
       * Removing them loses no coverage, and that is true by CONSTRUCTION rather than by
       * the shape of today's data: every writer of those markers also stamps the id prefix
       * and the status. `WORLD_CUP_DEMO_TEAMS` is 32 ids, all `demo_team_*`, all
       * `qualificationStatus: "test"`; `buildPlaceholderTeam` writes `wc2026_placeholder_*`
       * with `test_placeholder`. Both are already excluded above and below.
       *
       * ⚠ Do not "restore" them in a negated form. No Prisma spelling is NULL-safe here —
       * `path/not:` emits `<>` and `NOT: { OR: [...] }` both measured 0 too. Only SQL's
       * `IS NOT TRUE` works, and it needs raw SQL.
       */
      NOT: [
        { id: { startsWith: "demo_team_" } },
        { id: { startsWith: "wc2026_placeholder_" } },
      ],
    },
    _count: { _all: true },
  })

  const counts = new Map<string, number>()
  for (const row of rows as Array<{ groupName: string | null; _count: { _all: number } }>) {
    if (row.groupName) counts.set(row.groupName, row._count._all)
  }

  const groupNames = Array.from({ length: 12 }, (_, index) =>
    String.fromCharCode("A".charCodeAt(0) + index)
  )
  const incompleteGroups = groupNames
    .map((groupName) => {
      const teamCount = counts.get(groupName) ?? 0
      return { groupName, teamCount, missingTeams: Math.max(0, 4 - teamCount) }
    })
    .filter((group) => group.missingTeams > 0)
  const assignedTeams = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)

  return {
    ready: assignedTeams >= 48 && incompleteGroups.length === 0,
    assignedTeams,
    incompleteGroups,
  }
}

// ── Fixture sync ──────────────────────────────────────────────────────────────

export type WorldCupFixtureSyncResult = {
  created: number
  updated: number
  skipped: number
  officialFixturesCreated?: number
  officialFixturesUpdated?: number
  bracketMatchesUpdated?: number
  warnings: string[]
  lockTimeInferred: string | null
  fixtures: Array<{
    providerId: string
    matchId?: string
    action: "updated" | "skipped" | "no_match" | "error"
  }>
}

export type WorldCupGroupStandingsSyncResult = {
  created: number
  updated: number
  skipped: number
  warnings: string[]
  groupsComplete: boolean
  thirdPlaceAdvancers: Array<{ teamId: string; teamName: string; groupName: string }>
  standings: Array<{ teamId?: string; teamName: string; groupName: string; rank: number; action: "created" | "updated" | "skipped" | "error" }>
}

export type WorldCupInjurySyncResult = {
  created: number
  changed: number
  skipped: number
  notificationsCreated: number
  warnings: string[]
  injuries: Array<{
    playerName: string
    teamName: string
    status: string
    action: "created" | "changed" | "skipped" | "error"
  }>
}

const WORLD_CUP_TOURNAMENT_KEY = "fifa_world_cup"

function providerNameFor(options: WorldCupSyncOptions) {
  return (options.provider ?? process.env.WORLD_CUP_DATA_PROVIDER ?? "mock").toString()
}

async function recordWorldCupSyncState(
  entityType: "world_cup_teams" | "world_cup_fixtures" | "world_cup_live_scores" | "world_cup_standings" | "world_cup_injuries",
  options: WorldCupSyncOptions,
  stats: { imported?: number; updated?: number; skipped?: number; error?: string | null }
) {
  await recordProviderSync(
    { provider: providerNameFor(options), entityType, sport: "WC_SOCCER", key: String(options.seasonYear ?? 2026) },
    {
      recordsImported: stats.imported ?? 0,
      recordsUpdated: stats.updated ?? 0,
      recordsSkipped: stats.skipped ?? 0,
      error: stats.error ?? null,
    }
  )
}

function dateOrNull(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function findTeamIdByProviderOrName(input: {
  providerId?: string | null
  name?: string | null
  fifaCode?: string | null
}) {
  const apiTeamId =
    input.providerId && !Number.isNaN(Number(input.providerId))
      ? Number(input.providerId)
      : null
  if (apiTeamId) {
    const row = await (prisma as any).worldCupTeam.findUnique({
      where: { apiTeamId },
      select: { id: true },
    })
    if (row?.id) return row.id as string
  }

  const fifaCode = normalizeFifaTeamCode(input.fifaCode)
  if (fifaCode) {
    const row = await (prisma as any).worldCupTeam.findFirst({
      where: { fifaCode },
      select: { id: true },
    })
    if (row?.id) return row.id as string
  }

  if (input.name?.trim()) {
    const row = await (prisma as any).worldCupTeam.findFirst({
      where: { name: { equals: input.name.trim(), mode: "insensitive" } },
      select: { id: true },
    })
    if (row?.id) return row.id as string
  }

  return null
}

function isBracketRound(round: WorldCupRound | null) {
  return Boolean(round)
}

function groupStandingsComplete(rows: WorldCupProviderGroupStanding[]) {
  const groups = new Map<string, Set<number>>()
  for (const row of rows) {
    if (!row.groupName || !Number.isInteger(row.rank)) continue
    const ranks = groups.get(row.groupName) ?? new Set<number>()
    ranks.add(row.rank)
    groups.set(row.groupName, ranks)
  }

  if (groups.size < 12) return false
  for (const ranks of groups.values()) {
    if (![1, 2, 3, 4].every((rank) => ranks.has(rank))) return false
  }
  return true
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function parseProviderReportDate(value?: string | null) {
  if (!value) return startOfUtcDay(new Date())
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? startOfUtcDay(new Date()) : startOfUtcDay(date)
}

function normalizeInjuryText(value?: string | null, fallback = "Unknown") {
  const text = value?.replace(/\s+/g, " ").trim()
  return text ? text.slice(0, 128) : fallback
}

function injuryStatusChanged(previous: { status?: string | null; notes?: string | null } | null, injury: WorldCupProviderInjury) {
  if (!previous) return false
  return (
    normalizeInjuryText(previous.status, "").toLowerCase() !== normalizeInjuryText(injury.status, "").toLowerCase() ||
    normalizeInjuryText(previous.notes, "").toLowerCase() !== normalizeInjuryText(injury.notes, "").toLowerCase()
  )
}

async function upsertOfficialWorldCupFixtures(input: {
  fixtures: WorldCupProviderFixture[]
  providerName: string
  seasonYear: number
  dryRun: boolean
}) {
  let created = 0
  let updated = 0
  const rows: Array<{ providerId: string; action: "created" | "updated" | "skipped" | "error"; officialFixtureId?: string }> = []
  const warnings: string[] = []

  for (const fixture of input.fixtures) {
    try {
      const existing = await (prisma as any).worldCupOfficialFixture.findUnique({
        where: {
          providerName_seasonYear_providerFixtureId: {
            providerName: input.providerName,
            seasonYear: input.seasonYear,
            providerFixtureId: fixture.providerId,
          },
        },
        select: { id: true },
      })

      if (input.dryRun) {
        rows.push({ providerId: fixture.providerId, action: existing ? "updated" : "created" })
        if (existing) updated++
        else created++
        continue
      }

      const [homeTeamId, awayTeamId, winnerTeamId] = await Promise.all([
        findTeamIdByProviderOrName({ providerId: fixture.homeProviderId, name: fixture.homeName, fifaCode: fixture.homeFifaCode }),
        findTeamIdByProviderOrName({ providerId: fixture.awayProviderId, name: fixture.awayName, fifaCode: fixture.awayFifaCode }),
        findTeamIdByProviderOrName({ providerId: fixture.winnerProviderId, name: fixture.winnerName, fifaCode: fixture.winnerFifaCode }),
      ])
      const round = fixture.roundName ? normalizeWorldCupRound(fixture.roundName) : null
      const data = {
        tournamentKey: WORLD_CUP_TOURNAMENT_KEY,
        round,
        stage: fixture.stage ?? fixture.roundName ?? null,
        groupName: fixture.groupName ?? null,
        startsAt: dateOrNull(fixture.startsAt),
        status: normalizeProviderStatus(fixture.status),
        apiStatusShort: fixture.apiStatusShort ?? null,
        elapsedMinute: fixture.elapsedMinute ?? null,
        injuryTime: fixture.injuryTime ?? null,
        period: fixture.period ?? null,
        venueName: fixture.venueName ?? null,
        venueCity: fixture.venueCity ?? null,
        homeTeamId,
        awayTeamId,
        winnerTeamId,
        homeProviderId: fixture.homeProviderId ?? null,
        awayProviderId: fixture.awayProviderId ?? null,
        winnerProviderId: fixture.winnerProviderId ?? null,
        homeTeamName: fixture.homeName ?? null,
        awayTeamName: fixture.awayName ?? null,
        winnerTeamName: fixture.winnerName ?? null,
        homeTeamLogo: fixture.homeLogo ?? null,
        awayTeamLogo: fixture.awayLogo ?? null,
        homeScore: fixture.homeScore ?? null,
        awayScore: fixture.awayScore ?? null,
        homePenaltyScore: fixture.homePenaltyScore ?? null,
        awayPenaltyScore: fixture.awayPenaltyScore ?? null,
        sourcePayload: fixture.raw ? (fixture.raw as object) : undefined,
      }

      const row = await (prisma as any).worldCupOfficialFixture.upsert({
        where: {
          providerName_seasonYear_providerFixtureId: {
            providerName: input.providerName,
            seasonYear: input.seasonYear,
            providerFixtureId: fixture.providerId,
          },
        },
        create: {
          providerName: input.providerName,
          providerFixtureId: fixture.providerId,
          seasonYear: input.seasonYear,
          ...data,
        },
        update: { ...data, updatedAt: new Date() },
        select: { id: true },
      })

      rows.push({ providerId: fixture.providerId, action: existing ? "updated" : "created", officialFixtureId: row.id })
      if (existing) updated++
      else created++
    } catch (err) {
      rows.push({ providerId: fixture.providerId, action: "error" })
      warnings.push(`Fixture ${fixture.providerId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { created, updated, rows, warnings }
}

export async function syncWorldCupFixtures(
  options: WorldCupSyncOptions & {
    challengeId?: string
    upsert?: boolean
  } = {}
): Promise<WorldCupFixtureSyncResult> {
  const { dryRun = false, seasonYear = 2026, challengeId, upsert = true } =
    options

  const result: WorldCupFixtureSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    officialFixturesCreated: 0,
    officialFixturesUpdated: 0,
    bracketMatchesUpdated: 0,
    warnings: [],
    lockTimeInferred: null,
    fixtures: [],
  }

  let providerFixtures: WorldCupProviderFixture[]
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    providerFixtures = await provider.getFixtures(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      result.warnings.push(err.message)
      await recordWorldCupSyncState("world_cup_fixtures", options, {
        skipped: 0,
        error: err.message,
      })
      return result
    }
    throw err
  }

  if (providerFixtures.length === 0) {
    result.warnings.push(
      "Provider returned 0 fixtures. Check provider configuration."
    )
    await recordWorldCupSyncState("world_cup_fixtures", options, {
      skipped: 0,
      error: result.warnings[0],
    })
    return result
  }

  const providerName = providerNameFor(options)
  const officialSync = await upsertOfficialWorldCupFixtures({
    fixtures: providerFixtures,
    providerName,
    seasonYear,
    dryRun,
  })
  result.created += officialSync.created
  result.updated += officialSync.updated
  result.officialFixturesCreated = officialSync.created
  result.officialFixturesUpdated = officialSync.updated
  result.warnings.push(...officialSync.warnings)
  result.fixtures.push(...officialSync.rows)

  // Determine which challenges to update
  const challengeIds: string[] = challengeId
    ? [challengeId]
    : await (prisma as any).worldCupBracketChallenge
        .findMany({
          where: { status: { in: ["open", "locked", "live"] } },
          select: { id: true },
        })
        .then((rows: Array<{ id: string }>) => rows.map((r) => r.id))

  // Build a round → [fixtures] map for fallback matching
  const byRound = new Map<WorldCupRound, WorldCupProviderFixture[]>()
  for (const f of providerFixtures) {
    const round = f.roundName
      ? normalizeWorldCupRound(f.roundName as string)
      : null
    if (!round) continue
    const arr = byRound.get(round) ?? []
    arr.push(f)
    byRound.set(round, arr)
  }

  // Infer earliest start time for lock time suggestion
  const starts = providerFixtures
    .map((f) => f.startsAt)
    .filter(Boolean)
    .sort()
  const earliestStart = starts[0] ?? null

  for (const cid of challengeIds) {
    const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
      where: { id: cid },
      select: {
        id: true,
        pickLockAt: true,
        matches: { orderBy: { matchNumber: "asc" } },
      },
    })
    if (!challenge) continue

    // Auto-infer lock time if not set
    if (
      !challenge.pickLockAt &&
      earliestStart &&
      !dryRun &&
      challengeId // only when explicit challenge is given to avoid mass-updates
    ) {
      await (prisma as any).worldCupBracketChallenge.update({
        where: { id: cid },
        data: { pickLockAt: new Date(earliestStart) },
      })
      result.lockTimeInferred = earliestStart
    } else if (!challenge.pickLockAt && earliestStart) {
      result.lockTimeInferred = earliestStart // report even on dry-run
    }

    for (const f of providerFixtures) {
      const round = f.roundName
        ? normalizeWorldCupRound(f.roundName as string)
        : null
      const apiFixtureId = Number(f.providerId)

      // Find existing match: by apiFixtureId first, then by round+slot
      let match = !Number.isNaN(apiFixtureId)
        ? (challenge.matches as any[]).find(
            (m: any) => m.apiFixtureId === apiFixtureId
          )
        : null

      if (!match && round) {
        const roundFixtures = byRound.get(round) ?? []
        const idx = roundFixtures.findIndex(
          (rf) => rf.providerId === f.providerId
        )
        match = (challenge.matches as any[]).find(
          (m: any) => m.round === round && m.roundIndex === idx + 1
        )
      }

      if (!match) {
        if (isBracketRound(round)) {
          result.fixtures.push({ providerId: f.providerId, action: "no_match" })
          result.skipped++
        }
        continue
      }

      if (!upsert) {
        result.fixtures.push({
          providerId: f.providerId,
          matchId: match.id,
          action: "skipped",
        })
        result.skipped++
        continue
      }

      // Resolve team DB IDs
      const homeApiId = f.homeProviderId
        ? Number(f.homeProviderId)
        : null
      const awayApiId = f.awayProviderId
        ? Number(f.awayProviderId)
        : null

      let homeTeamId: string | null = match.homeTeamId
      let awayTeamId: string | null = match.awayTeamId

      if (homeApiId && !Number.isNaN(homeApiId)) {
        const t = await (prisma as any).worldCupTeam.findUnique({
          where: { apiTeamId: homeApiId },
          select: { id: true },
        })
        if (t) homeTeamId = t.id
        else if (f.homeName) {
          // Auto-upsert team
          const created = await (prisma as any).worldCupTeam.upsert({
            where: { apiTeamId: homeApiId },
            create: {
              apiTeamId: homeApiId,
              name: f.homeName,
              country: f.homeName,
              flagUrl: f.homeLogo ?? null,
              logoUrl: f.homeLogo ?? null,
              qualificationStatus: "qualified",
            },
            update: {
              name: f.homeName,
              flagUrl: f.homeLogo ?? null,
              logoUrl: f.homeLogo ?? null,
            },
            select: { id: true },
          })
          homeTeamId = created.id
        }
      }

      if (awayApiId && !Number.isNaN(awayApiId)) {
        const t = await (prisma as any).worldCupTeam.findUnique({
          where: { apiTeamId: awayApiId },
          select: { id: true },
        })
        if (t) awayTeamId = t.id
        else if (f.awayName) {
          const created = await (prisma as any).worldCupTeam.upsert({
            where: { apiTeamId: awayApiId },
            create: {
              apiTeamId: awayApiId,
              name: f.awayName,
              country: f.awayName,
              flagUrl: f.awayLogo ?? null,
              logoUrl: f.awayLogo ?? null,
              qualificationStatus: "qualified",
            },
            update: {
              name: f.awayName,
              flagUrl: f.awayLogo ?? null,
              logoUrl: f.awayLogo ?? null,
            },
            select: { id: true },
          })
          awayTeamId = created.id
        }
      }

      // Resolve winner team ID
      let winnerTeamId: string | null = null
      if (f.winnerProviderId) {
        const wApiId = Number(f.winnerProviderId)
        if (!Number.isNaN(wApiId)) {
          const t = await (prisma as any).worldCupTeam.findUnique({
            where: { apiTeamId: wApiId },
            select: { id: true },
          })
          winnerTeamId = t?.id ?? null
        }
      }

      const normalStatus = normalizeProviderStatus(f.status)
      const updateData: Record<string, unknown> = {
        homeTeamId: homeTeamId ?? undefined,
        awayTeamId: awayTeamId ?? undefined,
        homeTeamName: f.homeName ?? undefined,
        awayTeamName: f.awayName ?? undefined,
        homeTeamLogo: f.homeLogo ?? undefined,
        awayTeamLogo: f.awayLogo ?? undefined,
        startsAt: f.startsAt ? new Date(f.startsAt) : undefined,
        venueName: f.venueName ?? undefined,
        venueCity: f.venueCity ?? undefined,
        status: normalStatus,
        apiStatusShort: f.apiStatusShort ?? undefined,
        winnerTeamId: winnerTeamId ?? undefined,
        winnerTeamName: f.winnerName ?? undefined,
        sourcePayload: f.raw ? (f.raw as object) : undefined,
        updatedAt: new Date(),
      }
      if (!Number.isNaN(apiFixtureId)) {
        updateData.apiFixtureId = apiFixtureId
      }

      if (dryRun) {
        result.fixtures.push({
          providerId: f.providerId,
          matchId: match.id,
          action: "updated",
        })
        result.updated++
        continue
      }

      await (prisma as any).worldCupBracketMatch.update({
        where: { id: match.id },
        data: updateData,
      })

      result.fixtures.push({
        providerId: f.providerId,
        matchId: match.id,
        action: "updated",
      })
      result.updated++
      result.bracketMatchesUpdated = (result.bracketMatchesUpdated ?? 0) + 1
    }
  }

  return result
}

// ── Live score sync ────────────────────────────────────────────────────────────

export type WorldCupLiveScoreSyncResult = {
  updated: number
  skipped: number
  finalMatches: number
  warnings: string[]
  recalculated: boolean
}

/**
 * Applies provider fixture rows to a challenge's matches (by apiFixtureId).
 * Shared by legacy single-provider sync and multi-provider fallback sync.
 */
export async function applyWorldCupLiveFixturesToChallenge(
  challengeId: string,
  liveFixtures: WorldCupProviderFixture[],
  options: { dryRun?: boolean; recalculate?: boolean } = {}
): Promise<WorldCupLiveScoreSyncResult> {
  const { dryRun = false, recalculate = true } = options

  const result: WorldCupLiveScoreSyncResult = {
    updated: 0,
    skipped: 0,
    finalMatches: 0,
    warnings: [],
    recalculated: false,
  }

  if (liveFixtures.length === 0) {
    result.warnings.push("No live/updated fixtures to apply.")
    return result
  }

  const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: { matches: { orderBy: { matchNumber: "asc" } } },
  })
  if (!challenge) {
    result.warnings.push(`Challenge ${challengeId} not found.`)
    return result
  }

  let hadFinalUpdate = false

  for (const f of liveFixtures) {
    const apiFixtureId = Number(f.providerId)
    const match = !Number.isNaN(apiFixtureId)
      ? (challenge.matches as any[]).find(
          (m: any) => m.apiFixtureId === apiFixtureId
        )
      : null

    if (!match) {
      result.skipped++
      continue
    }

    const normalStatus = normalizeProviderStatus(f.status)

    let winnerTeamId: string | null = match.winnerTeamId ?? null
    if (normalStatus === "final" && f.winnerProviderId) {
      const wApiId = Number(f.winnerProviderId)
      if (!Number.isNaN(wApiId)) {
        const t = await (prisma as any).worldCupTeam.findUnique({
          where: { apiTeamId: wApiId },
          select: { id: true },
        })
        winnerTeamId = t?.id ?? winnerTeamId
      }
    }

    const scoreData: Record<string, unknown> = {
      status: normalStatus,
      homeScore: f.homeScore ?? undefined,
      awayScore: f.awayScore ?? undefined,
      homePenaltyScore: f.homePenaltyScore ?? undefined,
      awayPenaltyScore: f.awayPenaltyScore ?? undefined,
      elapsedMinute: f.elapsedMinute ?? undefined,
      injuryTime: f.injuryTime ?? undefined,
      period: f.period ?? undefined,
      apiStatusShort: f.apiStatusShort ?? undefined,
      lastScoreSyncedAt: new Date(),
      updatedAt: new Date(),
    }
    if (normalStatus === "final") {
      scoreData.winnerTeamId = winnerTeamId
      scoreData.winnerTeamName = f.winnerName ?? undefined
      hadFinalUpdate = true
    }

    if (dryRun) {
      result.updated++
      if (normalStatus === "final") result.finalMatches++
      continue
    }

    const prevSnap = {
      id: match.id,
      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,
      status: typeof match.status === "string" ? match.status : "scheduled",
      apiStatusShort: match.apiStatusShort ?? null,
      homeSlotKey: match.homeSlotKey ?? null,
      awaySlotKey: match.awaySlotKey ?? null,
      homeTeamId: match.homeTeamId ?? null,
      awayTeamId: match.awayTeamId ?? null,
      winnerTeamId: match.winnerTeamId ?? null,
    }

    const updated = await (prisma as any).worldCupBracketMatch.update({
      where: { id: match.id },
      data: scoreData,
    })

    if (!dryRun) {
      emitWorldCupMatchTransitionEvents({
        challengeId,
        prev: prevSnap,
        match: {
          id: updated.id,
          homeTeamName: updated.homeTeamName,
          awayTeamName: updated.awayTeamName,
          status: typeof updated.status === "string" ? updated.status : normalStatus,
          apiStatusShort: updated.apiStatusShort ?? null,
          homeSlotKey: updated.homeSlotKey ?? null,
          awaySlotKey: updated.awaySlotKey ?? null,
          homeTeamId: updated.homeTeamId ?? null,
          awayTeamId: updated.awayTeamId ?? null,
          winnerTeamId: updated.winnerTeamId ?? null,
        },
      })
    }

    if (normalStatus === "final") {
      result.finalMatches++
      if (updated.nextMatchId && updated.nextMatchSlot && winnerTeamId) {
        const slot = updated.nextMatchSlot === "home" ? "home" : "away"
        await (prisma as any).worldCupBracketMatch.update({
          where: { id: updated.nextMatchId },
          data: {
            [`${slot}TeamId`]: winnerTeamId,
            [`${slot}TeamName`]: f.winnerName ?? undefined,
            [`${slot}TeamLogo`]:
              winnerTeamId === updated.homeTeamId
                ? updated.homeTeamLogo
                : updated.awayTeamLogo,
          },
        })
      }
    }

    result.updated++
  }

  if (!dryRun && hadFinalUpdate && recalculate) {
    try {
      await recalculateWorldCupChallenge(challengeId)
      result.recalculated = true
    } catch (err) {
      result.warnings.push(
        `Recalculation triggered but failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return result
}

export async function syncWorldCupLiveScores(
  options: WorldCupSyncOptions & {
    challengeId: string
    recalculate?: boolean
  }
): Promise<WorldCupLiveScoreSyncResult> {
  const { dryRun = false, challengeId, recalculate = true, seasonYear = 2026 } =
    options

  let liveFixtures: WorldCupProviderFixture[]
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    liveFixtures = provider.getLiveFixtures
      ? await provider.getLiveFixtures(seasonYear)
      : await provider.getFixtures(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      await recordWorldCupSyncState("world_cup_live_scores", options, {
        skipped: 0,
        error: err.message,
      })
      return {
        updated: 0,
        skipped: 0,
        finalMatches: 0,
        warnings: [err.message],
        recalculated: false,
      }
    }
    throw err
  }

  if (liveFixtures.length === 0) {
    await recordWorldCupSyncState("world_cup_live_scores", options, {
      skipped: 0,
      error: "No live/updated fixtures returned by provider.",
    })
    return {
      updated: 0,
      skipped: 0,
      finalMatches: 0,
      warnings: ["No live/updated fixtures returned by provider."],
      recalculated: false,
    }
  }

  const result = await applyWorldCupLiveFixturesToChallenge(challengeId, liveFixtures, {
    dryRun,
    recalculate,
  })
  await recordWorldCupSyncState("world_cup_live_scores", options, {
    updated: result.updated,
    skipped: result.skipped,
    error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
  })
  return result
}

/**
 * Fetch live fixtures ONCE for all active World Cup challenges, then fan out DB writes.
 * Replaces N per-challenge provider calls with a single API-Football call per cron tick.
 */
export async function syncWorldCupLiveScoresBatch(
  options: WorldCupSyncOptions & {
    challengeIds: string[]
    recalculate?: boolean
  }
): Promise<Array<{ challengeId: string; result: WorldCupLiveScoreSyncResult }>> {
  const { dryRun = false, challengeIds, recalculate = true, seasonYear = 2026 } = options

  const emptyFor = (warnings: string[]): WorldCupLiveScoreSyncResult => ({
    updated: 0,
    skipped: 0,
    finalMatches: 0,
    warnings,
    recalculated: false,
  })

  let liveFixtures: WorldCupProviderFixture[]
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    liveFixtures = provider.getLiveFixtures
      ? await provider.getLiveFixtures(seasonYear)
      : await provider.getFixtures(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      const result = emptyFor([err.message])
      await recordWorldCupSyncState("world_cup_live_scores", options, {
        skipped: 0,
        error: err.message,
      })
      return challengeIds.map((challengeId) => ({ challengeId, result }))
    }
    throw err
  }

  if (liveFixtures.length === 0) {
    const result = emptyFor(["No live/updated fixtures returned by provider."])
    await recordWorldCupSyncState("world_cup_live_scores", options, {
      skipped: 0,
      error: result.warnings[0],
    })
    return challengeIds.map((challengeId) => ({ challengeId, result }))
  }

  const results = await Promise.all(
    challengeIds.map(async (challengeId) => ({
      challengeId,
      result: await applyWorldCupLiveFixturesToChallenge(challengeId, liveFixtures, {
        dryRun,
        recalculate,
      }),
    }))
  )
  await recordWorldCupSyncState("world_cup_live_scores", options, {
    updated: results.reduce((sum, row) => sum + row.result.updated, 0),
    skipped: results.reduce((sum, row) => sum + row.result.skipped, 0),
    error: results.flatMap((row) => row.result.warnings).slice(0, 3).join("; ") || null,
  })
  return results
}

export async function syncWorldCupProviderGroupStandings(
  options: WorldCupSyncOptions & { challengeId: string }
): Promise<WorldCupGroupStandingsSyncResult> {
  const seasonYear = options.seasonYear ?? 2026
  const providerName = providerNameFor(options)
  const result: WorldCupGroupStandingsSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
    groupsComplete: false,
    thirdPlaceAdvancers: [],
    standings: [],
  }

  let providerStandings: WorldCupProviderGroupStanding[]
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    if (!provider.getGroupStandings) {
      result.warnings.push("standings_not_available_yet: provider does not expose group standings.")
      await recordWorldCupSyncState("world_cup_standings", options, {
        skipped: 0,
        error: result.warnings[0],
      })
      return result
    }
    providerStandings = await provider.getGroupStandings(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      result.warnings.push(err.message)
      await recordWorldCupSyncState("world_cup_standings", options, {
        skipped: 0,
        error: err.message,
      })
      return result
    }
    throw err
  }

  if (providerStandings.length === 0) {
    result.warnings.push("standings_not_available_yet: provider returned 0 group standings rows.")
    await recordWorldCupSyncState("world_cup_standings", options, {
      skipped: 0,
      error: result.warnings[0],
    })
    return result
  }

  for (const standing of providerStandings) {
    const teamId = await findTeamIdByProviderOrName({
      providerId: standing.providerTeamId,
      fifaCode: standing.fifaCode,
      name: standing.teamName,
    })

    if (!teamId) {
      result.skipped++
      result.standings.push({
        teamName: standing.teamName,
        groupName: standing.groupName,
        rank: standing.rank,
        action: "skipped",
      })
      result.warnings.push(`Standing ${standing.groupName} ${standing.teamName}: team not found.`)
      continue
    }

    try {
      const existing = await (prisma as any).worldCupOfficialGroupStanding.findUnique({
        where: {
          providerName_seasonYear_groupName_teamId: {
            providerName,
            seasonYear,
            groupName: standing.groupName,
            teamId,
          },
        },
        select: { id: true },
      })

      if (options.dryRun) {
        result.standings.push({
          teamId,
          teamName: standing.teamName,
          groupName: standing.groupName,
          rank: standing.rank,
          action: existing ? "updated" : "created",
        })
        if (existing) result.updated++
        else result.created++
        continue
      }

      await (prisma as any).worldCupOfficialGroupStanding.upsert({
        where: {
          providerName_seasonYear_groupName_teamId: {
            providerName,
            seasonYear,
            groupName: standing.groupName,
            teamId,
          },
        },
        create: {
          providerName,
          seasonYear,
          tournamentKey: WORLD_CUP_TOURNAMENT_KEY,
          groupName: standing.groupName,
          teamId,
          providerTeamId: standing.providerTeamId ?? null,
          teamName: standing.teamName,
          actualRank: standing.rank,
          points: standing.points,
          goalDifference: standing.goalDifference,
          goalsFor: standing.goalsFor,
          goalsAgainst: standing.goalsAgainst ?? 0,
          played: standing.played ?? 0,
          wins: standing.wins ?? 0,
          draws: standing.draws ?? 0,
          losses: standing.losses ?? 0,
          sourcePayload: standing.raw ? (standing.raw as object) : undefined,
        },
        update: {
          providerTeamId: standing.providerTeamId ?? null,
          teamName: standing.teamName,
          actualRank: standing.rank,
          points: standing.points,
          goalDifference: standing.goalDifference,
          goalsFor: standing.goalsFor,
          goalsAgainst: standing.goalsAgainst ?? 0,
          played: standing.played ?? 0,
          wins: standing.wins ?? 0,
          draws: standing.draws ?? 0,
          losses: standing.losses ?? 0,
          sourcePayload: standing.raw ? (standing.raw as object) : undefined,
          updatedAt: new Date(),
        },
      })

      result.standings.push({
        teamId,
        teamName: standing.teamName,
        groupName: standing.groupName,
        rank: standing.rank,
        action: existing ? "updated" : "created",
      })
      if (existing) result.updated++
      else result.created++
    } catch (err) {
      result.standings.push({
        teamId,
        teamName: standing.teamName,
        groupName: standing.groupName,
        rank: standing.rank,
        action: "error",
      })
      result.warnings.push(`Standing ${standing.groupName} ${standing.teamName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  result.groupsComplete = groupStandingsComplete(providerStandings)
  if (!result.groupsComplete) {
    result.warnings.push("standings_not_available_yet: complete 12-group standings are not available.")
    await recordWorldCupSyncState("world_cup_standings", options, {
      imported: result.created,
      updated: result.updated,
      skipped: result.skipped,
      error: result.warnings.slice(0, 3).join("; "),
    })
    return result
  }

  const byGroup: Record<string, WorldCupGroupStanding[]> = {}
  for (const row of result.standings) {
    if (!row.teamId || row.action === "skipped" || row.action === "error") continue
    const providerRow = providerStandings.find((standing) => standing.groupName === row.groupName && standing.rank === row.rank && standing.teamName === row.teamName)
    if (!providerRow) continue
    byGroup[row.groupName] = byGroup[row.groupName] ?? []
    byGroup[row.groupName].push({
      group: row.groupName,
      teamId: row.teamId,
      teamName: row.teamName,
      points: providerRow.points,
      goalDifference: providerRow.goalDifference,
      goalsFor: providerRow.goalsFor,
    })
  }

  const advancers = getBestThirdPlaceTeams(byGroup).slice(0, 8)
  result.thirdPlaceAdvancers = advancers.map((row) => ({
    teamId: row.teamId,
    teamName: row.teamName,
    groupName: row.group,
  }))

  if (!options.dryRun) {
    await (prisma as any).worldCupOfficialGroupStanding.updateMany({
      where: { providerName, seasonYear },
      data: { isThirdPlaceAdvancer: false },
    })
    if (result.thirdPlaceAdvancers.length > 0) {
      await (prisma as any).worldCupOfficialGroupStanding.updateMany({
        where: {
          providerName,
          seasonYear,
          teamId: { in: result.thirdPlaceAdvancers.map((row) => row.teamId) },
        },
        data: { isThirdPlaceAdvancer: true },
      })
    }
  }

  if (result.thirdPlaceAdvancers.length !== 8) {
    result.warnings.push(`Expected 8 third-place advancers, found ${result.thirdPlaceAdvancers.length}.`)
  }

  await recordWorldCupSyncState("world_cup_standings", options, {
    imported: result.created,
    updated: result.updated,
    skipped: result.skipped,
    error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
  })

  await recordWorldCupSyncState("world_cup_teams", options, {
    imported: result.created,
    updated: result.updated,
    skipped: result.skipped,
    error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
  })

  return result
}

// ── Status normalization (internal) ───────────────────────────────────────────

/**
 * Maps provider status strings to the internal WorldCupMatchStatus type.
 * Exported for use in admin tools; canonical display formatting is in worldCupMatchStatus.ts.
 */
async function notifyWorldCupInjuryAffectedPicks(input: {
  injury: WorldCupProviderInjury
  reportDate: Date
  sourceProvider: string
}) {
  const teamName = normalizeInjuryText(input.injury.teamName, "")
  if (!teamName) return 0

  const entries = await (prisma as any).worldCupBracketEntry.findMany({
    where: {
      challenge: { status: { in: ["open", "locked", "live"] } },
      OR: [
        { championTeamName: { equals: teamName, mode: "insensitive" } },
        { picks: { some: { selectedTeamName: { equals: teamName, mode: "insensitive" } } } },
        { groupRankingPicks: { some: { team: { name: { equals: teamName, mode: "insensitive" } } } } },
      ],
    },
    select: {
      id: true,
      userId: true,
      challengeId: true,
      name: true,
      challenge: {
        select: {
          id: true,
          name: true,
          ownerUserId: true,
        },
      },
    },
    take: 250,
  }) as Array<{
    id: string
    userId: string
    challengeId: string
    name: string
    challenge?: { id: string; name?: string | null; ownerUserId?: string | null } | null
  }>

  let created = 0
  for (const entry of entries) {
    const recipients = Array.from(new Set([entry.userId, entry.challenge?.ownerUserId].filter(Boolean))) as string[]
    for (const userId of recipients) {
      const wasCreated = await createPlatformNotification({
        userId,
        productType: "bracket",
        type: "world_cup_injury_update",
        title: `World Cup injury update: ${input.injury.playerName}`,
        body: `${input.injury.playerName} (${teamName}) is listed as ${input.injury.status}. This may affect picks in ${entry.challenge?.name ?? "your World Cup pool"}.`,
        severity: "medium",
        sourceKey: [
          "world-cup-injury",
          input.sourceProvider,
          input.injury.providerPlayerId,
          input.injury.status,
          input.reportDate.toISOString().slice(0, 10),
          entry.challengeId,
          userId,
        ].join(":"),
        meta: {
          challengeId: entry.challengeId,
          entryId: entry.id,
          teamName,
          playerName: input.injury.playerName,
          status: input.injury.status,
          bodyPart: input.injury.bodyPart ?? null,
          fixtureProviderId: input.injury.fixtureProviderId ?? null,
          sourceProvider: input.sourceProvider,
        },
      })
      if (wasCreated) created++
    }
  }

  return created
}

export async function syncWorldCupInjuries(
  options: WorldCupSyncOptions = {}
): Promise<WorldCupInjurySyncResult> {
  const { dryRun = false, seasonYear = 2026 } = options
  const sourceProvider = providerNameFor(options)
  const result: WorldCupInjurySyncResult = {
    created: 0,
    changed: 0,
    skipped: 0,
    notificationsCreated: 0,
    warnings: [],
    injuries: [],
  }

  let providerInjuries: WorldCupProviderInjury[] = []
  try {
    const provider = await getWorldCupDataProvider(options.provider)
    if (!provider.getInjuries) {
      result.warnings.push("injuries_not_available_yet: provider does not expose World Cup injury data.")
      await recordProviderSync(
        { provider: sourceProvider, entityType: "world_cup_injuries", sport: "WC_SOCCER", key: String(seasonYear) },
        { recordsImported: 0, recordsUpdated: 0, recordsSkipped: 0 }
      )
      return result
    }
    providerInjuries = await provider.getInjuries(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      result.warnings.push(err.message)
      await recordProviderSync(
        { provider: sourceProvider, entityType: "world_cup_injuries", sport: "WC_SOCCER", key: String(seasonYear) },
        { recordsImported: 0, recordsUpdated: 0, recordsSkipped: 0, error: err.message }
      )
      return result
    }
    await recordProviderSync(
      { provider: sourceProvider, entityType: "world_cup_injuries", sport: "WC_SOCCER", key: String(seasonYear) },
      { recordsImported: 0, recordsUpdated: 0, recordsSkipped: 0, error: err instanceof Error ? err.message : String(err) }
    )
    throw err
  }

  if (providerInjuries.length === 0) {
    result.warnings.push("injuries_not_available_yet: provider returned 0 injury rows.")
    await recordProviderSync(
      { provider: sourceProvider, entityType: "world_cup_injuries", sport: "WC_SOCCER", key: String(seasonYear) },
      { recordsImported: 0, recordsUpdated: 0, recordsSkipped: 0 }
    )
    return result
  }

  for (const injury of providerInjuries) {
    const playerId = normalizeInjuryText(injury.providerPlayerId, "")
    const playerName = normalizeInjuryText(injury.playerName, "")
    const teamName = normalizeInjuryText(injury.teamName, "").slice(0, 32)
    const status = normalizeInjuryText(injury.status, "injured").slice(0, 32)
    if (!playerId || !playerName || !teamName) {
      result.skipped++
      result.injuries.push({
        playerName: playerName || "Unknown",
        teamName: teamName || "Unknown",
        status,
        action: "skipped",
      })
      continue
    }

    const reportDate = parseProviderReportDate(injury.fixtureDate)
    try {
      const previous = await (prisma as any).injuryReportRecord.findFirst({
        where: {
          sport: "WC_SOCCER",
          playerId,
        },
        orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
        select: { id: true, status: true, notes: true },
      }) as { id: string; status: string | null; notes: string | null } | null
      const changed = injuryStatusChanged(previous, { ...injury, status })

      if (dryRun) {
        result.injuries.push({ playerName, teamName, status, action: previous ? (changed ? "changed" : "skipped") : "created" })
        if (!previous) result.created++
        else if (changed) result.changed++
        else result.skipped++
        continue
      }

      await (prisma as any).injuryReportRecord.upsert({
        where: {
          uniq_injury_reports_player_report_status: {
            sport: "WC_SOCCER",
            playerId,
            reportDate,
            status,
          },
        },
        create: {
          sport: "WC_SOCCER",
          playerId,
          playerName,
          team: teamName,
          status,
          bodyPart: normalizeInjuryText(injury.bodyPart, "").slice(0, 64) || null,
          notes: normalizeInjuryText(injury.notes, ""),
          gameStatus: injury.fixtureProviderId ? `fixture:${injury.fixtureProviderId}`.slice(0, 32) : null,
          reportDate,
          week: null,
        },
        update: {
          playerName,
          team: teamName,
          bodyPart: normalizeInjuryText(injury.bodyPart, "").slice(0, 64) || null,
          notes: normalizeInjuryText(injury.notes, ""),
          gameStatus: injury.fixtureProviderId ? `fixture:${injury.fixtureProviderId}`.slice(0, 32) : null,
        },
      })

      if (!previous) {
        result.created++
        result.injuries.push({ playerName, teamName, status, action: "created" })
      } else if (changed) {
        result.changed++
        result.injuries.push({ playerName, teamName, status, action: "changed" })
      } else {
        result.skipped++
        result.injuries.push({ playerName, teamName, status, action: "skipped" })
      }

      if (!previous || changed) {
        result.notificationsCreated += await notifyWorldCupInjuryAffectedPicks({
          injury: { ...injury, playerName, teamName, status },
          reportDate,
          sourceProvider,
        })
      }
    } catch (err) {
      result.injuries.push({ playerName, teamName, status, action: "error" })
      result.warnings.push(`Injury ${playerName} (${teamName}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  await recordProviderSync(
    { provider: sourceProvider, entityType: "world_cup_injuries", sport: "WC_SOCCER", key: String(seasonYear) },
    {
      recordsImported: result.created,
      recordsUpdated: result.changed,
      recordsSkipped: result.skipped,
      error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
    }
  )

  await recordWorldCupSyncState("world_cup_fixtures", options, {
    imported: result.officialFixturesCreated ?? result.created,
    updated: (result.officialFixturesUpdated ?? 0) + (result.bracketMatchesUpdated ?? 0),
    skipped: result.skipped,
    error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
  })

  return result
}

export function normalizeProviderStatus(
  raw?: string | null
): "scheduled" | "live" | "halftime" | "final" | "postponed" | "cancelled" {
  if (!raw) return "scheduled"
  const s = raw.toLowerCase().trim()
  if (s === "final" || s === "ft" || s === "aet" || s === "pen" || s === "ft_pen") return "final"
  if (s === "halftime" || s === "ht") return "halftime"
  if (s === "live" || s === "1h" || s === "2h" || s === "extra_time" || s === "et" || s === "penalties") return "live"
  if (s === "postponed" || s === "pst" || s === "susp" || s === "suspended" || s === "int") return "postponed"
  if (s === "cancelled" || s === "canc" || s === "abd" || s === "awd" || s === "wo") return "cancelled"
  // tbd, scheduled, ns, upcoming all map to scheduled
  return "scheduled"
}

// ── Roster sync ───────────────────────────────────────────────────────────────

export type WorldCupRosterSyncResult = {
  created: number
  updated: number
  skipped: number
  teams: number
  warnings: string[]
}

export async function syncWorldCupRosters(
  options: WorldCupSyncOptions = {}
): Promise<WorldCupRosterSyncResult> {
  const { dryRun = false, seasonYear = 2026 } = options
  const result: WorldCupRosterSyncResult = { created: 0, updated: 0, skipped: 0, teams: 0, warnings: [] }

  const provider = await getWorldCupDataProvider(options.provider)
  if (!provider.getSquads) {
    result.warnings.push(`Provider "${provider.name}" does not implement getSquads().`)
    return result
  }

  let squads
  try {
    squads = await provider.getSquads(seasonYear)
  } catch (err) {
    if (err instanceof WorldCupProviderConfigError) {
      result.warnings.push(err.message)
      return result
    }
    throw err
  }

  if (squads.length === 0) {
    result.warnings.push("Provider returned 0 squads. Check provider configuration and season year.")
    return result
  }

  result.teams = squads.length

  for (const squad of squads) {
    const apiTeamId = !Number.isNaN(Number(squad.providerTeamId)) ? Number(squad.providerTeamId) : null
    const teamRow = apiTeamId
      ? await (prisma as any).worldCupTeam.findUnique({ where: { apiTeamId }, select: { id: true } }).catch(() => null)
      : await (prisma as any).worldCupTeam.findFirst({ where: { name: { contains: squad.teamName, mode: "insensitive" } }, select: { id: true } }).catch(() => null)

    if (!teamRow) {
      result.warnings.push(`Team not found for squad: ${squad.teamName} (${squad.providerTeamId}) — run team sync first.`)
      continue
    }

    const teamId: string = teamRow.id
    const sourceProvider = provider.name

    for (const player of squad.players) {
      try {
        const existing = await (prisma as any).worldCupPlayer.findUnique({
          where: { uniq_wc_player_provider: { providerPlayerId: player.providerPlayerId, sourceProvider } },
          select: { id: true },
        }).catch(() => null)

        if (dryRun) {
          if (existing) result.updated++
          else result.created++
          continue
        }

        const upsertData = {
          teamId,
          name: player.name,
          shortName: player.shortName ?? null,
          position: player.position ?? null,
          positionCode: player.positionCode ?? null,
          shirtNumber: player.shirtNumber ?? null,
          age: player.age ?? null,
          photoUrl: player.photoUrl ?? null,
          isCaptain: player.isCaptain ?? false,
          isActive: true,
          sourcePayload: (player.raw as object) ?? undefined,
          lastSyncedAt: new Date(),
        }

        if (existing) {
          await (prisma as any).worldCupPlayer.update({
            where: { id: existing.id },
            data: { ...upsertData, updatedAt: new Date() },
          })
          result.updated++
        } else {
          await (prisma as any).worldCupPlayer.create({
            data: { providerPlayerId: player.providerPlayerId, sourceProvider, ...upsertData },
          })
          result.created++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.warnings.push(`Player ${player.name} (${player.providerPlayerId}): ${msg}`)
        result.skipped++
      }
    }
  }

  await recordProviderSync(
    { provider: provider.name, entityType: "world_cup_rosters", sport: "WC_SOCCER", key: String(seasonYear) },
    {
      recordsImported: result.created,
      recordsUpdated: result.updated,
      recordsSkipped: result.skipped,
      error: result.warnings.length > 0 ? result.warnings.slice(0, 3).join("; ") : null,
    }
  )

  return result
}
