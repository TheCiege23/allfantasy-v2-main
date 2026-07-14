/**
 * Game Day Snapshot Service — Phase 9. Orchestrates the whole shared service
 * for one user across all their connected leagues: resolves connected
 * leagues (same real linked-platform-user-id pattern Waiver OS/Draft OS
 * already established), assembles each league's Game Day context (reusing
 * the real matchup-center engine), computes cross-league exposure, lineup
 * attention (reused legacy engine + new checks), game windows, Knowledge
 * Graph manager tendency, and divergence — into one immutable GameDaySnapshot.
 *
 * SHADOW MODE ONLY: nothing in this module is called by any live route.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { buildLeagueGameDayContext } from './GameDayContextAssembler'
import { computeUserPlayerExposure } from './UserPlayerExposureService'
import { computeLineupAttention } from './LineupAttentionService'
import { computeGameWindows } from './GameWindowService'
import { analyzeGameDayDivergence } from './GameDayDivergenceAnalyzer'
import { getManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/QueryService'
import { defaultGameDaySnapshotStore, type GameDaySnapshotStore } from './GameDaySnapshotStore'
import type { GameDaySnapshot, GameWindow, LeagueGameDayContext, ManagerTendencyContext } from './types'

async function resolveConnectedLeagueRosters(userId: string): Promise<Array<{ leagueId: string; platformUserId: string }>> {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { sleeperUserId: true } })
  const platformUserIds = Array.from(new Set([userId, profile?.sleeperUserId].map((v) => String(v ?? '').trim()).filter(Boolean)))
  if (platformUserIds.length === 0) return []

  const rosters = await prisma.roster.findMany({
    where: { platformUserId: { in: platformUserIds } },
    select: { leagueId: true, platformUserId: true },
  })

  const byLeague = new Map<string, string>()
  for (const r of rosters) {
    if (!byLeague.has(r.leagueId)) byLeague.set(r.leagueId, r.platformUserId)
  }
  return Array.from(byLeague.entries()).map(([leagueId, platformUserId]) => ({ leagueId, platformUserId }))
}

async function resolveManagerTendency(managerKey: string): Promise<ManagerTendencyContext> {
  try {
    const result = await getManagerBehaviorProfile(managerKey)
    if (result.status === 'gated') return { status: 'gated', reason: result.reason, profile: null }
    return { status: 'ok', reason: null, profile: result.data }
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message : 'Knowledge Graph lookup failed.', profile: null }
  }
}

export interface BuildGameDaySnapshotInput {
  userId: string
  resultStore?: GameDaySnapshotStore
}

export async function buildGameDaySnapshot(input: BuildGameDaySnapshotInput): Promise<GameDaySnapshot> {
  const resultStore = input.resultStore ?? defaultGameDaySnapshotStore
  const generatedAt = new Date().toISOString()

  const connectedRosters = await resolveConnectedLeagueRosters(input.userId)

  const leagues: LeagueGameDayContext[] = await Promise.all(
    connectedRosters.map(({ leagueId, platformUserId }) => buildLeagueGameDayContext({ leagueId, viewerUserId: platformUserId }))
  )

  const { exposures, connectedLeagueCount } = await computeUserPlayerExposure({ userId: input.userId })

  // Enrich exposures with injury status from the assembled league contexts —
  // real data this module already fetched, not a new source.
  const injuryByPlayerId = new Map<string, string>()
  for (const league of leagues) {
    if (!league.matchup) continue
    for (const starter of league.matchup.left.starters) {
      if (starter.injuryStatus) injuryByPlayerId.set(starter.playerId, starter.injuryStatus)
    }
  }
  const enrichedExposures = exposures.map((e) => ({ ...e, injuryStatus: injuryByPlayerId.get(e.playerId) ?? null }))

  const { items: attentionItems, legacyActions } = await computeLineupAttention({ userId: input.userId, leagueContexts: leagues })

  const windowKeys = new Set(leagues.map((l) => `${l.sport}|${l.season}|${l.week}`))
  const gameWindowLists = await Promise.all(
    Array.from(windowKeys).map((key) => {
      const [sport, season, week] = key.split('|')
      return computeGameWindows({ sport, season, week: Number(week) })
    })
  )
  const gameWindows: GameWindow[] = gameWindowLists.flat()

  const managerTendency = await resolveManagerTendency(input.userId)

  const divergence = analyzeGameDayDivergence({ leagueContexts: leagues, newAttentionItems: attentionItems, legacyActions })

  const unavailableLeagueCount = leagues.filter((l) => l.unavailableReason != null).length
  const staleMatchupCount = leagues.filter((l) => l.matchupState.state === 'stale').length
  const fetchedTimes = leagues.map((l) => l.matchupState.attribution.fetchedAt).sort()

  const snapshot: GameDaySnapshot = {
    snapshotId: randomUUID(),
    userId: input.userId,
    generatedAt,
    includedLeagueIds: leagues.map((l) => l.leagueId),
    leagues,
    exposures: enrichedExposures,
    attentionItems,
    gameWindows,
    managerTendency,
    dataQuality: {
      leagueCount: connectedLeagueCount,
      unavailableLeagueCount,
      staleMatchupCount,
    },
    freshnessSummary: {
      oldestFetchedAt: fetchedTimes[0] ?? null,
      newestFetchedAt: fetchedTimes[fetchedTimes.length - 1] ?? null,
    },
    divergence,
  }

  await resultStore.append(snapshot).catch((err) => {
    console.warn('[game-day-snapshot] failed to persist snapshot (non-fatal):', err)
  })

  return snapshot
}
