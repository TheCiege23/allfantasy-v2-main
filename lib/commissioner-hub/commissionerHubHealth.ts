import type { UserLeague } from '@/app/dashboard/types'
import { prisma } from '@/lib/prisma'
import { monitorLeagueHealth, type OverallStatus } from '@/lib/league-health/league-health-engine'
import { shouldRunCommissionerHealthShadow, shouldRunCommissionerHealthLive, runCommissionerHealthShadow } from '@/lib/decision-os/commissioner-health/shadow'
import { getDecisionShadowScopeFilters } from '@/lib/decision-os/core/shadow'
import { toCommissionerHealthCard, type CommissionerHealthCard } from '@/lib/decision-os/commissioner-health/healthCardAdapter'
import { emitLiveTelemetry } from '@/lib/decision-os/core/parity'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { getCanonicalNflDataCoverage } from '@/lib/nfl-data-foundation/nflDataCoverage'
import type { CanonicalNflDataCoverage } from '@/lib/nfl-data-foundation/types'

export type CommissionerHealthDataConfidence = 'high' | 'medium' | 'low'
export type CommissionerHealthDataSource = 'database' | 'dashboard-fallback'
export type CommissionerHealthActionTone = 'standard' | 'warning' | 'danger'

export type CommissionerHealthAction = {
  key:
    | 'force_lineup'
    | 'force_add_drop'
    | 'adjust_scores'
    | 'reverse_trade'
    | 'process_waivers'
    | 'lock_rosters'
    | 'unlock_rosters'
    | 'settings'
  label: string
  description: string
  href: string
  enabled: boolean
  requiresConfirmation: boolean
  tone: CommissionerHealthActionTone
  disabledReason?: string
}

export type CommissionerAssistantQuestion = {
  key:
    | 'missed_lineups'
    | 'injuries'
    | 'inactive_owners'
    | 'waiver_run'
    | 'league_update'
  label: string
  prompt: string
  answer: string
}

export type CommissionerLeagueHealthMetrics = {
  inactiveTeams: number
  missedLineups: number
  tradeActivity: number
  waiverActivity: number
  leagueEngagement: number
  commissionerActions: number
  pendingWaiverClaims: number
  pendingTrades: number
  openAiAlerts: number
  chatMessagesLast7Days: number
  activeManagers: number
  injuredStarters: number
  lineupSubmissionRate: number
  projectionCoveragePct: number
  lowConfidenceProjectionStarters: number
}

export type CommissionerLeagueHealthSnapshot = {
  leagueId: string
  leagueName: string
  sport: string
  leagueType: string
  season: number | string | null
  status: string | null
  teamCount: number
  currentWeek: number
  generatedAt: string
  source: CommissionerHealthDataSource
  dataConfidence: CommissionerHealthDataConfidence
  healthScore: number
  engagementScore: number
  fairnessScore: number
  sustainabilityScore: number
  overallStatus: OverallStatus
  healthTrend: string
  summary: string
  metrics: CommissionerLeagueHealthMetrics
  alerts: string[]
  recommendations: string[]
  actions: CommissionerHealthAction[]
  assistantQuestions: CommissionerAssistantQuestion[]
  nflDataCoverage?: CanonicalNflDataCoverage | null
  decisionOsShadow?: {
    decisionId: string
    parityPassed: boolean | null
    card: CommissionerHealthCard
  } | null
}

type CountMap = Map<string, number>

type RosterHealthRow = {
  id?: string | null
  platformUserId?: string | null
  playerData?: unknown
  updatedAt?: Date | string | null
  settings?: unknown
}

type LeagueHealthRow = {
  id: string
  name?: string | null
  sport?: string | null
  season?: number | string | null
  leagueSize?: number | null
  teamCount?: number | null
  status?: string | null
  lifecycleState?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
  scoring?: string | null
  settings?: unknown
  starters?: unknown
  waiverType?: string | null
  tradeReviewHours?: number | null
  playoffTeams?: number | null
  lockAllMoves?: boolean | null
  rosters?: RosterHealthRow[]
}

export type CommissionerHealthBuildInput = {
  league: LeagueHealthRow
  now?: Date
  source?: CommissionerHealthDataSource
  nflDataCoverage?: CanonicalNflDataCoverage | null
  counts?: Partial<{
    tradeActivity: number
    pendingTrades: number
    waiverActivity: number
    pendingWaiverClaims: number
    chatMessagesLast7Days: number
    commissionerActions: number
    openAiAlerts: number
  }>
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000
const RESERVE_SLOT_KEYS = new Set([
  'BN',
  'BE',
  'BENCH',
  'IR',
  'IR+',
  'IL',
  'IL+',
  'TAXI',
  'DEVY',
  'NA',
  'RESERVE',
  'MINORS',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numberOr(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function positiveInt(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(numberOr(value, fallback)))
}

function readCurrentWeek(settings: unknown): number {
  const s = asRecord(settings)
  return Math.max(1, positiveInt(s.currentWeek ?? s.current_week ?? s.week, 1))
}

function normalizeSlotKey(key: string): string {
  return key.trim().replace(/\s+/g, '_').replace(/-/g, '_').toUpperCase()
}

function sumStarterSlots(raw: unknown): number {
  if (Array.isArray(raw)) {
    return raw.filter((slot) => {
      const key = normalizeSlotKey(String(slot))
      return key && !RESERVE_SLOT_KEYS.has(key)
    }).length
  }

  const obj = asRecord(raw)
  let total = 0
  for (const [key, value] of Object.entries(obj)) {
    const normalized = normalizeSlotKey(key)
    if (!normalized || RESERVE_SLOT_KEYS.has(normalized)) continue
    total += positiveInt(value, 0)
  }
  return total
}

function readRequiredStarterCount(league: LeagueHealthRow): number {
  const settings = asRecord(league.settings)
  const rosterTemplate = asRecord(settings.rosterTemplate)

  const candidates = [
    league.starters,
    settings.starters,
    settings.rosterPositions,
    settings.roster_positions,
    rosterTemplate.starters,
    rosterTemplate.positions,
    rosterTemplate.slots,
  ]

  for (const candidate of candidates) {
    const count = sumStarterSlots(candidate)
    if (count > 0) return count
  }

  return 0
}

function countIds(raw: unknown): number {
  if (!raw) return 0
  if (Array.isArray(raw)) return raw.filter(Boolean).length
  const obj = asRecord(raw)
  if (Array.isArray(obj.players)) return obj.players.filter(Boolean).length
  return Object.keys(obj).length
}

function countRosterPlayers(playerData: unknown): number {
  if (Array.isArray(playerData)) return countIds(playerData)
  const data = asRecord(playerData)
  if (Array.isArray(data.players)) return countIds(data.players)
  const sections = getNormalizedLineupSections(playerData)
  const sectionCount =
    sections.starters.length +
    sections.bench.length +
    sections.ir.length +
    sections.taxi.length +
    sections.devy.length
  if (sectionCount > 0) return sectionCount
  return countIds(data.starters) + countIds(data.reserve) + countIds(data.taxi) + countIds(data.devy)
}

function countStarters(playerData: unknown): number {
  const sections = getNormalizedLineupSections(playerData)
  if (sections.starters.length > 0) return sections.starters.length
  const data = asRecord(playerData)
  return countIds(data.starters)
}

function starterRows(playerData: unknown): Array<Record<string, unknown>> {
  const sections = getNormalizedLineupSections(playerData)
  if (sections.starters.length > 0) return sections.starters
  const data = asRecord(playerData)
  const raw = data.starters
  if (!Array.isArray(raw)) return []
  return raw.map((item) => asRecord(item)).filter((item) => Object.keys(item).length > 0)
}

function isInjuryRisk(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase()
  return Boolean(normalized) && (
    normalized.includes('out') ||
    normalized.includes('ir') ||
    normalized.includes('questionable') ||
    normalized.includes('doubtful') ||
    normalized.includes('injured') ||
    normalized === 'q' ||
    normalized === 'd'
  )
}

function hasProjectionSignal(row: Record<string, unknown>): boolean {
  const candidates = [
    row.weekProjection,
    row.projectedPoints,
    row.projected,
    row.projection,
    row.fantasyPointsPerGame,
  ]
  const nested = asRecord(asRecord(row.normalizedProjections).allFantasyProjection)
  candidates.push(nested.weeklyProjection)
  return candidates.some((value) => numberOr(value, NaN) > 0)
}

function isLowConfidenceProjection(row: Record<string, unknown>): boolean {
  const nested = asRecord(asRecord(row.normalizedProjections).allFantasyProjection)
  const level = String(row.projectionConfidenceLevel ?? nested.confidenceLevel ?? '').toLowerCase()
  const score = numberOr(row.projectionConfidenceScore ?? nested.confidenceScore, 100)
  return level === 'low' || score < 58
}

function countProjectionSignals(rosters: RosterHealthRow[]): {
  starters: number
  withProjection: number
  lowConfidence: number
} {
  let starters = 0
  let withProjection = 0
  let lowConfidence = 0
  for (const roster of rosters) {
    for (const row of starterRows(roster.playerData)) {
      starters += 1
      if (hasProjectionSignal(row)) withProjection += 1
      if (hasProjectionSignal(row) && isLowConfidenceProjection(row)) lowConfidence += 1
    }
  }
  return { starters, withProjection, lowConfidence }
}

function countInjuredStarters(rosters: RosterHealthRow[]): number {
  return rosters.reduce((sum, roster) => {
    const rows = starterRows(roster.playerData)
    return sum + rows.filter((row) => {
      const status = row.injuryStatus ?? row.injury_status ?? row.status
      return isInjuryRisk(status)
    }).length
  }, 0)
}

function isRosterInactive(roster: RosterHealthRow, now: Date): boolean {
  const settings = asRecord(roster.settings)
  if (settings.isOrphan === true || settings.orphan === true || settings.inactive === true) return true
  if (!roster.platformUserId) return true
  if (!roster.updatedAt) return false
  const updatedAt = new Date(roster.updatedAt).getTime()
  if (!Number.isFinite(updatedAt)) return false
  return now.getTime() - updatedAt > INACTIVE_AFTER_MS
}

function countMissedLineups(rosters: RosterHealthRow[], requiredStarters: number): number {
  return rosters.filter((roster) => {
    const rosterPlayerCount = countRosterPlayers(roster.playerData)
    if (rosterPlayerCount === 0) return true
    const starterCount = countStarters(roster.playerData)
    return requiredStarters > 0 ? starterCount < requiredStarters : starterCount === 0
  }).length
}

function resolveTeamCount(league: LeagueHealthRow, rosters: RosterHealthRow[]): number {
  return (
    positiveInt(league.teamCount, 0) ||
    positiveInt(league.leagueSize, 0) ||
    rosters.length ||
    12
  )
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function countMapValue(map: CountMap | undefined, leagueId: string): number {
  return map?.get(leagueId) ?? 0
}

function getCountFromGroupRow(row: Record<string, unknown>): number {
  const count = row._count
  if (typeof count === 'number') return count
  const countObj = asRecord(count)
  return positiveInt(countObj._all ?? countObj.leagueId, 0)
}

function rowsToCountMap(rows: unknown[]): CountMap {
  const map = new Map<string, number>()
  for (const row of rows) {
    const obj = asRecord(row)
    const leagueId = typeof obj.leagueId === 'string' ? obj.leagueId : ''
    if (!leagueId) continue
    map.set(leagueId, getCountFromGroupRow(obj))
  }
  return map
}

async function safeGroupCount(
  model: unknown,
  where: Record<string, unknown>,
): Promise<CountMap> {
  const modelClient = asRecord(model)
  if (typeof modelClient.groupBy !== 'function') return new Map()
  try {
    const rows = await modelClient.groupBy({
      by: ['leagueId'],
      where,
      _count: { _all: true },
    })
    return rowsToCountMap(Array.isArray(rows) ? rows : [])
  } catch {
    return new Map()
  }
}

function buildActions(
  leagueId: string,
  lockAllMoves: boolean,
  pendingWaiverClaims: number,
  pendingTrades: number,
): CommissionerHealthAction[] {
  const base = `/league/${encodeURIComponent(leagueId)}`
  return [
    {
      key: 'force_lineup',
      label: 'Force Lineup',
      description: 'Review illegal or empty starters and apply commissioner lineup corrections.',
      href: `${base}?tab=Commissioner`,
      enabled: true,
      requiresConfirmation: true,
      tone: 'warning',
    },
    {
      key: 'force_add_drop',
      label: 'Force Add/Drop',
      description: 'Open player and roster tools for commissioner roster correction.',
      href: `${base}?tab=Players`,
      enabled: true,
      requiresConfirmation: true,
      tone: 'warning',
    },
    {
      key: 'adjust_scores',
      label: 'Adjust Scores',
      description: 'Open matchup controls for score review and audited corrections.',
      href: `${base}?tab=Matchups`,
      enabled: true,
      requiresConfirmation: true,
      tone: 'danger',
    },
    {
      key: 'reverse_trade',
      label: 'Reverse Trade',
      description: 'Review pending and completed trade records before any reversal.',
      href: `${base}?tab=Trades`,
      enabled: pendingTrades > 0,
      requiresConfirmation: true,
      tone: 'danger',
      disabledReason: pendingTrades > 0 ? undefined : 'No pending trade activity detected.',
    },
    {
      key: 'process_waivers',
      label: 'Process Waivers',
      description: 'Open waiver controls and process queued claims when ready.',
      href: `${base}?tab=Waivers`,
      enabled: pendingWaiverClaims > 0,
      requiresConfirmation: true,
      tone: 'warning',
      disabledReason: pendingWaiverClaims > 0 ? undefined : 'No pending waiver claims detected.',
    },
    {
      key: lockAllMoves ? 'unlock_rosters' : 'lock_rosters',
      label: lockAllMoves ? 'Unlock Rosters' : 'Lock Rosters',
      description: lockAllMoves
        ? 'Open commissioner settings to re-enable roster moves.'
        : 'Open commissioner settings to pause roster moves.',
      href: `${base}?tab=Settings&settingsTab=${encodeURIComponent('Commissioner Controls')}`,
      enabled: true,
      requiresConfirmation: true,
      tone: lockAllMoves ? 'standard' : 'warning',
    },
    {
      key: 'settings',
      label: 'Settings',
      description: 'Review scoring, roster, waiver, and trade settings.',
      href: `${base}?tab=Settings`,
      enabled: true,
      requiresConfirmation: false,
      tone: 'standard',
    },
  ]
}

function buildAssistantQuestions(args: {
  leagueName: string
  metrics: CommissionerLeagueHealthMetrics
  summary: string
}): CommissionerAssistantQuestion[] {
  const { leagueName, metrics, summary } = args
  const lineupAnswer = metrics.missedLineups === 0
    ? 'No missed lineup risk detected from the latest roster snapshots.'
    : `${metrics.missedLineups} team${metrics.missedLineups === 1 ? '' : 's'} need lineup attention.`
  const inactiveAnswer = metrics.inactiveTeams === 0
    ? 'No inactive owner risk detected from roster ownership and update timestamps.'
    : `${metrics.inactiveTeams} team${metrics.inactiveTeams === 1 ? ' is' : 's are'} inactive or stale.`
  const waiverAnswer = metrics.pendingWaiverClaims > 0
    ? `${metrics.pendingWaiverClaims} pending claim${metrics.pendingWaiverClaims === 1 ? '' : 's'} are queued. A waiver run is worth reviewing.`
    : 'No pending waiver claims are waiting right now.'

  return [
    {
      key: 'missed_lineups',
      label: "Who hasn't set lineups?",
      prompt: `Who has not set lineups in ${leagueName}?`,
      answer: lineupAnswer,
    },
    {
      key: 'injuries',
      label: 'Who has the most injuries?',
      prompt: `Which teams in ${leagueName} have the most injury risk?`,
      answer: metrics.injuredStarters > 0
        ? `${metrics.injuredStarters} injured or questionable starter signal${metrics.injuredStarters === 1 ? '' : 's'} detected.`
        : 'No injured starter signals detected in current lineup rows.',
    },
    {
      key: 'inactive_owners',
      label: "Which owners haven't logged in?",
      prompt: `Which owners in ${leagueName} look inactive?`,
      answer: inactiveAnswer,
    },
    {
      key: 'waiver_run',
      label: 'Suggest waiver run now.',
      prompt: `Should I run waivers now for ${leagueName}?`,
      answer: waiverAnswer,
    },
    {
      key: 'league_update',
      label: 'Generate league update.',
      prompt: `Generate a weekly commissioner update for ${leagueName}.`,
      answer: summary,
    },
  ]
}

export function buildCommissionerHealthSnapshot(
  input: CommissionerHealthBuildInput,
): CommissionerLeagueHealthSnapshot {
  const now = input.now ?? new Date()
  const league = input.league
  const rosters = Array.isArray(league.rosters) ? league.rosters : []
  const teamCount = resolveTeamCount(league, rosters)
  const requiredStarters = readRequiredStarterCount(league)
  const missedLineups = countMissedLineups(rosters, requiredStarters)
  const inactiveTeams = rosters.filter((roster) => isRosterInactive(roster, now)).length
  const injuredStarters = countInjuredStarters(rosters)
  const projectionSignals = countProjectionSignals(rosters)
  const activeManagers = Math.max(0, teamCount - inactiveTeams)
  const lineupSubmissionRate = clampPct(teamCount > 0 ? (teamCount - missedLineups) / teamCount : 1)
  const projectionCoveragePct = projectionSignals.starters > 0
    ? Math.round((projectionSignals.withProjection / projectionSignals.starters) * 100)
    : 0
  const leagueType = String(league.leagueType ?? (league.isDynasty ? 'dynasty' : 'redraft'))
  const settings = asRecord(league.settings)
  const tradeReviewProcess = String(settings.tradeReviewType ?? settings.trade_review_type ?? (
    positiveInt(league.tradeReviewHours, 48) > 0 ? 'commissioner' : 'none'
  ))
  const currentWeek = readCurrentWeek(league.settings)
  const counts = input.counts ?? {}

  const healthInput = {
    sport: String(league.sport ?? 'NFL'),
    leagueType,
    leagueId: league.id,
    numTeams: teamCount,
    currentWeek,
    totalWeeks: 17,
    activeManagers,
    inactiveManagers: inactiveTeams,
    abandonedTeams: Math.max(0, inactiveTeams - 1),
    lineupSubmissionRate,
    totalTradesThisSeason: positiveInt(counts.tradeActivity, 0),
    totalWaiverClaims: positiveInt(counts.waiverActivity, 0),
    avgFaabSpentPct: 0,
    chatMessageCount: positiveInt(counts.chatMessagesLast7Days, 0),
    voteCount: 0,
    disputeCount: 0,
    commissionerActionsThisSeason: positiveInt(counts.commissionerActions, 0),
    unresolvedDisputes: 0,
    playoffTeams: positiveInt(league.playoffTeams, Math.ceil(teamCount / 2)),
    waiverType: String(league.waiverType ?? settings.waiverType ?? settings.waiver_type ?? 'rolling'),
    tradeReviewProcess,
  }
  const health = monitorLeagueHealth(healthInput)
  const leagueEngagement = health.engagementScore

  const metrics: CommissionerLeagueHealthMetrics = {
    inactiveTeams,
    missedLineups,
    tradeActivity: positiveInt(counts.tradeActivity, 0),
    waiverActivity: positiveInt(counts.waiverActivity, 0),
    leagueEngagement,
    commissionerActions: positiveInt(counts.commissionerActions, 0),
    pendingWaiverClaims: positiveInt(counts.pendingWaiverClaims, 0),
    pendingTrades: positiveInt(counts.pendingTrades, 0),
    openAiAlerts: positiveInt(counts.openAiAlerts, 0),
    chatMessagesLast7Days: positiveInt(counts.chatMessagesLast7Days, 0),
    activeManagers,
    injuredStarters,
    lineupSubmissionRate,
    projectionCoveragePct,
    lowConfidenceProjectionStarters: projectionSignals.lowConfidence,
  }

  const source = input.source ?? 'database'
  const dataConfidence: CommissionerHealthDataConfidence =
    source === 'dashboard-fallback'
      ? 'low'
      : rosters.length > 0
        ? 'high'
        : 'medium'
  const leagueName = String(league.name ?? 'League')
  const summary = health.summary
  const nflDataCoverage = String(league.sport ?? 'NFL').toUpperCase() === 'NFL'
    ? input.nflDataCoverage ?? null
    : null

  return {
    leagueId: league.id,
    leagueName,
    sport: String(league.sport ?? 'NFL'),
    leagueType,
    season: league.season ?? null,
    status: String(league.lifecycleState ?? league.status ?? '') || null,
    teamCount,
    currentWeek,
    generatedAt: now.toISOString(),
    source,
    dataConfidence,
    healthScore: health.leagueHealthScore,
    engagementScore: health.engagementScore,
    fairnessScore: health.fairnessScore,
    sustainabilityScore: health.sustainabilityScore,
    overallStatus: health.overallStatus,
    healthTrend: health.healthTrend,
    summary,
    metrics,
    alerts: [
      ...health.urgentAlerts,
      ...health.earlyWarningSignals,
    ].slice(0, 4),
    recommendations: [
      ...health.interventionRecommendations,
      ...(nflDataCoverage?.missingFields.length
        ? [`NFL data foundation missing: ${nflDataCoverage.missingFields.join(', ')}.`]
        : []),
      ...(nflDataCoverage?.staleFields.length
        ? [`NFL data foundation stale: ${nflDataCoverage.staleFields.join(', ')}.`]
        : []),
      ...(projectionCoveragePct < 60
        ? ['Projection coverage is thin; run player stat/projection imports before relying on start/sit or waiver recommendations.']
        : []),
      ...health.commissionerHealthNotes,
    ].slice(0, 4),
    actions: buildActions(
      league.id,
      Boolean(league.lockAllMoves),
      metrics.pendingWaiverClaims,
      metrics.pendingTrades,
    ),
    assistantQuestions: buildAssistantQuestions({ leagueName, metrics, summary }),
    nflDataCoverage,
  }
}

function buildDashboardFallbackLeague(league: UserLeague): LeagueHealthRow {
  return {
    id: league.id,
    name: league.name,
    sport: league.sport,
    season: league.season ?? null,
    leagueSize: league.teamCount,
    teamCount: league.teamCount,
    status: league.status ?? null,
    lifecycleState: league.lifecycleState ?? null,
    leagueType: league.leagueType ?? (league.isDynasty ? 'dynasty' : 'redraft'),
    isDynasty: league.isDynasty ?? false,
    scoring: league.scoring ?? null,
    settings: league.settings ?? {},
    rosters: [],
  }
}

export async function getCommissionerHubHealthForUser(
  userId: string,
  leagues: UserLeague[],
): Promise<CommissionerLeagueHealthSnapshot[]> {
  if (!userId) return []
  const commissionerLeagues = leagues.filter((league) => league.isCommissioner)
  const leagueIds = commissionerLeagues.map((league) => league.id).filter(Boolean)
  if (leagueIds.length === 0) return []

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - WEEK_MS)
  const shadowFilters = getDecisionShadowScopeFilters()
  const fallbackById = new Map(
    commissionerLeagues.map((league) => [
      league.id,
      buildCommissionerHealthSnapshot({
        league: buildDashboardFallbackLeague(league),
        now,
        source: 'dashboard-fallback',
      }),
    ]),
  )

  try {
    const [
      dbLeagues,
      tradeActivity,
      legacyTradeActivity,
      pendingTrades,
      waiverActivity,
      pendingWaiverClaims,
      chatMessagesLast7Days,
      commissionerActions,
      openAiAlerts,
      shadowProfile,
    ] = await Promise.all([
      (prisma as any).league.findMany({
        where: { id: { in: leagueIds } },
        select: {
          id: true,
          name: true,
          sport: true,
          season: true,
          leagueSize: true,
          status: true,
          lifecycleState: true,
          leagueType: true,
          isDynasty: true,
          scoring: true,
          settings: true,
          starters: true,
          waiverType: true,
          tradeReviewHours: true,
          playoffTeams: true,
          lockAllMoves: true,
          rosters: {
            select: {
              id: true,
              platformUserId: true,
              playerData: true,
              updatedAt: true,
              settings: true,
            },
          },
        },
      }),
      safeGroupCount((prisma as any).redraftTradeProposal, {
        leagueId: { in: leagueIds },
        createdAt: { gte: sevenDaysAgo },
      }),
      safeGroupCount((prisma as any).redraftLeagueTrade, {
        leagueId: { in: leagueIds },
        createdAt: { gte: sevenDaysAgo },
      }),
      safeGroupCount((prisma as any).redraftTradeProposal, {
        leagueId: { in: leagueIds },
        status: 'pending',
      }),
      safeGroupCount((prisma as any).redraftWaiverClaim, {
        leagueId: { in: leagueIds },
        submittedAt: { gte: sevenDaysAgo },
      }),
      safeGroupCount((prisma as any).redraftWaiverClaim, {
        leagueId: { in: leagueIds },
        status: 'pending',
      }),
      safeGroupCount((prisma as any).leagueChatMessage, {
        leagueId: { in: leagueIds },
        createdAt: { gte: sevenDaysAgo },
      }),
      safeGroupCount((prisma as any).leagueAuditLog, {
        leagueId: { in: leagueIds },
        createdAt: { gte: sevenDaysAgo },
      }),
      safeGroupCount((prisma as any).aiCommissionerAlert, {
        leagueId: { in: leagueIds },
        status: 'open',
      }),
      shadowFilters.hasUsernameFilter
        ? prisma.userProfile.findUnique({
            where: { userId },
            select: { sleeperUsername: true },
          })
        : Promise.resolve(null),
    ])

    const dbById = new Map<string, LeagueHealthRow>(
      (Array.isArray(dbLeagues) ? dbLeagues : []).map((league: LeagueHealthRow) => [league.id, league]),
    )
    const nflCoverageByLeague = new Map<string, CanonicalNflDataCoverage | null>()
    await Promise.all(
      leagueIds.map(async (leagueId) => {
        const dbLeague = dbById.get(leagueId)
        if (String(dbLeague?.sport ?? '').toUpperCase() !== 'NFL') return
        const season = Number(dbLeague?.season ?? new Date().getUTCFullYear())
        const week = readCurrentWeek(dbLeague?.settings)
        const coverage = await getCanonicalNflDataCoverage({ season, week }).catch(() => null)
        nflCoverageByLeague.set(leagueId, coverage)
      }),
    )

    const snapshots = leagueIds.map((leagueId) => {
      const dbLeague = dbById.get(leagueId)
      if (!dbLeague) return fallbackById.get(leagueId)!

      return buildCommissionerHealthSnapshot({
        league: dbLeague,
        now,
        source: 'database',
        nflDataCoverage: nflCoverageByLeague.get(leagueId) ?? null,
        counts: {
          tradeActivity:
            countMapValue(tradeActivity, leagueId) +
            countMapValue(legacyTradeActivity, leagueId),
          pendingTrades: countMapValue(pendingTrades, leagueId),
          waiverActivity: countMapValue(waiverActivity, leagueId),
          pendingWaiverClaims: countMapValue(pendingWaiverClaims, leagueId),
          chatMessagesLast7Days: countMapValue(chatMessagesLast7Days, leagueId),
          commissionerActions: countMapValue(commissionerActions, leagueId),
          openAiAlerts: countMapValue(openAiAlerts, leagueId),
        },
      })
    })

    // Decision OS Slice 4 — commissioner.league.health shadow/live runner. Assessment only;
    // never executes commissioner actions, never mutates league state, never throws to the hub.
    // Stage 0 (SHADOW only): runs beside one scope-matched database-source league, logs parity.
    // Stage 1 (LIVE): populates decisionOsShadow on all database-source leagues unconditionally.
    const isLive = shouldRunCommissionerHealthLive(process.env)
    const liveStart = Date.now()
    let enrichedCount = 0

    if (isLive) {
      await Promise.all(
        snapshots.map(async (snapshot, i) => {
          if (!snapshot || snapshot.source !== 'database') return
          try {
            const shadow = await runCommissionerHealthShadow({ userId, snapshot })
            if (shadow.ran && shadow.result) {
              snapshots[i] = {
                ...snapshot,
                decisionOsShadow: {
                  decisionId: shadow.result.decision.decision_id,
                  parityPassed: shadow.result.parity?.passed ?? null,
                  card: toCommissionerHealthCard(shadow.result.decision),
                },
              }
              enrichedCount++
            }
          } catch {
            // live path must never affect the Commissioner Hub
          }
        }),
      )
      const totalDbSource = snapshots.filter((s) => s?.source === 'database').length
      emitLiveTelemetry('commissioner.league.health', {
        enriched: enrichedCount > 0,
        enriched_count: enrichedCount,
        total_db_source: totalDbSource,
        latency_ms: Date.now() - liveStart,
      })
    } else {
      const shadowTargetIndex = snapshots.findIndex((snapshot) =>
        snapshot &&
        snapshot.source === 'database' &&
        shouldRunCommissionerHealthShadow(process.env, {
          username: shadowProfile?.sleeperUsername ?? null,
          leagueId: snapshot.leagueId,
        }),
      )

      if (shadowTargetIndex >= 0) {
        const target = snapshots[shadowTargetIndex]
        if (target) {
          try {
            const shadow = await runCommissionerHealthShadow({ userId, snapshot: target })
            if (shadow.ran && shadow.result) {
              snapshots[shadowTargetIndex] = {
                ...target,
                decisionOsShadow: {
                  decisionId: shadow.result.decision.decision_id,
                  parityPassed: shadow.result.parity?.passed ?? null,
                  card: toCommissionerHealthCard(shadow.result.decision),
                },
              }
            }
          } catch {
            // shadow must never affect the Commissioner Hub
          }
        }
      }
    }

    return snapshots
  } catch (err) {
    console.error('[commissioner-hub-health] failed to load health dashboard', err)
    return leagueIds.map((leagueId) => fallbackById.get(leagueId)!).filter(Boolean)
  }
}
