import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { handleInvalidationTrigger } from '@/lib/trade-engine/caching'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { recordTrendSignalsAndUpdate } from '@/lib/player-trend'
import { resolveSportForTrend } from '@/lib/player-trend/SportTrendContextResolver'
import { prisma } from '@/lib/prisma'
import { validateAiActionExecution } from '@/lib/ai/action-validation'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  buildPersistedRosterDataFromRosterState,
  weekFromLeagueSettingsForLineup,
} from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedLineupIntegrationService, extractPlayerRefs } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

// Guillotine: chopped (eliminated) rosters cannot change lineup/roster.
// Salary cap: when persisting roster changes for a salary_cap league, call
// SalaryCapTradeValidator.validateTradeCap for trades and enforce cap legality
// (getOrCreateLedger / checkCapLegality) before saving adds/drops.

function weekFromLeagueSettings(settings: unknown): number {
  return weekFromLeagueSettingsForLineup(settings)
}

function toPlayerId(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const id = obj.id ?? obj.player_id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

function extractStarterIds(body: unknown, playerData: unknown): string[] {
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const pdObj =
    playerData && typeof playerData === 'object' && !Array.isArray(playerData)
      ? (playerData as Record<string, unknown>)
      : {}
  const lineupSections =
    pdObj.lineup_sections && typeof pdObj.lineup_sections === 'object'
      ? (pdObj.lineup_sections as Record<string, unknown>)
      : {}

  const startersRaw =
    (Array.isArray(bodyObj.starters) ? bodyObj.starters : null) ??
    (Array.isArray(bodyObj.lineup) ? bodyObj.lineup : null) ??
    (Array.isArray(bodyObj.startingPlayerIds) ? bodyObj.startingPlayerIds : null) ??
    (Array.isArray((bodyObj.roster as Record<string, unknown> | null | undefined)?.starters)
      ? (bodyObj.roster as Record<string, unknown>).starters
      : null) ??
    (Array.isArray(pdObj.starters) ? pdObj.starters : null) ??
    (Array.isArray(lineupSections.starters) ? lineupSections.starters : null)

  if (!Array.isArray(startersRaw)) return []
  return [...new Set(startersRaw.map((v) => toPlayerId(v)).filter(Boolean) as string[])]
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : null
  const rosterIdInput = typeof body?.rosterId === 'string' ? body.rosterId : null
  const rosterState = body?.roster
  const rosterDataInput =
    body?.rosterData && typeof body.rosterData === 'object' && !Array.isArray(body.rosterData)
      ? (body.rosterData as Record<string, unknown>)
      : null

  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const aiValidation = validateAiActionExecution({
    body,
    action: 'apply_lineup',
    leagueId,
  })
  if (!aiValidation.ok) {
    return NextResponse.json({ error: aiValidation.error }, { status: aiValidation.status })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, leagueVariant: true, sport: true, settings: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const editingWeekRaw = (body as Record<string, unknown>)?.week
  const editingWeek =
    typeof editingWeekRaw === 'number' && Number.isFinite(editingWeekRaw)
      ? Math.max(1, Math.floor(editingWeekRaw))
      : weekFromLeagueSettings(league.settings)

  const memberRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const canActAsCommissioner = league.userId === userId
  if (!memberRoster && !canActAsCommissioner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let targetRosterId = rosterIdInput ?? memberRoster?.id ?? null
  if (!targetRosterId && canActAsCommissioner) {
    const firstRoster = await (prisma as any).roster.findFirst({
      where: { leagueId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    targetRosterId = firstRoster?.id ?? null
  }
  if (!targetRosterId) {
    return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  }

  if (!canActAsCommissioner && memberRoster && targetRosterId !== memberRoster.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const chopped = await isRosterChopped(leagueId, targetRosterId)
  if (chopped) {
    return NextResponse.json(
      { error: 'This team has been eliminated and cannot make roster changes.' },
      { status: 403 }
    )
  }

  const specialtySpec = getSpecialtySpecByVariant(league?.leagueVariant ?? null)
  if (specialtySpec?.rosterGuard) {
    const canAct = await specialtySpec.rosterGuard(leagueId, targetRosterId).catch(() => true)
    if (!canAct) {
      return NextResponse.json(
        { error: 'This roster is not allowed to make lineup or roster changes right now.' },
        { status: 403 }
      )
    }
  }

  const currentRoster = await prisma.roster.findUnique({
    where: { id: targetRosterId },
    select: { id: true, leagueId: true, playerData: true },
  })
  if (!currentRoster || currentRoster.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Roster not found or does not belong to this league.' }, { status: 404 })
  }

  let nextPlayerData = currentRoster.playerData
  if (rosterDataInput) {
    nextPlayerData = {
      ...(currentRoster.playerData && typeof currentRoster.playerData === 'object' && !Array.isArray(currentRoster.playerData)
        ? (currentRoster.playerData as Record<string, unknown>)
        : {}),
      ...rosterDataInput,
      lineup_updated_at: new Date().toISOString(),
    }
  } else if (rosterState && typeof rosterState === 'object') {
    nextPlayerData = buildPersistedRosterDataFromRosterState(rosterState, currentRoster.playerData) as Prisma.JsonObject
  }

  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true },
  })
  const season = leagueRow?.season ?? new Date().getFullYear()

  // Gated, reject-only certified sports safety — runs BEFORE persistence, can only ADD a rejection (never
  // approve, never weaken), and only on TRUSTWORTHY (current) certified evidence that a started player's game
  // is already locked/final/postponed. On stale/unavailable certified data it does NOT block this
  // human-confirmed manual save — the engine's own lock check below (skipLockCheck:false) remains final. This
  // route intentionally uses the engine persist as its deterministic authority (no separate full-legality gate,
  // to preserve existing behavior). Evidence is EMITTED in the response (not persisted). Wrapped so it can never
  // turn a safe save into an error.
  let sportsDataDecision:
    | { featureGateEnabled: boolean; finalDecision: 'allowed' | 'rejected'; reason: string; freshnessStatus: string; identityStatus: string; scheduleSnapshotVersion: string | null; blockedCanonicalPlayerIds: string[]; evaluatedAt: string }
    | undefined
  if (isSportsDataEnabled('lineup') && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const starterRefs = extractPlayerRefs(extractStarterIds(body, nextPlayerData))
      const guard = await new CertifiedLineupIntegrationService().evaluateLineupPersistSafety({ season: String(season), week: String(editingWeek), starterRefs })
      sportsDataDecision = {
        featureGateEnabled: true,
        finalDecision: guard.block ? 'rejected' : 'allowed',
        reason: guard.reason,
        freshnessStatus: guard.freshnessStatus,
        identityStatus: guard.identityStatus,
        scheduleSnapshotVersion: guard.snapshotVersion,
        blockedCanonicalPlayerIds: guard.blockedPlayers,
        evaluatedAt: new Date().toISOString(),
      }
      if (guard.block) {
        console.info('[roster/save][sports-data] rejected', { leagueId, rosterId: targetRosterId, reason: guard.reason, snapshot: guard.snapshotVersion })
        return NextResponse.json({ error: `Lineup blocked by certified game evidence: ${guard.reason}`, code: 'SPORTS_DATA_LOCK', sportsDataDecision }, { status: 409 })
      }
    } catch {
      sportsDataDecision = { featureGateEnabled: true, finalDecision: 'allowed', reason: 'certified sports evidence unavailable — existing authority final', freshnessStatus: 'unavailable', identityStatus: 'unresolved', scheduleSnapshotVersion: null, blockedCanonicalPlayerIds: [], evaluatedAt: new Date().toISOString() }
    }
  }

  const persisted = await persistRosterLineupWithEngine({
    leagueId,
    rosterId: targetRosterId,
    actorUserId: userId,
    nextPlayerData:
      nextPlayerData && typeof nextPlayerData === 'object' && !Array.isArray(nextPlayerData)
        ? (nextPlayerData as Record<string, unknown>)
        : {},
    season,
    week: editingWeek,
    source: 'user_save',
    skipLockCheck: false,
  })

  if (!persisted.ok) {
    return NextResponse.json({ error: persisted.error }, { status: persisted.status ?? 400 })
  }

  const prevStarters = extractStarterIds({}, currentRoster.playerData)
  const nextStarters = extractStarterIds(body, nextPlayerData)
  const prevKey = [...prevStarters].sort().join(',')
  const nextKey = [...nextStarters].sort().join(',')
  if (prevKey !== nextKey) {
    void recordAfLearningEvent({
      eventType: 'lineup_change',
      sport: normalizeToSupportedSport(String(league.sport ?? 'NFL')),
      leagueId,
      userId,
      source: 'roster_save',
      payload: {
        week: editingWeek,
        rosterId: targetRosterId,
        prevStarterCount: prevStarters.length,
        nextStarterCount: nextStarters.length,
      },
    })
  }

  // Best-effort lineup_start signals for trend engine if starter IDs are provided.
  const starterIds = extractStarterIds(body, nextPlayerData)
  if (starterIds.length > 0) {
    const sport = resolveSportForTrend(league?.sport)
    const players = await prisma.player.findMany({
      where: { id: { in: starterIds }, sport },
      select: { id: true },
    })
    if (players.length > 0) {
      void recordTrendSignalsAndUpdate(
        players.map((p) => ({
          playerId: p.id,
          sport,
          signalType: 'lineup_start',
          leagueId,
          value: 1,
        }))
      ).catch(() => {})
    }
  }

  handleInvalidationTrigger('roster_change', leagueId)

  void import('@/lib/league-notifications/realtimeHint').then(({ publishLeagueRealtimeHint }) =>
    publishLeagueRealtimeHint(leagueId, 'lineup_updated', 'Roster or lineup updated', {
      rosterId: targetRosterId,
      week: editingWeek,
    }),
  )

  return NextResponse.json({ ok: true, rosterId: targetRosterId, ...(sportsDataDecision ? { sportsDataDecision } : {}) })
}

