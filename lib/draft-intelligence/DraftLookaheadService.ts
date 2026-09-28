import type { LeagueSport } from '@prisma/client'

import {
  isAnthropicPipelineAvailable,
  runDraftLookaheadAgent,
  type UserContext,
} from '@/lib/agents/anthropic-pipeline'
import { isDraftIntelAiEnabled } from '@/lib/draft-intelligence/draftIntelAiFlag'
import {
  computeDraftRecommendation,
  type RecommendationPlayer,
} from '@/lib/draft-helper/RecommendationEngine'
import { getRosterSlotLabelsForLeagueDraft } from '@/lib/draft-room'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { formatPickLabel, getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { DraftPickSnapshot, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { buildDeterministicPostDraftRecap } from '@/lib/post-draft'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'

import { draftIntelStateStore } from './DraftIntelStateStore'
import type {
  DraftIntelPredictedPick,
  DraftIntelPredictedPickOption,
  DraftIntelQueueEntry,
  DraftIntelState,
  DraftIntelTrigger,
} from './types'

export interface DraftIntelPublishResult {
  previousState: DraftIntelState | null
  state: DraftIntelState
}

type LookaheadContext = {
  leagueId: string
  leagueName: string | null
  sport: LeagueSport
  isDynasty: boolean
  rosterSlots: string[]
  isSuperflex: boolean
}

type QueueCandidate = {
  player: RecommendationPlayer
  reason: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function probabilityLabel(probability: number): 'high' | 'medium' | 'low' {
  if (probability >= 70) return 'high'
  if (probability >= 40) return 'medium'
  return 'low'
}

function inferIsSuperflex(rosterSlots: string[]) {
  const normalized = rosterSlots.map((slot) => String(slot || '').toUpperCase())
  return (
    normalized.includes('SUPER_FLEX') ||
    normalized.includes('SUPERFLEX') ||
    normalized.includes('OP') ||
    normalized.filter((slot) => slot === 'QB').length >= 2
  )
}

function playerKey(player: Pick<RecommendationPlayer, 'name' | 'position' | 'team'>) {
  return `${String(player.name || '').toLowerCase()}|${String(player.position || '').toLowerCase()}|${String(
    player.team || ''
  ).toLowerCase()}`
}

function buildRosterByTeam(snapshot: DraftSessionSnapshot): Map<string, Array<{ position: string; team?: string | null; byeWeek?: number | null }>> {
  const rosterMap = new Map<string, Array<{ position: string; team?: string | null; byeWeek?: number | null }>>()
  for (const pick of snapshot.picks) {
    const next = rosterMap.get(pick.rosterId) ?? []
    next.push({
      position: pick.position,
      team: pick.team ?? null,
      byeWeek: pick.byeWeek ?? null,
    })
    rosterMap.set(pick.rosterId, next)
  }
  return rosterMap
}

function parseAiJson(text: string): {
  headline?: string
  queueEntries?: Array<{ playerName?: string; reasonShort?: string; availabilitySummary?: string }>
  dmReady?: string
  dmUpdate?: string
  dmOnClock?: string
} | null {
  const trimmed = text.trim()
  const candidate = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? null
  if (!candidate) return null
  try {
    return JSON.parse(candidate) as {
      headline?: string
      queueEntries?: Array<{ playerName?: string; reasonShort?: string; availabilitySummary?: string }>
      dmReady?: string
      dmUpdate?: string
      dmOnClock?: string
    }
  } catch {
    return null
  }
}

async function resolveLookaheadContext(leagueId: string): Promise<LookaheadContext | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, isDynasty: true },
  })
  if (!league?.id) return null

  const sport = normalizeToSupportedSport((league.sport as LeagueSport | null) ?? 'NFL')
  const rosterSlots = await getRosterSlotLabelsForLeagueDraft(leagueId, sport)

  return {
    leagueId,
    leagueName: league.name ?? null,
    sport,
    isDynasty: Boolean(league.isDynasty),
    rosterSlots,
    isSuperflex: inferIsSuperflex(rosterSlots),
  }
}

async function getAppUserIdForRosterId(rosterId: string): Promise<string | null> {
  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { platformUserId: true },
  })
  if (!roster?.platformUserId || String(roster.platformUserId).startsWith('orphan-')) {
    return null
  }
  return String(roster.platformUserId)
}

async function buildAvailablePlayers(
  leagueId: string,
  sport: LeagueSport,
  draftedNames: Set<string>
): Promise<RecommendationPlayer[]> {
  const pool = await getPlayerPoolForLeague(leagueId, sport, { limit: 500 }).catch(() => [])
  const rows = pool
    .filter((row) => !draftedNames.has(String(row.full_name || '')))
    .slice(0, 250)

  return rows.map((row, index) => ({
    name: row.full_name,
    position: row.position ?? '',
    team: row.team_abbreviation ?? null,
    playerId:
      (row.external_source_id as string | null | undefined) ??
      ((row as { player_id?: string | null }).player_id ?? null),
    adp: index + 1,
    byeWeek: null,
  })) as RecommendationPlayer[]
}

function buildQueueCandidates(params: {
  available: RecommendationPlayer[]
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  rosterSlots: string[]
  currentOverall: number
  teamCount: number
  sport: string
  isDynasty: boolean
  isSuperflex: boolean
}): QueueCandidate[] {
  const working = [...params.available]
  const queue: QueueCandidate[] = []

  for (let rank = 0; rank < 5 && working.length > 0; rank += 1) {
    const overall = params.currentOverall + rank
    const round = Math.ceil(overall / params.teamCount)
    const pickInRound = ((overall - 1) % params.teamCount) + 1
    const result = computeDraftRecommendation({
      available: working,
      teamRoster: params.teamRoster,
      rosterSlots: params.rosterSlots,
      round,
      pick: pickInRound,
      totalTeams: params.teamCount,
      sport: params.sport,
      isDynasty: params.isDynasty,
      isSF: params.isSuperflex,
      mode: 'needs',
    })
    const top = result.recommendation?.player
    if (!top) break
    queue.push({
      player: top,
      reason: result.recommendation?.reason ?? 'Best fit for the next turn.',
    })
    const key = playerKey(top)
    const nextIndex = working.findIndex((candidate) => playerKey(candidate) === key)
    if (nextIndex < 0) break
    working.splice(nextIndex, 1)
  }

  return queue
}

function buildPredictedPickOption(
  player: RecommendationPlayer | null | undefined,
  probability: number,
  reason: string
): DraftIntelPredictedPickOption | null {
  if (!player) return null
  return {
    playerName: player.name,
    position: player.position,
    team: player.team ?? null,
    playerId: (player as RecommendationPlayer & { playerId?: string | null }).playerId ?? null,
    probability,
    reason,
  }
}

function simulateUpcomingPicks(params: {
  snapshot: DraftSessionSnapshot
  available: RecommendationPlayer[]
  rosterSlots: string[]
  sport: string
  isDynasty: boolean
  isSuperflex: boolean
  stopBeforeOverall: number
}): DraftIntelPredictedPick[] {
  const predictions: DraftIntelPredictedPick[] = []
  const rosterByTeam = buildRosterByTeam(params.snapshot)
  const available = [...params.available]
  const tradedPicks = Array.isArray(params.snapshot.tradedPicks) ? params.snapshot.tradedPicks : []

  for (
    let overall = params.snapshot.currentPick?.overall ?? 1;
    overall < params.stopBeforeOverall && predictions.length < 5 && available.length > 0;
    overall += 1
  ) {
    const round = Math.ceil(overall / params.snapshot.teamCount)
    const slot = getSlotInRoundForOverall({
      overall,
      teamCount: params.snapshot.teamCount,
      draftType: params.snapshot.draftType,
      thirdRoundReversal: params.snapshot.thirdRoundReversal,
    })
    const owner =
      resolvePickOwner(round, slot, params.snapshot.slotOrder, tradedPicks) ??
      params.snapshot.slotOrder.find((entry) => entry.slot === slot)
    if (!owner?.rosterId) continue

    const teamRoster = rosterByTeam.get(owner.rosterId) ?? []
    const pickInRound = ((overall - 1) % params.snapshot.teamCount) + 1
    const recommendation = computeDraftRecommendation({
      available,
      teamRoster,
      rosterSlots: params.rosterSlots,
      round,
      pick: pickInRound,
      totalTeams: params.snapshot.teamCount,
      sport: params.sport,
      isDynasty: params.isDynasty,
      isSF: params.isSuperflex,
      mode: 'needs',
    })
    const likely = recommendation.recommendation?.player ?? null
    const alternative = recommendation.alternatives?.[0]?.player ?? null
    const reach = recommendation.alternatives?.[1]?.player ?? alternative

    predictions.push({
      overall,
      round,
      slot,
      rosterId: owner.rosterId,
      displayName: owner.displayName ?? 'Manager',
      likely: buildPredictedPickOption(
        likely,
        58,
        recommendation.recommendation?.reason ?? 'Best roster-fit projection.'
      ),
      alternative: buildPredictedPickOption(
        alternative,
        24,
        recommendation.alternatives?.[0]?.reason ?? 'Second-path pivot if the board shifts.'
      ),
      reach: buildPredictedPickOption(
        reach,
        12,
        recommendation.alternatives?.[1]?.reason ?? 'Lower-probability upside swing.'
      ),
    })

    if (likely) {
      const key = playerKey(likely)
      const nextIndex = available.findIndex((candidate) => playerKey(candidate) === key)
      if (nextIndex >= 0) {
        available.splice(nextIndex, 1)
      }
      rosterByTeam.set(owner.rosterId, [
        ...teamRoster,
        {
          position: likely.position,
          team: likely.team ?? null,
          byeWeek: likely.byeWeek ?? null,
        },
      ])
    }
  }

  return predictions
}

function buildQueueWithAvailability(
  queue: QueueCandidate[],
  predictions: DraftIntelPredictedPick[]
): DraftIntelQueueEntry[] {
  return queue.map((candidate, index) => {
    let threatScore = 0
    for (const prediction of predictions) {
      const options = [prediction.likely, prediction.alternative, prediction.reach]
      for (const option of options) {
        if (!option) continue
        if (option.playerName === candidate.player.name) {
          threatScore += option.probability
        }
      }
    }
    const availabilityProbability = clamp(100 - threatScore, 5, 96)
    return {
      rank: index + 1,
      playerName: candidate.player.name,
      position: candidate.player.position,
      team: candidate.player.team ?? null,
      playerId:
        (candidate.player as RecommendationPlayer & { playerId?: string | null }).playerId ?? null,
      availabilityProbability,
      availabilityLabel: probabilityLabel(availabilityProbability),
      reason:
        availabilityProbability < 40
          ? `${candidate.reason}. Availability is fragile before your turn.`
          : candidate.reason,
    }
  })
}

/** @internal Exported for the `DRAFT_INTEL_AI_ENABLED` switch test; callers use the state builders. */
export async function applyAiLookaheadCopy(params: {
  state: DraftIntelState
  ctx: LookaheadContext
}): Promise<DraftIntelState> {
  // The owner's switch comes first: off means no model call at all, whatever else is configured.
  if (!isDraftIntelAiEnabled() || !isAnthropicPipelineAvailable() || params.state.queue.length === 0) {
    return params.state
  }

  const userContext: UserContext = {
    userId: params.state.userId,
    tier: 'pro',
    sport: normalizeToSupportedSport(params.ctx.sport),
    leagueFormat: params.ctx.isDynasty ? 'dynasty' : 'redraft',
    leagueId: params.state.leagueId,
  }

  try {
    const response = await runDraftLookaheadAgent(
      {
        mode: params.state.status === 'on_clock' ? 'on_clock' : 'lookahead',
        leagueName: params.state.leagueName,
        sport: params.state.sport,
        picksUntilUser: params.state.picksUntilUser,
        headline: params.state.headline,
        queue: params.state.queue.map((entry) => ({
          playerName: entry.playerName,
          position: entry.position,
          team: entry.team,
          availabilityProbability: entry.availabilityProbability,
          reason: entry.reason,
        })),
        predictions: params.state.predictions,
      },
      userContext
    )
    const parsed = parseAiJson(response.text)
    if (!parsed) return params.state

    const queue = params.state.queue.map((entry) => {
      const aiEntry = parsed.queueEntries?.find((item) => item.playerName === entry.playerName)
      if (!aiEntry) return entry
      const availabilityText = aiEntry.availabilitySummary?.trim()
      return {
        ...entry,
        reason: aiEntry.reasonShort?.trim() || entry.reason,
        ...(availabilityText
          ? {
              reason: `${aiEntry.reasonShort?.trim() || entry.reason} ${availabilityText}`.trim(),
            }
          : null),
      }
    })

    return {
      ...params.state,
      headline: parsed.headline?.trim() || params.state.headline,
      queue,
      messages: {
        ready: parsed.dmReady?.trim() || params.state.messages.ready,
        update: parsed.dmUpdate?.trim() || params.state.messages.update,
        onClock: parsed.dmOnClock?.trim() || params.state.messages.onClock,
      },
    }
  } catch {
    return params.state
  }
}

function buildDefaultHeadline(picksUntilUser: number | null, leagueName: string | null) {
  if (picksUntilUser === 0) return `You're on the clock${leagueName ? ` in ${leagueName}` : ''}.`
  if (picksUntilUser == null) return 'Draft intelligence unavailable right now.'
  return `Chimmy queue ready: ${picksUntilUser} pick${picksUntilUser === 1 ? '' : 's'} until your turn.`
}

function buildDefaultMessages(state: DraftIntelState) {
  const top = state.queue[0]
  const fallback = state.queue[1]
  return {
    ready: top
      ? `Queue ready. Target ${top.playerName} first; ${fallback?.playerName ?? 'the fallback queue'} is next if the board breaks.`
      : 'Queue ready. I do not have a clean player edge yet.',
    update: top
      ? `Queue updated. ${top.playerName} leads the board with ${top.availabilityProbability}% availability.`
      : 'Queue updated after the latest pick.',
    onClock: top
      ? `You're on the clock. Take ${top.playerName} now.${fallback ? ` Backup: ${fallback.playerName}.` : ''}`
      : `You're on the clock.`
  }
}

function inferEventType(state: DraftIntelState): 'queue_update' | 'on_clock' | 'recap' {
  if (state.status === 'complete') return 'recap'
  if (state.status === 'on_clock') return 'on_clock'
  return 'queue_update'
}

async function buildActiveState(params: {
  leagueId: string
  userId: string
  rosterId: string
  ctx: LookaheadContext
  snapshot: DraftSessionSnapshot
  trigger: DraftIntelTrigger
}): Promise<DraftIntelState> {
  const currentOverall = params.snapshot.currentPick?.overall ?? null
  const draftedNames = new Set(params.snapshot.picks.map((pick) => pick.playerName))
  const available = await buildAvailablePlayers(params.leagueId, params.ctx.sport, draftedNames)
  const rosterByTeam = buildRosterByTeam(params.snapshot)
  const teamRoster = rosterByTeam.get(params.rosterId) ?? []

  const userNextOverall = (() => {
    if (!currentOverall) return null
    for (
      let overall = currentOverall;
      overall <= params.snapshot.teamCount * params.snapshot.rounds;
      overall += 1
    ) {
      const round = Math.ceil(overall / params.snapshot.teamCount)
      const slot = getSlotInRoundForOverall({
        overall,
        teamCount: params.snapshot.teamCount,
        draftType: params.snapshot.draftType,
        thirdRoundReversal: params.snapshot.thirdRoundReversal,
      })
      const owner = resolvePickOwner(
        round,
        slot,
        params.snapshot.slotOrder,
        Array.isArray(params.snapshot.tradedPicks) ? params.snapshot.tradedPicks : []
      )
      if (owner?.rosterId === params.rosterId) return overall
    }
    return null
  })()

  const picksUntilUser =
    currentOverall != null && userNextOverall != null ? Math.max(0, userNextOverall - currentOverall) : null

  if (
    picksUntilUser == null ||
    !currentOverall ||
    !userNextOverall ||
    (picksUntilUser > 5 && params.trigger !== 'manual')
  ) {
    const idleState: DraftIntelState = {
      leagueId: params.leagueId,
      userId: params.userId,
      rosterId: params.rosterId,
      leagueName: params.ctx.leagueName,
      sport: params.ctx.sport,
      sessionId: params.snapshot.id,
      status: 'idle',
      trigger: params.trigger,
      currentOverall,
      userNextOverall,
      picksUntilUser,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      headline: picksUntilUser == null
        ? 'Chimmy is waiting for your next live draft window.'
        : `Chimmy will arm the queue when you are 5 picks out. ${picksUntilUser} picks remain.`,
      queue: [],
      predictions: [],
      messages: {
        ready: 'Draft intel is standing by.',
        update: 'Draft intel is standing by.',
        onClock: `You're on the clock.`,
      },
      recap: null,
      archived: false,
      draftSession: params.snapshot,
    }
    return idleState
  }

  const queueCandidates = buildQueueCandidates({
    available,
    teamRoster,
    rosterSlots: params.ctx.rosterSlots,
    currentOverall: userNextOverall,
    teamCount: params.snapshot.teamCount,
    sport: params.ctx.sport,
    isDynasty: params.ctx.isDynasty,
    isSuperflex: params.ctx.isSuperflex,
  })
  const predictions = simulateUpcomingPicks({
    snapshot: params.snapshot,
    available,
    rosterSlots: params.ctx.rosterSlots,
    sport: params.ctx.sport,
    isDynasty: params.ctx.isDynasty,
    isSuperflex: params.ctx.isSuperflex,
    stopBeforeOverall: userNextOverall,
  })
  const queue = buildQueueWithAvailability(queueCandidates, predictions)

  const baseState: DraftIntelState = {
    leagueId: params.leagueId,
    userId: params.userId,
    rosterId: params.rosterId,
    leagueName: params.ctx.leagueName,
    sport: params.ctx.sport,
    sessionId: params.snapshot.id,
    status: picksUntilUser === 0 ? 'on_clock' : 'active',
    trigger: params.trigger,
    currentOverall,
    userNextOverall,
    picksUntilUser,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    headline: buildDefaultHeadline(picksUntilUser, params.ctx.leagueName),
    queue,
    predictions,
    messages: {
      ready: '',
      update: '',
      onClock: '',
    },
    recap: null,
    archived: false,
    draftSession: params.snapshot,
  }
  baseState.messages = buildDefaultMessages(baseState)
  return applyAiLookaheadCopy({ state: baseState, ctx: params.ctx })
}

export async function generateDraftIntelStateForUser(input: {
  leagueId: string
  userId: string
  trigger: DraftIntelTrigger
}): Promise<DraftIntelState | null> {
  const rosterId = await getCurrentUserRosterIdForLeague(input.leagueId, input.userId)
  if (!rosterId) return null
  const snapshot = await buildSessionSnapshot(input.leagueId)
  if (!snapshot) return null
  const ctx = await resolveLookaheadContext(input.leagueId)
  if (!ctx) return null

  return buildActiveState({
    leagueId: input.leagueId,
    userId: input.userId,
    rosterId,
    ctx,
    snapshot,
    trigger: input.trigger,
  })
}

export async function publishDraftIntelState(input: {
  leagueId: string
  userId: string
  trigger: DraftIntelTrigger
}): Promise<DraftIntelState | null> {
  const state = await generateDraftIntelStateForUser(input)
  if (!state) return null
  draftIntelStateStore.set(inferEventType(state), state)
  return state
}

export async function publishDraftIntelRecap(input: {
  leagueId: string
  userId: string
}): Promise<DraftIntelState | null> {
  const rosterId = await getCurrentUserRosterIdForLeague(input.leagueId, input.userId)
  if (!rosterId) return null
  const snapshot = await buildSessionSnapshot(input.leagueId)
  const recap = await buildDeterministicPostDraftRecap(input.leagueId)
  const ctx = await resolveLookaheadContext(input.leagueId)
  if (!ctx) return null

  const state: DraftIntelState = {
    leagueId: input.leagueId,
    userId: input.userId,
    rosterId,
    leagueName: ctx.leagueName,
    sport: ctx.sport,
    sessionId: snapshot?.id ?? null,
    status: 'complete',
    trigger: 'recap',
    currentOverall: snapshot?.currentPick?.overall ?? null,
    userNextOverall: null,
    picksUntilUser: null,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    headline: `Draft complete${ctx.leagueName ? `: ${ctx.leagueName}` : ''}.`,
    queue: [],
    predictions: [],
    messages: {
      ready: 'Draft complete.',
      update: 'Draft complete.',
      onClock: 'Draft complete.',
    },
    recap: recap?.sections?.chimmyDraftDebrief ?? recap?.sections?.leagueNarrativeRecap ?? 'Draft complete.',
    archived: true,
    draftSession: snapshot,
  }
  draftIntelStateStore.set('recap', state)
  return state
}

export function getDraftIntelState(leagueId: string, userId: string) {
  return draftIntelStateStore.get(leagueId, userId)
}

export async function publishDraftIntelForUpcomingManagers(input: {
  leagueId: string
  trigger: DraftIntelTrigger
}): Promise<DraftIntelPublishResult[]> {
  const snapshot = await buildSessionSnapshot(input.leagueId)
  if (!snapshot?.currentPick) return []

  const tradedPicks = Array.isArray(snapshot.tradedPicks) ? snapshot.tradedPicks : []
  const uniqueUserIds = new Set<string>()
  for (
    let overall = snapshot.currentPick.overall;
    overall <= Math.min(snapshot.teamCount * snapshot.rounds, snapshot.currentPick.overall + 5);
    overall += 1
  ) {
    const round = Math.ceil(overall / snapshot.teamCount)
    const slot = getSlotInRoundForOverall({
      overall,
      teamCount: snapshot.teamCount,
      draftType: snapshot.draftType,
      thirdRoundReversal: snapshot.thirdRoundReversal,
    })
    const owner = resolvePickOwner(round, slot, snapshot.slotOrder, tradedPicks)
    if (!owner?.rosterId) continue
    const userId = await getAppUserIdForRosterId(owner.rosterId)
    if (userId) uniqueUserIds.add(userId)
  }

  const states = await Promise.all(
    Array.from(uniqueUserIds).map(async (userId) => {
      const previousState = getDraftIntelState(input.leagueId, userId)
      const state = await publishDraftIntelState({
        leagueId: input.leagueId,
        userId,
        trigger: input.trigger,
      })
      return state ? { previousState, state } : null
    })
  )

  return states.filter((state): state is DraftIntelPublishResult => Boolean(state))
}
