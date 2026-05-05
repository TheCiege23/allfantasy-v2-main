/**
 * Server-side: when queue-first autopick has no queue pick (empty queue or all attempts failed),
 * resolve best-available / need-based candidate — same rules as POST autopick-expired.
 */

import { prisma } from '@/lib/prisma'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { computeDraftRecommendation } from '@/lib/draft-helper/RecommendationEngine'
import { getRosterSlotLabelsForLeagueDraft } from '@/lib/draft-room'
import { getLiveADP } from '@/lib/adp-data'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { getResolvedDraftPoolForLeague } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { getAiAdpForLeague } from '@/lib/ai-adp-engine'
import { resolveAiAdpFormatKeyFromSettings } from '@/lib/ai-adp-engine/segment-resolver'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { getAllowedPositionsAndRosterSize } from '@/lib/live-draft-engine/RosterFitValidation'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import type { CurrentOnTheClock } from '@/lib/live-draft-engine/types'

export type AutopickFallbackPoolEntry = {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  byeWeek: number | null
  adp: number | null
}

export type AutopickDraftContext = {
  draftSession: {
    id: string
    status: string
    draftType: string
    rounds: number
    teamCount: number
    thirdRoundReversal: boolean
    sportType: string | null
    /** `live` | `mock` — from DraftSession.sessionKind */
    sessionKind: string
    picks: Array<{
      rosterId: string
      playerName: string
      position: string
      team?: string | null
    }>
    slotOrder: unknown
    tradedPicks: unknown
  }
  current: CurrentOnTheClock
  onClockRosterId: string
  fallbackPool: AutopickFallbackPoolEntry[]
  league: { sport: string; isDynasty: boolean; settings: Record<string, unknown> } | null
  sport: string
  isDynasty: boolean
  isSuperflex: boolean
  aiAdpByKey?: Record<string, number>
  autopickBehavior: string
  overallPick: number
  /** Starter-eligible positions for need-based autopick / recommendation weighting */
  draftEligiblePositions: Set<string> | null
}

export type BestAvailableAutopickResolved = {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  byeWeek: number | null
  reason: string
  strategy: 'need-based' | 'bpa'
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function getIsSuperflexFromSettings(settings: Record<string, unknown>): boolean {
  return (
    settings.is_superflex === true ||
    settings.superflex === true ||
    settings.isSuperflex === true ||
    String(settings.roster_format_type ?? '').toLowerCase().includes('superflex') ||
    String(settings.roster_format ?? '').toLowerCase().includes('superflex')
  )
}

async function loadFallbackCandidatesLegacy(
  leagueId: string,
  sport: string,
): Promise<
  Array<{
    playerName: string
    position: string
    team: string | null
    playerId: string | null
    byeWeek: number | null
    adp: number | null
  }>
> {
  const normalizedSport = String(sport || 'NFL').toUpperCase()
  if (normalizedSport === 'NFL') {
    const adp = await getLiveADP('redraft', 300).catch(() => [])
    return adp.map((entry) => ({
      playerName: String(entry.name ?? '').trim(),
      position: String(entry.position ?? '').trim(),
      team: entry.team ?? null,
      playerId: null,
      byeWeek: entry.bye ?? null,
      adp: entry.adp ?? null,
    }))
  }

  const pool = await getPlayerPoolForLeague(leagueId, normalizedSport as any, {
    limit: 300,
  }).catch(() => [])

  return pool.map((entry: any) => ({
    playerName: String(entry.full_name ?? entry.name ?? '').trim(),
    position: String(entry.position ?? '').trim(),
    team: entry.team_abbreviation ?? null,
    playerId: entry.external_source_id ?? entry.player_id ?? null,
    byeWeek: null,
    adp: null,
  }))
}

async function loadFallbackCandidates(
  leagueId: string,
  sport: string,
  draftedNames: Set<string>,
): Promise<
  Array<{
    playerName: string
    position: string
    team: string | null
    playerId: string | null
    byeWeek: number | null
    adp: number | null
  }>
> {
  try {
    const resolved = await getResolvedDraftPoolForLeague(leagueId, {
      limit: 400,
      excludeDraftedNames: draftedNames,
    })
    if (!resolved.rosterConfigurationIncomplete && resolved.entries.length > 0) {
      return resolved.entries.map((e) => ({
        playerName: e.name.trim(),
        position: e.position.trim(),
        team: e.team,
        playerId: String(e.display?.playerId ?? e.playerId ?? '').trim() || null,
        byeWeek: e.byeWeek ?? e.display?.metadata?.byeWeek ?? null,
        adp: e.adp ?? null,
      }))
    }
  } catch (err) {
    console.warn('[autopick] getResolvedDraftPoolForLeague failed; using legacy fallback pool', err)
  }
  return loadFallbackCandidatesLegacy(leagueId, sport)
}

/**
 * Shared draft + pool context for autopick and AI opponent pick (same validation as legacy BPA).
 */
export async function loadAutopickDraftContextForOnClock(
  leagueId: string,
  onClockRosterId: string
): Promise<AutopickDraftContext | null> {
  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!draftSession || draftSession.status !== 'in_progress') return null

  const slotOrder = (draftSession.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
  const tradedPicks = Array.isArray(draftSession.tradedPicks)
    ? (draftSession.tradedPicks as {
        round: number
        originalRosterId: string
        previousOwnerName: string
        newRosterId: string
        newOwnerName: string
      }[])
    : []
  const teamCount = draftSession.teamCount
  const totalPicks = draftSession.rounds * teamCount
  const progressPicks = draftSession.picks.map((p) => ({
    overall: p.overall,
    playerName: p.playerName,
    position: p.position,
    pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
  }))
  const current = resolveCurrentOnTheClock({
    totalPicks,
    picks: progressPicks,
    teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
    slotOrder,
  })
  if (!current) return null
  const resolvedOwner = resolvePickOwner(current.round, current.slot, slotOrder, tradedPicks)
  const expectedRosterId = resolvedOwner?.rosterId ?? current.rosterId
  if (expectedRosterId !== onClockRosterId) return null

  const draftConfig = await getDraftConfigForLeague(leagueId)
  const autopickBehavior = String(draftConfig?.autopick_behavior ?? 'queue-first').toLowerCase()

  const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
  const draftEligiblePositions = rosterRules?.draftEligiblePositions
  const draftedNames = new Set(draftSession.picks.map((p) => p.playerName.trim().toLowerCase()))

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, isDynasty: true, settings: true },
  })
  const sport = String(league?.sport ?? draftSession.sportType ?? 'NFL').toUpperCase()
  const isDynasty = Boolean(league?.isDynasty)
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const isSuperflex = getIsSuperflexFromSettings(settings)

  const fallbackPoolRaw = await loadFallbackCandidates(leagueId, sport, draftedNames)
  const fallbackPool = fallbackPoolRaw.filter((entry) => {
    if (!entry.playerName || !entry.position) return false
    if (draftedNames.has(normalizeName(entry.playerName))) return false
    if (draftEligiblePositions && !draftPoolRowMatchesEligiblePositions(entry.position, draftEligiblePositions)) {
      return false
    }
    return true
  })

  if (fallbackPool.length === 0) return null

  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  let aiAdpByKey: Record<string, number> | undefined
  if (uiSettings.aiAdpEnabled && league) {
    const formatKey = resolveAiAdpFormatKeyFromSettings(settings)
    const aiAdp = await getAiAdpForLeague(sport, isDynasty, formatKey).catch(() => null)
    if (aiAdp?.entries?.length) {
      aiAdpByKey = {}
      for (const entry of aiAdp.entries) {
        const key = `${(entry.playerName || '').toLowerCase()}|${(entry.position || '').toLowerCase()}|${(entry.team || '').toLowerCase()}`
        aiAdpByKey[key] = Number(entry.adp ?? 0)
      }
    }
  }

  return {
    draftSession: {
      id: draftSession.id,
      status: draftSession.status,
      draftType: draftSession.draftType,
      rounds: draftSession.rounds,
      teamCount: draftSession.teamCount,
      thirdRoundReversal: draftSession.thirdRoundReversal,
      sportType: draftSession.sportType,
      sessionKind: String(draftSession.sessionKind ?? 'live'),
      picks: draftSession.picks.map((p) => ({
        rosterId: p.rosterId,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
      })),
      slotOrder: draftSession.slotOrder,
      tradedPicks: draftSession.tradedPicks,
    },
    current,
    onClockRosterId,
    fallbackPool,
    league: league ? { sport: String(league.sport), isDynasty: Boolean(league.isDynasty), settings } : null,
    sport,
    isDynasty,
    isSuperflex,
    aiAdpByKey,
    autopickBehavior,
    overallPick: current.overall,
    draftEligiblePositions: draftEligiblePositions ?? null,
  }
}

/**
 * Best ranked / need-based player for the current on-clock pick (not queue).
 * Call only when queue-first did not yield a pick and autopick_behavior is not `skip`.
 */
export async function resolveBestAvailableAutopickCandidate(
  leagueId: string,
  onClockRosterId: string
): Promise<BestAvailableAutopickResolved | null> {
  const ctx = await loadAutopickDraftContextForOnClock(leagueId, onClockRosterId)
  if (!ctx) return null

  const {
    draftSession,
    current,
    onClockRosterId: rid,
    fallbackPool,
    sport,
    isDynasty,
    isSuperflex,
    aiAdpByKey,
    autopickBehavior,
    draftEligiblePositions,
  } = ctx

  let selected: BestAvailableAutopickResolved | null = null

  const rosterSlots = await getRosterSlotLabelsForLeagueDraft(leagueId, sport)

  if (autopickBehavior === 'need-based') {
    const rec = computeDraftRecommendation({
      available: fallbackPool.map((entry) => ({
        name: entry.playerName,
        position: entry.position,
        team: entry.team,
        adp: entry.adp,
        byeWeek: entry.byeWeek,
      })),
      teamRoster: draftSession.picks
        .filter((pick) => pick.rosterId === rid)
        .map((pick) => ({ position: pick.position })),
      rosterSlots,
      round: current.round,
      pick: current.slot,
      totalTeams: draftSession.teamCount,
      sport,
      isDynasty,
      isSF: isSuperflex,
      mode: 'needs',
      aiAdpByKey,
      draftEligiblePositions: draftEligiblePositions ?? undefined,
    })
    const candidate = rec.recommendation?.player
    if (candidate) {
      const fromPool =
        fallbackPool.find(
          (entry) =>
            normalizeName(entry.playerName) === normalizeName(candidate.name) &&
            String(entry.position).toUpperCase() === String(candidate.position).toUpperCase()
        ) ?? fallbackPool[0]
      if (fromPool) {
        selected = {
          playerName: fromPool.playerName,
          position: fromPool.position,
          team: fromPool.team,
          playerId: fromPool.playerId,
          byeWeek: fromPool.byeWeek,
          reason: rec.recommendation?.reason || 'Need-based fallback recommendation.',
          strategy: 'need-based',
        }
      }
    }
  }

  if (!selected) {
    const sorted = [...fallbackPool].sort((a, b) => {
      const keyA = `${normalizeName(a.playerName)}|${(a.position || '').toLowerCase()}|${(a.team || '').toLowerCase()}`
      const keyB = `${normalizeName(b.playerName)}|${(b.position || '').toLowerCase()}|${(b.team || '').toLowerCase()}`
      const adpA = aiAdpByKey?.[keyA] ?? a.adp ?? 999
      const adpB = aiAdpByKey?.[keyB] ?? b.adp ?? 999
      if (adpA !== adpB) return adpA - adpB
      return a.playerName.localeCompare(b.playerName)
    })
    const top = sorted[0]
    if (top) {
      selected = {
        playerName: top.playerName,
        position: top.position,
        team: top.team,
        playerId: top.playerId,
        byeWeek: top.byeWeek,
        reason:
          autopickBehavior === 'need-based'
            ? 'Need-based fallback unavailable; selected best ranked available player.'
            : 'Queue empty; selected best ranked available player.',
        strategy: 'bpa',
      }
    }
  }

  return selected
}

/**
 * Slow-draft cron: submit best-available after queue-first produced no pick.
 *
 * Commit Q — accepts an optional `expectedOverall` so callers (the
 * cron tick, the autopick-expired route) can pass the overall they
 * computed when resolving the on-clock state. Combined with Commit M's
 * stale-overall guard inside `submitPick`, this short-circuits a
 * doomed-pick race the moment another writer lands a pick first.
 * Falling back to the in-tx `picks.length` guard alone would still be
 * correct, but the explicit pass is cheap and clearer.
 */
export async function submitBestAvailableAutopickForExpiredTimer(
  leagueId: string,
  onClockRosterId: string,
  expectedOverall?: number
): Promise<{ ok: true; pick: BestAvailableAutopickResolved } | { ok: false; error: 'no_pool' | 'submit_failed' }> {
  const { tryAiOpponentAutopickForExpiredTimer } = await import('@/lib/ai/opponents/liveDraftAiAutopick')
  const aiTry = await tryAiOpponentAutopickForExpiredTimer(leagueId, onClockRosterId)
  if (aiTry.ok) return aiTry

  const selected = await resolveBestAvailableAutopickCandidate(leagueId, onClockRosterId)
  if (!selected) return { ok: false, error: 'no_pool' }

  const result = await submitPick({
    leagueId,
    playerName: selected.playerName.trim(),
    position: selected.position.trim(),
    team: selected.team ?? null,
    playerId: selected.playerId ?? null,
    byeWeek: selected.byeWeek ?? null,
    rosterId: onClockRosterId,
    source: 'auto',
    expectedOverall,
  })

  if (!result.success) return { ok: false, error: 'submit_failed' }
  return { ok: true, pick: selected }
}
