import crypto from 'crypto'
import { getNativeLeagueMock } from '@/lib/mock-draft/native-league'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getLeagueDrafts,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueUsers,
  getScoringType,
  type SleeperRoster,
} from '@/lib/sleeper-client'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

type LeagueMockRecord = {
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

type LeagueMockManager = {
  slot: number
  rosterId: number
  managerId: string
  managerName: string
  avatarUrl: string | null
  isUser: boolean
  slotPredicted: boolean
  role: string | null
  isOrphan: boolean
  record: LeagueMockRecord
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function buildSleeperAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null
  return `https://sleepercdn.com/avatars/${avatar}`
}

function inferSuperflex(value: unknown): boolean {
  const raw = recordFromUnknown(value)
  if (!raw) return false

  const explicitFlags = [
    raw.superflex,
    raw.isSuperflex,
    raw.sf,
    raw.super_flex,
  ]
  if (explicitFlags.some((entry) => entry === true || numberFromUnknown(entry) === 1)) {
    return true
  }

  const slots = [
    ...arrayFromUnknown(raw.roster_positions),
    ...arrayFromUnknown(raw.starters),
  ]

  return slots.some((slot) => {
    const value = stringFromUnknown(slot)
    if (!value) return false
    const normalized = value.toUpperCase()
    return normalized === 'SUPER_FLEX' || normalized === 'SUPERFLEX' || normalized === 'OP'
  })
}

function inferRoundsFromLeagueSettings(value: unknown): number | null {
  const raw = recordFromUnknown(value)
  if (!raw) return null

  const candidates = [
    raw.rounds,
    raw.draft_rounds,
    raw.round_count,
    raw.total_rounds,
  ]

  for (const candidate of candidates) {
    const numeric = numberFromUnknown(candidate)
    if (numeric && numeric > 0) return numeric
  }

  return null
}

function normalizeDraftType(value: unknown): 'snake' | 'linear' | 'auction' {
  const normalized = stringFromUnknown(value)?.toLowerCase()
  if (normalized === 'auction') return 'auction'
  if (normalized === 'linear') return 'linear'
  return 'snake'
}

function normalizeScoringLabel(value: string | null | undefined): 'PPR' | 'Half PPR' | 'Standard' | 'Points' | 'Categories' {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (normalized.includes('half')) return 'Half PPR'
  if (normalized.includes('ppr')) return 'PPR'
  if (normalized.includes('categorie')) return 'Categories'
  if (normalized.includes('point')) return 'Points'
  return 'Standard'
}

function collectRosterPlayerIds(value: unknown, accumulator: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) accumulator.add(trimmed)
    return accumulator
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectRosterPlayerIds(entry, accumulator))
    return accumulator
  }

  const raw = recordFromUnknown(value)
  if (!raw) return accumulator

  const directId =
    stringFromUnknown(raw.id) ??
    stringFromUnknown(raw.playerId) ??
    stringFromUnknown(raw.player_id) ??
    stringFromUnknown(raw.sleeperId) ??
    stringFromUnknown(raw.sleeper_id)

  if (directId) {
    accumulator.add(directId)
  }

  for (const key of ['players', 'starters', 'reserve', 'bench', 'taxi', 'ir']) {
    collectRosterPlayerIds(raw[key], accumulator)
  }

  const lineupSections = recordFromUnknown(raw.lineup_sections)
  if (lineupSections) {
    Object.values(lineupSections).forEach((entry) => collectRosterPlayerIds(entry, accumulator))
  }

  return accumulator
}

function inferUserRosterId(args: {
  ownRosterData: unknown | null
  sleeperRosters: SleeperRoster[]
  leagueTeams: Array<{ externalId: string; legacyRoster: { isOwner: boolean; rosterId: number } | null }>
}): number | null {
  const ownerTeam = args.leagueTeams.find((team) => team.legacyRoster?.isOwner)
  if (ownerTeam) {
    const explicitRosterId = numberFromUnknown(ownerTeam.externalId) ?? ownerTeam.legacyRoster?.rosterId ?? null
    if (explicitRosterId != null) return explicitRosterId
  }

  const ownPlayerIds = collectRosterPlayerIds(args.ownRosterData)
  if (ownPlayerIds.size === 0) return null

  let bestRosterId: number | null = null
  let bestOverlap = 0

  for (const roster of args.sleeperRosters) {
    const overlap = arrayFromUnknown(roster.players).reduce<number>((total, playerId) => {
      const value = stringFromUnknown(playerId)
      return value && ownPlayerIds.has(value) ? total + 1 : total
    }, 0)

    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestRosterId = roster.roster_id
    }
  }

  return bestOverlap > 0 ? bestRosterId : null
}

function resolveSleeperDraftOrder(
  drafts: unknown[],
  activeDraftId: string | null | undefined,
  rosters: SleeperRoster[],
): Map<number, number> | null {
  const draftRecords = drafts
    .map((draft) => recordFromUnknown(draft))
    .filter((draft): draft is Record<string, unknown> => draft != null)

  const activeDraft =
    draftRecords.find((draft) => stringFromUnknown(draft.draft_id) === activeDraftId) ??
    draftRecords.find((draft) => stringFromUnknown(draft.status) === 'pre_draft') ??
    draftRecords[0]

  if (!activeDraft) return null

  const slotToRoster = recordFromUnknown(activeDraft.slot_to_roster_id)
  if (slotToRoster) {
    const resolved = new Map<number, number>()
    for (const [slotKey, rosterIdValue] of Object.entries(slotToRoster)) {
      const slot = numberFromUnknown(slotKey)
      const rosterId = numberFromUnknown(rosterIdValue)
      if (slot != null && rosterId != null) {
        resolved.set(rosterId, slot)
      }
    }
    if (resolved.size > 0) return resolved
  }

  const draftOrder = recordFromUnknown(activeDraft.draft_order)
  if (!draftOrder) return null

  const ownerIdToRosterId = new Map(rosters.map((roster) => [roster.owner_id, roster.roster_id] as const))
  const resolved = new Map<number, number>()

  for (const [ownerId, slotValue] of Object.entries(draftOrder)) {
    const slot = numberFromUnknown(slotValue)
    const rosterId = ownerIdToRosterId.get(ownerId)
    if (slot != null && rosterId != null) {
      resolved.set(rosterId, slot)
    }
  }

  return resolved.size > 0 ? resolved : null
}

function predictDraftOrder(managers: Array<Omit<LeagueMockManager, 'slot' | 'slotPredicted'>>) {
  return [...managers]
    .sort((left, right) => {
      if (left.record.wins !== right.record.wins) return left.record.wins - right.record.wins
      if (left.record.pointsFor !== right.record.pointsFor) return left.record.pointsFor - right.record.pointsFor
      if (left.record.losses !== right.record.losses) return right.record.losses - left.record.losses
      return left.managerName.localeCompare(right.managerName)
    })
    .map((manager, index) => ({
      ...manager,
      slot: index + 1,
      slotPredicted: true,
    }))
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const leagueId = stringFromUnknown(searchParams?.get('leagueId'))
  const platformLeagueId = stringFromUnknown(searchParams?.get('platformLeagueId'))

  if (!leagueId && !platformLeagueId) {
    return NextResponse.json({ error: 'leagueId or platformLeagueId is required' }, { status: 400 })
  }

  if (leagueId) {
    const native = await getNativeLeagueMock(leagueId, userId)
    if (native) return NextResponse.json(native.body, { status: native.status })
  }

  const [league, sleeperLeague] = await Promise.all([
    leagueId
      ? prisma.league.findFirst({
          where: { id: leagueId, userId },
          select: {
            id: true,
            name: true,
            sport: true,
            scoring: true,
            isDynasty: true,
            leagueSize: true,
            platform: true,
            platformLeagueId: true,
            settings: true,
            starters: true,
            rosters: {
              select: {
                platformUserId: true,
                playerData: true,
              },
            },
            teams: {
              select: {
                externalId: true,
                ownerName: true,
                avatarUrl: true,
                role: true,
                isOrphan: true,
                wins: true,
                losses: true,
                ties: true,
                pointsFor: true,
                legacyRoster: {
                  select: {
                    isOwner: true,
                    rosterId: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
    platformLeagueId
      ? prisma.sleeperLeague.findFirst({
          where: {
            userId,
            sleeperLeagueId: platformLeagueId,
          },
          select: {
            id: true,
            sleeperLeagueId: true,
            name: true,
            totalTeams: true,
            season: true,
            status: true,
            isDynasty: true,
            scoringType: true,
            rosterSettings: true,
          },
        })
      : Promise.resolve(null),
  ])

  const resolvedPlatformLeagueId = platformLeagueId ?? league?.platformLeagueId ?? sleeperLeague?.sleeperLeagueId ?? null
  if (!resolvedPlatformLeagueId) {
    return NextResponse.json({ error: 'Could not resolve Sleeper league id' }, { status: 404 })
  }

  if (!league && !sleeperLeague) {
    const fallbackUnifiedLeague = await prisma.league.findFirst({
      where: {
        userId,
        platform: 'sleeper',
        platformLeagueId: resolvedPlatformLeagueId,
      },
      select: { id: true },
    })

    if (!fallbackUnifiedLeague) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }
  }

  const [leagueInfo, sleeperRosters, sleeperUsers, sleeperDrafts] = await Promise.all([
    getLeagueInfo(resolvedPlatformLeagueId),
    getLeagueRosters(resolvedPlatformLeagueId),
    getLeagueUsers(resolvedPlatformLeagueId),
    getLeagueDrafts(resolvedPlatformLeagueId),
  ])

  if (!leagueInfo) {
    return NextResponse.json({ error: 'Unable to load Sleeper league' }, { status: 404 })
  }

  const normalizedSport = normalizeToSupportedSport(
    stringFromUnknown(league?.sport) ??
      stringFromUnknown(leagueInfo.sport) ??
      stringFromUnknown(searchParams?.get('sport')) ??
      DEFAULT_SPORT,
  )

  const draftOrder = resolveSleeperDraftOrder(sleeperDrafts, leagueInfo.draft_id, sleeperRosters)
  const userLookup = new Map(sleeperUsers.map((user) => [user.user_id, user]))
  const leagueTeamLookup = new Map((league?.teams ?? []).map((team) => [team.externalId, team]))
  const ownRosterData =
    league?.rosters.find((roster) => roster.platformUserId === userId)?.playerData ?? null

  const detectedUserRosterId = inferUserRosterId({
    ownRosterData,
    sleeperRosters,
    leagueTeams: (league?.teams ?? []).map((team) => ({
      externalId: team.externalId,
      legacyRoster: team.legacyRoster,
    })),
  })

  const baseManagers = sleeperRosters.map((roster) => {
    const user = userLookup.get(roster.owner_id)
    const leagueTeam = leagueTeamLookup.get(String(roster.roster_id))
    const managerName =
      user?.display_name ??
      user?.username ??
      leagueTeam?.ownerName ??
      `Roster ${roster.roster_id}`
    const hasSleeperPoints =
      roster.settings?.fpts != null || roster.settings?.fpts_decimal != null
    const sleeperPointsFor =
      (roster.settings?.fpts ?? 0) + ((roster.settings?.fpts_decimal ?? 0) / 100)

    return {
      rosterId: roster.roster_id,
      managerId: roster.owner_id ?? String(roster.roster_id),
      managerName,
      avatarUrl: buildSleeperAvatarUrl(user?.avatar) ?? leagueTeam?.avatarUrl ?? null,
      isUser: detectedUserRosterId === roster.roster_id,
      role: leagueTeam?.role ?? null,
      isOrphan: leagueTeam?.isOrphan === true,
      record: {
        wins: roster.settings?.wins ?? leagueTeam?.wins ?? 0,
        losses: roster.settings?.losses ?? leagueTeam?.losses ?? 0,
        ties: roster.settings?.ties ?? leagueTeam?.ties ?? 0,
        pointsFor: hasSleeperPoints ? sleeperPointsFor : (leagueTeam?.pointsFor ?? 0),
      },
    }
  })

  const orderedManagers: LeagueMockManager[] = draftOrder
    ? [...baseManagers]
        .sort((left, right) => {
          const leftSlot = draftOrder.get(left.rosterId) ?? Number.MAX_SAFE_INTEGER
          const rightSlot = draftOrder.get(right.rosterId) ?? Number.MAX_SAFE_INTEGER
          if (leftSlot !== rightSlot) return leftSlot - rightSlot
          return left.managerName.localeCompare(right.managerName)
        })
        .map((manager, index) => ({
          ...manager,
          slot: draftOrder.get(manager.rosterId) ?? index + 1,
          slotPredicted: draftOrder.get(manager.rosterId) == null,
        }))
    : predictDraftOrder(baseManagers)

  const detectedUserSlot =
    orderedManagers.find((manager) => manager.isUser)?.slot ??
    orderedManagers[0]?.slot ??
    1

  const scoringLabel = normalizeScoringLabel(
    league?.scoring ?? sleeperLeague?.scoringType ?? getScoringType(leagueInfo.scoring_settings),
  )

  const rounds =
    inferRoundsFromLeagueSettings(league?.settings) ??
    inferRoundsFromLeagueSettings(leagueInfo.settings) ??
    inferRoundsFromLeagueSettings(sleeperLeague?.rosterSettings) ??
    15

  const draftType = normalizeDraftType(recordFromUnknown(leagueInfo.settings)?.type)

  return NextResponse.json({
    league: {
      leagueId: league?.id ?? null,
      platformLeagueId: resolvedPlatformLeagueId,
      leagueName: leagueInfo.name ?? league?.name ?? sleeperLeague?.name ?? 'Sleeper League',
      sport: normalizedSport,
      scoring: scoringLabel,
      isDynasty: Boolean(league?.isDynasty ?? sleeperLeague?.isDynasty),
      teamCount: leagueInfo.total_rosters ?? league?.leagueSize ?? sleeperLeague?.totalTeams ?? orderedManagers.length,
      rounds,
      draftType,
      superflex: inferSuperflex(league?.settings) || inferSuperflex(leagueInfo.settings),
      managers: orderedManagers,
      detectedUserSlot,
      hasExplicitDraftOrder: Boolean(draftOrder),
    },
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rawBody = recordFromUnknown(body)

  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const results = recordFromUnknown(rawBody.results)
  if (!results) {
    return NextResponse.json({ error: 'results object is required' }, { status: 400 })
  }

  const picks = arrayFromUnknown(results.picks)
  if (picks.length === 0) {
    return NextResponse.json({ error: 'results.picks must contain at least one pick' }, { status: 400 })
  }

  const settings = recordFromUnknown(results.settings)
  const draftId = stringFromUnknown(rawBody.draftId)
  const leagueId = stringFromUnknown(rawBody.leagueId)
  const resolvedRounds =
    numberFromUnknown(rawBody.rounds) ??
    numberFromUnknown(settings?.rounds) ??
    picks.reduce<number>(
      (maxRound, entry) => Math.max(maxRound, numberFromUnknown(recordFromUnknown(entry)?.round) ?? 0),
      0,
    ) ??
    15

  const shareId = crypto.randomBytes(8).toString('base64url')
  const metadata: Prisma.InputJsonObject = {
    sport: stringFromUnknown(settings?.sport) ?? DEFAULT_SPORT,
    leagueType: leagueId ? 'league' : 'open',
    draftType: stringFromUnknown(results.draftType) ?? stringFromUnknown(settings?.draftType) ?? 'snake',
    numTeams: numberFromUnknown(settings?.teamCount) ?? 12,
    scoringFormat: stringFromUnknown(settings?.scoring) ?? 'Standard',
    timerSeconds: numberFromUnknown(settings?.speed) ?? 15,
    aiEnabled: true,
    shareVersion: 'sleeper-room-v1',
    ...(leagueId ? { leagueId } : {}),
  }

  const data = {
    leagueId: leagueId ?? undefined,
    userId,
    rounds: Math.max(1, resolvedRounds),
    results: results as Prisma.InputJsonValue,
    shareId,
    metadata,
    status: 'completed',
  } satisfies Prisma.MockDraftUncheckedCreateInput

  const draft = draftId
    ? await prisma.mockDraft.updateMany({
        where: {
          id: draftId,
          userId,
        },
        data,
      }).then(async (result) => {
        if (result.count === 0) return null
        return prisma.mockDraft.findUnique({
          where: { id: draftId },
          select: { id: true, shareId: true },
        })
      })
    : null

  const created =
    draft ??
    (await prisma.mockDraft.create({
      data,
      select: { id: true, shareId: true },
    }))

  return NextResponse.json({
    draftId: created.id,
    shareId: created.shareId,
  })
}

