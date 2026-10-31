import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import {
  getRosterPlayerIds,
  addPlayerToRosterData,
  removePlayerFromRosterData,
  rosterContainsPlayer,
} from './roster-utils'
import { countTowardRosterLimit, importedIrOverflow, leagueRosterLimit } from '@/lib/league/rosterLimit'
import { onWaiverRunComplete } from './run-hooks'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { isWaiverFrozenForRoster } from '@/lib/survivor/SurvivorEffectEngine'
import type { ProcessedClaimResult, WaiverClaimOutcomeCode } from './types'
import { normalizeWaiverTypeForEngine } from './waiver-engine-config'
import { isAutomatedWaiverRunBlocked, resolveEngineWaiverTypeForDate } from '@/lib/waivers/dailyWaiverSchedule'
import { commissionerOverrideAllowed, getCommissionerOverrides } from './commissioner-claim-override'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { upsertLeagueWaiverStateAfterRun, getLeagueWaiverState } from './waiver-state-service'
import { assertNonEmptyIdempotencyKey } from '@/lib/engine-testing/hardening/engineInvariants'
import { logEngineInvariantOptional } from '@/lib/engine-testing/runtime/invariantRuntime'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { isCommissionerRosterLocked } from '@/lib/league/commissioner-roster-lock'
import { claimSnapshotWhere, isClaimSnapshotConflict } from './claim-snapshot'
import { planRedraftRosterMoveWrites } from '@/lib/league-runtime/redraftRosterMoveSync'
import { guillotineClaimsCutoff } from '@/lib/guillotine/blindWaiverCutoff'
import { loadWaiverRunPhaseGate } from './season-phase-gate'
import { DROPPER_RECLAIM_MESSAGE, droppedPlayerHoldPolicy, loadDroppedPlayerHolds, maxHoldHours, type DroppedPlayerHold } from './dropped-player-waivers'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'
import { isRedraftLeagueMovesLocked } from '@/lib/redraft/tradeMoveLock'
import {
  isFantraxProspectId,
  resolveNhlProspectClaimAward,
  type ProspectFreeAgencyLeague,
} from './nhlProspectFreeAgency'

/** Why a run settled nothing on purpose, leaving every pending claim pending (reported through `opts.onSkip`). */
export type WaiverRunSkipReason = 'league_moves_locked'

type ClaimRow = {
  id: string
  leagueId: string
  rosterId: string
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number | null
  priorityOrder: number
  status: string
  createdAt?: Date
  metadata?: unknown
  roster: {
    id: string
    platformUserId: string
    playerData: unknown
    faabRemaining: number | null
    waiverPriority: number | null
  }
}

function outcomeFromFailureMessage(msg: string): WaiverClaimOutcomeCode {
  const m = msg.toLowerCase()
  if (m.includes('locked by the commissioner')) return 'blocked_by_roster_lock'
  if (m.includes('insufficient faab')) return 'insufficient_faab'
  if (m.includes('no longer available')) return 'player_no_longer_available'
  if (m.includes('frozen')) return 'blocked_by_lineup_lock'
  if (m.includes('roster full') || m.includes('drop player not on roster')) return 'invalid_due_to_roster'
  return 'failed'
}

export async function processWaiverClaimsForLeague(
  leagueId: string,
  opts?: {
    processedByUserId?: string | null
    runType?: string
    idempotencyKey?: string | null
    onSkip?: (reason: WaiverRunSkipReason) => void
  }
): Promise<ProcessedClaimResult[]> {
  if (opts?.idempotencyKey != null) {
    logEngineInvariantOptional(assertNonEmptyIdempotencyKey(opts.idempotencyKey), 'waiver_process.idempotency_key', {
      leagueId,
    })
  }

  if (opts?.idempotencyKey && String(opts.idempotencyKey).trim() !== '') {
    const recent = await (prisma as any).waiverRun.findMany({
      where: { leagueId, status: 'completed' },
      orderBy: { runAt: 'desc' },
      take: 30,
      select: { id: true, metadata: true },
    })
    const key = String(opts.idempotencyKey)
    const dup = recent.some(
      (r: { metadata: unknown }) =>
        r.metadata &&
        typeof r.metadata === 'object' &&
        !Array.isArray(r.metadata) &&
        (r.metadata as Record<string, unknown>).idempotencyKey === key,
    )
    if (dup) {
      return []
    }
  }

  const locked = await getLeagueWaiverState(leagueId).catch(() => null)
  if (locked?.processingLocked) return []

  // 🛑 The commissioner's "Lock all roster moves" (`League.lockAllMoves`), re-read when the run executes:
  // a claim filed before the lock went on must not settle while it is on. Nothing is touched — no run
  // row, no claim update — so every claim stays pending and the first run after the lift settles it.
  // A commissioner's manual run is exempt, like `commissionerOverride` in the waiver and trade runtimes.
  if (opts?.runType !== 'manual' && (await isRedraftLeagueMovesLocked(leagueId))) {
    console.info(`[waiver-process] league ${leagueId} skipped: the commissioner has locked all roster moves; pending claims stay pending`)
    opts?.onSkip?.('league_moves_locked')
    return []
  }

  const [effectiveSettings, league, pendingClaims, allRosters, leagueTeams] = await Promise.all([
    getEffectiveLeagueWaiverSettings(leagueId),
    (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: { id: true, rosterSize: true, leagueVariant: true, guillotineMode: true, sport: true, settings: true, timezone: true, waiverHours: true, platform: true, irSlots: true },
    }),
    (prisma as any).waiverClaim.findMany({
      where: { leagueId, status: 'pending' },
      include: {
        roster: {
          select: {
            id: true,
            platformUserId: true,
            playerData: true,
            faabRemaining: true,
            waiverPriority: true,
          },
        },
      },
    }),
    (prisma as any).roster.findMany({
      where: { leagueId },
      select: { id: true, playerData: true, waiverPriority: true, faabRemaining: true },
    }),
    (prisma as any).leagueTeam
      .findMany({
        where: { leagueId },
        select: { externalId: true, currentRank: true },
      })
      .catch(() => []),
  ])

  if (!league) return []
  // Per-day schedule: an automated run on a Free-agents or Locked day processes nothing (guards stale
  // engine processing days). A commissioner's manual run is never blocked.
  if (isAutomatedWaiverRunBlocked(league.settings, new Date(), league.timezone, opts?.runType)) return []
  const specialtySpec = getSpecialtySpecByVariant(league.leagueVariant ?? null)
  const rosterGuard = specialtySpec?.rosterGuard
  const configuredWaiverType =
    effectiveSettings.normalizedWaiverType ?? normalizeWaiverTypeForEngine(effectiveSettings.waiverType)
  // A commissioner's per-day schedule (lib/waivers/dailyWaiverSchedule.ts) may name THIS day's type
  // (Mon reverse standings, Tue rolling …). Null — no schedule, or a non-processing day reached by
  // a manual run — keeps the configured type. FCFS leagues are never overridden.
  const dayWaiverType =
    configuredWaiverType === 'fcfs'
      ? null
      : resolveEngineWaiverTypeForDate(league.settings, new Date(), league.timezone)
  const waiverType = dayWaiverType ?? configuredWaiverType
  const tiebreakRule =
    (effectiveSettings.tiebreakRule ?? effectiveSettings.waiverEngineConfig?.faab_tiebreaker ?? '')
      .toString()
      .trim()
      .toLowerCase() || 'priority_lowest_first'
  const faabMinBid = effectiveSettings.faabMinBid ?? 0
  const allowZeroFaab = effectiveSettings.allowZeroFaabBid

  const rankByPlatformUserId = new Map<string, number>()
  for (const t of (leagueTeams as { externalId: string; currentRank: number | null }[]) || []) {
    if (t.externalId != null && t.currentRank != null) rankByPlatformUserId.set(t.externalId, t.currentRank)
  }

  const rosteredByPlayer = new Map<string, string>()
  for (const r of allRosters as { id: string; playerData: unknown }[]) {
    const ids = getRosterPlayerIds(r.playerData)
    for (const id of ids) rosteredByPlayer.set(id, r.id)
  }

  // Guilly blind FAAB auction (lib/guillotine/blindWaiverCutoff.ts): inside the window, claims made since
  // it opened wait for the run so every bid on a chopped roster competes together. A manual
  // commissioner run is not held.
  const blindCutoff = opts?.runType === 'manual' ? null : await guillotineClaimsCutoff(leagueId, new Date(), league)
  const dueClaims = blindCutoff
    ? (pendingClaims as Array<ClaimRow & { createdAt: Date | string }>).filter((c) => new Date(c.createdAt) < blindCutoff)
    : (pendingClaims as ClaimRow[])

  const orderedAll = orderClaimsForProcessing(
    dueClaims as ClaimRow[],
    waiverType,
    rankByPlatformUserId,
    tiebreakRule,
  )

  if (orderedAll.length === 0) {
    return []
  }

  // Season phase (season-phase-policy.ts): in a closed or first-come offseason, with rosters locked
  // for the playoffs, or for a team out of the title bracket under the alive-only rule, a claim fails
  // with the reason. Read once per run; an unreadable phase keeps the regular season's rules.
  const phaseRefusal = await loadWaiverRunPhaseGate(leagueId).catch(() => (): string | null => null)
  // A dropped player on waivers (dropped-player-waivers.ts) cannot go back to the team that dropped
  // him: that claim fails. Every other claim on him waits — it stays pending, untouched, until the
  // first run after his hold ends, and there competes with the other claims on him in the order
  // above, like any claim. An unreadable hold processes nothing this run rather than run a held
  // player's claims early; they are all still pending for the next one.
  const runAt = new Date()
  const holdPolicy = droppedPlayerHoldPolicy({
    normalizedWaiverType: configuredWaiverType,
    waiverHours: league.waiverHours,
    waiverEngineConfig: effectiveSettings.waiverEngineConfig,
    sport: league.sport ? String(league.sport) : null,
  })
  let dropHolds: Map<string, DroppedPlayerHold> = new Map()
  if (maxHoldHours(holdPolicy) > 0) {
    try {
      dropHolds = await loadDroppedPlayerHolds(leagueId, holdPolicy, {
        now: runAt,
        playerIds: Array.from(new Set(orderedAll.map((c) => String(c.addPlayerId)))),
      })
    } catch (err) {
      console.warn('[waiver-wire] dropped-player holds unreadable; waiver run deferred', { leagueId, err })
      return []
    }
  }
  const ordered = orderedAll.filter((c) => {
    const hold = dropHolds.get(String(c.addPlayerId))
    return !(hold && hold.until > runAt && hold.droppedByRosterId !== c.rosterId)
  })
  const deferredHeldClaimCount = orderedAll.length - ordered.length
  if (ordered.length === 0) {
    return []
  }

  const waiverRun = await (prisma as any).waiverRun.create({
    data: {
      leagueId,
      runType: opts?.runType ?? 'scheduled',
      status: 'running',
      processedByUserId: opts?.processedByUserId ?? null,
      metadata: {
        claimCount: ordered.length,
        ...(deferredHeldClaimCount > 0 ? { deferredHeldClaimCount } : {}),
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
    },
  })
  const runId: string = waiverRun.id
  const waiverRunStartedAt = Date.now()

  const results: ProcessedClaimResult[] = []
  // The same limit trades and the draft use (lib/league/rosterLimit.ts): active spots, IR / taxi aside.
  const rosterLimit = leagueRosterLimit(league, 20)
  const { limit: rosterSize, counts: rosterCounts } = rosterLimit
  // An imported roster over the provider's IR spots is reported once per run, never refused.
  const irOverflowReported = new Set<string>()
  // NHL dynasty `fantrax:` claims only (nhlProspectFreeAgency.ts, AWARD TIME): the league fields the
  // rule needs, read once and only when such a claim is reached, so every other run reads nothing new.
  let prospectLeague: Promise<ProspectFreeAgencyLeague | null> | null = null
  const loadProspectLeague = () =>
    (prospectLeague ??= (prisma as any).league
      .findUnique({ where: { id: leagueId }, select: { sport: true, isDynasty: true, leagueType: true } })
      .catch(() => null) as Promise<ProspectFreeAgencyLeague | null>)
  const resultRows: Array<{
    claimId: string | null
    rosterId: string
    addPlayerId: string
    dropPlayerId: string | null
    faabDelta: number | null
    priorityBefore: number | null
    priorityAfter: number | null
    rosterApplied: boolean
    resultType: string
    metadata?: Record<string, unknown>
  }> = []

  for (const claim of ordered) {
    try {
    const roster = claim.roster
    const pushFail = async (msg: string, extra?: Record<string, unknown>) => {
      const oc = outcomeFromFailureMessage(msg)
      const prevMeta =
        claim.metadata && typeof claim.metadata === 'object' && !Array.isArray(claim.metadata)
          ? (claim.metadata as Record<string, unknown>)
          : {}
      await (prisma as any).waiverClaim.update({
        where: claimSnapshotWhere(claim),
        data: {
          status: 'failed',
          processedAt: new Date(),
          resultMessage: msg,
          metadata: { ...prevMeta, outcomeCode: oc, ...extra },
        },
      })
      resultRows.push({
        claimId: claim.id,
        rosterId: claim.rosterId,
        addPlayerId: claim.addPlayerId,
        dropPlayerId: claim.dropPlayerId ?? null,
        faabDelta: null,
        priorityBefore: roster.waiverPriority ?? null,
        priorityAfter: roster.waiverPriority ?? null,
        rosterApplied: false,
        resultType: 'failed',
        metadata: { reason: msg, outcomeCode: oc, ...extra },
      })
      results.push({
        claimId: claim.id,
        rosterId: claim.rosterId,
        success: false,
        addPlayerId: claim.addPlayerId,
        dropPlayerId: claim.dropPlayerId ?? undefined,
        message: msg,
        waiverRunId: runId,
        outcomeCode: oc,
      })
    }

    if (await isCommissionerRosterLocked(leagueId, claim.rosterId)) {
      await pushFail('This roster is locked by the commissioner.')
      continue
    }
    const waiversFrozen = await isWaiverFrozenForRoster(leagueId, claim.rosterId).catch(() => false)
    if (waiversFrozen) {
      await pushFail("Roster's waiver moves are frozen by an active Survivor idol effect.")
      continue
    }
    if (league.leagueVariant === 'survivor_guillotine' &&
        await prisma.survivorGuillotineChop.count({ where: { leagueId, rosterId: claim.rosterId, reversedAt: null } })) {
      await pushFail('Eliminated Survivor Guilly rosters cannot win waiver claims.')
      continue
    }
    if (rosterGuard && !(await rosterGuard(leagueId, claim.rosterId))) {
      await pushFail('Roster cannot make waiver claims (eliminated or inactive).')
      continue
    }

    const phaseBlock = phaseRefusal(claim.rosterId)
    if (phaseBlock) {
      await pushFail(phaseBlock)
      continue
    }

    let addId = claim.addPlayerId
    const dropId = claim.dropPlayerId

    if (dropHolds.get(String(addId))?.droppedByRosterId === claim.rosterId) {
      await pushFail(DROPPER_RECLAIM_MESSAGE)
      continue
    }

    const ownerRosterId = rosteredByPlayer.get(addId)
    if (ownerRosterId) {
      const earlier =
        ownerRosterId !== claim.rosterId
          ? 'Player no longer available (awarded to another team in this run).'
          : 'Player no longer available.'
      await pushFail(earlier, { competingRosterId: ownerRosterId })
      continue
    }

    // A `fantrax:` prospect claim: the submit-time rule again, now (nhlProspectFreeAgency.ts, AWARD
    // TIME). He may have been linked to an NHL identity since — then he is awarded under his pro id,
    // or fails if that man is on a roster already. Every other claim skips this block entirely.
    let prospectAliases: string[] = []
    let claimedProspectId: string | null = null
    if (isFantraxProspectId(addId)) {
      const decision = await resolveNhlProspectClaimAward(
        prisma as never,
        await loadProspectLeague(),
        addId,
        claim.rosterId,
        rosteredByPlayer,
      )
      if (decision.kind === 'fail') {
        await pushFail(decision.message, decision.extra)
        continue
      }
      prospectAliases = decision.aliases
      if (decision.playerId !== addId) {
        claimedProspectId = addId
        addId = decision.playerId
      }
    }

    const irOverflow = irOverflowReported.has(claim.rosterId) ? null : importedIrOverflow(roster.playerData, rosterLimit)
    if (irOverflow) {
      irOverflowReported.add(claim.rosterId)
      console.warn(`[waiver-process] league ${leagueId} roster ${claim.rosterId}: IR holds ${irOverflow.held} players against ${irOverflow.slots} imported IR spots (not enforced)`)
    }
    const needDrop = countTowardRosterLimit(roster.playerData, rosterCounts) >= rosterSize && !dropId
    if (needDrop) {
      await pushFail('Roster full; no drop specified')
      continue
    }

    if (dropId && !rosterContainsPlayer(roster.playerData, dropId)) {
      await pushFail('Drop player not on roster')
      continue
    }

    const bid = claim.faabBid ?? 0
    const faabRem = roster.faabRemaining ?? 0
    const bypassInsufficientFaab =
      commissionerOverrideAllowed(
        effectiveSettings.waiverEngineConfig ?? {},
        effectiveSettings.commissionerOverrideRules ?? null,
      ) && getCommissionerOverrides(claim.metadata).bypassInsufficientFaab

    let faabSpent: number | null = null
    if (waiverType === 'faab') {
      if (!allowZeroFaab && bid <= 0) {
        await pushFail('This league requires a FAAB bid greater than zero.')
        continue
      }
      if (bid < faabMinBid) {
        await pushFail(`Minimum FAAB bid is $${faabMinBid}.`)
        continue
      }
      if (bid > faabRem && !bypassInsufficientFaab) {
        await pushFail('Insufficient FAAB')
        continue
      }
      faabSpent = Math.min(bid, faabRem)
    }

    let newPlayerData = addPlayerToRosterData(roster.playerData, addId)
    if (dropId) newPlayerData = removePlayerFromRosterData(newPlayerData, dropId)
    const priorityBefore = roster.waiverPriority ?? null
    /** Rolling: winner moves to the back of the line (max priority + 1). Standard: order is fixed for the period. */
    const isRolling = waiverType === 'rolling'
    let newWaiverPriority: number | undefined
    let priorityAfter: number | null = priorityBefore
    if (isRolling) {
      const maxPri = Math.max(
        0,
        ...(allRosters as { waiverPriority: number | null }[]).map((r) => r.waiverPriority ?? 0),
      )
      newWaiverPriority = maxPri + 1
      priorityAfter = newWaiverPriority
    }

    const survivorGuillotineWrites: Array<Promise<unknown>> = []
    if (league.leagueVariant === 'survivor_guillotine') {
      const linked = await prisma.roster.findUnique({ where: { id: claim.rosterId }, select: { redraftRosterId: true } })
      const player = await prisma.player.findUnique({ where: { id: addId }, select: {
        name: true, position: true, team: true, sport: true } })
      if (!player) {
        await pushFail('Survivor Guilly claim needs a known player.')
        continue
      }
      if (!linked?.redraftRosterId && await prisma.redraftSeason.count({ where: { leagueId } })) {
        await pushFail('Survivor Guilly roster needs its redraft link reconciled before waivers.')
        continue
      }
      if (linked?.redraftRosterId) {
        if (dropId) survivorGuillotineWrites.push(prisma.redraftRosterPlayer.updateMany({ where: {
          rosterId: linked.redraftRosterId, playerId: dropId, droppedAt: null }, data: { droppedAt: new Date() } }))
        survivorGuillotineWrites.push(prisma.redraftRosterPlayer.create({ data: { rosterId: linked.redraftRosterId,
          playerId: addId, playerName: player.name, position: player.position, team: player.team,
          sport: player.sport, slotType: 'bench', acquisitionType: 'waiver' } }))
        if (faabSpent != null) survivorGuillotineWrites.push(prisma.redraftRoster.update({ where: { id: linked.redraftRosterId },
          data: { faabBalance: { decrement: faabSpent } } }))
      }
    }

    /*
     * Native scoring reads `RedraftRosterPlayer`, not `playerData` — without this an awarded
     * player never scores and the dropped one keeps scoring. Survivor Guillotine writes its own
     * rows above, so it is excluded here rather than written twice.
     */
    const redraftMoveWrites = league.leagueVariant === 'survivor_guillotine'
      ? []
      : await planRedraftRosterMoveWrites(prisma, {
          leagueId,
          acquisitionType: 'waiver',
          moves: [
            { playerId: addId, fromRosterId: null, toRosterId: claim.rosterId },
            ...(dropId ? [{ playerId: dropId, fromRosterId: claim.rosterId, toRosterId: null }] : []),
          ],
          playerDataByRoster: new Map([[claim.rosterId, newPlayerData]]),
        })

    await (prisma as any).$transaction([
      (prisma as any).waiverClaim.update({
        where: claimSnapshotWhere(claim),
        data: { status: 'processed', processedAt: new Date(), resultMessage: 'Awarded' },
      }),
      (prisma as any).roster.update({
        where: { id: claim.rosterId },
        data: {
          playerData: newPlayerData,
          ...(faabSpent != null && { faabRemaining: Math.max(0, faabRem - faabSpent) }),
          ...(newWaiverPriority != null && { waiverPriority: newWaiverPriority }),
        },
      }),
      (prisma as any).waiverTransaction.create({
        data: {
          leagueId,
          sportType: league.sport ?? null,
          rosterId: claim.rosterId,
          claimId: claim.id,
          waiverRunId: runId,
          addPlayerId: addId,
          dropPlayerId: dropId,
          faabSpent,
          waiverPriorityBefore: priorityBefore,
          waiverPriorityAfter: priorityAfter ?? null,
        },
      }),
      ...survivorGuillotineWrites,
      ...redraftMoveWrites,
    ])

    // Survivor Guilly wrote faabBalance itself, above; every other native league copies it across.
    if (faabSpent != null && league.leagueVariant !== 'survivor_guillotine') {
      await copyGenericFaabToRedraft(prisma, [claim.rosterId])
    }

    rosteredByPlayer.set(addId, claim.rosterId)
    // A prospect award: every id he is known by, so a later claim in this run on any of them fails.
    for (const alias of prospectAliases) rosteredByPlayer.set(alias, claim.rosterId)
    if (dropId) rosteredByPlayer.delete(dropId)

    if (newWaiverPriority != null) {
      const row = (allRosters as { id: string; waiverPriority: number | null }[]).find((r) => r.id === claim.rosterId)
      if (row) row.waiverPriority = newWaiverPriority
    }

    resultRows.push({
      claimId: claim.id,
      rosterId: claim.rosterId,
      addPlayerId: addId,
      dropPlayerId: dropId,
      faabDelta: faabSpent != null ? -faabSpent : null,
      priorityBefore,
      priorityAfter: priorityAfter ?? null,
      rosterApplied: true,
      resultType: 'awarded',
      // Awarded under his pro id: the claim row keeps the `fantrax:` id it was filed with.
      ...(claimedProspectId ? { metadata: { claimedPlayerId: claimedProspectId } } : {}),
    })

    const uid = roster.platformUserId?.trim()
    if (uid) {
      void resolveLeagueSport(leagueId).then((sport) =>
        recordAfLearningEvent({
          eventType: 'waiver_claim_awarded',
          sport,
          leagueId,
          userId: uid,
          source: 'waiver_process_engine',
          payload: {
            claimId: claim.id,
            addPlayerId: addId,
            dropPlayerId: dropId ?? null,
            faabSpent: faabSpent ?? null,
            waiverRunId: runId,
          },
        }),
      )
    }

    results.push({
      claimId: claim.id,
      rosterId: claim.rosterId,
      success: true,
      addPlayerId: addId,
      dropPlayerId: dropId ?? undefined,
      faabSpent: faabSpent ?? undefined,
      message: 'Awarded',
      waiverRunId: runId,
      outcomeCode: 'won',
    })

    const fresh = await (prisma as any).roster.findUnique({
      where: { id: claim.rosterId },
      select: { faabRemaining: true, waiverPriority: true, playerData: true },
    })
    if (fresh) {
      claim.roster.faabRemaining = fresh.faabRemaining
      claim.roster.waiverPriority = fresh.waiverPriority
      claim.roster.playerData = fresh.playerData
    }
    } catch (error) {
      // A newer override/cancellation or another processor won. The guarded
      // award transaction rolls back its roster and ledger writes. Leave a
      // changed pending claim for the next run to evaluate with fresh metadata.
      if (!isClaimSnapshotConflict(error)) throw error
    }
  }

  if (resultRows.length > 0) {
    await (prisma as any).waiverResult.createMany({
      data: resultRows.map((r) => ({
        waiverRunId: runId,
        claimId: r.claimId,
        leagueId,
        rosterId: r.rosterId,
        addPlayerId: r.addPlayerId,
        dropPlayerId: r.dropPlayerId,
        faabDelta: r.faabDelta,
        priorityBefore: r.priorityBefore,
        priorityAfter: r.priorityAfter,
        rosterApplied: r.rosterApplied,
        resultType: r.resultType,
        metadata: r.metadata ?? undefined,
      })),
    })
  }

  await (prisma as any).waiverRun.update({
    where: { id: runId },
    data: {
      status: 'completed',
      metadata: {
        claimCount: ordered.length,
        resultCount: results.length,
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
    },
  })

  const rostersAfter = await (prisma as any).roster.findMany({
    where: { leagueId },
    select: { id: true, waiverPriority: true, faabRemaining: true },
    orderBy: { waiverPriority: 'asc' },
  })
  await upsertLeagueWaiverStateAfterRun(leagueId, {
    schedule: {
      processingDayOfWeek: effectiveSettings.processingDayOfWeek,
      processingTimeUtc: effectiveSettings.processingTimeUtc,
      processingDays: effectiveSettings.processingDays,
    },
    priorityOrder: rostersAfter.map((x: { id: string; waiverPriority: number | null; faabRemaining: number | null }) => ({
      rosterId: x.id,
      waiverPriority: x.waiverPriority,
      faabRemaining: x.faabRemaining,
    })),
  }).catch(() => {})

  await onWaiverRunComplete(leagueId, results).catch(() => {})
  recordProductEvent(ENGAGEMENT.WAIVER_RUN, {
    meta: {
      leagueId,
      runId,
      durationMs: Date.now() - waiverRunStartedAt,
      claimCount: ordered.length,
      resultCount: results.length,
      waiverType,
      sport: league?.sport ? String(league.sport) : null,
      runType: opts?.runType ?? 'scheduled',
    },
  })
  return results
}

/** Exported for deterministic unit tests (FAAB / priority / rolling tie-breaks). */
/**
 * Reverse standings: the WORST team claims first. `LeagueTeam.currentRank` 1 is first place
 * (standings are read `orderBy currentRank asc`), so the highest rank number goes first. A team
 * with no rank yet goes after every ranked team rather than ahead of them.
 */
function worstStandingFirst(a: ClaimRow, b: ClaimRow, rankByPlatformUserId: Map<string, number>): number {
  const rankA = rankByPlatformUserId.get(a.roster?.platformUserId ?? '')
  const rankB = rankByPlatformUserId.get(b.roster?.platformUserId ?? '')
  if (rankA === rankB) return 0
  if (rankA == null) return 1
  if (rankB == null) return -1
  return rankB - rankA
}

export function orderClaimsForProcessing(
  claims: ClaimRow[],
  waiverType: string,
  rankByPlatformUserId: Map<string, number>,
  tiebreakRule: string = 'priority_lowest_first',
): ClaimRow[] {
  if (waiverType === 'faab') {
    return [...claims].sort((a, b) => {
      const bidA = a.faabBid ?? 0
      const bidB = b.faabBid ?? 0
      if (bidB !== bidA) return bidB - bidA
      const tb = tiebreakRule
      if (tb === 'reverse_standings' || tb === 'reverse_standings_order') {
        const byStanding = worstStandingFirst(a, b, rankByPlatformUserId)
        if (byStanding !== 0) return byStanding
      }
      if (tb === 'earliest_claim' || tb === 'earliest_claim_timestamp') {
        const ta = (a as any).createdAt
        const tbAt = (b as any).createdAt
        const t1 = ta instanceof Date ? ta.getTime() : typeof ta === 'string' ? new Date(ta).getTime() : 0
        const t2 = tbAt instanceof Date ? tbAt.getTime() : typeof tbAt === 'string' ? new Date(tbAt).getTime() : 0
        if (t1 !== t2) return t1 - t2
      }
      const pA = a.roster?.waiverPriority ?? 999
      const pB = b.roster?.waiverPriority ?? 999
      if (pA !== pB) return pA - pB
      return a.priorityOrder - b.priorityOrder
    })
  }

  if (waiverType === 'reverse_standings') {
    return [...claims].sort((a, b) => {
      const byStanding = worstStandingFirst(a, b, rankByPlatformUserId)
      if (byStanding !== 0) return byStanding
      return a.priorityOrder - b.priorityOrder
    })
  }

  if (waiverType === 'rolling' || waiverType === 'standard') {
    return [...claims].sort((a, b) => {
      const pA = a.roster?.waiverPriority ?? 999
      const pB = b.roster?.waiverPriority ?? 999
      if (pA !== pB) return pA - pB
      return a.priorityOrder - b.priorityOrder
    })
  }

  if (waiverType === 'fcfs') {
    return [...claims].sort((a, b) => {
      const at = (a as any).createdAt
      const bt = (b as any).createdAt
      const ta = at instanceof Date ? at.getTime() : typeof at === 'string' ? new Date(at).getTime() : 0
      const tb = bt instanceof Date ? bt.getTime() : typeof bt === 'string' ? new Date(bt).getTime() : 0
      return ta - tb
    })
  }

  return [...claims].sort((a, b) => a.priorityOrder - b.priorityOrder)
}
