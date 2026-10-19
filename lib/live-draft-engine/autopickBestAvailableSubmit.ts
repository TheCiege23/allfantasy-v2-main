import { prepareSeasonDraftPool } from '@/lib/tournament/seasonDraftRefresh'
import { loadSeasonDraftContext, loadSeasonDraftPlayers } from '@/lib/tournament/seasonDraftRuntime'
import { selectSeasonAutodraft } from '@/lib/tournament/seasonDraftPolicy'
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
import { loadNbaSurvivorRosterEligibility, nbaSurvivorPlayerIdMatches } from '@/lib/draft-room/nbaSurvivorRosterEligibility'
import { ensureDraftPoolReady, getWarmDraftPoolSnapshotFast } from '@/lib/draft-room/ensureDraftPoolReady'
import { getAiAdpForLeague } from '@/lib/ai-adp-engine'
import { resolveAiAdpFormatKeyFromSettings } from '@/lib/ai-adp-engine/segment-resolver'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { draftPoolRowMatchesEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { getAllowedPositionsAndRosterSize } from '@/lib/live-draft-engine/RosterFitValidation'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import type { CurrentOnTheClock } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { filterCandidatesForPlayerPool } from '@/lib/live-draft-engine/serverRookieStatus'

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

type ResolvedPoolEntry = Awaited<ReturnType<typeof getResolvedDraftPoolForLeague>>['entries'][number]

function toFallbackPoolEntry(e: ResolvedPoolEntry): AutopickFallbackPoolEntry {
  return {
    playerName: String(e.name ?? '').trim(),
    position: String(e.position ?? '').trim(),
    team: e.team ?? null,
    playerId: String(e.display?.playerId ?? e.playerId ?? '').trim() || null,
    byeWeek: e.byeWeek ?? e.display?.metadata?.byeWeek ?? null,
    adp: e.adp ?? null,
  }
}

/**
 * Below this many undrafted rows a cached snapshot is too thin to choose from. The snapshot is built
 * WITHOUT exclusions and capped at its own limit (300 from `ensureDraftPoolReady`), so late in a big
 * draft most of it is gone; that is when a rebuild with exclusions earns its cost.
 */
export const AUTOPICK_WARM_POOL_MIN_UNDRAFTED = 75

/**
 * The draft room's cached pool snapshot, when one is warm and still deep enough. Building one first
 * when none exists, so the cold build happens once per pool rather than once per pick.
 *
 * Drafted players are not removed here: the caller already filters on `draftedNames`, by the same
 * normalization it always used.
 */
async function loadWarmPoolCandidates(
  leagueId: string,
  draftedNames: Set<string>,
): Promise<AutopickFallbackPoolEntry[] | null> {
  let snap = await getWarmDraftPoolSnapshotFast(leagueId)
  if (!snap.warm) {
    const ensured = await ensureDraftPoolReady(leagueId)
    if (!ensured.ok) return null
    snap = await getWarmDraftPoolSnapshotFast(leagueId)
    if (!snap.warm) return null
  }
  const payload = snap.payload
  if (payload.rosterConfigurationIncomplete || !Array.isArray(payload.entries) || payload.entries.length === 0) {
    return null
  }
  const candidates = (payload.entries as ResolvedPoolEntry[]).map(toFallbackPoolEntry)
  const undrafted = candidates.filter((c) => c.playerName && !draftedNames.has(normalizeName(c.playerName))).length
  if (undrafted < AUTOPICK_WARM_POOL_MIN_UNDRAFTED) return null
  return candidates
}

/*
 * 🛑 EVERY AUTOPICK WAS A FULL COLD POOL BUILD. This called `getResolvedDraftPoolForLeague` with the
 * pick's drafted names, which no cache can hold, so each expired timer rebuilt the whole pool —
 * measured 10–22s per pick for a ~1,350-player NBA pool, ~2.5h for one 104-pick board of autopicks.
 * The draft room had a warm snapshot of the same pool the whole time (`ensureDraftPoolReady`'s memory
 * and DB cache). Read it first; rebuild with exclusions only when it is missing or exhausted.
 */
async function loadFallbackCandidates(
  leagueId: string,
  sport: string,
  draftedNames: Set<string>,
): Promise<AutopickFallbackPoolEntry[]> {
  try {
    const warm = await loadWarmPoolCandidates(leagueId, draftedNames)
    if (warm) return warm
  } catch (err) {
    console.warn('[autopick] warm pool snapshot unavailable; rebuilding', err)
  }
  try {
    const resolved = await getResolvedDraftPoolForLeague(leagueId, {
      limit: 400,
      excludeDraftedNames: draftedNames,
    })
    if (!resolved.rosterConfigurationIncomplete && resolved.entries.length > 0) {
      return resolved.entries.map(toFallbackPoolEntry)
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
  const draftSession = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
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
    select: { sport: true, leagueVariant: true, isDynasty: true, settings: true },
  })
  const sport = String(league?.sport ?? draftSession.sportType ?? 'NFL').toUpperCase()
  const isDynasty = Boolean(league?.isDynasty)
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const isSuperflex = getIsSuperflexFromSettings(settings)

  let fallbackPoolRaw = await loadFallbackCandidates(leagueId, sport, draftedNames)
  if (sport === 'NBA' && league?.leagueVariant === 'survivor') {
    const roster = await loadNbaSurvivorRosterEligibility(totalPicks)
    fallbackPoolRaw = fallbackPoolRaw.filter((candidate) =>
      nbaSurvivorPlayerIdMatches(roster, candidate.playerName, candidate.playerId),
    )
  }
  const fallbackPool = await filterCandidatesForPlayerPool(
    leagueId,
    (draftSession as { playerPool?: string | null }).playerPool,
    fallbackPoolRaw.filter((entry) => {
      if (!entry.playerName || !entry.position) return false
      if (draftedNames.has(normalizeName(entry.playerName))) return false
      if (draftEligiblePositions && !draftPoolRowMatchesEligiblePositions(entry.position, draftEligiblePositions)) {
        return false
      }
      return true
    }),
    // Same verdict pick validation applies to `auto` picks, so autopick never chooses a player it
    // would then be refused — a refused autopick retries the same player and stalls the clock.
    (entry) => ({ playerId: entry.playerId, playerName: entry.playerName }),
  )

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
  const season = await loadSeasonDraftContext(leagueId)
  if (season) {
    const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, include: { picks: { orderBy: { overall: 'asc' } } } })
    if (!session || session.status !== 'in_progress' || session.draftType !== 'snake' || session.rounds !== season.config.rosterSize) return null
    const order = session.slotOrder as Array<{ slot: number; rosterId: string; displayName: string }>
    if (!Array.isArray(order) || order.length !== season.rosterIds.length || order.some((s, i) => s.slot !== i + 1 || s.rosterId !== season.rosterIds[i]) || (Array.isArray(session.tradedPicks) && session.tradedPicks.length > 0)) return null
    const current = resolveCurrentOnTheClock({ totalPicks: session.rounds * session.teamCount, picks: session.picks, teamCount: session.teamCount, draftType: 'snake', thirdRoundReversal: false, slotOrder: order })
    if (current?.rosterId !== onClockRosterId) return null
    if (await prepareSeasonDraftPool(leagueId)) return null
    const pool = await loadSeasonDraftPlayers(leagueId, season.config.sport)
    const filled = session.picks.filter(p => p.playerName.trim() && p.position.trim())
    const takenNames = new Set(filled.map(p => normalizeName(p.playerName)))
    const taken = new Set(pool.filter(p => takenNames.has(normalizeName(p.playerName))).map(p => p.playerId))
    const own = filled.filter(p => p.rosterId === onClockRosterId).map(p => ({ playerId: p.playerId ?? '', playerName: p.playerName, position: p.position }))
    const player = selectSeasonAutodraft(season.config, own, pool, taken)
    return player ? { ...player, team: player.team ?? null, byeWeek: null, reason: 'Best available player that preserves the frozen roster requirements.', strategy: 'bpa' } : null
  }
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
  if (!(await loadSeasonDraftContext(leagueId))) {
    const { tryAiOpponentAutopickForExpiredTimer } = await import('@/lib/ai/opponents/liveDraftAiAutopick')
    const aiTry = await tryAiOpponentAutopickForExpiredTimer(leagueId, onClockRosterId)
    if (aiTry.ok) return aiTry
  }

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
