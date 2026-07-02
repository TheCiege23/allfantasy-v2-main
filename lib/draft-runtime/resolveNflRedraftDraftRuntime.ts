import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getResolvedDraftPoolForLeague } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import {
  buildCanonicalDraftRuntimeState,
  buildSmartDraftRecommendations,
  type CanonicalDraftRuntimeSessionInput,
  type DraftRuntimeManagerState,
  type DraftRuntimePlayer,
  type DraftRuntimeQueueEntry,
} from './canonicalDraftRuntime'
import { deriveDraftRuntimeIntelligence } from '@/lib/decision-os/draft-runtime-intelligence'

export type NflRedraftDraftRuntimeResolved =
  | {
      ok: true
      rules: NonNullable<Awaited<ReturnType<typeof resolveCanonicalLeagueRules>>>
      state: ReturnType<typeof buildCanonicalDraftRuntimeState>
      recommendations: ReturnType<typeof buildSmartDraftRecommendations>
      intelligence: ReturnType<typeof deriveDraftRuntimeIntelligence>
      playerCoverage: {
        availablePlayers: number
        withAdp: number
        withProjection: number
        withHeadshot: number
        withNews: number
      }
    }
  | { ok: false; reason: 'league_not_found' | 'not_nfl_redraft' | 'draft_session_unavailable' }

function snapshotToSessionInput(
  snapshot: Awaited<ReturnType<typeof buildSessionSnapshot>>,
): CanonicalDraftRuntimeSessionInput | null {
  if (!snapshot) return null
  return {
    id: snapshot.id,
    leagueId: snapshot.leagueId,
    status: snapshot.status,
    draftType: snapshot.draftType,
    rounds: snapshot.rounds,
    teamCount: snapshot.teamCount,
    thirdRoundReversal: snapshot.thirdRoundReversal,
    timerSeconds: snapshot.timerSeconds,
    timerEndAtIso: snapshot.timerEndAt,
    pausedRemainingSeconds: snapshot.pausedRemainingSeconds,
    slotOrder: snapshot.slotOrder.map((slot) => ({
      slot: slot.slot,
      rosterId: slot.rosterId,
      displayName: slot.displayName,
      userId: slot.platformUserId ?? null,
    })),
    picks: snapshot.picks.map((pick) => ({
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      rosterId: pick.rosterId,
      playerId: pick.playerId ?? null,
      playerName: pick.playerName,
      position: pick.position,
      team: pick.team,
      byeWeek: pick.byeWeek,
      source: pick.source,
      createdAtIso: pick.createdAt,
    })),
    scheduledAtIso: null,
    version: snapshot.version,
    updatedAtIso: snapshot.updatedAt,
  }
}

function poolEntryToRuntimePlayer(entry: Awaited<ReturnType<typeof getResolvedDraftPoolForLeague>>['entries'][number]): DraftRuntimePlayer {
  const display = entry.display
  const metadata = display.metadata
  const assets = display.assets
  const stats = display.stats
  return {
    playerId: String(display.playerId ?? entry.playerId ?? '').trim() || null,
    name: entry.name || display.displayName,
    position: entry.position || metadata.position,
    team: entry.team ?? metadata.teamAbbreviation ?? display.team?.abbreviation ?? null,
    rosterPosition: null,
    headshotUrl: assets.headshotUrl,
    teamLogoUrl: assets.teamLogoUrl ?? display.team?.logoUrl ?? null,
    jerseyNumber: null,
    age: typeof entry.age === 'number' ? entry.age : typeof metadata.age === 'number' ? metadata.age : null,
    experience: typeof entry.yearsExp === 'number' ? entry.yearsExp : null,
    byeWeek: entry.byeWeek ?? metadata.byeWeek ?? stats.byeWeek ?? null,
    injuryDesignation: entry.injuryStatus ?? metadata.injuryStatus ?? null,
    projectedStatus: null,
    depthChart: null,
    historicalFinishes: null,
    previousSeasonStats: null,
    multiSeasonProduction: null,
    projection: typeof stats.fantasyPointsPerGame === 'number' ? stats.fantasyPointsPerGame : typeof stats.primaryStatValue === 'number' ? stats.primaryStatValue : null,
    adp: entry.adp ?? null,
    expertConsensusRank: null,
    newsCount: null,
    weatherContext: null,
    tier: null,
  }
}

function playerCoverage(players: DraftRuntimePlayer[]) {
  return {
    availablePlayers: players.length,
    withAdp: players.filter((player) => player.adp != null).length,
    withProjection: players.filter((player) => player.projection != null).length,
    withHeadshot: players.filter((player) => Boolean(player.headshotUrl)).length,
    withNews: players.filter((player) => (player.newsCount ?? 0) > 0).length,
  }
}

export async function resolveNflRedraftDraftRuntime(input: {
  leagueId: string
  viewerRosterId?: string | null
  managerStates?: DraftRuntimeManagerState[]
  queueByRosterId?: Record<string, DraftRuntimeQueueEntry[]>
  now?: Date
}): Promise<NflRedraftDraftRuntimeResolved> {
  const rules = await resolveCanonicalLeagueRules(input.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  if (rules.general.sport !== 'NFL' || rules.general.format !== 'redraft') {
    return { ok: false, reason: 'not_nfl_redraft' }
  }

  const snapshot = await buildSessionSnapshot(input.leagueId, input.now ?? new Date())
  const session = snapshotToSessionInput(snapshot)
  if (!session) return { ok: false, reason: 'draft_session_unavailable' }

  const draftedNames = new Set(session.picks.map((pick) => pick.playerName.trim().toLowerCase()))
  const pool = await getResolvedDraftPoolForLeague(input.leagueId, {
    limit: 350,
    excludeDraftedNames: draftedNames,
  }).catch(() => null)
  const players = (pool?.entries ?? []).map(poolEntryToRuntimePlayer)
  const state = buildCanonicalDraftRuntimeState({
    rules,
    session,
    managerStates: input.managerStates ?? [],
    queueByRosterId: input.queueByRosterId ?? {},
    now: input.now,
  })
  const rosterId = input.viewerRosterId ?? state.currentPick?.rosterId ?? state.slotOrder[0]?.rosterId ?? ''
  const recommendations = buildSmartDraftRecommendations({
    rules,
    state,
    availablePlayers: players,
    rosterId,
    generatedAt: input.now,
  })
  const intelligence = deriveDraftRuntimeIntelligence({
    rules,
    state,
    recommendations,
    events: [],
    generatedAt: input.now,
  })

  return {
    ok: true,
    rules,
    state,
    recommendations,
    intelligence,
    playerCoverage: playerCoverage(players),
  }
}
