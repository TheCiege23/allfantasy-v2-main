/**
 * Pre-flight validation for waiver claims and projected roster state after add/drop.
 * Integrates roster legality engine, size limits, FAAB min bid, and undroppable list.
 */

import { prisma } from '@/lib/prisma'
import { evaluateLegalityForProjectedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { computePerPlayerKickoffLocks } from '@/lib/roster-lineup-engine/lineupLockService'
import {
  addPlayerToRosterData,
  getRosterPlayerIds,
  getRosterSize,
  removePlayerFromRosterData,
  rosterContainsPlayer,
} from './roster-utils'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { normalizeWaiverTypeForEngine, parseWaiverEngineConfig } from './waiver-engine-config'
import { assertWeeklyDropLimit } from './waiver-validation'
import { commissionerOverrideAllowed, getCommissionerOverrides } from './commissioner-claim-override'

export const WAIVER_TX_RESULT_CODES = [
  'won',
  'lost_priority',
  'lost_tiebreaker',
  'insufficient_faab',
  'invalid_due_to_roster',
  'player_no_longer_available',
  'blocked_by_lineup_lock',
  'blocked_by_ir_taxi_devy_violation',
  'blocked_by_roster_lock',
  'blocked_by_undroppable',
  'blocked_by_drop_lock',
  'roster_over_limit',
] as const
export type WaiverTxResultCode = (typeof WAIVER_TX_RESULT_CODES)[number]

export type WaiverClaimEligibilityInput = {
  leagueId: string
  rosterId: string
  addPlayerId: string
  dropPlayerId?: string | null
  faabBid?: number | null
  /** Pending claim metadata (commissioner override flags). */
  claimMetadata?: unknown | null
  /** When editing an existing pending claim, exclude it from weekly drop counts. */
  excludeClaimId?: string | null
}

function sectionForPlayerId(playerData: unknown, pid: string): RosterSectionKey | null {
  const sections = getNormalizedLineupSections(playerData)
  const keys: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  for (const k of keys) {
    for (const row of sections[k]) {
      const o = row as Record<string, unknown>
      const id = String(o.id ?? '').trim()
      if (id === pid) return k
    }
  }
  return null
}

/**
 * Deterministic checks before creating a waiver claim. Throws `Error` with a user-facing message.
 */
export async function assertWaiverClaimEligibility(input: WaiverClaimEligibilityInput): Promise<void> {
  const { leagueId, rosterId, addPlayerId, dropPlayerId } = input
  const addId = String(addPlayerId).trim()
  if (!addId) throw new Error('Add player is required.')

  const [league, roster, settingsRow, eff] = await Promise.all([
    prisma.league.findFirst({
      where: { id: leagueId },
      select: {
        id: true,
        rosterSize: true,
        sport: true,
        lockAllMoves: true,
        lifecycleState: true,
      },
    }),
    prisma.roster.findFirst({
      where: { id: rosterId, leagueId },
      select: { id: true, playerData: true, faabRemaining: true },
    }),
    (prisma as any).leagueWaiverSettings.findUnique({ where: { leagueId } }),
    getEffectiveLeagueWaiverSettings(leagueId),
  ])

  if (!league || !roster) throw new Error('Roster not found or does not belong to this league.')

  if (league.lockAllMoves) {
    throw new Error('All roster moves are locked by the commissioner.')
  }
  if (league.lifecycleState === 'archived' || league.lifecycleState === 'completed') {
    throw new Error('This league season is complete; roster moves are locked.')
  }

  const engineConfig = parseWaiverEngineConfig(settingsRow?.waiverEngineConfig ?? null)
  const waiverType = normalizeWaiverTypeForEngine(eff.waiverType)
  const overrideAllowed = commissionerOverrideAllowed(engineConfig, settingsRow?.commissionerOverrideRules ?? null)
  const comm = overrideAllowed ? getCommissionerOverrides(input.claimMetadata) : {}

  const rosteredElsewhere = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, playerData: true },
  })
  if (rosterContainsPlayer(roster.playerData, addId)) {
    throw new Error('This player is already on your roster.')
  }
  const takenBy = rosteredElsewhere.find((r) => r.id !== rosterId && rosterContainsPlayer(r.playerData, addId))
  if (takenBy) {
    throw new Error('This player is already on another roster in this league.')
  }

  const rosterSizeLimit = league.rosterSize ?? 20
  const currentIds = getRosterPlayerIds(roster.playerData)
  const dropId = dropPlayerId && String(dropPlayerId).trim() ? String(dropPlayerId).trim() : null

  if (dropId && !rosterContainsPlayer(roster.playerData, dropId)) {
    throw new Error('Drop player is not on your roster.')
  }

  const undroppable = new Set(
    (Array.isArray(engineConfig.undroppable_player_ids) ? engineConfig.undroppable_player_ids : [])
      .map((x) => String(x).trim())
      .filter(Boolean),
  )
  if (dropId && undroppable.has(dropId)) {
    throw new Error('This player is on the commissioner undroppable list and cannot be dropped.')
  }

  if (dropId && eff.maxDropsPerWeek != null && eff.maxDropsPerWeek > 0 && !comm.bypassWeeklyDropLimit) {
    const dropLimit = await assertWeeklyDropLimit(
      leagueId,
      rosterId,
      eff.maxDropsPerWeek,
      input.excludeClaimId ? { excludeClaimId: input.excludeClaimId } : undefined,
    )
    if (!dropLimit.ok) throw new Error(dropLimit.message)
  }

  if (currentIds.length >= rosterSizeLimit && !dropId) {
    throw new Error('You cannot add this player because your roster is already at the limit. Choose a player to drop.')
  }

  const now = new Date()
  const kick = computePerPlayerKickoffLocks(roster.playerData, now)
  if (dropId && kick.lockedPlayerIds.includes(dropId)) {
    const sec = sectionForPlayerId(roster.playerData, dropId)
    const canDropStarters = engineConfig.can_drop_starters_after_game_start === true
    const canDropBench = engineConfig.can_drop_bench_after_lock !== false
    if (sec === 'starters' && !canDropStarters) {
      throw new Error('This starter is locked because their game has started.')
    }
    if (sec === 'bench' && !canDropBench) {
      throw new Error('This bench player is locked until the league allows drops after lock.')
    }
    if ((sec === 'ir' || sec === 'taxi' || sec === 'devy') && !canDropBench) {
      throw new Error('You cannot drop this player while this slot is locked for the period.')
    }
  }

  const faabMin = engineConfig.faab_min_bid ?? 0
  const allowZero = engineConfig.allow_zero_faab_bid !== false
  if (waiverType === 'faab') {
    const bid = input.faabBid ?? 0
    if (!allowZero && bid <= 0) {
      throw new Error('This league requires a minimum FAAB bid greater than zero.')
    }
    if (bid < faabMin) {
      throw new Error(`Minimum FAAB bid for this league is $${faabMin}.`)
    }
    const rem = roster.faabRemaining ?? 0
    if (bid > rem && !comm.bypassInsufficientFaab) {
      throw new Error('Insufficient FAAB for this bid.')
    }
  }

  let projected = addPlayerToRosterData(roster.playerData, addId)
  if (dropId) projected = removePlayerFromRosterData(projected, dropId)

  if (getRosterSize(projected) > rosterSizeLimit) {
    throw new Error('You cannot add this player because your roster would be over the limit.')
  }

  const ev = await evaluateLegalityForProjectedRoster({ id: roster.id, leagueId, playerData: roster.playerData }, projected)
  if (ev) {
    // `isLegal` folds in the whole-roster weekly lineup lock (e.g. "Mon-Tue" football_weekly
    // policy), which exists to freeze STARTER edits during game windows. A free-agent add/drop
    // doesn't touch the starting lineup, and a locked player being dropped is already blocked
    // precisely above via `computePerPlayerKickoffLocks`. Treating the blanket weekly lock as
    // blocking here would fail every waiver add for ~2 of every 7 days, all season, regardless
    // of whether the move ever touched a starter slot.
    const blocking = ev.result.blockingReasons.filter((r) => r.code !== 'LEAGUE_LINEUP_LOCK_ACTIVE')
    if (blocking.length > 0) {
      const ir = ev.result.irViolations.length
      const taxi = ev.result.taxiViolations.length
      const devy = ev.result.devyViolations.length
      if (ir || taxi || devy) {
        throw new Error(
          'You must resolve IR, taxi, or devy slot issues before this transaction. ' + (blocking[0]?.message ?? ''),
        )
      }
      throw new Error(blocking[0]?.message ?? 'This transaction would leave your roster in an illegal state.')
    }
  }
}

/**
 * Map process-engine failure messages to stable API/AI codes.
 */
export function mapWaiverFailureMessageToCode(message: string): WaiverTxResultCode {
  const m = message.toLowerCase()
  if (m.includes('insufficient faab')) return 'insufficient_faab'
  if (m.includes('no longer available')) return 'player_no_longer_available'
  if (m.includes('roster full')) return 'invalid_due_to_roster'
  if (m.includes('drop player not on roster')) return 'invalid_due_to_roster'
  if (m.includes('frozen')) return 'blocked_by_lineup_lock'
  if (m.includes('eliminated') || m.includes('inactive')) return 'invalid_due_to_roster'
  return 'invalid_due_to_roster'
}
