/**
 * Devy Dynasty future pick tracking and pick ownership resolution. PROMPT 2/6.
 * Covers: traded devy picks, traded rookie picks, traded vet (startup) picks.
 * Deterministic: no AI in pick ownership resolution.
 */

import { prisma } from '@/lib/prisma'
import { getDevyConfig } from '../DevyLeagueConfig'
import type { DevyLeagueConfigShape } from '../types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type DevyPickType = 'startup_vet' | 'rookie' | 'devy'

export interface TradedPickRecord {
  pickType: DevyPickType
  /** Draft year this pick applies to. */
  year: number
  round: number
  /** Roster that originally owned this pick (the team that got drafted into the slot). */
  originalRosterId: string
  originalOwnerName: string
  /** Current owner of the pick after trades. */
  currentRosterId: string
  currentOwnerName: string
  /** Previous owner (for audit trail). */
  previousRosterId?: string
  previousOwnerName?: string
}

export interface PickInventory {
  rosterId: string
  leagueId: string
  devy: TradedPickRecord[]
  rookie: TradedPickRecord[]
  startup: TradedPickRecord[]
  /** All picks this roster currently owns (own + received). */
  allOwned: TradedPickRecord[]
  /** Picks originally theirs but traded away. */
  tradedAway: TradedPickRecord[]
}

export interface PickTradeValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Read the tradedPicks JSON from the DraftSession for a league.
 * The DraftSession.tradedPicks stores: Array<{ round, originalRosterId, previousOwnerName, newRosterId, newOwnerName }>
 * We adapt this per-phase via devyConfig.phase on the session.
 */
async function readDraftSessionTradedPicks(leagueId: string): Promise<{
  picks: Array<{
    round: number
    originalRosterId: string
    previousOwnerName: string
    newRosterId: string
    newOwnerName: string
    pickType?: DevyPickType
    year?: number
  }>
  sessionExists: boolean
}> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { tradedPicks: true, devyConfig: true },
  })
  if (!session) return { picks: [], sessionExists: false }

  const raw = Array.isArray(session.tradedPicks) ? session.tradedPicks : []
  const devyCfg = session.devyConfig as { phase?: DevyPickType; year?: number } | null
  const pickType: DevyPickType = devyCfg?.phase ?? 'startup_vet'
  const year: number = devyCfg?.year ?? new Date().getFullYear()

  const picks = raw.map((value) => {
    const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    return {
      round: Number(p.round ?? 1),
      originalRosterId: String(p.originalRosterId ?? ''),
      previousOwnerName: String(p.previousOwnerName ?? ''),
      newRosterId: String(p.newRosterId ?? ''),
      newOwnerName: String(p.newOwnerName ?? ''),
      pickType: (p.pickType as DevyPickType | undefined) ?? pickType,
      year: Number(p.year ?? year),
    }
  })

  return { picks, sessionExists: true }
}

/**
 * Get all future devy draft picks (traded) for a league, optionally filtered by year.
 */
export async function getFutureDevyPicks(leagueId: string, year?: number): Promise<TradedPickRecord[]> {
  const { picks } = await readDraftSessionTradedPicks(leagueId)
  return picks
    .filter((p) => p.pickType === 'devy' && (year == null || p.year === year))
    .map((p) => ({
      pickType: 'devy',
      year: p.year ?? new Date().getFullYear(),
      round: p.round,
      originalRosterId: p.originalRosterId,
      originalOwnerName: p.previousOwnerName,
      currentRosterId: p.newRosterId,
      currentOwnerName: p.newOwnerName,
    }))
}

/**
 * Get all future rookie draft picks (traded) for a league, optionally filtered by year.
 */
export async function getFutureRookiePicks(leagueId: string, year?: number): Promise<TradedPickRecord[]> {
  const { picks } = await readDraftSessionTradedPicks(leagueId)
  return picks
    .filter((p) => p.pickType === 'rookie' && (year == null || p.year === year))
    .map((p) => ({
      pickType: 'rookie',
      year: p.year ?? new Date().getFullYear(),
      round: p.round,
      originalRosterId: p.originalRosterId,
      originalOwnerName: p.previousOwnerName,
      currentRosterId: p.newRosterId,
      currentOwnerName: p.newOwnerName,
    }))
}

/**
 * Resolve the current owner of a specific pick.
 * Returns null if no trade has modified ownership (original owner still holds it).
 */
export async function resolveDevyPickOwner(
  leagueId: string,
  originalRosterId: string,
  year: number,
  round: number,
  pickType: DevyPickType = 'devy'
): Promise<{ currentRosterId: string; currentOwnerName: string } | null> {
  const { picks } = await readDraftSessionTradedPicks(leagueId)
  // Find the most recent trade for this specific pick
  const matches = picks.filter(
    (p) =>
      p.pickType === pickType &&
      p.originalRosterId === originalRosterId &&
      p.year === year &&
      p.round === round
  )
  if (matches.length === 0) return null
  const latest = matches[matches.length - 1]
  return { currentRosterId: latest.newRosterId, currentOwnerName: latest.newOwnerName }
}

/**
 * Get the full pick inventory for a specific roster — all picks owned and all picks traded away.
 */
export async function getPickInventoryForRoster(leagueId: string, rosterId: string): Promise<PickInventory> {
  const { picks } = await readDraftSessionTradedPicks(leagueId)

  // Picks currently owned: newRosterId === rosterId (received via trade)
  const received = picks.filter((p) => p.newRosterId === rosterId)
  // Picks originally theirs that were traded away: originalRosterId === rosterId AND newRosterId !== rosterId
  const tradedAway = picks.filter((p) => p.originalRosterId === rosterId && p.newRosterId !== rosterId)

  const toRecord = (p: (typeof picks)[number]): TradedPickRecord => ({
    pickType: p.pickType ?? 'startup_vet',
    year: p.year ?? new Date().getFullYear(),
    round: p.round,
    originalRosterId: p.originalRosterId,
    originalOwnerName: p.previousOwnerName,
    currentRosterId: p.newRosterId,
    currentOwnerName: p.newOwnerName,
  })

  const allOwned = received.map(toRecord)
  const devy = allOwned.filter((r) => r.pickType === 'devy')
  const rookie = allOwned.filter((r) => r.pickType === 'rookie')
  const startup = allOwned.filter((r) => r.pickType === 'startup_vet')

  return {
    rosterId,
    leagueId,
    devy,
    rookie,
    startup,
    allOwned,
    tradedAway: tradedAway.map(toRecord),
  }
}

/**
 * Validate whether a pick trade is permitted under league settings.
 * Checks devyPickTradeRules / rookiePickTradeRules from DevyCommissionerSettings.
 */
export function validatePickTradeRules(
  pickType: DevyPickType,
  settings: Pick<
    DevyLeagueConfigShape,
    | 'devyPickTradeRules'
    | 'rookiePickTradeRules'
    | 'supportsFuturePicks'
    | 'supportsTradeableDevyPicks'
    | 'supportsTradeableRookiePicks'
  >
): PickTradeValidationResult {
  if (!settings.supportsFuturePicks) {
    return { valid: false, reason: 'Future pick trades are disabled for this league.' }
  }
  if (pickType === 'devy') {
    if (!settings.supportsTradeableDevyPicks) {
      return { valid: false, reason: 'Devy pick trades are disabled for this league.' }
    }
    if (String(settings.devyPickTradeRules) === 'no_trade') {
      return { valid: false, reason: 'Devy pick trades are set to no-trade by the commissioner.' }
    }
  }
  if (pickType === 'rookie') {
    if (!settings.supportsTradeableRookiePicks) {
      return { valid: false, reason: 'Rookie pick trades are disabled for this league.' }
    }
    if (String(settings.rookiePickTradeRules) === 'no_trade') {
      return { valid: false, reason: 'Rookie pick trades are set to no-trade by the commissioner.' }
    }
  }
  return { valid: true }
}

/**
 * Validate pick trade limits: leagues may restrict how many years out picks can be traded.
 * Uses the `futurePicksYearsOut` field from DevyLeagueConfig (stored in capabilities).
 */
export async function validatePickYearsOut(
  leagueId: string,
  pickYear: number,
  currentYear: number
): Promise<PickTradeValidationResult> {
  const config = await getDevyConfig(leagueId)
  // Default: 3 years out per schema default
  const maxYearsOut: number = (config as { futurePicksYearsOut?: number } | null)?.futurePicksYearsOut ?? 3
  const yearsOut = pickYear - currentYear
  if (yearsOut < 0) {
    return { valid: false, reason: 'Cannot trade picks from past seasons.' }
  }
  if (yearsOut > maxYearsOut) {
    return { valid: false, reason: `This league only allows trading picks up to ${maxYearsOut} year(s) out.` }
  }
  return { valid: true }
}
