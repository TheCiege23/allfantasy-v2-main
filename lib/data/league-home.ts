import 'server-only'

import type { LeagueLifecycleState, LeagueSport, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { getAllowedActions } from '@/server/services/leagueLifecycleService'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getLeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { getPlayoffConfigForLeague } from '@/lib/playoff-defaults/PlayoffConfigResolver'
import { getWaiverConfigForLeague } from '@/lib/waiver-defaults/WaiverConfigResolver'
import { getScheduleConfigForLeague } from '@/lib/schedule-defaults/ScheduleConfigResolver'
import { getDevyConfig } from '@/lib/devy/DevyLeagueConfig'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'
import { getFormatIntroMetadata } from '@/lib/league/format-engine'
import { resolveLeagueIntroFormatKey } from '@/lib/league/resolveLeagueIntroFormatKey'
import type {
  LeagueActivityItem,
  LeagueBracketMatchup,
  LeagueBracketMatchupTeam,
  LeagueBracketRound,
  LeagueChatPreview,
  LeagueHomeData,
  LeagueIntroVideoData,
  LeagueKeeperDeclarationItem,
  LeagueMatchupPreviewCardData,
  LeaguePlayersData,
  LeaguePowerRankingItem,
  LeagueRosterCard,
  LeagueRosterSection,
  LeagueRosterSlot,
  LeagueScoringSection,
  LeagueSettingsItem,
  LeagueStorylineCardData,
  LeagueTeamRow,
  LeagueTradeAsset,
  LeagueTradeBlockItem,
  LeagueTradeHistoryItem,
  LeagueTradesData,
  LeagueTopTab,
  LeagueVariantSummary,
  LeagueDraftSummaryCard,
  ResolvedLeaguePlayer,
} from '@/components/league/types'

type JsonRecord = Record<string, unknown>
const prismaAny = prisma as any

function isEmptySleeperSlotPlayerId(playerId: string): boolean {
  return playerId.trim() === '0'
}

function fallbackPlayerName(playerId: string): string {
  return isEmptySleeperSlotPlayerId(playerId) ? 'Open Slot' : `Player ${playerId}`
}

type LeagueContext = {
  userId: string
  league: {
    id: string
    name: string | null
    sport: LeagueSport
    season: number | null
    leagueSize: number | null
    avatarUrl: string | null
    leagueVariant: string | null
    /** Canonical format id (redraft, dynasty, guillotine, …) — use for intro/media, not `leagueVariant`. */
    leagueType: string | null
    settings: Prisma.JsonValue | null
    scoring: string | null
    isDynasty: boolean
    platformLeagueId: string
    lifecycleState: LeagueLifecycleState
    locked: boolean
    emergencyPaused: boolean
  }
  isCommissioner: boolean
  currentRoster: {
    id: string
    platformUserId: string
    playerData: Prisma.JsonValue
    faabRemaining: number | null
    waiverPriority: number | null
  } | null
  leagueTeams: Array<{
    id: string
    externalId: string
    ownerName: string
    teamName: string
    avatarUrl: string | null
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    currentRank: number | null
  }>
  allRosters: Array<{
    id: string
    platformUserId: string
    playerData: Prisma.JsonValue
    faabRemaining: number | null
    waiverPriority: number | null
  }>
}

type ResolvedPlayerIndexEntry = {
  id: string
  name: string
  position: string
  team: string | null
  adp: number | null
  injuryStatus: string | null
  stats: JsonRecord
  headshotUrl: string | null
  teamLogoUrl: string | null
}

type PlayerMediaBatchMap = Awaited<ReturnType<typeof attachPlayerMediaBatch>>

const TOP_TAB_VALUES: LeagueTopTab[] = ['DRAFT', 'TEAM', 'PLAYERS', 'LEAGUE']

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isLeagueTopTab(value: string | null | undefined): value is LeagueTopTab {
  return !!value && TOP_TAB_VALUES.includes(value.toUpperCase() as LeagueTopTab)
}

function toJsonRecord(value: Prisma.JsonValue | null | undefined): JsonRecord {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {}
  return value as JsonRecord
}

/** Sleeper hub: `settings.leg`; some snapshots expose top-level `leg`. */
function resolveCurrentWeekFromLeagueSettings(settings: Prisma.JsonValue | null | undefined): number | null {
  const root = toJsonRecord(settings)
  const nested =
    root.settings && typeof root.settings === 'object' && !Array.isArray(root.settings)
      ? (root.settings as Record<string, unknown>)
      : null
  for (const leg of [nested?.leg, root.leg]) {
    if (typeof leg === 'number' && Number.isFinite(leg) && leg >= 1) {
      return Math.min(Math.floor(leg), 53)
    }
    if (typeof leg === 'string') {
      const n = Number.parseInt(leg, 10)
      if (Number.isFinite(n) && n >= 1) return Math.min(n, 53)
    }
  }
  return null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const candidate = record.id ?? record.player_id ?? record.playerId ?? record.label
        return typeof candidate === 'string' ? candidate : null
      }
      return null
    })
    .filter((entry): entry is string => Boolean(entry))
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatRecord(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return 'Just now'
  const value = typeof date === 'string' ? new Date(date) : date
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return 'Just now'
  return value.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return '-'
  if (Math.abs(value) >= 1000) {
    return `${value > 0 ? '+' : ''}${(value / 1000).toFixed(1)}K`
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

function logOptionalLeagueDataWarning(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[league-home] ${scope} unavailable: ${message}`)
}

function normalizeSlotPill(slot: string): string {
  const upper = slot.toUpperCase()
  if (upper === 'FLEX') return 'WRT'
  if (upper === 'SUPERFLEX' || upper === 'SUPER_FLEX') return 'SF'
  if (upper === 'BENCH') return 'BN'
  if (upper === 'TAXI') return 'TX'
  if (upper === 'IDP_FLEX') return 'IDP'
  return upper
}

function formatSlotLabel(slot: string): string {
  const upper = slot.toUpperCase()
  if (upper === 'BENCH') return 'Bench'
  if (upper === 'IR') return 'Injured Reserve'
  if (upper === 'TAXI') return 'Taxi Squad'
  if (upper === 'IDP_FLEX') return 'IDP'
  if (upper === 'SUPER_FLEX') return 'Superflex'
  return titleCase(slot)
}

function formatRosterSummary(
  slots: Array<{
    slotName: string
    starterCount: number
    benchCount: number
    reserveCount: number
    taxiCount: number
    devyCount: number
  }>
): string {
  const parts: string[] = []
  for (const slot of slots) {
    if (slot.starterCount > 0) {
      parts.push(`${slot.starterCount} ${normalizeSlotPill(slot.slotName)}`)
    }
  }
  const bench = slots.reduce((sum, slot) => sum + slot.benchCount, 0)
  const ir = slots.reduce((sum, slot) => sum + slot.reserveCount, 0)
  const taxi = slots.reduce((sum, slot) => sum + slot.taxiCount, 0)
  const devy = slots.reduce((sum, slot) => sum + slot.devyCount, 0)
  if (bench > 0) parts.push(`${bench} BN`)
  if (ir > 0) parts.push(`${ir} IR`)
  if (taxi > 0) parts.push(`${taxi} TAXI`)
  if (devy > 0) parts.push(`${devy} DEVY`)
  return parts.join(', ')
}

function formatProcessingDay(day: number): string {
  if (day >= 0 && day < DAY_LABELS.length) return DAY_LABELS[day]!
  return `Day ${day}`
}

function formatWaiverProcessing(days: number[], timeUtc: string | null): string {
  if (!days.length) return 'Free Agents'
  const timeLabel = timeUtc ? ` (${timeUtc} UTC)` : ''
  return days.map((day) => `${formatProcessingDay(day)}: Waivers${timeLabel}`).join('\n')
}

function formatScoringValue(statKey: string, value: number): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  const abs = Math.abs(numeric)
  if (/(yard|yards|return_yards)/i.test(statKey) && abs > 0 && abs < 1) {
    const yardsPerPoint = Math.round(1 / abs)
    return `${numeric >= 0 ? '+' : ''}${numeric} per yard (${yardsPerPoint} yards = 1 pt)`
  }
  return `${numeric >= 0 ? '+' : ''}${numeric}`
}

function categorizeRule(statKey: string): string {
  const key = statKey.toLowerCase()
  if (key.includes('pass')) return 'Passing'
  if (key.includes('rush')) return 'Rushing'
  if (key.includes('rec') || key.includes('target')) return 'Receiving'
  if (key.includes('fg') || key.includes('pat') || key.includes('kick')) return 'Kicking'
  if (key.includes('defense') || key.includes('points_allowed') || key.includes('sack') || key.includes('interception')) return 'Team Defense'
  if (key.includes('special')) return 'Special Teams'
  if (key.includes('tackle') || key.includes('qb_hit') || key.includes('forced_fumble') || key.includes('pass_defended') || key.includes('idp')) return 'IDP'
  return 'Misc'
}

function extractNumericStats(statsValue: unknown, position: string): Array<{ label: string; value: string }> {
  const stats = statsValue && typeof statsValue === 'object' && !Array.isArray(statsValue)
    ? (statsValue as Record<string, unknown>)
    : {}
  const positionKey = position.toUpperCase()
  const preferredKeys =
    positionKey === 'RB'
      ? ['rush_yd', 'rec_yd', 'rush_td', 'rec_td', 'rush', 'rec', 'tar']
      : positionKey === 'WR' || positionKey === 'TE'
        ? ['rec', 'rec_yd', 'rec_td', 'tar', 'rost_pct']
        : ['pass_yd', 'pass_td', 'rush_yd', 'rush_td', 'rec_yd']

  const seen = new Set<string>()
  const picked: Array<{ label: string; value: string }> = []
  for (const key of preferredKeys) {
    const raw = stats[key]
    if (raw == null) continue
    seen.add(key)
    picked.push({ label: titleCase(key), value: String(raw) })
  }
  if (picked.length >= 5) return picked.slice(0, 7)
  for (const [key, raw] of Object.entries(stats)) {
    if (seen.has(key) || typeof raw === 'object') continue
    if (typeof raw !== 'number' && typeof raw !== 'string') continue
    picked.push({ label: titleCase(key), value: String(raw) })
    if (picked.length >= 7) break
  }
  return picked
}

async function loadLeagueContext(leagueId: string, userId: string): Promise<LeagueContext | null> {
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return null

  const [league, currentRoster, allRosters, leagueTeams] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        sport: true,
        season: true,
        leagueSize: true,
        avatarUrl: true,
        leagueVariant: true,
        leagueType: true,
        settings: true,
        scoring: true,
        isDynasty: true,
        platformLeagueId: true,
        lifecycleState: true,
        locked: true,
        emergencyPaused: true,
      },
    }),
    prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: {
        id: true,
        platformUserId: true,
        playerData: true,
        faabRemaining: true,
        waiverPriority: true,
      },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: {
        id: true,
        platformUserId: true,
        playerData: true,
        faabRemaining: true,
        waiverPriority: true,
      },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      orderBy: [{ currentRank: 'asc' }, { pointsFor: 'desc' }, { wins: 'desc' }, { teamName: 'asc' }],
      select: {
        id: true,
        externalId: true,
        ownerName: true,
        teamName: true,
        avatarUrl: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        pointsAgainst: true,
        currentRank: true,
      },
    }),
  ])

  if (!league) return null

  return {
    userId,
    league,
    isCommissioner: access.isCommissioner,
    currentRoster,
    allRosters,
    leagueTeams,
  }
}

async function resolvePlayerIndex(
  sport: string,
  playerIds: string[]
): Promise<Map<string, ResolvedPlayerIndexEntry>> {
  const uniqueIds = Array.from(new Set(playerIds.filter(Boolean)))
  if (!uniqueIds.length) return new Map()

  const [identityRows, sportsPlayers, sportsRecords, mediaMap] = await Promise.all([
    prisma.playerIdentityMap.findMany({
      where: {
        sport: sport.toUpperCase(),
        OR: [
          { sleeperId: { in: uniqueIds } },
          { rollingInsightsId: { in: uniqueIds } },
          { apiSportsId: { in: uniqueIds } },
          { clearSportsId: { in: uniqueIds } },
          { espnId: { in: uniqueIds } },
          { mflId: { in: uniqueIds } },
        ],
      },
      select: {
        canonicalName: true,
        position: true,
        currentTeam: true,
        sleeperId: true,
        rollingInsightsId: true,
        apiSportsId: true,
        clearSportsId: true,
        espnId: true,
        mflId: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('player identity index', error)
      return []
    }),
    prisma.sportsPlayer.findMany({
      where: {
        sport: sport.toUpperCase(),
        OR: [
          { externalId: { in: uniqueIds } },
          { sleeperId: { in: uniqueIds } },
        ],
      },
      orderBy: { fetchedAt: 'desc' },
      select: {
        externalId: true,
        sleeperId: true,
        name: true,
        position: true,
        team: true,
        imageUrl: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('sports player index', error)
      return []
    }),
    prisma.sportsPlayerRecord.findMany({
      where: {
        sport: sport.toUpperCase(),
        id: { in: uniqueIds },
      },
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        adp: true,
        injuryStatus: true,
        stats: true,
        headshotUrl: true,
        logoUrl: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('sports player records', error)
      return []
    }),
    attachPlayerMediaBatch(uniqueIds.map((playerId) => ({ playerId, sport }))).catch((error) => {
      logOptionalLeagueDataWarning('player media', error)
      return new Map() as PlayerMediaBatchMap
    }),
  ])

  const index = new Map<string, ResolvedPlayerIndexEntry>()

  for (const row of identityRows) {
    const keys = [
      row.sleeperId,
      row.rollingInsightsId,
      row.apiSportsId,
      row.clearSportsId,
      row.espnId,
      row.mflId,
    ].filter((value): value is string => Boolean(value))
    for (const key of keys) {
      index.set(key, {
        id: key,
        name: row.canonicalName,
        position: row.position ?? 'FLEX',
        team: row.currentTeam ?? null,
        adp: null,
        injuryStatus: null,
        stats: {},
        headshotUrl: null,
        teamLogoUrl: null,
      })
    }
  }

  for (const row of sportsPlayers) {
    const keys = [row.externalId, row.sleeperId].filter((value): value is string => Boolean(value))
    for (const key of keys) {
      const existing = index.get(key)
      index.set(key, {
        id: key,
        name: row.name || existing?.name || fallbackPlayerName(key),
        position: row.position || existing?.position || 'FLEX',
        team: row.team || existing?.team || null,
        adp: existing?.adp ?? null,
        injuryStatus: existing?.injuryStatus ?? null,
        stats: existing?.stats ?? {},
        headshotUrl: row.imageUrl || existing?.headshotUrl || null,
        teamLogoUrl: existing?.teamLogoUrl || null,
      })
    }
  }

  for (const row of sportsRecords) {
    const existing = index.get(row.id)
    index.set(row.id, {
      id: row.id,
      name: row.name || existing?.name || fallbackPlayerName(row.id),
      position: row.position || existing?.position || 'FLEX',
      team: row.team || existing?.team || null,
      adp: row.adp ?? existing?.adp ?? null,
      injuryStatus: row.injuryStatus ?? existing?.injuryStatus ?? null,
      stats: toJsonRecord(row.stats),
      headshotUrl: row.headshotUrl || existing?.headshotUrl || null,
      teamLogoUrl: row.logoUrl || existing?.teamLogoUrl || null,
    })
  }

  for (const playerId of uniqueIds) {
    const media = mediaMap.get(playerId)
    const existing = index.get(playerId)
    index.set(playerId, {
      id: playerId,
      name: existing?.name || fallbackPlayerName(playerId),
      position: existing?.position || 'FLEX',
      team: existing?.team || media?.teamAbbr || null,
      adp: existing?.adp ?? null,
      injuryStatus: existing?.injuryStatus ?? null,
      stats: existing?.stats ?? {},
      headshotUrl: existing?.headshotUrl || media?.media.headshotUrl || null,
      teamLogoUrl: existing?.teamLogoUrl || media?.media.teamLogoUrl || null,
    })
  }

  return index
}

function toResolvedLeaguePlayer(
  entry: ResolvedPlayerIndexEntry | undefined,
  playerId: string,
  extras?: Partial<ResolvedLeaguePlayer>
): ResolvedLeaguePlayer {
  return {
    id: playerId,
    name: entry?.name || fallbackPlayerName(playerId),
    position: entry?.position || 'FLEX',
    team: entry?.team || null,
    headshotUrl: entry?.headshotUrl || null,
    teamLogoUrl: entry?.teamLogoUrl || null,
    injuryStatus: entry?.injuryStatus || null,
    rosterPercent: extras?.rosterPercent ?? null,
    startPercent: extras?.startPercent ?? null,
    score: extras?.score ?? null,
    trendValue: extras?.trendValue ?? null,
    adp: extras?.adp ?? entry?.adp ?? null,
    ownerLabel: extras?.ownerLabel,
    stats: extras?.stats ?? extractNumericStats(entry?.stats ?? {}, entry?.position || 'FLEX'),
  }
}

function sumLineupSlots(lineup: unknown): number {
  if (!lineup || typeof lineup !== 'object' || Array.isArray(lineup)) return 0
  return Object.values(lineup as Record<string, unknown>).reduce<number>((sum, value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? sum + parsed : sum
  }, 0)
}

async function buildVariantSummary(context: LeagueContext): Promise<LeagueVariantSummary> {
  const [devyConfig, c2cConfig] = await Promise.all([
    getDevyConfig(context.league.id).catch(() => null),
    getC2CConfig(context.league.id).catch(() => null),
  ])

  if (c2cConfig) {
    return {
      mode: 'c2c',
      collegeSports: c2cConfig.collegeSports,
      devy: null,
      c2c: {
        rosterSize: c2cConfig.collegeRosterSize,
        scoringSystem: c2cConfig.collegeScoringSystem,
        standingsModel: c2cConfig.standingsModel,
        mixProPlayers: c2cConfig.mixProPlayers,
      },
    }
  }

  if (devyConfig) {
    return {
      mode: 'devy',
      collegeSports: devyConfig.collegeSports,
      devy: {
        slotCount: devyConfig.devySlotCount,
        irSlots: devyConfig.devyIRSlots,
        taxiSlots: devyConfig.taxiSize,
        scoringEnabled: devyConfig.devyScoringEnabled,
      },
      c2c: null,
    }
  }

  return {
    mode: 'standard',
    collegeSports: [],
    devy: null,
    c2c: null,
  }
}

function toCollegeResolvedPlayer(
  player: {
    id: string
    name: string
    position: string
    school: string
    conference?: string | null
    sport?: string | null
    headshotUrl?: string | null
    nflTeam?: string | null
    portalStatus?: string | null
    draftGrade?: string | null
    draftEligibleYear?: number | null
    classYearLabel?: string | null
    c2cPointsWeek?: number | null
    c2cPointsSeason?: number | null
    devyAdp?: number | null
    projectedDraftPick?: number | null
    projectedDraftRound?: number | null
    statsPayload?: Prisma.JsonValue | null
  },
  extras?: Partial<ResolvedLeaguePlayer>
): ResolvedLeaguePlayer {
  const badges = [
    'COLLEGE',
    ...(player.portalStatus === 'IN_PORTAL' ? ['IN PORTAL'] : []),
    ...(player.draftEligibleYear != null && player.draftEligibleYear <= new Date().getFullYear() + 1
      ? ['DRAFT ELIGIBLE']
      : []),
  ]
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.school,
    headshotUrl: player.headshotUrl ?? null,
    teamLogoUrl: null,
    injuryStatus: null,
    rosterPercent: null,
    startPercent: null,
    score: extras?.score ?? player.c2cPointsWeek ?? null,
    trendValue: extras?.trendValue ?? null,
    adp: extras?.adp ?? player.devyAdp ?? null,
    ownerLabel: extras?.ownerLabel,
    source: 'college',
    collegeSport: player.sport ?? null,
    school: player.school,
    conference: player.conference ?? null,
    classYearLabel: player.classYearLabel ?? null,
    draftGrade: player.draftGrade ?? null,
    draftYear: player.draftEligibleYear ?? null,
    projectedLandingSpot: player.nflTeam ?? null,
    nextGameLabel: extras?.nextGameLabel ?? null,
    badges,
    stats:
      extras?.stats ??
      extractNumericStats(player.statsPayload ?? {}, player.position).slice(0, 5),
  }
}

async function buildCollegeRosterSections(
  context: LeagueContext,
  variant: LeagueVariantSummary
): Promise<LeagueRosterSection[]> {
  if (variant.mode === 'standard' || !context.currentRoster?.id) return []

  const rights = await prisma.devyRights.findMany({
    where: {
      leagueId: context.league.id,
      rosterId: context.currentRoster.id,
    },
    orderBy: [{ slotCategory: 'asc' }, { createdAt: 'desc' }],
  }).catch(() => [])
  if (!rights.length) return []

  const players = await prisma.devyPlayer.findMany({
    where: { id: { in: rights.map((right) => right.devyPlayerId) } },
  }).catch(() => [])
  const playerById = new Map(players.map((player) => [player.id, player]))
  const scoringLogs = variant.mode === 'c2c'
    ? await prisma.c2CScoringLog.findMany({
        where: {
          leagueId: context.league.id,
          rosterId: context.currentRoster.id,
          devyPlayerId: { in: rights.map((right) => right.devyPlayerId) },
        },
        orderBy: [{ season: 'desc' }, { week: 'desc' }, { updatedAt: 'desc' }],
      }).catch(() => [])
    : []
  const latestScoreByPlayer = new Map<string, { points: number; week: number }>()
  for (const log of scoringLogs) {
    if (!latestScoreByPlayer.has(log.devyPlayerId)) {
      latestScoreByPlayer.set(log.devyPlayerId, { points: log.points, week: log.week })
    }
  }

  const grouped = new Map<string, LeagueRosterSlot[]>()
  const resolveBucket = (right: { slotCategory: string; c2cLineupRole: string | null; state: string }) => {
    if (variant.mode === 'devy') {
      if (right.slotCategory === 'DEVY_IR') return 'devy-ir'
      if (right.slotCategory === 'DEVY_TAXI') return 'devy-taxi'
      return 'devy'
    }
    if (right.c2cLineupRole === 'STARTER' || right.state === 'COLLEGE_STARTER') return 'college-starters'
    return 'college-bench'
  }
  for (const right of rights) {
    const player = playerById.get(right.devyPlayerId)
    if (!player) continue
    const bucket = resolveBucket(right)
    const score = latestScoreByPlayer.get(player.id)
    const slotName =
      bucket === 'devy-ir'
        ? 'DEVY_IR'
        : bucket === 'devy-taxi'
          ? 'DEVY_TAXI'
          : bucket === 'college-starters'
            ? 'COLLEGE'
            : 'DEVY'
    const items = grouped.get(bucket) ?? []
    items.push({
      id: `${bucket}-${player.id}`,
      slot: slotName,
      slotLabel: formatSlotLabel(slotName),
      pill: normalizeSlotPill(slotName),
      player: toCollegeResolvedPlayer(player, {
        score: score?.points ?? player.c2cPointsWeek ?? null,
        nextGameLabel: score ? `Week ${score.week} total` : player.nextGameLabel ?? null,
      }),
    })
    grouped.set(bucket, items)
  }

  const order =
    variant.mode === 'devy'
      ? [
          ['devy', 'DEVY', 'No devy assets yet.'],
          ['devy-ir', 'DEVY IR', 'No devy IR players.'],
          ['devy-taxi', 'DEVY TAXI', 'No devy taxi players.'],
        ]
      : [
          ['college-starters', 'COLLEGE STARTERS', 'No college starters configured yet.'],
          ['college-bench', 'COLLEGE BENCH', 'No college bench players yet.'],
        ]

  return order.map(([key, title, emptyLabel]) => ({
    id: key,
    title,
    emptyLabel,
    items: grouped.get(key) ?? [],
  }))
}

async function buildCollegePlayersData(
  context: LeagueContext,
  variant: LeagueVariantSummary
): Promise<LeaguePlayersData['college']> {
  if (variant.mode === 'standard' || variant.collegeSports.length === 0) return null

  const sports = variant.collegeSports
  const [trendRows, availableRows, leaderRows] = await Promise.all([
    prisma.devyPlayer.findMany({
      where: { sport: { in: sports } },
      orderBy: [{ stockTrendDelta: 'desc' }, { draftProjectionScore: 'desc' }],
      take: 20,
    }).catch(() => []),
    prisma.devyPlayer.findMany({
      where: { sport: { in: sports }, graduatedToNFL: false },
      orderBy: [{ devyAdp: 'asc' }, { draftProjectionScore: 'desc' }],
      take: 40,
    }).catch(() => []),
    prisma.devyPlayer.findMany({
      where: { sport: { in: sports } },
      /*
       * BOTH keys here were dead. `c2cPointsSeason` has 0 populated rows in
       * production, so the sort fell straight through to `devyValue`, which is
       * 0 for 72% of the pool — leaving this a effectively arbitrary 20 players.
       * The two sibling queries above already fall back to draftProjectionScore;
       * this one now matches them.
       */
      orderBy: [{ c2cPointsSeason: 'desc' }, { draftProjectionScore: 'desc' }],
      take: 20,
    }).catch(() => []),
  ])

  return {
    trend: trendRows.map((player) =>
      toCollegeResolvedPlayer(player, {
        trendValue: player.stockTrendDelta ?? player.draftProjectionScore ?? null,
      })
    ),
    available: availableRows.map((player) => toCollegeResolvedPlayer(player)),
    leaders: leaderRows.map((player) =>
      toCollegeResolvedPlayer(player, {
        score: player.c2cPointsSeason ?? null,
      })
    ),
    availablePositions: Array.from(new Set(availableRows.map((player) => player.position).filter(Boolean))),
    availableSports: sports,
  }
}

function buildDraftSummaryCards(
  variant: LeagueVariantSummary,
  roster: LeagueRosterCard
): LeagueDraftSummaryCard[] {
  if (variant.mode === 'devy' && variant.devy) {
    return [
      {
        id: 'devy-format',
        title: 'Devy Roster',
        description: 'College stashes that mature into your rookie pipeline.',
        values: [
          { label: 'Slots', value: String(variant.devy.slotCount) },
          { label: 'IR', value: String(variant.devy.irSlots) },
          { label: 'Taxi', value: String(variant.devy.taxiSlots) },
          { label: 'Sports', value: variant.collegeSports.join(', ') || 'NCAAF' },
        ],
      },
      {
        id: 'devy-assets',
        title: 'Current Devy Assets',
        description: 'Live view of held college rights for this roster.',
        values: [
          { label: 'Held', value: String(roster.collegeSections?.[0]?.items.length ?? 0) },
          { label: 'IR', value: String(roster.collegeSections?.[1]?.items.length ?? 0) },
          { label: 'Taxi', value: String(roster.collegeSections?.[2]?.items.length ?? 0) },
        ],
      },
    ]
  }

  if (variant.mode === 'c2c' && variant.c2c) {
    return [
      {
        id: 'c2c-format',
        title: 'C2C Rosters',
        description: 'College and pro assets live in one connected ecosystem.',
        values: [
          { label: 'College roster', value: String(variant.c2c.rosterSize) },
          { label: 'Scoring', value: variant.c2c.scoringSystem.toUpperCase() },
          { label: 'Standings', value: titleCase(variant.c2c.standingsModel) },
          { label: 'Mix pro players', value: variant.c2c.mixProPlayers ? 'Yes' : 'No' },
        ],
      },
      {
        id: 'c2c-college-side',
        title: 'College Side',
        description: 'Live college scoring, starters, and bench breakdown.',
        values: [
          { label: 'Starters', value: String(roster.collegeSections?.[0]?.items.length ?? 0) },
          { label: 'Bench', value: String(roster.collegeSections?.[1]?.items.length ?? 0) },
          { label: 'Sports', value: variant.collegeSports.join(', ') || 'NCAAF' },
        ],
      },
    ]
  }

  return []
}

async function buildIntroVideoData(
  context: LeagueContext,
  userId: string
): Promise<LeagueIntroVideoData | null> {
  const settings = toJsonRecord(context.league.settings)
  const storedIntro =
    settings.intro_video && typeof settings.intro_video === 'object'
      ? (settings.intro_video as Record<string, unknown>)
      : null

  const introFormatKey = resolveLeagueIntroFormatKey({
    leagueTypeColumn: context.league.leagueType,
    settings,
  })

  const derivedIntro = getFormatIntroMetadata({
    sport: context.league.sport,
    leagueType: introFormatKey,
    leagueVariant: context.league.leagueVariant,
    requestedModifiers: Array.isArray(settings.format_modifiers)
      ? settings.format_modifiers.map((entry) => String(entry))
      : [],
  })

  const seen = await prismaAny.leagueIntroView.findUnique({
    where: {
      leagueId_userId: {
        leagueId: context.league.id,
        userId,
      },
    },
    select: { id: true },
  })

  /**
   * When `League.leagueType` is set (canonical create/import), intro **video + poster** must match
   * that format. Legacy `settings.intro_video` sometimes stored wrong URLs (e.g. guillotine assets for
   * redraft); titles already came from derived metadata when absent, but thumbnail/video overrides caused
   * mismatched artwork.
   */
  const hasCanonicalLeagueType =
    typeof context.league.leagueType === 'string' && context.league.leagueType.trim().length > 0

  const introVideo = hasCanonicalLeagueType
    ? derivedIntro.introVideo
    : typeof storedIntro?.introVideo === 'string'
      ? storedIntro.introVideo
      : derivedIntro.introVideo

  const thumbnail = hasCanonicalLeagueType
    ? derivedIntro.thumbnail
    : typeof storedIntro?.thumbnail === 'string'
      ? storedIntro.thumbnail
      : derivedIntro.thumbnail

  return {
    title: typeof storedIntro?.title === 'string' ? storedIntro.title : derivedIntro.title,
    subtitle: typeof storedIntro?.subtitle === 'string' ? storedIntro.subtitle : derivedIntro.subtitle,
    introVideo,
    thumbnail,
    fallbackCopy:
      typeof storedIntro?.fallbackCopy === 'string'
        ? storedIntro.fallbackCopy
        : derivedIntro.fallbackCopy,
    shouldAutoOpen: !seen,
  }
}

async function buildStorylineCard(leagueId: string): Promise<LeagueStorylineCardData | null> {
  const storyline = await prismaAny.leagueStoryline.findFirst({
    where: { leagueId, storyType: 'weekly_storyline' },
    orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
  })

  if (!storyline) return null

  return {
    title: storyline.title,
    summary: storyline.summary,
    body: storyline.body,
    createdAtLabel: formatDateTime(storyline.createdAt),
  }
}

async function buildDraftRecapCard(leagueId: string): Promise<LeagueStorylineCardData | null> {
  const recap = await prismaAny.draftRecap.findFirst({
    where: { leagueId },
    orderBy: { updatedAt: 'desc' },
  })

  if (!recap) return null

  return {
    title: recap.title,
    summary: recap.summary,
    body: null,
    createdAtLabel: formatDateTime(recap.updatedAt),
  }
}

async function buildConstitutionCard(leagueId: string): Promise<LeagueStorylineCardData | null> {
  const constitution = await prismaAny.leagueStoryline.findFirst({
    where: { leagueId, storyType: 'constitution' },
    orderBy: { updatedAt: 'desc' },
  })

  if (!constitution) return null

  return {
    title: constitution.title,
    summary: constitution.summary,
    body: constitution.body,
    createdAtLabel: formatDateTime(constitution.updatedAt),
  }
}

async function buildMatchupPreviewCard(leagueId: string): Promise<LeagueMatchupPreviewCardData | null> {
  const preview = await prismaAny.leagueMatchupPreview.findFirst({
    where: { leagueId },
    orderBy: [{ season: 'desc' }, { week: 'desc' }, { updatedAt: 'desc' }],
  })

  if (!preview) return null

  return {
    headline: preview.headline,
    summary: preview.summary,
    confidenceLabel:
      typeof preview.confidenceScore === 'number'
        ? `Confidence ${Math.round(preview.confidenceScore * 100)}%`
        : null,
  }
}

async function buildKeeperDeclarationsCard(
  leagueId: string
): Promise<LeagueKeeperDeclarationItem[]> {
  const declarations = await prismaAny.keeperDeclaration.findMany({
    where: { leagueId },
    orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
    take: 6,
    select: {
      id: true,
      playerName: true,
      playerId: true,
      status: true,
      roundCost: true,
      salaryValue: true,
    },
  })

  return declarations.map((item: any) => ({
    id: item.id,
    playerName: item.playerName ?? `Player ${item.playerId}`,
    status: titleCase(item.status),
    costLabel:
      item.salaryValue != null
        ? `$${item.salaryValue}`
        : item.roundCost != null
          ? `Round ${item.roundCost}`
          : 'Commissioner cost',
  }))
}

function buildPowerRankingsCard(standings: LeagueTeamRow[]): LeaguePowerRankingItem[] {
  return standings.slice(0, 5).map((team, index) => ({
    id: team.id,
    rank: index + 1,
    name: team.name,
    record: formatRecord(team.record.wins, team.record.losses, team.record.ties),
    pointsFor: team.pointsFor.toFixed(1),
  }))
}

function getCurrentTeamExternalId(playerData: Prisma.JsonValue | null | undefined): string | null {
  const record = toJsonRecord(playerData)
  const sourceTeamId = record.source_team_id
  return typeof sourceTeamId === 'string' && sourceTeamId.trim() ? sourceTeamId.trim() : null
}

function buildLeagueTeamRows(
  context: LeagueContext,
  currentTeamExternalId: string | null
): LeagueTeamRow[] {
  const rosterBySourceTeam = new Map<string, { faabRemaining: number | null; waiverPriority: number | null }>()
  for (const roster of context.allRosters) {
    const sourceTeamId = getCurrentTeamExternalId(roster.playerData)
    if (!sourceTeamId) continue
    rosterBySourceTeam.set(sourceTeamId, {
      faabRemaining: roster.faabRemaining,
      waiverPriority: roster.waiverPriority,
    })
  }

  return context.leagueTeams.map((team, index) => {
    const rosterMeta = rosterBySourceTeam.get(team.externalId)
    return {
      id: team.id,
      externalId: team.externalId,
      rank: team.currentRank ?? index + 1,
      name: team.teamName || team.ownerName || 'Free',
      handle: team.ownerName || null,
      avatarUrl: team.avatarUrl,
      faab: rosterMeta?.faabRemaining ?? null,
      waiverPriority: rosterMeta?.waiverPriority ?? null,
      draftPosition: index + 1,
      record: {
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
      },
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      isCurrentUser: currentTeamExternalId != null && team.externalId === currentTeamExternalId,
    }
  })
}

async function buildRosterCard(context: LeagueContext): Promise<LeagueRosterCard> {
  const sport = context.league.sport
  const settings = toJsonRecord(context.league.settings)
  const currentRoster = context.currentRoster
  const playerData = currentRoster?.playerData ?? {}
  const playerDataRecord = toJsonRecord(playerData)
  const allPlayers = toStringArray(playerDataRecord.players)
  const starters = toStringArray(playerDataRecord.starters)
  const reserve = toStringArray(playerDataRecord.reserve)
  const taxi = toStringArray(playerDataRecord.taxi)
  const draftPicksRaw = Array.isArray(playerDataRecord.draftPicks) ? playerDataRecord.draftPicks : []
  const currentTeamExternalId = getCurrentTeamExternalId(playerData)
  const currentTeam = context.leagueTeams.find((team) => team.externalId === currentTeamExternalId) ?? null

  const template = await getRosterTemplateForLeague(
    sport,
    context.league.isDynasty ? 'dynasty' : 'standard',
    context.league.id
  ).catch(() => null)

  const rosterPlayerIndex = await resolvePlayerIndex(String(sport), [
    ...allPlayers,
    ...reserve,
    ...taxi,
  ])

  const totalAllowed = template
    ? template.slots.reduce(
        (sum, slot) =>
          sum +
          slot.starterCount +
          slot.benchCount +
          slot.reserveCount +
          slot.taxiCount +
          slot.devyCount,
        0
      )
    : allPlayers.length

  const starterSlots = template
    ? template.slots
        .filter((slot) => slot.starterCount > 0)
        .flatMap((slot) => Array.from({ length: slot.starterCount }, () => slot.slotName))
    : starters.map((_playerId, index) => (index === 0 ? 'QB' : 'FLEX'))

  const starterItems: LeagueRosterSlot[] = starters.map((playerId, index) => ({
    id: `starter-${playerId}-${index}`,
    slot: starterSlots[index] ?? 'FLEX',
    slotLabel: formatSlotLabel(starterSlots[index] ?? 'FLEX'),
    pill: normalizeSlotPill(starterSlots[index] ?? 'FLEX'),
    player: toResolvedLeaguePlayer(rosterPlayerIndex.get(playerId), playerId, {
      rosterPercent: null,
      startPercent: null,
      score: null,
    }),
  }))

  const starterSet = new Set(starters)
  const reserveSet = new Set(reserve)
  const taxiSet = new Set(taxi)
  const benchIds = allPlayers.filter((playerId) => !starterSet.has(playerId) && !reserveSet.has(playerId) && !taxiSet.has(playerId))

  const makeSectionItems = (ids: string[], slotName: string): LeagueRosterSlot[] =>
    ids.map((playerId, index) => ({
      id: `${slotName.toLowerCase()}-${playerId}-${index}`,
      slot: slotName,
      slotLabel: formatSlotLabel(slotName),
      pill: normalizeSlotPill(slotName),
      player: toResolvedLeaguePlayer(rosterPlayerIndex.get(playerId), playerId),
    }))

  const draftPicks = draftPicksRaw.map((entry) => {
    if (typeof entry === 'string') return entry
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const season = record.season ? String(record.season) : String(context.league.season ?? '')
      const round = record.round ? `${record.round}${typeof record.round === 'number' ? 'th' : ''}` : 'Pick'
      const slot = record.pick ? ` - ${record.pick}` : ''
      return `${season} ${round}${slot}`.trim()
    }
    return 'Future draft pick'
  })

  const sections: LeagueRosterSection[] = [
    {
      id: 'starters',
      title: 'Starters',
      emptyLabel: 'No starters loaded yet.',
      items: starterItems,
    },
    {
      id: 'bench',
      title: 'Bench',
      emptyLabel: 'No bench players yet.',
      items: makeSectionItems(benchIds, 'BENCH'),
    },
    {
      id: 'ir',
      title: 'Injured Reserve',
      emptyLabel: 'No injured reserve players.',
      items: makeSectionItems(reserve, 'IR'),
    },
    {
      id: 'taxi',
      title: 'Taxi Squad',
      emptyLabel: 'No taxi squad players.',
      items: makeSectionItems(taxi, 'TAXI'),
    },
  ]

  return {
    rosterId: currentRoster?.id ?? 'unlinked',
    sourceTeamId: currentTeamExternalId,
    teamId: currentTeam?.id ?? null,
    teamName: currentTeam?.teamName || currentTeam?.ownerName || 'Free',
    ownerName: currentTeam?.ownerName ?? null,
    avatarUrl: currentTeam?.avatarUrl ?? context.league.avatarUrl ?? null,
    record: {
      wins: currentTeam?.wins ?? 0,
      losses: currentTeam?.losses ?? 0,
      ties: currentTeam?.ties ?? 0,
    },
    faabRemaining: currentRoster?.faabRemaining ?? null,
    waiverPriority: currentRoster?.waiverPriority ?? null,
    overRosterLimitBy: Math.max(0, allPlayers.length - totalAllowed),
    sections,
    draftPicks,
  }
}

async function buildScoringSections(leagueId: string): Promise<LeagueScoringSection[]> {
  const config = await getLeagueScoringConfig(leagueId).catch(() => null)
  if (!config) return []

  const sections = new Map<string, LeagueScoringSection>()
  for (const rule of config.rules) {
    const title = categorizeRule(rule.statKey)
    if (!sections.has(title)) {
      sections.set(title, { id: title.toLowerCase().replace(/\s+/g, '-'), title, rows: [] })
    }
    sections.get(title)!.rows.push({
      id: rule.statKey,
      label: titleCase(rule.statKey),
      value: formatScoringValue(rule.statKey, rule.pointsValue),
      numericValue: rule.pointsValue,
      isPositive: rule.pointsValue > 0,
      isNegative: rule.pointsValue < 0,
      isHighlighted: rule.isOverridden,
    })
  }

  return Array.from(sections.values())
}

async function buildSettingsItems(context: LeagueContext): Promise<LeagueSettingsItem[]> {
  const [playoffConfig, waiverConfig, scheduleConfig] = await Promise.all([
    getPlayoffConfigForLeague(context.league.id).catch(() => null),
    getWaiverConfigForLeague(context.league.id).catch(() => null),
    getScheduleConfigForLeague(context.league.id).catch(() => null),
  ])

  const template = await getRosterTemplateForLeague(
    context.league.sport,
    context.league.isDynasty ? 'dynasty' : 'standard',
    context.league.id
  ).catch(() => null)

  const settings = toJsonRecord(context.league.settings)
  const rosterText = template ? formatRosterSummary(template.slots) : 'Roster template unavailable'

  return [
    {
      id: 'teams',
      label: 'Number of Teams',
      value: String(context.league.leagueSize ?? context.leagueTeams.length ?? 0),
    },
    {
      id: 'roster',
      label: 'Roster',
      value: rosterText,
    },
    {
      id: 'playoffs',
      label: 'Playoffs',
      value: playoffConfig
        ? `${playoffConfig.playoff_team_count} teams, starts week ${playoffConfig.playoff_start_week ?? '-'}`
        : 'Playoff format unavailable',
    },
    {
      id: 'waivers',
      label: 'Daily Waivers',
      value: waiverConfig
        ? formatWaiverProcessing(waiverConfig.processing_days, waiverConfig.processing_time_utc)
        : 'Waiver processing unavailable',
    },
    {
      id: 'clear-waivers',
      label: 'Clear Waivers',
      value: waiverConfig?.instant_fa_after_clear ? 'Instant free agents after clear' : 'Standard waivers',
    },
    {
      id: 'waiver-time',
      label: 'Waiver Time',
      value: waiverConfig?.processing_time_utc ? `${waiverConfig.processing_time_utc} UTC` : 'Not configured',
    },
    {
      id: 'trade-deadline',
      label: 'Trade Deadline',
      value:
        typeof settings.trade_deadline_week === 'number'
          ? `Week ${settings.trade_deadline_week}`
          : typeof settings.trade_deadline === 'string'
            ? settings.trade_deadline
            : 'Not configured',
    },
    {
      id: 'ir-slots',
      label: 'Injured Reserve Slots',
      value: template
        ? String(template.slots.reduce((sum, slot) => sum + slot.reserveCount, 0))
        : String(settings.ir_slots ?? 0),
    },
    {
      id: 'draft-pick-trading',
      label: 'Draft Pick Trading Allowed',
      value: settings.allow_draft_pick_trading === false ? 'No' : 'Yes',
    },
    {
      id: 'player-auto-subs',
      label: 'Player Auto-Subs',
      value: settings.player_auto_subs === true ? 'Enabled' : 'None',
      badge: 'NEW',
    },
    {
      id: 'schedule',
      label: 'Schedule',
      value: scheduleConfig
        ? `${titleCase(scheduleConfig.matchup_cadence)} · ${scheduleConfig.regular_season_length} regular season`
        : 'Schedule config unavailable',
    },
  ]
}

async function buildActivityItems(context: LeagueContext): Promise<LeagueActivityItem[]> {
  const rosterById = new Map(context.allRosters.map((roster) => [roster.id, roster]))
  const teamBySourceTeam = new Map(context.leagueTeams.map((team) => [team.externalId, team]))

  const [waiverRows, tradeHistories] = await Promise.all([
    prisma.waiverTransaction.findMany({
      where: { leagueId: context.league.id },
      orderBy: { processedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        rosterId: true,
        addPlayerId: true,
        dropPlayerId: true,
        faabSpent: true,
        processedAt: true,
      },
    }),
    prisma.leagueTradeHistory.findMany({
      where: { sleeperLeagueId: context.league.platformLeagueId },
      orderBy: { updatedAt: 'desc' },
      take: 4,
      include: {
        trades: {
          orderBy: { tradeDate: 'desc' },
          take: 2,
        },
      },
    }).catch(() => []),
  ])

  const activityPlayerIds = Array.from(
    new Set(
      waiverRows.flatMap((row) => [row.addPlayerId, row.dropPlayerId]).filter((value): value is string => Boolean(value))
    )
  )
  const playerIndex = await resolvePlayerIndex(String(context.league.sport), activityPlayerIds)

  const waiverItems: LeagueActivityItem[] = waiverRows.map((row) => {
    const roster = rosterById.get(row.rosterId)
    const sourceTeamId = getCurrentTeamExternalId(roster?.playerData)
    const team = sourceTeamId ? teamBySourceTeam.get(sourceTeamId) : null
    const addPlayer = row.addPlayerId ? playerIndex.get(row.addPlayerId) : null
    const dropPlayer = row.dropPlayerId ? playerIndex.get(row.dropPlayerId) : null
    return {
      id: row.id,
      type: 'waiver',
      managerName: team?.teamName || team?.ownerName || 'Manager',
      badge: row.faabSpent != null ? 'WAIVERED' : 'FREE AGENCY',
      badgeTone: row.faabSpent != null ? 'teal' : 'neutral',
      timestamp: formatDateTime(row.processedAt),
      amountLabel: row.faabSpent != null ? `BID $${row.faabSpent}` : null,
      lines: [
        ...(addPlayer
          ? [{
              type: 'add' as const,
              label: 'ADD',
              playerName: addPlayer.name,
              playerMeta: `${addPlayer.position}${addPlayer.team ? ` - ${addPlayer.team}` : ''}`,
              headshotUrl: addPlayer.headshotUrl,
            }]
          : []),
        ...(dropPlayer
          ? [{
              type: 'drop' as const,
              label: 'DROP',
              playerName: dropPlayer.name,
              playerMeta: `${dropPlayer.position}${dropPlayer.team ? ` - ${dropPlayer.team}` : ''}`,
              headshotUrl: dropPlayer.headshotUrl,
            }]
          : []),
      ],
    }
  })

  const tradeItems: LeagueActivityItem[] = tradeHistories
    .flatMap((history) =>
      history.trades.map((trade) => ({
        id: trade.id,
        type: 'trade' as const,
        managerName: history.sleeperUsername,
        badge: 'TRADE',
        badgeTone: 'teal' as const,
        timestamp: formatDateTime(trade.tradeDate ?? history.updatedAt),
        summary: `Trade between ${history.sleeperUsername}${trade.partnerName ? ` and ${trade.partnerName}` : ''}`,
        lines: [{
          type: 'note' as const,
          label: 'View this trade',
        }],
      }))
    )

  return [...waiverItems, ...tradeItems]
    .sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return timeB - timeA
    })
    .slice(0, 12)
}

function jsonAssetLabels(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const name = typeof record.player_name === 'string' ? record.player_name : typeof record.name === 'string' ? record.name : null
        const round = typeof record.round === 'number' ? `${record.round}${record.season ? ` ${record.season}` : ''}` : null
        return name || round || null
      }
      return null
    })
    .filter((entry): entry is string => Boolean(entry))
}

async function buildTradesData(context: LeagueContext): Promise<LeagueTradesData> {
  const tradeBlockRows = await prisma.tradeBlockEntry.findMany({
    where: {
      sleeperLeagueId: context.league.platformLeagueId,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  }).catch(() => [])

  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: context.league.platformLeagueId },
    orderBy: { updatedAt: 'desc' },
    include: {
      trades: {
        orderBy: { tradeDate: 'desc' },
        take: 10,
      },
    },
    take: 6,
  }).catch(() => [])

  const blockPlayerIds = tradeBlockRows.map((row) => row.playerId)
  const tradePlayerIds = histories.flatMap((history) =>
    history.trades.flatMap((trade) => [
      ...jsonAssetLabels(trade.playersGiven as Prisma.JsonValue),
      ...jsonAssetLabels(trade.playersReceived as Prisma.JsonValue),
    ])
  )
  const mediaIndex = await resolvePlayerIndex(String(context.league.sport), blockPlayerIds)

  const tradeBlock: LeagueTradeBlockItem[] = tradeBlockRows.map((row, index) => {
    const player = mediaIndex.get(row.playerId)
    return {
      id: row.id,
      name: row.playerName,
      sublabel: `${row.position ?? 'FLEX'}${row.team ? ` • ${row.team}` : ''}`,
      headshotUrl: player?.headshotUrl ?? null,
      accent: index % 4 === 0 ? 'blue' : index % 4 === 1 ? 'teal' : index % 4 === 2 ? 'orange' : 'slate',
    }
  })

  const tradeRows: LeagueTradeHistoryItem[] = histories
    .flatMap((history) =>
      history.trades.map((trade) => {
        const sentLabels = [
          ...jsonAssetLabels(trade.playersGiven as Prisma.JsonValue),
          ...jsonAssetLabels(trade.picksGiven as Prisma.JsonValue),
        ]
        const receivedLabels = [
          ...jsonAssetLabels(trade.playersReceived as Prisma.JsonValue),
          ...jsonAssetLabels(trade.picksReceived as Prisma.JsonValue),
        ]

        const toAsset = (label: string, index: number): LeagueTradeAsset => ({
          id: `${trade.id}-${label}-${index}`,
          label,
          sublabel: label.toLowerCase().includes('pick') ? 'PICK' : null,
          headshotUrl: null,
          accent: index % 3 === 0 ? 'teal' : index % 3 === 1 ? 'blue' : 'orange',
        })

        const direction =
          trade.valueReceived != null && trade.valueGiven != null
            ? trade.valueReceived >= trade.valueGiven
              ? 'incoming'
              : 'outgoing'
            : 'complete'

        return {
          id: trade.id,
          direction,
          partnerName: trade.partnerName || history.sleeperUsername || 'Trade partner',
          timestamp: formatDateTime(trade.tradeDate ?? history.updatedAt),
          sent: sentLabels.map(toAsset),
          received: receivedLabels.map(toAsset),
        }
      })
    )

  return {
    tradeBlock,
    activeTrades: tradeRows.slice(0, 4),
    history: tradeRows.slice(4, 10),
  }
}

async function buildPlayersData(
  context: LeagueContext,
  variant: LeagueVariantSummary
): Promise<LeaguePlayersData> {
  const sport = String(context.league.sport)
  const rosterIds = Array.from(
    new Set(context.allRosters.flatMap((roster) => toStringArray(toJsonRecord(roster.playerData).players)))
  )

  const rosterOwnerByPlayerId = new Map<string, string>()
  for (const roster of context.allRosters) {
    const sourceTeamId = getCurrentTeamExternalId(roster.playerData)
    const team = sourceTeamId
      ? context.leagueTeams.find((entry) => entry.externalId === sourceTeamId)
      : null
    const ownerLabel = team?.teamName || team?.ownerName || null
    for (const playerId of toStringArray(toJsonRecord(roster.playerData).players)) {
      if (ownerLabel) rosterOwnerByPlayerId.set(playerId, ownerLabel)
    }
  }

  const [trendRows, availableRows, leaderRows] = await Promise.all([
    prisma.playerMetaTrend.findMany({
      where: { sport: sport.toUpperCase() },
      orderBy: [{ trendScore: 'desc' }, { updatedAt: 'desc' }],
      take: 12,
      select: {
        playerId: true,
        trendScore: true,
        lineupStartRate: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('player trends', error)
      return []
    }),
    prisma.sportsPlayerRecord.findMany({
      where: {
        sport: sport.toUpperCase(),
        id: { notIn: rosterIds },
      },
      orderBy: [{ adp: 'asc' }, { lastUpdated: 'desc' }],
      take: 12,
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        stats: true,
        adp: true,
        headshotUrl: true,
        injuryStatus: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('available players', error)
      return []
    }),
    prisma.sportsPlayerRecord.findMany({
      where: { sport: sport.toUpperCase() },
      orderBy: [{ adp: 'asc' }, { lastUpdated: 'desc' }],
      take: 12,
      select: {
        id: true,
        name: true,
        position: true,
        team: true,
        stats: true,
        adp: true,
        headshotUrl: true,
        injuryStatus: true,
      },
    }).catch((error) => {
      logOptionalLeagueDataWarning('player leaders', error)
      return []
    }),
  ])

  const trendIndex = await resolvePlayerIndex(sport, trendRows.map((row) => row.playerId))

  const trend = trendRows.map((row) =>
    toResolvedLeaguePlayer(trendIndex.get(row.playerId), row.playerId, {
      trendValue: row.trendScore,
      rosterPercent: row.lineupStartRate != null ? Math.round(row.lineupStartRate * 1000) / 10 : null,
    })
  )

  const available = availableRows.map((row) =>
    toResolvedLeaguePlayer(
      {
        id: row.id,
        name: row.name,
        position: row.position,
        team: row.team,
        adp: row.adp,
        injuryStatus: row.injuryStatus,
        stats: toJsonRecord(row.stats),
        headshotUrl: row.headshotUrl,
        teamLogoUrl: null,
      },
      row.id,
      {
        adp: row.adp,
        stats: extractNumericStats(row.stats, row.position),
      }
    )
  )

  const leaders = leaderRows.map((row) =>
    toResolvedLeaguePlayer(
      {
        id: row.id,
        name: row.name,
        position: row.position,
        team: row.team,
        adp: row.adp,
        injuryStatus: row.injuryStatus,
        stats: toJsonRecord(row.stats),
        headshotUrl: row.headshotUrl,
        teamLogoUrl: null,
      },
      row.id,
      {
        adp: row.adp,
        ownerLabel: rosterOwnerByPlayerId.get(row.id) ?? null,
        stats: extractNumericStats(row.stats, row.position),
      }
    )
  )

  const search = context.leagueTeams.map((team) => ({
    id: team.id,
    name: team.teamName || team.ownerName || 'Defense',
    teamCode: team.teamName || null,
    logoUrl: team.avatarUrl ?? null,
    watchLabel: 'W/Fri',
  }))

  const college = await buildCollegePlayersData(context, variant)

  return {
    search,
    trend,
    available,
    leaders,
    college,
  }
}

function seedPairings(teams: LeagueTeamRow[]): Array<[LeagueTeamRow | null, LeagueTeamRow | null]> {
  const pairings: Array<[LeagueTeamRow | null, LeagueTeamRow | null]> = []
  let left = 0
  let right = teams.length - 1
  while (left < right) {
    pairings.push([teams[left] ?? null, teams[right] ?? null])
    left += 1
    right -= 1
  }
  if (left === right) {
    pairings.push([teams[left] ?? null, null])
  }
  return pairings
}

function toBracketTeam(team: LeagueTeamRow | null, score: number | null): LeagueBracketMatchupTeam | null {
  if (!team) return null
  return {
    seed: team.rank,
    name: team.handle || team.name,
    avatarUrl: team.avatarUrl,
    score,
    isCurrentUser: team.isCurrentUser,
  }
}

async function buildBracket(context: LeagueContext, standings: LeagueTeamRow[]): Promise<{ rounds: LeagueBracketRound[] }> {
  const playoff = await getPlayoffConfigForLeague(context.league.id).catch(() => null)
  if (!playoff || playoff.playoff_team_count <= 1) {
    return { rounds: [] }
  }

  const roundCount = playoff.total_rounds ?? Math.max(1, playoff.playoff_weeks)
  const firstWeek = playoff.playoff_start_week ?? 15
  const seededTeams = standings.slice(0, playoff.playoff_team_count)
  const matchupFacts = await prisma.matchupFact.findMany({
    where: {
      leagueId: context.league.id,
      weekOrPeriod: {
        gte: firstWeek,
        lte: firstWeek + roundCount - 1,
      },
    },
    orderBy: [{ weekOrPeriod: 'asc' }, { matchupId: 'asc' }],
  })

  const teamByRef = new Map<string, LeagueTeamRow>()
  for (const team of standings) {
    teamByRef.set(team.id, team)
    teamByRef.set(team.externalId, team)
  }

  const rounds: LeagueBracketRound[] = []
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const week = firstWeek + roundIndex
    const facts = matchupFacts.filter((fact) => fact.weekOrPeriod === week)
    let matchups: LeagueBracketMatchup[]
    if (facts.length > 0) {
      matchups = facts.map((fact, index) => ({
        id: `${fact.matchupId}-${roundIndex}-${index}`,
        label: roundIndex === roundCount - 1 ? 'Championship' : `Matchup ${index + 1}`,
        teamA: toBracketTeam(teamByRef.get(fact.teamA) ?? null, fact.scoreA),
        teamB: toBracketTeam(teamByRef.get(fact.teamB) ?? null, fact.scoreB),
      }))
    } else if (roundIndex === 0) {
      matchups = seedPairings(seededTeams).map(([teamA, teamB], index) => ({
        id: `seed-${index}`,
        label: `Seed ${teamA?.rank ?? index + 1}`,
        teamA: toBracketTeam(teamA, 0),
        teamB: toBracketTeam(teamB, 0),
      }))
    } else {
      const previousRoundSize = Math.max(1, Math.ceil((rounds[roundIndex - 1]?.matchups.length ?? 2) / 2))
      matchups = Array.from({ length: previousRoundSize }).map((_, index) => ({
        id: `placeholder-${roundIndex}-${index}`,
        label: roundIndex === roundCount - 1 ? 'Championship' : `Round ${roundIndex + 1}`,
        teamA: null,
        teamB: null,
      }))
    }

    rounds.push({
      id: `round-${roundIndex + 1}`,
      title: roundIndex === roundCount - 1 ? 'FINALS' : `ROUND ${roundIndex + 1}`,
      subtitle: `Week ${week}`,
      matchups,
    })
  }

  return { rounds }
}

async function buildChatPreview(leagueId: string): Promise<LeagueChatPreview> {
  const messages = await getLeagueChatMessages(leagueId, { limit: 3 }).catch(() => [])
  const latest = messages[messages.length - 1] ?? null
  return {
    href: `/messages`,
    senderName: latest?.senderName ?? null,
    preview: latest?.body || 'League chat is ready when your managers are.',
  }
}

export async function getLeagueStandingsView(leagueId: string, userId: string) {
  const context = await loadLeagueContext(leagueId, userId)
  if (!context) return null
  const currentTeamExternalId = getCurrentTeamExternalId(context.currentRoster?.playerData)
  const standings = buildLeagueTeamRows(context, currentTeamExternalId)
  const bracket = await buildBracket(context, standings)
  return { standings, bracket }
}

export async function getLeagueRosterView(leagueId: string, userId: string) {
  const context = await loadLeagueContext(leagueId, userId)
  if (!context) return null
  const variant = await buildVariantSummary(context)
  const roster = await buildRosterCard(context)
  const collegeSections = await buildCollegeRosterSections(context, variant)
  return {
    ...roster,
    collegeSections,
  }
}

export async function getLeagueActivityView(leagueId: string, userId: string) {
  const context = await loadLeagueContext(leagueId, userId)
  if (!context) return null
  return buildActivityItems(context)
}

export async function getLeagueTradesView(leagueId: string, userId: string) {
  const context = await loadLeagueContext(leagueId, userId)
  if (!context) return null
  return buildTradesData(context)
}

export async function getLeagueHomeData(
  leagueId: string,
  userId: string,
  requestedTab?: string | null
): Promise<LeagueHomeData | null> {
  const context = await loadLeagueContext(leagueId, userId)
  if (!context) return null

  const activeTab = isLeagueTopTab(requestedTab) ? requestedTab.toUpperCase() as LeagueTopTab : 'TEAM'
  const currentTeamExternalId = getCurrentTeamExternalId(context.currentRoster?.playerData)
  const standings = buildLeagueTeamRows(context, currentTeamExternalId)
  const variant = await buildVariantSummary(context)

  const [
    baseRoster,
    collegeSections,
    settingsItems,
    scoringSections,
    activity,
    trades,
    players,
    bracket,
    chat,
    introVideo,
    storyline,
    matchupPreview,
    draftRecap,
    constitution,
    keeperDeclarations,
  ] = await Promise.all([
    buildRosterCard(context),
    buildCollegeRosterSections(context, variant),
    buildSettingsItems(context),
    buildScoringSections(context.league.id),
    buildActivityItems(context),
    buildTradesData(context),
    buildPlayersData(context, variant),
    buildBracket(context, standings),
    buildChatPreview(context.league.id),
    buildIntroVideoData(context, userId),
    buildStorylineCard(context.league.id),
    buildMatchupPreviewCard(context.league.id),
    buildDraftRecapCard(context.league.id),
    buildConstitutionCard(context.league.id),
    buildKeeperDeclarationsCard(context.league.id),
  ])
  const roster = {
    ...baseRoster,
    collegeSections,
  }
  const draftSummaryCards = buildDraftSummaryCards(variant, roster)
  const powerRankings = buildPowerRankingsCard(standings)

  const settings = toJsonRecord(context.league.settings)
  const leagueRole = await getLeagueRole(leagueId, userId)
  const lifecycleSnap = getAllowedActions({
    lifecycleState: context.league.lifecycleState,
    locked: context.league.locked,
    emergencyPaused: context.league.emergencyPaused,
  })

  return {
    league: {
      id: context.league.id,
      name: context.league.name || 'League',
      sport: String(context.league.sport),
      season: context.league.season,
      leagueSize: context.league.leagueSize,
      avatarUrl: context.league.avatarUrl,
      leagueVariant: context.league.leagueVariant,
      leagueType: typeof settings.league_type === 'string' ? settings.league_type : null,
      isDynasty: context.league.isDynasty,
      currentWeek: resolveCurrentWeekFromLeagueSettings(context.league.settings),
      lifecycle: {
        state: lifecycleSnap.state,
        locked: lifecycleSnap.locked,
        emergencyPaused: lifecycleSnap.emergencyPaused,
        allowedActions: lifecycleSnap.actions,
      },
    },
    variant,
    introVideo,
    currentUserId: userId,
    isCommissioner: context.isCommissioner,
    leagueRole,
    activeTab,
    teamsInDraftOrder: standings,
    standings,
    settingsItems,
    scoringSections,
    roster,
    activity,
    trades,
    players,
    draftSummaryCards,
    storyline,
    matchupPreview,
    draftRecap,
    constitution,
    keeperDeclarations,
    powerRankings,
    bracket,
    chat,
  }
}
