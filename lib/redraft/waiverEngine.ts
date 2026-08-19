import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assignIdpCapSalaryForWaiverClaim } from '@/lib/idp/capEngine'
import { getPlatformEvents, EVENT } from '@/lib/events'

export type ProcessedClaim = { claimId: string; status: string; reason?: string }

/**
 * After a claim is approved and `RedraftRosterPlayer` exists for the add, assign IDP cap salary.
 * No-op when the league has no `IDPCapConfig`.
 */
export async function finalizeRedraftWaiverClaimIdpCap(opts: {
  leagueId: string
  rosterId: string
  addPlayerId: string
  addPlayerName: string
  bidAmount: number | null | undefined
  position: string
  isDefensive: boolean
}): Promise<void> {
  await assignIdpCapSalaryForWaiverClaim(
    opts.leagueId,
    opts.rosterId,
    opts.addPlayerId,
    opts.addPlayerName,
    opts.position,
    opts.isDefensive,
    opts.bidAmount,
  )
}

function isDefensivePosition(position: string): boolean {
  return ['DE', 'DT', 'DL', 'LB', 'ILB', 'OLB', 'CB', 'S', 'DB'].includes(position.toUpperCase())
}

async function resolvePlayerMeta(addPlayerId: string, addPlayerName: string, sport: string) {
  const sportKeys = [sport.toUpperCase(), sport.toLowerCase()]
  const player = await prisma.sportsPlayer
    .findFirst({
      where: {
        sport: { in: sportKeys },
        OR: [{ externalId: addPlayerId }, { sleeperId: addPlayerId }, { id: addPlayerId }],
      },
      select: { name: true, position: true, team: true },
    })
    .catch(() => null)
  if (player) {
    return {
      playerName: player.name || addPlayerName,
      position: player.position || 'UNK',
      team: player.team ?? null,
      warning: null as string | null,
    }
  }

  const identity = await prisma.playerIdentityMap
    .findFirst({
      where: {
        sport: { in: sportKeys },
        OR: [
          { sleeperId: addPlayerId },
          { fantasyCalcId: addPlayerId },
          { rollingInsightsId: addPlayerId },
          { apiSportsId: addPlayerId },
          { espnId: addPlayerId },
          { clearSportsId: addPlayerId },
        ],
      },
      select: { canonicalName: true, position: true, currentTeam: true },
    })
    .catch(() => null)

  if (identity) {
    return {
      playerName: identity.canonicalName || addPlayerName,
      position: identity.position || 'UNK',
      team: identity.currentTeam ?? null,
      warning: null as string | null,
    }
  }

  return {
    playerName: addPlayerName,
    position: 'UNK',
    team: null,
    warning: `No cached player metadata found for ${addPlayerId}; rostered with unknown position.`,
  }
}

async function denyClaim(claimId: string, reason: string): Promise<ProcessedClaim> {
  await prisma.redraftWaiverClaim.update({
    where: { id: claimId },
    data: { status: 'denied', processedAt: new Date(), denialReason: reason },
  })
  return { claimId, status: 'denied', reason }
}

async function moveApprovedRosterToBack(seasonId: string, rosterId: string) {
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId },
    select: { waiverPriority: true },
    orderBy: { waiverPriority: 'desc' },
    take: 1,
  })
  const maxPriority = rosters[0]?.waiverPriority ?? 0
  await prisma.redraftRoster.update({
    where: { id: rosterId },
    data: { waiverPriority: maxPriority + 1 },
  })
}

/** Sentinel: the claim's drop player was not active, so the claim is denied. */
class WaiverDropInactiveError extends Error {}

async function runWaiverSettlement(callback: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  const transaction = (prisma as unknown as { $transaction?: (fn: (tx: Prisma.TransactionClient) => Promise<void>) => Promise<void> }).$transaction
  if (typeof transaction === 'function') {
    await transaction(callback)
    return
  }
  await callback(prisma as unknown as Prisma.TransactionClient)
}

export type WaiverClaimOrderFields = {
  id: string
  bidAmount: number | null
  priority: number | null
  submittedAt: Date
}

/**
 * Deterministic waiver claim resolution order (FAAB-priority hybrid):
 *  1. Higher FAAB bid wins. A null bid is treated as 0 and ranks LAST (so a
 *     priority-only claim never outranks a real bid in a mixed league).
 *  2. Lower waiver priority number wins (1 = first in line).
 *  3. Earlier submission wins.
 *  4. Claim id (stable) — guarantees a total order so two otherwise-equal
 *     claims always resolve the same way on re-runs.
 *
 * The Prisma query in `processWaiverWindow` mirrors this exactly; this pure
 * comparator exists so the ordering is unit-testable without a database.
 */
export function compareWaiverClaims(a: WaiverClaimOrderFields, b: WaiverClaimOrderFields): number {
  const bidA = a.bidAmount ?? 0
  const bidB = b.bidAmount ?? 0
  if (bidA !== bidB) return bidB - bidA
  const prioA = a.priority ?? Number.MAX_SAFE_INTEGER
  const prioB = b.priority ?? Number.MAX_SAFE_INTEGER
  if (prioA !== prioB) return prioA - prioB
  const tA = a.submittedAt.getTime()
  const tB = b.submittedAt.getTime()
  if (tA !== tB) return tA - tB
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export async function processWaiverWindow(
  leagueId: string,
  seasonId: string,
): Promise<ProcessedClaim[]> {
  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId } })
  if (!season) return []

  const claims = await prisma.redraftWaiverClaim.findMany({
    where: { leagueId, seasonId, status: 'pending' },
    // Mirrors compareWaiverClaims: highest bid first (null bids last, treated as
    // 0), then lowest priority number, earliest submission, then stable id.
    orderBy: [
      { bidAmount: { sort: 'desc', nulls: 'last' } },
      { priority: 'asc' },
      { submittedAt: 'asc' },
      { id: 'asc' },
    ],
  })

  const results: ProcessedClaim[] = []
  const acquiredPlayerIds = new Set<string>()

  for (const claim of claims) {
    const roster = await prisma.redraftRoster.findFirst({
      where: { id: claim.rosterId, seasonId, leagueId },
    })
    if (!roster) {
      results.push(await denyClaim(claim.id, 'Roster not found for this season.'))
      continue
    }

    const bid = claim.bidAmount ?? 0
    if (bid < 0) {
      results.push(await denyClaim(claim.id, 'Invalid FAAB bid.'))
      continue
    }
    if (roster.faabBalance != null && bid > roster.faabBalance) {
      results.push(await denyClaim(claim.id, 'Insufficient FAAB balance.'))
      continue
    }
    if (acquiredPlayerIds.has(claim.addPlayerId)) {
      results.push(await denyClaim(claim.id, 'Another claim in this waiver run already won this player.'))
      continue
    }

    const existingActive = await prisma.redraftRosterPlayer.findFirst({
      where: {
        playerId: claim.addPlayerId,
        droppedAt: null,
        roster: { seasonId },
      },
      select: { rosterId: true },
    })
    if (existingActive) {
      const reason =
        existingActive.rosterId === claim.rosterId
          ? 'Player is already on this roster.'
          : 'Player is already rostered in this season.'
      results.push(await denyClaim(claim.id, reason))
      continue
    }

    const meta = await resolvePlayerMeta(claim.addPlayerId, claim.addPlayerName, season.sport || 'NFL')

    // Atomic settlement: drop + add + approve + FAAB deduction commit together,
    // so a crash/timeout can never leave a roster that dropped a player without
    // gaining the claimed one.
    try {
      await runWaiverSettlement(async (tx: Prisma.TransactionClient) => {
        if (claim.dropPlayerId) {
          const dropResult = await tx.redraftRosterPlayer.updateMany({
            where: { rosterId: claim.rosterId, playerId: claim.dropPlayerId, droppedAt: null },
            data: { droppedAt: new Date() },
          })
          if (dropResult.count === 0) throw new WaiverDropInactiveError()
        }

        await tx.redraftRosterPlayer.create({
          data: {
            rosterId: claim.rosterId,
            playerId: claim.addPlayerId,
            playerName: meta.playerName,
            position: meta.position,
            team: meta.team,
            sport: season.sport || 'NFL',
            slotType: 'bench',
            acquisitionType: 'waiver',
          },
        })

        await tx.redraftWaiverClaim.update({
          where: { id: claim.id },
          data: {
            status: 'approved',
            processedAt: new Date(),
            denialReason: meta.warning,
          },
        })

        if (bid > 0 && roster.faabBalance != null) {
          await tx.redraftRoster.update({
            where: { id: claim.rosterId },
            data: { faabBalance: Math.max(0, roster.faabBalance - bid) },
          })
        }
      })
    } catch (err) {
      if (err instanceof WaiverDropInactiveError) {
        results.push(await denyClaim(claim.id, 'Drop player is not active on this roster.'))
        continue
      }
      results.push(await denyClaim(claim.id, 'Waiver settlement failed; no roster changes were applied.'))
      continue
    }

    await prisma.redraftLeagueTransaction
      .create({
        data: {
          leagueId,
          seasonId,
          rosterId: claim.rosterId,
          type: 'waiver_claim_approved',
          metadata: {
            claimId: claim.id,
            addPlayerId: claim.addPlayerId,
            addPlayerName: meta.playerName,
            dropPlayerId: claim.dropPlayerId ?? null,
            bidAmount: claim.bidAmount ?? null,
            warning: meta.warning,
          },
        },
      })
      .catch(() => null)

    await finalizeRedraftWaiverClaimIdpCap({
      leagueId,
      rosterId: claim.rosterId,
      addPlayerId: claim.addPlayerId,
      addPlayerName: meta.playerName,
      bidAmount: claim.bidAmount,
      position: meta.position,
      isDefensive: isDefensivePosition(meta.position),
    }).catch(() => null)

    acquiredPlayerIds.add(claim.addPlayerId)
    await moveApprovedRosterToBack(seasonId, claim.rosterId).catch(() => null)
    results.push({ claimId: claim.id, status: 'approved', reason: meta.warning ?? undefined })
  }

  // G15.2b — publish (best-effort, post-commit; never throws). One event per claim
  // (deterministic key → re-runs only touch still-pending claims, so no duplicates)
  // plus one window summary. Concept is 'redraft' (this path is redraft-specific).
  const events = getPlatformEvents()
  for (const r of results) {
    await events.emit(EVENT.WAIVER_PROCESSED, {
      leagueId,
      seasonId,
      sport: season.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      source: 'engine:waiver',
      idempotencyKey: `waiver.processed:${r.claimId}`,
      subjects: [{ kind: 'waiver_claim', id: r.claimId }],
      payload: { claimId: r.claimId, result: r.status },
    })
  }
  await events.emit(EVENT.WAIVER_WINDOW_PROCESSED, {
    leagueId,
    seasonId,
    sport: season.sport ?? null,
    leagueConcept: 'redraft',
    actor: { type: 'system' },
    source: 'engine:waiver',
    payload: {
      processed: results.length,
      succeeded: results.filter((r) => r.status === 'approved').length,
      failed: results.filter((r) => r.status !== 'approved').length,
    },
  })

  return results
}

export async function resetWaiverPriority(seasonId: string): Promise<void> {
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId },
    orderBy: [{ wins: 'asc' }, { pointsFor: 'asc' }],
  })
  let p = 1
  for (const r of rosters) {
    await prisma.redraftRoster.update({
      where: { id: r.id },
      data: { waiverPriority: p },
    })
    p += 1
  }
}
