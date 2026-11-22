/**
 * Devy Pool Manager — builds draft pools with strict pool separation. PROMPT 3/6.
 * - Vet pool: pro veterans (startup draft only — no NCAA, no rookies)
 * - Rookie pool: first-year pros, devy-held-promoted excluded
 * - Devy pool: NCAA devy-eligible, not graduated, not currently rostered in this league
 * Deterministic: no AI, no approximation.
 */

import { prisma } from '@/lib/prisma'
import {
  getDevyHeldPromotedDevyPlayerIds,
  getPromotedProPlayerIdsExcludedFromRookiePool,
} from './DevyPoolSeparation'
import { DEVY_LIFECYCLE_STATE } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DevyPoolPlayer {
  id: string
  name: string
  position: string
  school: string
  draftEligibleYear: number | null
  projectedDraftRound: number | null
  statusConfidence: number
  devyAdp: number | null
  /** true if already rostered by any team in this league */
  rostered: boolean
}

export interface RookiePoolPlayer {
  proPlayerId: string
  position: string
  proTeam: string | null
}

export interface VetPoolPlayer {
  proPlayerId: string
  position: string
  proTeam: string | null
}

export interface PoolBuildResult<T> {
  pool: T[]
  excludedCount: number
  buildAt: string
}

// ─── Devy Pool ────────────────────────────────────────────────────────────────

/**
 * Build the devy draft pool for a league:
 * - NCAA devy-eligible, not graduated (devyEligible = true, graduatedToNFL = false for NFL or devyEligible = true for NBA)
 * - Position-filtered by sport adapter
 * - Not currently rostered by any team in this league (unless extra devy FA; checked separately)
 * - Not already holding rights via devy draft (they already have a roster slot)
 */
export async function buildDevyPool(
  leagueId: string,
  sport: 'NFL' | 'NBA',
  seasonYear?: number
): Promise<PoolBuildResult<DevyPoolPlayer>> {
  const buildAt = new Date().toISOString()

  // Position filter: NFL = QB/RB/WR/TE, NBA = G/F/C
  const nflPositions = ['QB', 'RB', 'WR', 'TE']
  const nbaPositions = ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF']
  const eligiblePositions = sport === 'NBA' ? nbaPositions : nflPositions

  // Exclude players already rostered in this league via devy rights (PROMOTED or still NCAA)
  const rosteredDevyIds = await prisma.devyRights.findMany({
    where: {
      leagueId,
      state: { in: [DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE, DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI, DEVY_LIFECYCLE_STATE.DECLARED, DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD] },
    },
    select: { devyPlayerId: true },
  })
  const rosteredSet = new Set(rosteredDevyIds.map((r) => r.devyPlayerId))

  // NFL: exclude graduatedToNFL; NBA: exclude devyEligible=false
  const graduationWhere =
    sport === 'NBA'
      ? { devyEligible: true }
      : { devyEligible: true, graduatedToNFL: false }

  const yearFilter =
    seasonYear != null
      ? { draftEligibleYear: { gte: seasonYear } }
      : {}

  const players = await prisma.devyPlayer.findMany({
    where: {
      ...graduationWhere,
      ...yearFilter,
      position: { in: eligiblePositions },
    },
    select: {
      id: true,
      name: true,
      position: true,
      school: true,
      draftEligibleYear: true,
      projectedDraftRound: true,
      statusConfidence: true,
      devyAdp: true,
    },
    orderBy: { devyAdp: 'asc' },
  })

  const pool: DevyPoolPlayer[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    school: p.school,
    draftEligibleYear: p.draftEligibleYear,
    projectedDraftRound: p.projectedDraftRound,
    statusConfidence: p.statusConfidence,
    devyAdp: p.devyAdp,
    rostered: rosteredSet.has(p.id),
  }))

  // Exclude those already drafted (rostered in a rights slot) from the available pool
  const available = pool.filter((p) => !p.rostered)
  const excludedCount = pool.length - available.length

  return { pool: available, excludedCount, buildAt }
}

// ─── Rookie Pool ──────────────────────────────────────────────────────────────

/**
 * Build the rookie draft pool for a league:
 * - Players in their first pro season (draftYear = seasonYear if the external system tags them)
 * - Devy-held-promoted pro players are EXCLUDED (they already belong to a roster)
 * - Veterans are excluded (not rookies)
 *
 * Note: Our DB stores pro players as SportsPlayer (or mapped by proPlayerId on DevyRights).
 * We derive the "rookie" pool from DevyRights.promotedProPlayerId exclusion set and
 * expose the exclusion set so the draft engine can filter its player list from the sports API.
 */
export async function buildRookiePoolExclusionSet(leagueId: string): Promise<{
  excludedDevyPlayerIds: string[]
  excludedProPlayerIds: string[]
  buildAt: string
}> {
  const buildAt = new Date().toISOString()
  const [devyIds, proIds] = await Promise.all([
    getDevyHeldPromotedDevyPlayerIds(leagueId),
    getPromotedProPlayerIdsExcludedFromRookiePool(leagueId),
  ])
  return {
    excludedDevyPlayerIds: [...devyIds],
    excludedProPlayerIds: [...proIds],
    buildAt,
  }
}

/**
 * Check if a given pro player ID is eligible for the rookie draft pool in this league.
 * A player is ineligible if they were already promoted from a devy slot.
 */
export async function isInRookiePool(leagueId: string, proPlayerId: string): Promise<boolean> {
  const excluded = await getPromotedProPlayerIdsExcludedFromRookiePool(leagueId)
  return !excluded.has(proPlayerId)
}

/**
 * Check if a given devy player ID (pre-promotion) is eligible for the rookie draft pool.
 */
export async function isDevyPlayerInRookiePool(leagueId: string, devyPlayerId: string): Promise<boolean> {
  const excluded = await getDevyHeldPromotedDevyPlayerIds(leagueId)
  return !excluded.has(devyPlayerId)
}

// ─── Vet Pool ─────────────────────────────────────────────────────────────────

/**
 * Startup vet pool: no NCAA players, no rookies (derived at draft time from sports API).
 * We return the exclusion rule description; the actual player list is fetched from the pro sports API.
 */
export function getVetPoolExclusionRule(): {
  excludeNcaa: true
  excludeRookies: true
  description: string
} {
  return {
    excludeNcaa: true,
    excludeRookies: true,
    description: 'Startup vet draft: veterans only. No NCAA or first-year rookies.',
  }
}

// ─── Pool Validation ──────────────────────────────────────────────────────────

/**
 * Assert no player exists in both pools simultaneously.
 * Used as a guard before presenting the draft board.
 */
export async function assertNoPoolOverlap(
  leagueId: string
): Promise<{ valid: boolean; conflicts: string[] }> {
  const [promotedDevyIds] = await Promise.all([
    getDevyHeldPromotedDevyPlayerIds(leagueId),
    getPromotedProPlayerIdsExcludedFromRookiePool(leagueId),
  ])

  // Check if any PROMOTION_ELIGIBLE or NCAA rights holder is also PROMOTED (shouldn't exist)
  const ncaaRights = await prisma.devyRights.findMany({
    where: {
      leagueId,
      state: { in: [DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE, DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI] },
    },
    select: { devyPlayerId: true },
  })
  const ncaaDevyIds = new Set(ncaaRights.map((r) => r.devyPlayerId))

  const conflicts: string[] = []
  for (const id of ncaaDevyIds) {
    if (promotedDevyIds.has(id)) {
      conflicts.push(`DevyPlayer ${id} is in both NCAA devy pool and promoted pool`)
    }
  }

  return { valid: conflicts.length === 0, conflicts }
}
