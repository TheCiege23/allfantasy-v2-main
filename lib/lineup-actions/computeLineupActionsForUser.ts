import { prisma } from '@/lib/prisma'
import { getServerNowISO } from '@/lib/time-engine/serverClock'
import { getLineupActionThresholds } from '@/lib/lineup-actions/thresholds'
import { mergeAiLineupSignals } from '@/lib/lineup-actions/mergeAiLineupSignals'
import { scanNativeLeagueLineup } from '@/lib/lineup-actions/nativeLineupScan'
import { scanSleeperLeagueLineup } from '@/lib/lineup-actions/sleeperLineupScan'
import type {
  LineupActionDisplayMode,
  LineupActionItem,
  LineupActionSummaryPayload,
  LineupCheckLeagueBlock,
} from '@/lib/lineup-actions/types'
import { appendWeatherRiskLineupActions } from '@/lib/lineup-actions/weatherLineupSignals'
import type { LeagueSport } from '@prisma/client'

function countableAction(a: { reasonType: string; severity: string }): boolean {
  if (a.reasonType === 'fetch_error') return false
  if (a.severity === 'info') return false
  return true
}

function buildLeagueBlocks(
  leagues: {
    leagueId: string
    leagueName: string
    leagueAvatar: string | null
    sport: string
    platform: string
    chimmyAdvice: string
    actions: LineupActionItem[]
    scanIncomplete?: boolean
  }[]
): LineupCheckLeagueBlock[] {
  return leagues.map((lg) => {
    const issues = lg.actions.map((a) => ({
      type: a.reasonType,
      message: a.message,
      playerName: a.playerName ?? undefined,
      position: undefined,
      severity: a.severity,
    }))
    return {
      leagueId: lg.leagueId,
      leagueName: lg.leagueName,
      leagueAvatar: lg.leagueAvatar,
      sport: lg.sport,
      platform: lg.platform,
      issues,
      chimmyAdvice: lg.chimmyAdvice,
      actions: lg.actions,
      scanIncomplete: lg.scanIncomplete,
    }
  })
}

function pickDisplayMode(unresolved: number, scanWarningLeagues: number): {
  mode: LineupActionDisplayMode
  count: number
  labelKey: string
  params: Record<string, string | number>
} {
  if (unresolved > 0) {
    return {
      mode: 'unresolved_slots',
      count: unresolved,
      labelKey: unresolved === 1 ? 'dashboard.today.lineupDecisionsOne' : 'dashboard.today.lineupDecisionsMany',
      params: { n: unresolved },
    }
  }
  if (scanWarningLeagues > 0) {
    return {
      mode: 'unresolved_slots',
      count: scanWarningLeagues,
      labelKey:
        scanWarningLeagues === 1
          ? 'dashboard.today.lineupScanWarningOne'
          : 'dashboard.today.lineupScanWarningMany',
      params: { n: scanWarningLeagues },
    }
  }
  return {
    mode: 'unresolved_slots',
    count: 0,
    labelKey: 'dashboard.today.lineupsGoodShort',
    params: {},
  }
}

export async function computeLineupActionsForUser(userId: string): Promise<LineupActionSummaryPayload> {
  const thresholds = getLineupActionThresholds()
  const lastUpdatedAt = getServerNowISO()

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { sleeperUserId: true },
  })
  const sleeperUserId = profile?.sleeperUserId?.trim() || null

  const leagues = await prisma.league.findMany({
    // Stable, total ordering: season and id are non-null and id is unique, so
    // the result set cannot silently reorder between requests. Mirrors
    // lib/dashboard/get-dashboard-league-list.ts so this set lines up with the
    // league list the user actually sees. Deliberately not lastSyncedAt: it is
    // nullable, and Postgres sorts NULLS FIRST on DESC, so never-synced leagues
    // would sort to the top.
    orderBy: [{ season: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    where: {
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      sport: true,
      platform: true,
      platformLeagueId: true,
      avatarUrl: true,
      bestBallMode: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { platformUserId: true },
        take: 1,
      },
    },
  })

  const nativeLeagueTargets = leagues.filter((l) => !(l.platform === 'sleeper' && l.platformLeagueId))
  const rosterOr =
    nativeLeagueTargets.length > 0
      ? nativeLeagueTargets.map((l) => {
          const teamPid = l.teams[0]?.platformUserId?.trim()
          return {
            leagueId: l.id,
            platformUserId: teamPid && teamPid.length > 0 ? teamPid : userId,
          }
        })
      : []

  const rosterRows =
    rosterOr.length > 0
      ? await prisma.roster.findMany({
          where: { OR: rosterOr },
          select: { leagueId: true, playerData: true },
        })
      : []
  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]))

  const aiExtras = await mergeAiLineupSignals(userId, thresholds)

  const perLeague: Array<{
    leagueId: string
    leagueName: string
    leagueAvatar: string | null
    sport: string
    platform: string
    chimmyAdvice: string
    actions: LineupActionItem[]
    scanIncomplete?: boolean
  }> = []

  let scannedSleeper = 0
  let scannedNative = 0

  for (const league of leagues) {
    const leagueName = league.name ?? 'League'
    const leagueAvatar = league.avatarUrl ?? null
    const sport = league.sport as LeagueSport

    if (league.platform === 'sleeper' && league.platformLeagueId) {
      const ownerSleeperId = league.teams[0]?.platformUserId?.trim() || sleeperUserId || null
      if (!ownerSleeperId) continue

      scannedSleeper += 1
      const scan = await scanSleeperLeagueLineup({
        leagueId: league.id,
        leagueName,
        platformLeagueId: league.platformLeagueId,
        ownerSleeperId,
        thresholds,
      })

      let leagueActions = scan.actions.filter((a) => a.leagueId === league.id)
      if (scan.scanIncomplete && leagueActions.length === 0) {
        leagueActions = [
          {
            leagueId: league.id,
            leagueName,
            sport,
            platform: 'sleeper',
            teamId: null,
            slotIndex: null,
            slotId: null,
            slotLabel: null,
            playerId: null,
            playerName: null,
            reasonType: 'fetch_error',
            urgency: 'low',
            lockTime: null,
            recommendedAction: null,
            suggestedReplacementPlayerId: null,
            confidence: null,
            expectedGain: null,
            sourceModule: 'lineup_scan',
            message: 'Could not load lineup data from Sleeper',
            severity: 'info',
          },
        ]
      }
      const extras = aiExtras.filter((a) => a.leagueId === league.id)
      const all = [...leagueActions, ...extras]

      perLeague.push({
        leagueId: league.id,
        leagueName,
        leagueAvatar,
        sport: String(sport),
        platform: 'sleeper',
        chimmyAdvice: '',
        actions: all,
        scanIncomplete: scan.scanIncomplete,
      })
      continue
    }

    const roster = rosterByLeague.get(league.id)
    if (!roster?.playerData) continue

    scannedNative += 1
    const { actions } = await scanNativeLeagueLineup({
      leagueId: league.id,
      leagueName,
      sport,
      platform: league.platform,
      bestBallMode: league.bestBallMode ?? false,
      playerData: roster.playerData,
      thresholds,
    })
    const extras = aiExtras.filter((a) => a.leagueId === league.id)
    perLeague.push({
      leagueId: league.id,
      leagueName,
      leagueAvatar,
      sport: String(sport),
      platform: league.platform,
      chimmyAdvice: '',
      actions: [...actions, ...extras],
    })
  }

  await appendWeatherRiskLineupActions(perLeague, userId)

  const allActions = perLeague.flatMap((p) => p.actions)
  const unresolvedSlotActions = allActions.filter(countableAction)

  const leagueIds = new Set<string>()
  for (const a of unresolvedSlotActions) leagueIds.add(a.leagueId)

  const leaguesNeedingAttention = leagueIds.size
  const lineupsNeedingAttention = leaguesNeedingAttention

  const scanWarningLeagues = perLeague.filter((p) => p.scanIncomplete === true).length

  const urgentLineupActions = unresolvedSlotActions.filter((a) => {
    if (a.urgency === 'urgent') return true
    if (!a.lockTime) return false
    const t = Date.parse(a.lockTime)
    if (Number.isNaN(t)) return false
    const delta = t - Date.now()
    return delta > 0 && delta <= thresholds.urgentLockWindowMinutes * 60_000
  }).length

  const lockedMissedActions = unresolvedSlotActions.filter((a) => {
    if (!a.lockTime) return false
    return Date.parse(a.lockTime) < Date.now()
  }).length

  const display = pickDisplayMode(unresolvedSlotActions.length, scanWarningLeagues)

  const withLeagues = leaguesNeedingAttention
  const subKey =
    withLeagues > 0 ? (withLeagues === 1 ? 'dashboard.today.lineupAcrossLeaguesOne' : 'dashboard.today.lineupAcrossLeaguesMany') : null
  const urgentKey =
    urgentLineupActions > 0
      ? urgentLineupActions === 1
        ? 'dashboard.today.lineupUrgentOne'
        : 'dashboard.today.lineupUrgentMany'
      : null

  const leagueBlocks = buildLeagueBlocks(perLeague.filter((p) => p.actions.some(countableAction) || p.scanIncomplete))

  return {
    totalIssues: unresolvedSlotActions.length,
    totalUnresolvedSlotActions: unresolvedSlotActions.length,
    scanWarningLeagues,
    leaguesNeedingAttention,
    lineupsNeedingAttention,
    urgentLineupActions,
    lockedMissedActions,
    displayMode: display.mode,
    displayCount: display.count,
    displayLabelKey: display.labelKey,
    displayLabelParams: display.params,
    displaySubtextKey: subKey,
    displaySubtextParams: subKey ? { n: withLeagues } : null,
    urgentSubtextKey: urgentKey,
    urgentSubtextParams: urgentKey ? { n: urgentLineupActions } : null,
    actions: allActions,
    leagues: leagueBlocks,
    scannedLeagues: scannedSleeper + scannedNative,
    scannedSleeperLeagues: scannedSleeper,
    scannedNativeLeagues: scannedNative,
    lastUpdatedAt,
  }
}
