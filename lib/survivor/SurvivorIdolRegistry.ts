/**
 * Survivor idol registry: assignment, transfer, use, expiry (PROMPT 346). Deterministic.
 * Player-bound; one per user at initial assignment; full chain-of-custody in SurvivorIdolLedgerEntry.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { DEFAULT_IDOL_POWER_POOL } from './constants'
import { getEligibleRosterIdsForCouncil } from './SurvivorCouncilEligibility'
import { applyIdolPowerEffect } from './SurvivorEffectEngine'
import { getFinaleState } from './SurvivorFinaleEngine'
import { getCouncil } from './SurvivorTribalCouncilService'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import type { IdolPowerType } from './types'

/** Seeded RNG for deterministic assignment. */
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) >>> 0
    return (s >>> 0) / 0xffff_ffff
  }
}

/**
 * Assign idols after draft: N idols to N distinct drafted players; max one per roster at assignment.
 * playerRosterPairs: { playerId, rosterId }[] for all drafted players (from draft picks).
 */
export async function assignIdolsAfterDraft(
  leagueId: string,
  playerRosterPairs: { playerId: string; rosterId: string }[],
  options?: { seed?: number }
): Promise<{ ok: boolean; assigned: number; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, assigned: 0, error: 'Not a Survivor league' }

  const existing = await prisma.survivorIdol.findMany({
    where: { configId: config.configId },
    select: { id: true },
  })
  if (existing.length > 0) return { ok: false, assigned: 0, error: 'Idols already assigned' }

  const count = Math.min(config.idolCount, playerRosterPairs.length)
  if (count <= 0) return { ok: true, assigned: 0 }

  const pool = config.idolPowerPool?.length ? config.idolPowerPool : [...DEFAULT_IDOL_POWER_POOL]
  const rng = seededRandom(options?.seed ?? Date.now())

  const usedRosterIds = new Set<string>()
  const shuffled = [...playerRosterPairs]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const expiresAtWeek = await resolveIdolExpiryWeek(leagueId)

  let assigned = 0
  for (let i = 0; i < count; i++) {
    const pair = shuffled[i]
    if (usedRosterIds.has(pair.rosterId)) continue
    usedRosterIds.add(pair.rosterId)
    const powerType = pool[i % pool.length] ?? 'protect_self'
    const idol = await prisma.survivorIdol.create({
      data: {
        leagueId,
        configId: config.configId,
        rosterId: pair.rosterId,
        playerId: pair.playerId,
        powerType,
        status: 'hidden',
        expiresAtWeek,
      },
    })
    await prisma.survivorIdolLedgerEntry.create({
      data: {
        leagueId,
        idolId: idol.id,
        eventType: 'assigned',
        toRosterId: pair.rosterId,
        metadata: { playerId: pair.playerId, powerType },
      },
    })
    assigned++
  }

  await appendSurvivorAudit(leagueId, config.configId, 'idol_assigned', { count: assigned })
  return { ok: true, assigned }
}

/**
 * Transfer idol ownership (on trade/waiver claim/stolen player). New owner = toRosterId.
 */
export async function transferIdol(
  leagueId: string,
  idolId: string,
  toRosterId: string,
  reason: 'trade' | 'waiver_claim' | 'stolen_player'
): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const idol = await prisma.survivorIdol.findFirst({
    where: { id: idolId, leagueId, configId: config.configId },
  })
  if (!idol) return { ok: false, error: 'Idol not found' }
  if (idol.status !== 'hidden' && idol.status !== 'revealed') return { ok: false, error: 'Idol already used or expired' }

  const fromRosterId = idol.rosterId
  await prisma.survivorIdol.update({
    where: { id: idolId },
    data: { rosterId: toRosterId },
  })
  await prisma.survivorIdolLedgerEntry.create({
    data: {
      leagueId,
      idolId,
      eventType: 'transferred',
      fromRosterId,
      toRosterId,
      metadata: { reason },
    },
  })
  await appendSurvivorAudit(leagueId, config.configId, 'idol_transferred', {
    idolId,
    fromRosterId,
    toRosterId,
    reason,
  })
  return { ok: true }
}

/**
 * Get idol by player (for transfer on trade/claim/steal). Returns first active idol bound to this player.
 */
export async function getIdolByPlayer(leagueId: string, playerId: string): Promise<{ id: string; rosterId: string } | null> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return null
  const idol = await prisma.survivorIdol.findFirst({
    where: { leagueId, configId: config.configId, playerId, status: { in: ['hidden', 'revealed'] } },
    select: { id: true, rosterId: true },
  })
  return idol
}

/**
 * Validate and apply idol use. Returns ok and optional error.
 * (Named `applyIdolPower` — not a React hook.)
 */
export async function applyIdolPower(
  leagueId: string,
  idolId: string,
  rosterId: string,
  context?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const idol = await prisma.survivorIdol.findFirst({
    where: { id: idolId, leagueId, configId: config.configId },
  })
  if (!idol) return { ok: false, error: 'Idol not found' }
  if (idol.rosterId !== rosterId) return { ok: false, error: 'Not your idol' }
  if (idol.status !== 'hidden' && idol.status !== 'revealed') return { ok: false, error: 'Idol already used or expired' }

  const councilId = typeof context?.councilId === 'string' ? context.councilId : null
  const councilWeekRaw = context?.week ?? context?.currentWeek
  const councilWeek =
    typeof councilWeekRaw === 'number'
      ? councilWeekRaw
      : typeof councilWeekRaw === 'string' && councilWeekRaw.trim()
        ? Number.parseInt(councilWeekRaw, 10)
        : null
  const council = councilId
    ? await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId } })
    : councilWeek != null
      ? await getCouncil(leagueId, councilWeek)
      : null
  const finaleOnlyPower = idol.powerType === 'jury_influence' || idol.powerType === 'finale_advantage'
  if (!council && !finaleOnlyPower) return { ok: false, error: 'Idols can only be played during an active Tribal Council' }

  if (council) {
    if (council.closedAt) return { ok: false, error: 'This Tribal Council is already closed' }
    if (new Date() > council.voteDeadlineAt) return { ok: false, error: 'The Tribal Council deadline has passed' }

    const eligibleRosterIds = await getEligibleRosterIdsForCouncil(council.id)
    if (!eligibleRosterIds.includes(rosterId)) {
      return { ok: false, error: 'You are not eligible to play an idol in this council' }
    }
    if (idol.powerType === 'protect_self' || idol.powerType === 'protect_self_plus_one') {
      const protectedRosterId =
        typeof context?.protectedRosterId === 'string' ? context.protectedRosterId.trim() : ''
      if (protectedRosterId && !eligibleRosterIds.includes(protectedRosterId)) {
        return { ok: false, error: 'That manager is not eligible to receive idol protection in this council' }
      }
    }
    if (idol.powerType === 'vote_nullifier') {
      const nullifiedVoterRosterId =
        typeof context?.nullifiedVoterRosterId === 'string' ? context.nullifiedVoterRosterId.trim() : ''
      if (nullifiedVoterRosterId && !eligibleRosterIds.includes(nullifiedVoterRosterId)) {
        return { ok: false, error: 'That manager is not eligible to have their vote nullified in this council' }
      }
    }
  } else if (finaleOnlyPower) {
    const finaleWeek = councilWeek ?? (await resolveSurvivorCurrentWeek(leagueId))
    const finaleState = await getFinaleState(leagueId, finaleWeek)
    if (!finaleState.open) {
      return { ok: false, error: 'This idol can only be played while the Survivor finale is open' }
    }
    if (idol.powerType === 'jury_influence' && !finaleState.juryRosterIds.includes(rosterId)) {
      return { ok: false, error: 'Only jury members can use jury influence in the finale' }
    }
    const finalistTarget =
      typeof context?.targetRosterId === 'string' && context.targetRosterId.trim()
        ? context.targetRosterId.trim()
        : rosterId
    if (idol.powerType === 'finale_advantage' && !finaleState.finalists.includes(finalistTarget)) {
      return { ok: false, error: 'Finale advantage must target an active finalist' }
    }
    if (idol.powerType === 'finale_advantage') {
      context = {
        ...(context ?? {}),
        targetRosterId: finalistTarget,
      }
    }
  }

  const effectResult = await applyIdolPowerEffect({
    leagueId,
    idolId,
    rosterId,
    powerType: idol.powerType,
    context,
  })
  if (!effectResult.ok) {
    return { ok: false, error: effectResult.error ?? 'Unable to apply this idol power right now' }
  }

  await prisma.survivorIdol.update({
    where: { id: idolId },
    data: { status: 'used', usedAt: new Date() },
  })
  await prisma.survivorIdolLedgerEntry.create({
    data: {
      leagueId,
      idolId,
      eventType: 'used',
      fromRosterId: rosterId,
      metadata: toPrismaJsonInput({
        ...(context ?? {}),
        powerType: idol.powerType,
        appliedEffect: effectResult.effect ?? null,
      }),
    },
  })
  await appendSurvivorAudit(leagueId, config.configId, 'idol_used', {
    idolId,
    rosterId,
    powerType: idol.powerType,
  })
  return { ok: true }
}

/**
 * Mark idol expired (e.g. valid until merge and we merged).
 */
export async function expireIdol(leagueId: string, idolId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const idol = await prisma.survivorIdol.findFirst({
    where: { id: idolId, leagueId, configId: config.configId },
  })
  if (!idol) return { ok: false, error: 'Idol not found' }
  if (idol.status === 'used' || idol.status === 'expired') return { ok: true }

  await prisma.survivorIdol.update({
    where: { id: idolId },
    data: { status: 'expired', expiredAt: new Date() },
  })
  await prisma.survivorIdolLedgerEntry.create({
    data: { leagueId, idolId, eventType: 'expired', fromRosterId: idol.rosterId, metadata: {} },
  })
  await appendSurvivorAudit(leagueId, config.configId, 'idol_expired', { idolId })
  return { ok: true }
}

/**
 * Get all active idols for a roster.
 */
export async function getActiveIdolsForRoster(leagueId: string, rosterId: string): Promise<{ id: string; playerId: string; powerType: string }[]> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return []
  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, configId: config.configId, rosterId, status: { in: ['hidden', 'revealed'] } },
    select: { id: true, playerId: true, powerType: true },
  })
  return idols
}

/**
 * Compute the default "Final 5" week: the point at which 5 rosters remain, based
 * on current league size. Falls back to 14 when league data is unavailable.
 */
export async function defaultFinal5Week(
  league: { id: string; survivorIdolExpiryWeek?: number | null; leagueSize?: number | null } | null,
): Promise<number> {
  try {
    const leagueId = league?.id
    if (!leagueId) return 14
    const size =
      (typeof league?.leagueSize === 'number' && league.leagueSize > 0
        ? league.leagueSize
        : null) ??
      (await prisma.roster.count({ where: { leagueId } }).catch(() => 0)) ??
      0
    if (!size || size <= 5) return 14
    const elimsNeeded = size - 5
    // Approximate one elimination per tribal-council week, offset by a 2-week ramp.
    return Math.max(5, 2 + elimsNeeded)
  } catch {
    return 14
  }
}

/** Resolve per-league idol expiry week (explicit league field wins, else Final 5). */
export async function resolveIdolExpiryWeek(leagueId: string): Promise<number | null> {
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, survivorIdolExpiryWeek: true, leagueSize: true },
    })
    if (!league) return null
    if (typeof league.survivorIdolExpiryWeek === 'number') {
      return league.survivorIdolExpiryWeek
    }
    return defaultFinal5Week(league)
  } catch {
    return null
  }
}

/**
 * Mark any idols whose expiresAtWeek has passed as expired.
 */
export async function expireStaleIdols(
  leagueId: string,
  currentWeek: number,
): Promise<{ ok: boolean; expired: number; error?: string }> {
  try {
    const stale = await prisma.survivorIdol.findMany({
      where: {
        leagueId,
        status: { in: ['hidden', 'revealed'] },
        expiresAtWeek: { not: null, lt: currentWeek },
      },
      select: { id: true, rosterId: true },
    })
    let expired = 0
    for (const idol of stale) {
      await prisma.survivorIdol.update({
        where: { id: idol.id },
        data: { status: 'expired', expiredAt: new Date() },
      })
      await prisma.survivorIdolLedgerEntry.create({
        data: {
          leagueId,
          idolId: idol.id,
          eventType: 'expired',
          fromRosterId: idol.rosterId,
          metadata: { reason: 'stale', week: currentWeek },
        },
      }).catch(() => {})
      expired++
    }
    return { ok: true, expired }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, expired: 0, error: msg }
  }
}

/**
 * Get chain-of-custody for an idol.
 */
export async function getIdolLedger(idolId: string): Promise<{ eventType: string; fromRosterId: string | null; toRosterId: string | null; metadata: unknown; createdAt: Date }[]> {
  const rows = await prisma.survivorIdolLedgerEntry.findMany({
    where: { idolId },
    orderBy: { createdAt: 'asc' },
    select: { eventType: true, fromRosterId: true, toRosterId: true, metadata: true, createdAt: true },
  })
  return rows
}
