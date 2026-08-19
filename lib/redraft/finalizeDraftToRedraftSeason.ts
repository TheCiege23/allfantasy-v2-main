import { prisma } from '@/lib/prisma'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { buildRedraftOwnerIdCandidates } from '@/lib/redraft/redraftRosterIdentity'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { leagueSportToConfigSport } from '@/lib/redraft/sportKey'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { getPlatformEvents, EVENT } from '@/lib/events'

export type RedraftDraftFinalizationSummary = {
  skipped: boolean
  reason?: string
  seasonId?: string
  redraftRostersCreated: number
  redraftPlayersCreated: number
  redraftPlayersAlreadyPresent: number
  skippedPicks: number
}

const EMPTY_SUMMARY: RedraftDraftFinalizationSummary = {
  skipped: true,
  redraftRostersCreated: 0,
  redraftPlayersCreated: 0,
  redraftPlayersAlreadyPresent: 0,
  skippedPicks: 0,
}

type DraftPickForRedraftSync = {
  id: string
  overall: number
  round: number
  rosterId: string
  playerId: string | null
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  pickMetadata?: unknown | null
}

function currentSeasonYear(): number {
  return new Date().getFullYear()
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stablePlayerId(sessionId: string, pick: DraftPickForRedraftSync): string {
  const raw = String(pick.playerId ?? '').trim()
  if (raw) return raw

  const normalizedName = pick.playerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  const normalizedPosition = pick.position
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 24)

  return `draft:${sessionId}:${pick.overall}:${normalizedName || 'player'}:${normalizedPosition || 'pos'}`
}

function textMatchesPick(value: unknown, pick: DraftPickForRedraftSync): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  if (!v) return false

  const playerId = String(pick.playerId ?? '').trim().toLowerCase()
  const playerName = pick.playerName.trim().toLowerCase()

  return Boolean(
    (playerId && v === playerId) ||
    (playerName && v === playerName),
  )
}

function objectMatchesPick(value: unknown, pick: DraftPickForRedraftSync): boolean {
  const obj = objectRecord(value)
  if (!Object.keys(obj).length) return false

  const playerId = String(pick.playerId ?? '').trim().toLowerCase()
  const playerName = pick.playerName.trim().toLowerCase()

  const candidates = [
    obj.playerId,
    obj.player_id,
    obj.id,
    obj.playerName,
    obj.player_name,
    obj.name,
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)

  return candidates.some((candidate) => {
    return Boolean(
      (playerId && candidate === playerId) ||
      (playerName && candidate === playerName),
    )
  })
}

function normalizeSlotType(sectionName: string, pick: DraftPickForRedraftSync): string {
  const s = sectionName.trim().toLowerCase()
  if (!s) return 'bench'
  if (s === 'starters' || s === 'starter') return pick.position || 'starter'
  if (s === 'lineup') return pick.position || 'starter'
  if (s === 'bench' || s === 'bn') return 'bench'
  if (s === 'reserve') return 'bench'
  if (s === 'taxi') return 'taxi'
  if (s === 'ir') return 'ir'
  if (s === 'devy') return 'devy'
  return s
}

function inferSlotTypeFromGenericRosterPlayerData(
  playerData: unknown,
  pick: DraftPickForRedraftSync,
): string {
  const data = objectRecord(playerData)

  const starters = data.starters
  if (Array.isArray(starters) && starters.some((entry) => textMatchesPick(entry, pick) || objectMatchesPick(entry, pick))) {
    return pick.position || 'starter'
  }

  const lineupSections = objectRecord(data.lineup_sections ?? data.lineupSections)
  for (const [sectionName, sectionValue] of Object.entries(lineupSections)) {
    if (!Array.isArray(sectionValue)) continue
    if (sectionValue.some((entry) => textMatchesPick(entry, pick) || objectMatchesPick(entry, pick))) {
      return normalizeSlotType(sectionName, pick)
    }
  }

  return 'bench'
}

async function ensureRedraftSeason(leagueId: string) {
  const existing = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { season: existing, created: false }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      season: true,
      medianGame: true,
    },
  })
  if (!league) throw new Error('League not found')

  const sportKey = leagueSportToConfigSport(String(league.sport ?? 'NFL'))
  const cfg = tryGetSportConfig(sportKey)
  const seasonYear = Number(league.season ?? currentSeasonYear()) || currentSeasonYear()
  const totalWeeks = cfg?.defaultSeasonWeeks ?? 17
  const playoffStartWeek = cfg?.defaultPlayoffStartWeek ?? 15

  const season = await prisma.redraftSeason.create({
    data: {
      leagueId,
      sport: sportKey,
      season: seasonYear,
      status: 'active',
      totalWeeks,
      playoffStartWeek,
      currentWeek: 1,
      medianGame: Boolean(league.medianGame ?? false),
    },
  })

  return { season, created: true }
}

async function ensureRedraftRosterForGenericRoster(params: {
  seasonId: string
  leagueId: string
  genericRosterId: string
}) {
  const genericRoster = await prisma.roster.findFirst({
    where: { id: params.genericRosterId, leagueId: params.leagueId },
    select: {
      id: true,
      platformUserId: true,
      playerData: true,
      faabRemaining: true,
      waiverPriority: true,
    },
  })

  if (!genericRoster) return { redraftRoster: null, created: false, genericRoster: null }

  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId: params.leagueId,
      OR: [
        { externalId: genericRoster.id },
        { platformUserId: genericRoster.platformUserId },
        { claimedByUserId: genericRoster.platformUserId },
      ],
    },
    select: {
      ownerName: true,
      teamName: true,
      avatarUrl: true,
      claimedByUserId: true,
      platformUserId: true,
    },
  })

  const ownerId =
    String(team?.claimedByUserId ?? team?.platformUserId ?? genericRoster.platformUserId ?? '').trim() ||
    `roster:${genericRoster.id}`

  const ownerIdCandidates = buildRedraftOwnerIdCandidates({
    preferredOwnerId: ownerId,
    claimedByUserId: team?.claimedByUserId,
    teamPlatformUserId: team?.platformUserId,
    genericRosterPlatformUserId: genericRoster.platformUserId,
    genericRosterId: genericRoster.id,
  })

  const existing = await prisma.redraftRoster.findFirst({
    where: {
      seasonId: params.seasonId,
      ownerId: { in: ownerIdCandidates },
    },
  })

  if (existing) {
    if (existing.ownerId !== ownerId) {
      const conflict = await prisma.redraftRoster.findFirst({
        where: {
          seasonId: params.seasonId,
          ownerId,
          NOT: { id: existing.id },
        },
        select: { id: true },
      })

      if (!conflict) {
        const repaired = await prisma.redraftRoster.update({
          where: { id: existing.id },
          data: {
            ownerId,
            ownerName: team?.ownerName ?? existing.ownerName,
            teamName: team?.teamName ?? team?.ownerName ?? existing.teamName,
            avatarUrl: team?.avatarUrl ?? existing.avatarUrl,
            faabBalance: genericRoster.faabRemaining ?? existing.faabBalance,
            waiverPriority: genericRoster.waiverPriority ?? existing.waiverPriority,
          },
        })
        return { redraftRoster: repaired, created: false, genericRoster }
      }
    }

    const refreshed = await prisma.redraftRoster.update({
      where: { id: existing.id },
      data: {
        ownerName: team?.ownerName ?? existing.ownerName,
        teamName: team?.teamName ?? team?.ownerName ?? existing.teamName,
        avatarUrl: team?.avatarUrl ?? existing.avatarUrl,
        faabBalance: genericRoster.faabRemaining ?? existing.faabBalance,
        waiverPriority: genericRoster.waiverPriority ?? existing.waiverPriority,
      },
    })
    return { redraftRoster: refreshed, created: false, genericRoster }
  }

  const redraftRoster = await prisma.redraftRoster.create({
    data: {
      seasonId: params.seasonId,
      leagueId: params.leagueId,
      ownerId,
      ownerName: team?.ownerName ?? `Team ${genericRoster.id.slice(0, 6)}`,
      teamName: team?.teamName ?? team?.ownerName ?? `Team ${genericRoster.id.slice(0, 6)}`,
      avatarUrl: team?.avatarUrl ?? null,
      faabBalance: genericRoster.faabRemaining ?? 100,
      waiverPriority: genericRoster.waiverPriority ?? 0,
    },
  })

  return { redraftRoster, created: true, genericRoster }
}

async function ensureScheduleForNewSeason(params: {
  seasonId: string
  leagueId: string
  sport: string
  totalWeeks: number
  playoffStartWeek: number
  medianGame: boolean
}) {
  const existingScheduleCount = await prisma.redraftMatchup.count({
    where: { seasonId: params.seasonId },
  })
  if (existingScheduleCount > 0) return

  // RedraftRoster has no createdAt column; order by id (cuid, roughly
  // creation-ordered) for a deterministic, schema-valid roster sequence so the
  // round-robin schedule is reproducible across runs.
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: params.seasonId },
    select: { id: true },
    orderBy: { id: 'asc' },
  })

  if (rosters.length < 2) return

  const slots = generateSchedule(
    rosters,
    params.totalWeeks,
    params.playoffStartWeek,
    params.sport,
    { medianGame: params.medianGame },
  )

  const rows = slots
    .filter((slot) => slot.type !== 'median')
    .map((slot) => ({
      seasonId: params.seasonId,
      leagueId: params.leagueId,
      week: slot.week,
      type: 'regular',
      homeRosterId: slot.home,
      awayRosterId: slot.away,
      isMedianMatchup: false,
    }))

  if (rows.length > 0) {
    await prisma.redraftMatchup.createMany({ data: rows })
  }
}

/**
 * Bridges the completed canonical DraftSession into redraft season tables.
 *
 * The live draft room already persists DraftPick rows and generic Roster.playerData.
 * Redraft tabs, waivers, trades, scoring, and lineup APIs read RedraftSeason /
 * RedraftRoster / RedraftRosterPlayer. This service keeps those systems aligned.
 *
 * Idempotent: safe to run after draft completion, from post-draft summary reads,
 * or by repair jobs. It does not duplicate active RedraftRosterPlayer rows.
 */
export async function syncCompletedDraftToRedraftSeason(
  leagueId: string,
): Promise<RedraftDraftFinalizationSummary> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, leagueType: true, isDynasty: true },
  })

  if (!league) return { ...EMPTY_SUMMARY, reason: 'league_not_found' }

  const isRedraft =
    String(league.leagueType ?? '').toLowerCase() === 'redraft' ||
    league.isDynasty === false

  if (!isRedraft) {
    return { ...EMPTY_SUMMARY, reason: 'not_redraft_league' }
  }

  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: {
      picks: { orderBy: { overall: 'asc' } },
    },
  })

  if (!session) return { ...EMPTY_SUMMARY, reason: 'draft_session_not_found' }
  if (session.status !== 'completed') return { ...EMPTY_SUMMARY, reason: 'draft_not_completed' }

  const { season } = await ensureRedraftSeason(leagueId)

  let redraftRostersCreated = 0
  let redraftPlayersCreated = 0
  let redraftPlayersAlreadyPresent = 0
  let skippedPicks = 0

  const redraftRosterByGenericRosterId = new Map<string, Awaited<ReturnType<typeof ensureRedraftRosterForGenericRoster>>>()

  for (const pick of session.picks as DraftPickForRedraftSync[]) {
    if (
      isDraftPickRowEmpty({
        playerName: pick.playerName,
        position: pick.position,
        pickMetadata: pick.pickMetadata ?? null,
      })
    ) {
      skippedPicks += 1
      continue
    }

    let mapping = redraftRosterByGenericRosterId.get(pick.rosterId)
    if (!mapping) {
      mapping = await ensureRedraftRosterForGenericRoster({
        seasonId: season.id,
        leagueId,
        genericRosterId: pick.rosterId,
      })
      redraftRosterByGenericRosterId.set(pick.rosterId, mapping)
      if (mapping.created) redraftRostersCreated += 1
    }

    if (!mapping.redraftRoster) {
      skippedPicks += 1
      continue
    }

    const playerId = stablePlayerId(session.id, pick)

    const existingActive = await prisma.redraftRosterPlayer.findFirst({
      where: {
        rosterId: mapping.redraftRoster.id,
        playerId,
        droppedAt: null,
      },
      select: { id: true },
    })

    if (existingActive) {
      redraftPlayersAlreadyPresent += 1
      continue
    }

    const slotType = inferSlotTypeFromGenericRosterPlayerData(mapping.genericRoster?.playerData ?? null, pick)

    await prisma.redraftRosterPlayer.create({
      data: {
        rosterId: mapping.redraftRoster.id,
        playerId,
        playerName: pick.playerName,
        position: pick.position || 'UNK',
        team: pick.team ?? null,
        sport: season.sport || String(session.sportType ?? 'NFL'),
        slotType,
        byeWeek: pick.byeWeek ?? null,
        acquisitionType: 'drafted',
      },
    })

    redraftPlayersCreated += 1
  }

  if (season.status === 'setup' || season.currentWeek === 0) {
    await prisma.redraftSeason.update({
      where: { id: season.id },
      data: {
        status: 'active',
        currentWeek: Math.max(1, season.currentWeek ?? 1),
      },
    })
  }

  await ensureScheduleForNewSeason({
    seasonId: season.id,
    leagueId,
    sport: season.sport,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: season.playoffStartWeek,
    medianGame: season.medianGame,
  }).catch((err) => {
    console.warn('[syncCompletedDraftToRedraftSeason] schedule sync skipped', {
      leagueId,
      seasonId: season.id,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  // G15.2 / G12: DRAFT_COMPLETED is now emitted generically from completeDraftSession
  // (all league types). SEASON_ACTIVATED remains here — it carries the season-specific
  // payload and is Redraft-concept-specific.
  const events = getPlatformEvents()
  await events.emit(EVENT.SEASON_ACTIVATED, {
    leagueId,
    seasonId: season.id,
    sport: season.sport ?? null,
    leagueConcept: 'redraft',
    actor: { type: 'system' },
    idempotencyKey: `season.activated:${season.id}`,
    source: 'engine:draft-finalize',
    subjects: [{ kind: 'season', id: season.id }],
    payload: { seasonId: season.id, season: season.season ?? undefined },
  })

  return {
    skipped: false,
    seasonId: season.id,
    redraftRostersCreated,
    redraftPlayersCreated,
    redraftPlayersAlreadyPresent,
    skippedPicks,
  }
}
