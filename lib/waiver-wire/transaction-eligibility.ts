/**
 * Pre-flight validation for waiver claims and projected roster state after add/drop.
 * Integrates roster legality engine, size limits, FAAB min bid, and undroppable list.
 */

import { prisma } from '@/lib/prisma'
import { activeFaLockWindow, faLockMessage, readWaiverExtras } from '@/lib/waivers/waiverExtras'
import { evaluateLegalityForProjectedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { computePerPlayerKickoffLocks, resolveScheduleLockedPlayerIds } from '@/lib/roster-lineup-engine/lineupLockService'
import { isBestBallLeagueRow } from '@/lib/core-app/leagueBestBall'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import {
  addPlayerToRosterData,
  removePlayerFromRosterData,
  rosterContainsPlayer,
} from './roster-utils'
import { countTowardRosterLimit, importedIrOverflow, leagueRosterLimit } from '@/lib/league/rosterLimit'
import type { RosterLegalityBlockingReason } from '@/lib/roster-legality/types'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import { normalizeWaiverTypeForEngine, parseWaiverEngineConfig } from './waiver-engine-config'
import { assertWeeklyDropLimit, startOfWeekUtc } from './waiver-validation'
import { commissionerOverrideAllowed, getCommissionerOverrides } from './commissioner-claim-override'
import { assertCurrentNbaWaiverPlayer } from './current-nba-player-pool'
import { assertNhlProspectFreeAgencyAdd } from './nhlProspectFreeAgency'
import { isCommissionerRosterLocked } from '@/lib/league/commissioner-roster-lock'
import { isImportedPlatform } from '@/lib/league/isNativeLeague'

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
  /**
   * A first-come add in an offseason the commissioner opened to free agency
   * (lib/waiver-wire/season-phase-policy.ts): a `completed` season does not lock it.
   */
  /** True only for the immediate-add service, not a submitted waiver claim. */
  freeAgent?: boolean
  offseasonFreeAgency?: boolean
  /** Told what the gate let through but wants said — an imported roster's IR findings. Never a refusal. */
  onNotice?: (message: string) => void
}

/**
 * A finding on an IMPORTED roster about state the provider owns, reported rather than enforced:
 * - IR: a player whose IR row carries no injury status (imports store bare ids, so every one reads as
 *   ineligible) or more IR players than the provider's spots. IR does not count against an import's
 *   roster limit (lib/league/rosterLimit.ts).
 * - The provider's starting lineup: a starter whose position no slot takes (or is unknown), or fewer
 *   starters than slots (968 of 6,734 Sleeper rosters on 2026-10-27). An add lands on the bench and
 *   never touches the lineup, and the lineup is set on the provider.
 * - The template's whole-roster total. It counts IR spots, so an over-full provider IR read as an
 *   over-full roster; an import's size rule is `leagueRosterLimit`, checked above.
 * Bench and taxi overflow are still enforced against the provider's own slots.
 */
function isImportedProviderStateIssue(reason: RosterLegalityBlockingReason): boolean {
  return (
    reason.sourceIssueCode === 'ir_ineligible_status' ||
    (reason.sourceIssueCode === 'section_overflow' && reason.section === 'ir') ||
    reason.sourceIssueCode === 'starter_position_ineligible' ||
    reason.sourceIssueCode === 'roster_total_over_limit' ||
    reason.code === 'STARTER_SLOT_EMPTY_WHEN_REQUIRED'
  )
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
/**
 * The drop rules, checked again WHEN THE CLAIM IS PROCESSED (2026-11-26). They were checked only when
 * the claim was placed, so a claim filed on Tuesday could drop on Sunday a player whose game had
 * started by then, a player the commissioner had since made undroppable, or — several claims each
 * passing the weekly limit when filed — more players than the weekly limit allows.
 *
 * Returns the refusal message, or null when the drop is allowed. Read failures fail OPEN on the lock
 * (as at claim time) and never block a run on infrastructure.
 */
export async function waiverRunDropRefusal(input: {
  leagueId: string
  rosterId: string
  dropPlayerId: string | null | undefined
  playerData: unknown
  league: { sport?: string | null; leagueVariant?: string | null; leagueType?: string | null; settings?: unknown; season?: number | null; name?: string | null; bestBallMode?: boolean | null }
  engineConfig: { undroppable_player_ids?: unknown; can_drop_starters_after_game_start?: unknown; can_drop_bench_after_lock?: unknown }
  maxDropsPerWeek?: number | null
  /** The claim's commissioner override allows passing the weekly drop limit. */
  bypassWeeklyDropLimit?: boolean
  now?: Date
}): Promise<string | null> {
  const dropId = input.dropPlayerId && String(input.dropPlayerId).trim() ? String(input.dropPlayerId).trim() : null
  if (!dropId) return null
  const undroppable = new Set(
    (Array.isArray(input.engineConfig.undroppable_player_ids) ? input.engineConfig.undroppable_player_ids : []).map((x) => String(x).trim()),
  )
  if (undroppable.has(dropId)) return 'This player is on the commissioner undroppable list and cannot be dropped.'

  if (input.maxDropsPerWeek != null && input.maxDropsPerWeek > 0 && !input.bypassWeeklyDropLimit) {
    // At the run, only drops that HAPPENED count (this run's earlier awards are already written):
    // other pending claims may still fail, so counting them here would refuse a legal drop.
    const done = await (prisma as any).waiverTransaction
      .count({ where: { leagueId: input.leagueId, rosterId: input.rosterId, dropPlayerId: { not: null }, processedAt: { gte: startOfWeekUtc(input.now ?? new Date()) } } })
      .catch(() => 0)
    if (done >= input.maxDropsPerWeek) return `Weekly drop limit reached (${input.maxDropsPerWeek} max).`
  }

  if (isBestBallLeagueRow(input.league)) return null
  const now = input.now ?? new Date()
  const kick = computePerPlayerKickoffLocks(input.playerData as never, now)
  const scheduleLocked = await resolveScheduleLockedPlayerIds({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    sport: String(input.league.sport ?? 'NFL'),
    leagueVariant: input.league.leagueVariant ?? null,
    settings: input.league.settings,
    season: input.league.season ?? now.getFullYear(),
    leagueWeek: leagueWeekFromSettings(input.league.settings) ?? 1,
    now,
  }).catch(() => null)
  const locked = new Set([...kick.lockedPlayerIds, ...(scheduleLocked ?? [])])
  if (!locked.has(dropId)) return null
  const sec = sectionForPlayerId(input.playerData, dropId)
  if (sec === 'starters' && input.engineConfig.can_drop_starters_after_game_start !== true) {
    return 'This starter is locked because their game has started.'
  }
  if (sec === 'bench' && input.engineConfig.can_drop_bench_after_lock !== true) {
    return 'This bench player is locked because their game has started.'
  }
  if ((sec === 'ir' || sec === 'taxi' || sec === 'devy') && input.engineConfig.can_drop_bench_after_lock === false) {
    return 'You cannot drop this player while this slot is locked for the period.'
  }
  return null
}

export async function assertWaiverClaimEligibility(input: WaiverClaimEligibilityInput): Promise<void> {
  await checkWaiverEligibility(input)
}

/** Trusted server-side simulation only; never accepted from a claim request payload. No writes. */
export async function previewWaiverClaimEligibility(input: WaiverClaimEligibilityInput, projection: {
  playerData: unknown; priorDrops: number
}): Promise<void> {
  if (!Number.isSafeInteger(projection.priorDrops) || projection.priorDrops < 0) throw new Error('Invalid simulated drop count.')
  await checkWaiverEligibility(input, projection)
}

async function checkWaiverEligibility(input: WaiverClaimEligibilityInput, projection?: {
  playerData: unknown; priorDrops: number
}): Promise<void> {
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
        settings: true,
        platform: true,
        irSlots: true,
        isDynasty: true,
        leagueType: true,
        leagueVariant: true,
        lockAllMoves: true,
        lifecycleState: true,
        season: true,
        name: true,
        bestBallMode: true,
        timezone: true,
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
  if (projection) roster.playerData = projection.playerData as typeof roster.playerData
  if (await isCommissionerRosterLocked(leagueId, rosterId)) {
    throw new Error('This roster is locked by the commissioner.')
  }

  if (league.lockAllMoves) {
    throw new Error('All roster moves are locked by the commissioner.')
  }
  if (league.lifecycleState === 'archived' || (league.lifecycleState === 'completed' && !input.offseasonFreeAgency)) {
    throw new Error('This league season is complete; roster moves are locked.')
  }

  if (league.leagueVariant === 'survivor_guillotine' && input.freeAgent) throw new Error('Survivor Guilly acquisitions use blind FAAB waivers; immediate free-agent adds are disabled.')
  // AF Commissioner free-agent lock windows (lib/waivers/waiverExtras.ts): hours in league time when
  // free-agent adds are locked league-wide. Waiver CLAIMS stay open — they settle at the next run.
  if (input.freeAgent) {
    const lockWindow = activeFaLockWindow(readWaiverExtras(league.settings), new Date(), (league as { timezone?: string | null }).timezone)
    if (lockWindow) throw new Error(faLockMessage(lockWindow))
  }
  await assertCurrentNbaWaiverPlayer(league, addId)

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
  // NHL dynasty: a `fantrax:<id>` prospect must be on the stored Fantrax universe; elsewhere it is
  // refused. Every other id in every other league returns untouched (lib/waiver-wire/nhlProspectFreeAgency.ts).
  await assertNhlProspectFreeAgencyAdd(
    prisma as never,
    league,
    addId,
    rosteredElsewhere.map((r) => r.playerData),
  )

  // The same limit trades and the draft use (lib/league/rosterLimit.ts): active spots, IR / taxi aside.
  const rosterLimit = leagueRosterLimit(league, 20)
  const { limit: rosterSizeLimit, counts: rosterCounts } = rosterLimit
  // By platform, not by `counts`: an import whose settings carry a saved layout counts 'active' but its
  // lineup and IR are still the provider's (8 Sleeper leagues on 2026-10-27).
  const imported = isImportedPlatform(league.platform)
  const notices: string[] = []
  const irOverflow = importedIrOverflow(roster.playerData, rosterLimit)
  if (irOverflow) {
    notices.push(`IR holds ${irOverflow.held} players; the imported league has ${irOverflow.slots} IR spots. Not enforced here — the host platform owns its IR.`)
  }
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
      { ...(input.excludeClaimId ? { excludeClaimId: input.excludeClaimId } : {}), additionalDrops: projection?.priorDrops ?? 0 },
    )
    if (!dropLimit.ok) throw new Error(dropLimit.message)
  }

  if (countTowardRosterLimit(roster.playerData, rosterCounts) >= rosterSizeLimit && !dropId) {
    throw new Error('You cannot add this player because your roster is already at the limit. Choose a player to drop.')
  }

  const now = new Date()
  const kick = computePerPlayerKickoffLocks(roster.playerData, now)
  /*
   * 🛑 A PLAYER WHOSE GAME HAD STARTED COULD BE DROPPED (2026-11-25). The only check here read the
   * `gameTime` the CLIENT stored on its last lineup save — '—' when the screen had none, so it never
   * locked. The lineup save locks from the schedule (`resolveFullLineupLockContext`); a drop is the same
   * "moved out" under the owner's rule, so it locks from the same schedule. Best ball is exempt, as
   * everywhere. A schedule read that fails keeps the old check rather than failing every claim.
   */
  const scheduleLocked =
    dropId && !isBestBallLeagueRow(league)
      ? await resolveScheduleLockedPlayerIds({
          leagueId,
          rosterId,
          sport: String(league.sport ?? 'NFL'),
          leagueVariant: league.leagueVariant,
          settings: league.settings,
          season: league.season ?? now.getFullYear(),
          leagueWeek: leagueWeekFromSettings(league.settings) ?? 1,
          now,
        })
      : null
  const dropLocked = new Set([...kick.lockedPlayerIds, ...(scheduleLocked ?? [])])
  if (dropId && dropLocked.has(dropId)) {
    const sec = sectionForPlayerId(roster.playerData, dropId)
    const canDropStarters = engineConfig.can_drop_starters_after_game_start === true
    /*
     * Owner's call, 2026-11-25: a BENCH player whose game has started is locked too, by default — "can't
     * be moved in or out" makes no exception for the bench. A commissioner can still allow it by setting
     * `can_drop_bench_after_lock: true` (no league had set it either way: 861 of 861 rows blank).
     * IR, taxi and devy keep the old default — those players are not in the lineup at all.
     */
    const canDropBench = engineConfig.can_drop_bench_after_lock === true
    const canDropReserve = engineConfig.can_drop_bench_after_lock !== false
    if (sec === 'starters' && !canDropStarters) {
      throw new Error('This starter is locked because their game has started.')
    }
    if (sec === 'bench' && !canDropBench) {
      throw new Error('This bench player is locked because their game has started.')
    }
    if ((sec === 'ir' || sec === 'taxi' || sec === 'devy') && !canDropReserve) {
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

  if (countTowardRosterLimit(projected, rosterCounts) > rosterSizeLimit) {
    throw new Error('You cannot add this player because your roster would be over the limit.')
  }

  const ev = await evaluateLegalityForProjectedRoster({ id: roster.id, leagueId, playerData: roster.playerData }, projected)
  if (projection && !ev) throw new Error('Projected roster legality is unavailable.')
  if (ev) {
    // `isLegal` folds in the whole-roster weekly lineup lock (e.g. "Mon-Tue" football_weekly
    // policy), which exists to freeze STARTER edits during game windows. A free-agent add/drop
    // doesn't touch the starting lineup, and a locked player being dropped is already blocked
    // precisely above via `computePerPlayerKickoffLocks`. Treating the blanket weekly lock as
    // blocking here would fail every waiver add for ~2 of every 7 days, all season, regardless
    // of whether the move ever touched a starter slot.
    const blocking = ev.result.blockingReasons.filter((r) => {
      if (r.code === 'LEAGUE_LINEUP_LOCK_ACTIVE') return false
      // An empty starting slot never blocks a claim. A roster that is ALREADY short (an auction team that
      // won no catcher, a QB lost to injury) could otherwise claim no one at all — not even the player who
      // fills the gap — and the request failed as an unhandled 500 (dynasty simulation, 2026-11-09: MLB,
      // "Not enough starters (22/23)"). A claim whose DROP opens the gap is already the manager's call:
      // the claims route asks once (lib/waiver-wire/lineup-fill-warning.ts) — a warning, never a block.
      if (r.code === 'STARTER_SLOT_EMPTY_WHEN_REQUIRED') {
        notices.push(r.message)
        return false
      }
      if (imported && isImportedProviderStateIssue(r)) {
        notices.push(r.message)
        return false
      }
      return true
    })
    if (blocking.length > 0) {
      const ir = imported ? 0 : ev.result.irViolations.length
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

  if (notices.length > 0) {
    console.warn(`[waiver-eligibility] league ${leagueId} roster ${rosterId}: ${notices.join(' | ')}`)
    for (const notice of notices) input.onNotice?.(notice)
  }
}

/**
 * Map process-engine failure messages to stable API/AI codes.
 */
export function mapWaiverFailureMessageToCode(message: string): WaiverTxResultCode {
  const m = message.toLowerCase()
  if (m.includes('locked by the commissioner')) return 'blocked_by_roster_lock'
  if (m.includes('insufficient faab')) return 'insufficient_faab'
  if (m.includes('no longer available')) return 'player_no_longer_available'
  if (m.includes('roster full')) return 'invalid_due_to_roster'
  if (m.includes('drop player not on roster')) return 'invalid_due_to_roster'
  if (m.includes('frozen')) return 'blocked_by_lineup_lock'
  if (m.includes('eliminated') || m.includes('inactive')) return 'invalid_due_to_roster'
  return 'invalid_due_to_roster'
}
