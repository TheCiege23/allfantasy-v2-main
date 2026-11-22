import { prisma } from "@/lib/prisma"
import { recordAfLearningEvent } from "@/lib/ai-learning-system/recordEvent"
import { normalizeToSupportedSport } from "@/lib/sport-scope"
import type { WaiverClaimInput } from "./types"
import { isRosterChopped } from "@/lib/guillotine/guillotineGuard"
import { isRosterCurrentlyEliminated } from "@/lib/survivor/SurvivorRosterState"
import { validateDevyWaiverClaim } from "@/lib/devy/waiver/DevyWaiverRules"
import { isWaiverFrozenForRoster } from "@/lib/survivor/SurvivorEffectEngine"
import { getEffectiveLeagueWaiverSettings } from "./settings-service"
import {
  assertClaimWithinLimits,
  assertClaimWithinPerRunLimit,
  assertWaiverSubmissionWindow,
  assertDailyScheduleAllowsClaim,
  conceptOverridesBlockWaivers,
} from "./waiver-validation"
import { getLeagueWaiverState } from "./waiver-state-service"
import { assertWaiverClaimEligibility } from "./transaction-eligibility"
import { loadDailyTransactionPolicy } from "./daily-schedule-gate"
import { loadWaiverPhasePolicy } from "./season-phase-gate"
import { DROPPER_RECLAIM_MESSAGE, droppedPlayerHoldPolicy, loadDroppedPlayerHold, maxHoldHours } from "./dropped-player-waivers"

/**
 * Create a waiver claim. Validates that roster exists and belongs to the league (data consistency).
 * Guillotine: chopped (eliminated) rosters cannot submit claims.
 * Devy: devy players not claimable unless league has dispersal devy FA enabled.
 */
export async function createClaim(
  leagueId: string,
  rosterId: string,
  input: WaiverClaimInput
) {
  const roster = await (prisma as any).roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!roster) {
    throw new Error("Roster not found or does not belong to this league")
  }

  const chopped = await isRosterChopped(leagueId, rosterId)
  if (chopped) {
    throw new Error("This team has been eliminated and cannot submit waiver claims")
  }

  const survivorEliminated = await isRosterCurrentlyEliminated(leagueId, rosterId).catch(() => false)
  if (survivorEliminated) {
    throw new Error("This Survivor manager has been eliminated and cannot submit waiver claims")
  }

  const waiversFrozen = await isWaiverFrozenForRoster(leagueId, rosterId).catch(() => false)
  if (waiversFrozen) {
    throw new Error("This roster's waiver moves are frozen by an active Survivor idol effect")
  }

  const leagueLock = await getLeagueWaiverState(leagueId).catch(() => null)
  if (leagueLock?.processingLocked) {
    throw new Error("Waiver adds and edits are locked until the commissioner unlocks processing.")
  }

  // Season phase (season-phase-policy.ts): a closed or first-come offseason, rosters locked for the
  // playoffs, or a team out of the title bracket under the alive-only rule takes no claims.
  const phase = await loadWaiverPhasePolicy(leagueId, rosterId)
  if (!phase.claimsAllowed) {
    throw new Error(phase.reason ?? "Waiver claims are closed right now.")
  }

  const devyCheck = await validateDevyWaiverClaim({ leagueId, addPlayerId: input.addPlayerId })
  if (!devyCheck.allowed) {
    throw new Error(devyCheck.reason ?? "This player cannot be claimed via waivers.")
  }

  const settings = await getEffectiveLeagueWaiverSettings(leagueId)
  const conceptBlock = conceptOverridesBlockWaivers(settings.specialtyConceptOverrides)
  if (conceptBlock) {
    throw new Error(conceptBlock)
  }
  const limitCheck = await assertClaimWithinLimits(
    leagueId,
    rosterId,
    settings.claimLimitPerWeek,
    settings.claimLimitPerPeriod,
  )
  if (!limitCheck.ok) {
    throw new Error(limitCheck.message)
  }
  const perRunCheck = await assertClaimWithinPerRunLimit(leagueId, rosterId, settings.claimLimitPerRun)
  if (!perRunCheck.ok) {
    throw new Error(perRunCheck.message)
  }
  const windowCheck = assertWaiverSubmissionWindow({
    freeAgentWindowRules: settings.freeAgentWindowRules ?? null,
    processingDays: settings.processingDays ?? null,
    lockType: settings.lockType ?? null,
  })
  if (!windowCheck.ok) {
    throw new Error(windowCheck.message)
  }
  // Commissioner's per-day schedule: a Locked day refuses claims (null = no schedule, unchanged).
  const daily = await loadDailyTransactionPolicy(leagueId).catch(() => null)
  const dailyCheck = assertDailyScheduleAllowsClaim(daily?.policy)
  if (!dailyCheck.ok) {
    throw new Error(dailyCheck.message)
  }

  await assertWaiverClaimEligibility({
    leagueId,
    rosterId,
    addPlayerId: input.addPlayerId,
    dropPlayerId: input.dropPlayerId ?? null,
    faabBid: input.faabBid ?? null,
    claimMetadata: input.metadata ?? null,
  })

  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { sport: true, waiverHours: true },
  })

  // A player this team dropped is on waivers for the league's waiver period (or his position's);
  // it cannot claim him back until he clears (dropped-player-waivers.ts). A failed read lets the
  // claim through — the processor checks again at the run.
  const holdPolicy = droppedPlayerHoldPolicy({
    normalizedWaiverType: settings.normalizedWaiverType,
    waiverHours: league?.waiverHours ?? null,
    waiverEngineConfig: settings.waiverEngineConfig,
    sport: league?.sport ? String(league.sport) : null,
  })
  if (maxHoldHours(holdPolicy) > 0) {
    const hold = await loadDroppedPlayerHold(leagueId, String(input.addPlayerId), holdPolicy).catch(() => null)
    if (hold && hold.droppedByRosterId === rosterId) throw new Error(DROPPER_RECLAIM_MESSAGE)
  }

  const maxOrder = await (prisma as any).waiverClaim.aggregate({
    where: { leagueId, status: "pending" },
    _max: { priorityOrder: true },
  })
  const priorityOrder = (maxOrder?._max?.priorityOrder ?? -1) + 1
  const submitterId =
    typeof input.userId === "string" && input.userId.trim() ? input.userId.trim() : null
  const created = await (prisma as any).waiverClaim.create({
    data: {
      leagueId,
      sportType: league?.sport ?? null,
      rosterId,
      userId: submitterId,
      addPlayerId: input.addPlayerId,
      dropPlayerId: input.dropPlayerId ?? null,
      faabBid: input.faabBid ?? null,
      priorityOrder: input.priorityOrder ?? priorityOrder,
      claimType: input.claimType ?? "add_drop",
      status: "pending",
      metadata: input.metadata === undefined || input.metadata === null ? undefined : (input.metadata as object),
    },
  })

  const uid = typeof roster.platformUserId === "string" ? roster.platformUserId.trim() : ""
  if (uid) {
    const sport = normalizeToSupportedSport(league?.sport ?? undefined)
    void recordAfLearningEvent({
      eventType: "waiver_claim_submitted",
      sport,
      leagueId,
      userId: uid,
      source: "waiver_claim_service",
      payload: {
        claimId: created.id,
        faabBid: input.faabBid ?? null,
        hasDrop: input.dropPlayerId != null && String(input.dropPlayerId).length > 0,
      },
    })
  }

  return created
}

export async function getPendingClaims(leagueId: string) {
  const list = await (prisma as any).waiverClaim.findMany({
    where: { leagueId, status: "pending" },
    orderBy: [{ priorityOrder: "asc" }],
    include: { roster: { select: { id: true, platformUserId: true, playerData: true, faabRemaining: true, waiverPriority: true } } },
  })
  return list
}

export async function getClaimsByRoster(rosterId: string, status?: string) {
  const where: any = { rosterId }
  if (status) where.status = status
  return (prisma as any).waiverClaim.findMany({
    where,
    orderBy: [{ priorityOrder: "asc" }, { createdAt: "asc" }],
  })
}

export async function updateClaim(
  claimId: string,
  leagueId: string,
  rosterId: string,
  input: Partial<WaiverClaimInput>
) {
  const existing = await (prisma as any).waiverClaim.findFirst({
    where: { id: claimId, leagueId, rosterId, status: "pending" },
  })
  if (!existing) return null
  const leagueLock = await getLeagueWaiverState(leagueId).catch(() => null)
  if (leagueLock?.processingLocked) {
    throw new Error("Waiver adds and edits are locked until the commissioner unlocks processing.")
  }
  const survivorEliminated = await isRosterCurrentlyEliminated(leagueId, rosterId).catch(() => false)
  if (survivorEliminated) {
    throw new Error("This Survivor manager has been eliminated and cannot edit waiver claims")
  }
  const waiversFrozen = await isWaiverFrozenForRoster(leagueId, rosterId).catch(() => false)
  if (waiversFrozen) {
    throw new Error("This roster's waiver moves are frozen by an active Survivor idol effect")
  }

  const nextAdd = input.addPlayerId != null ? input.addPlayerId : existing.addPlayerId
  const nextDrop = input.dropPlayerId !== undefined ? input.dropPlayerId : existing.dropPlayerId
  const nextFaab = input.faabBid !== undefined ? input.faabBid : existing.faabBid
  await assertWaiverClaimEligibility({
    leagueId,
    rosterId,
    addPlayerId: nextAdd,
    dropPlayerId: nextDrop ?? null,
    faabBid: nextFaab ?? null,
    claimMetadata: existing.metadata ?? null,
    excludeClaimId: claimId,
  })

  const updated = await (prisma as any).waiverClaim.update({
    where: { id: claimId },
    data: {
      ...(input.addPlayerId != null && { addPlayerId: input.addPlayerId }),
      ...(input.dropPlayerId !== undefined && { dropPlayerId: input.dropPlayerId }),
      ...(input.faabBid !== undefined && { faabBid: input.faabBid }),
      ...(input.priorityOrder !== undefined && { priorityOrder: input.priorityOrder }),
    },
  })
  return updated
}

export async function cancelClaim(claimId: string, leagueId: string, rosterId: string) {
  const existing = await (prisma as any).waiverClaim.findFirst({
    where: { id: claimId, leagueId, rosterId, status: "pending" },
  })
  if (!existing) return false
  const leagueLock = await getLeagueWaiverState(leagueId).catch(() => null)
  if (leagueLock?.processingLocked) {
    throw new Error("Waiver adds and edits are locked until the commissioner unlocks processing.")
  }
  await (prisma as any).waiverClaim.update({
    where: { id: claimId },
    data: { status: "cancelled" },
  })
  return true
}

export async function getProcessedClaimsAndTransactions(leagueId: string, limit: number) {
  const [claims, transactions] = await Promise.all([
    (prisma as any).waiverClaim.findMany({
      where: { leagueId, status: { in: ["processed", "failed"] } },
      orderBy: { processedAt: "desc" },
      take: limit,
      include: { roster: { select: { id: true, platformUserId: true } } },
    }),
    (prisma as any).waiverTransaction.findMany({
      where: { leagueId },
      orderBy: { processedAt: "desc" },
      take: limit,
      include: { roster: { select: { id: true, platformUserId: true } } },
    }),
  ])
  const enriched = await enrichTransactionsWithPositions(transactions)
  return { claims, transactions: enriched }
}

const IDP_POSITIONS = new Set(["DE", "DT", "LB", "CB", "S", "SS", "FS"])

async function enrichTransactionsWithPositions(
  transactions: { addPlayerId: string; dropPlayerId: string | null }[]
): Promise<{ addPlayerId: string; dropPlayerId: string | null; addPlayerPosition?: string; dropPlayerPosition?: string; isDefensiveAdd?: boolean; isDefensiveDrop?: boolean }[]> {
  const ids = new Set<string>()
  for (const t of transactions) {
    if (t.addPlayerId) ids.add(t.addPlayerId)
    if (t.dropPlayerId) ids.add(t.dropPlayerId)
  }
  if (ids.size === 0) return transactions.map((t) => ({ ...t, isDefensiveAdd: false, isDefensiveDrop: false }))
  const players = await (prisma as any).sportsPlayer.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, position: true },
  })
  const posById = new Map<string, string>(players.map((p: { id: string; position: string | null }) => [p.id, (p.position ?? "").toUpperCase()]))
  return transactions.map((t) => {
    const addPos = posById.get(t.addPlayerId) ?? ""
    const dropPos = posById.get(t.dropPlayerId ?? "") ?? ""
    return {
      ...t,
      addPlayerPosition: addPos || undefined,
      dropPlayerPosition: dropPos || undefined,
      isDefensiveAdd: addPos ? IDP_POSITIONS.has(addPos) : false,
      isDefensiveDrop: dropPos ? IDP_POSITIONS.has(dropPos) : false,
    }
  })
}
