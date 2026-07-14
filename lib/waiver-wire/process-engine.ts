import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueWaiverSettings } from './settings-service'
import {
  getRosterPlayerIds,
  addPlayerToRosterData,
  removePlayerFromRosterData,
  rosterContainsPlayer,
} from './roster-utils'
import { onWaiverRunComplete } from './run-hooks'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'
import { isWaiverFrozenForRoster } from '@/lib/survivor/SurvivorEffectEngine'
import type { ProcessedClaimResult, WaiverClaimOutcomeCode } from './types'
import { normalizeWaiverTypeForEngine } from './waiver-engine-config'
import { commissionerOverrideAllowed, getCommissionerOverrides } from './commissioner-claim-override'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { recordWaiverClaimSignal } from '@/lib/shared-services/knowledge-graph/WaiverSignalHook'
import { upsertLeagueWaiverStateAfterRun, getLeagueWaiverState } from './waiver-state-service'
import { assertNonEmptyIdempotencyKey } from '@/lib/engine-testing/hardening/engineInvariants'
import { logEngineInvariantOptional } from '@/lib/engine-testing/runtime/invariantRuntime'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'

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
  if (m.includes('insufficient faab')) return 'insufficient_faab'
  if (m.includes('no longer available')) return 'player_no_longer_available'
  if (m.includes('frozen')) return 'blocked_by_lineup_lock'
  if (m.includes('roster full') || m.includes('drop player not on roster')) return 'invalid_due_to_roster'
  return 'failed'
}

export async function processWaiverClaimsForLeague(
  leagueId: string,
  opts?: { processedByUserId?: string | null; runType?: string; idempotencyKey?: string | null }
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

  const [effectiveSettings, league, pendingClaims, allRosters, leagueTeams] = await Promise.all([
    getEffectiveLeagueWaiverSettings(leagueId),
    (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: { id: true, rosterSize: true, leagueVariant: true, sport: true },
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
  const specialtySpec = getSpecialtySpecByVariant(league.leagueVariant ?? null)
  const rosterGuard = specialtySpec?.rosterGuard
  const waiverType =
    effectiveSettings.normalizedWaiverType ?? normalizeWaiverTypeForEngine(effectiveSettings.waiverType)
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

  const ordered = orderClaimsForProcessing(
    pendingClaims as ClaimRow[],
    waiverType,
    rankByPlatformUserId,
    tiebreakRule,
  )

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
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      },
    },
  })
  const runId: string = waiverRun.id
  const waiverRunStartedAt = Date.now()

  const results: ProcessedClaimResult[] = []
  const rosterSize = league.rosterSize ?? 20
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
    const roster = claim.roster
    const pushFail = async (msg: string, extra?: Record<string, unknown>) => {
      const oc = outcomeFromFailureMessage(msg)
      const prevMeta =
        claim.metadata && typeof claim.metadata === 'object' && !Array.isArray(claim.metadata)
          ? (claim.metadata as Record<string, unknown>)
          : {}
      await (prisma as any).waiverClaim.update({
        where: { id: claim.id },
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

      // Fantasy Knowledge Graph signal capture (Migration Plan Milestone 3) —
      // one hook covers every failure branch that calls pushFail.
      await recordWaiverClaimSignal({
        outcome: 'waiver_claim_lost',
        leagueId,
        managerKey: roster.platformUserId,
        claimId: claim.id,
        addPlayerId: claim.addPlayerId,
        dropPlayerId: claim.dropPlayerId ?? null,
        emittedFrom: 'process-engine.pushFail',
      })
    }

    const waiversFrozen = await isWaiverFrozenForRoster(leagueId, claim.rosterId).catch(() => false)
    if (waiversFrozen) {
      await pushFail("Roster's waiver moves are frozen by an active Survivor idol effect.")
      continue
    }
    if (rosterGuard && !(await rosterGuard(leagueId, claim.rosterId))) {
      await pushFail('Roster cannot make waiver claims (eliminated or inactive).')
      continue
    }

    const currentPlayerIds = getRosterPlayerIds(roster.playerData)
    const addId = claim.addPlayerId
    const dropId = claim.dropPlayerId

    const ownerRosterId = rosteredByPlayer.get(addId)
    if (ownerRosterId) {
      const earlier =
        ownerRosterId !== claim.rosterId
          ? 'Player no longer available (awarded to another team in this run).'
          : 'Player no longer available.'
      await pushFail(earlier, { competingRosterId: ownerRosterId })
      continue
    }

    const needDrop = currentPlayerIds.length >= rosterSize && !dropId
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

    await (prisma as any).$transaction([
      (prisma as any).waiverClaim.update({
        where: { id: claim.id },
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
    ])

    rosteredByPlayer.set(addId, claim.rosterId)
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

    // Fantasy Knowledge Graph signal capture (Migration Plan Milestone 3) —
    // same fails-safe convention as recordAfLearningEvent immediately above.
    await recordWaiverClaimSignal({
      outcome: 'waiver_claim_won',
      leagueId,
      managerKey: roster.platformUserId,
      claimId: claim.id,
      addPlayerId: addId,
      dropPlayerId: dropId ?? null,
      emittedFrom: 'process-engine.processWaiverClaimsForLeague',
    })

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
        const rankA = rankByPlatformUserId.get(a.roster?.platformUserId ?? '') ?? 999
        const rankB = rankByPlatformUserId.get(b.roster?.platformUserId ?? '') ?? 999
        if (rankA !== rankB) return rankA - rankB
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
      const rankA = rankByPlatformUserId.get(a.roster?.platformUserId ?? '') ?? 999
      const rankB = rankByPlatformUserId.get(b.roster?.platformUserId ?? '') ?? 999
      if (rankA !== rankB) return rankA - rankB
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
