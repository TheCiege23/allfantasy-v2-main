/**
 * Historical Waiver Loader — Waiver Shadow Backtest, Phase 7.
 *
 * Loads real, terminal (processed or failed) WaiverClaim rows, joined to
 * their real WaiverResult (the true win/loss + FAAB-delta outcome record —
 * confirmed via lib/waiver-wire/process-engine.ts: WaiverClaim.status
 * becomes 'processed' + WaiverResult.resultType 'awarded' on a win, or
 * WaiverClaim.status 'failed' + WaiverResult.resultType 'failed' on a loss)
 * and their League (for platform/provider grouping).
 *
 * IMPORTANT, HONEST LIMITATION: no point-in-time roster/free-agent-pool
 * snapshot exists for waivers (unlike Trade OS's assets, which were captured
 * verbatim into TradeOfferEvent.assetsGiven/assetsReceived at proposal time).
 * Re-running evaluateWaiverShadow for a historical claim evaluates the shadow
 * engine against TODAY's roster and free-agent-pool state, not the state as
 * it existed when the claim was actually made. This is documented in
 * backtest/README.md and is why this backtest's primary value is
 * engine-to-engine parity (shadow vs the one real legacy grader) using real
 * league/roster/player identifiers, not strict outcome prediction — the real
 * historical outcome is attached for reporting only, not as ground truth.
 */

import { prisma } from '@/lib/prisma'
import { IMPORT_PROVIDERS } from '@/lib/league-import/types'
import type { HistoricalWaiverLoadResult, HistoricalWaiverRealOutcome, HistoricalWaiverSample, SkippedWaiverSample } from './types'

function normalizeRealOutcome(claimStatus: string): HistoricalWaiverRealOutcome | null {
  if (claimStatus === 'processed') return 'awarded'
  if (claimStatus === 'failed') return 'failed'
  return null
}

export interface LoadHistoricalWaiverSamplesOptions {
  /** Max WaiverClaim candidates to consider. Defaults to 200. */
  limit?: number
}

export async function loadHistoricalWaiverSamples(
  options: LoadHistoricalWaiverSamplesOptions = {}
): Promise<HistoricalWaiverLoadResult> {
  const limit = options.limit ?? 200
  const samples: HistoricalWaiverSample[] = []
  const skipped: SkippedWaiverSample[] = []

  const claims = await prisma.waiverClaim.findMany({
    where: { status: { in: ['processed', 'failed'] } },
    orderBy: { processedAt: 'desc' },
    take: limit,
    include: { roster: { select: { platformUserId: true } } },
  })

  for (const claim of claims) {
    const realOutcome = normalizeRealOutcome(claim.status)
    if (!realOutcome) {
      // Guarded against by the query's where-clause; kept for type-narrowing only.
      skipped.push({ claimId: claim.id, reason: `unexpected_status:${claim.status}` })
      continue
    }

    const result = await prisma.waiverResult.findFirst({
      where: { claimId: claim.id },
      select: { faabDelta: true, resultType: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!result) {
      skipped.push({ claimId: claim.id, reason: 'no_waiver_result' })
      continue
    }

    const league = await prisma.league.findUnique({ where: { id: claim.leagueId }, select: { platform: true } })
    if (!league) {
      skipped.push({ claimId: claim.id, reason: 'league_not_found' })
      continue
    }
    if (!IMPORT_PROVIDERS.includes(league.platform as (typeof IMPORT_PROVIDERS)[number]) && league.platform !== 'native') {
      // Unrecognized platform value — not guessed at. Note: unlike Trade OS's backtest, a real
      // 'native' league IS included (Waiver OS never needs an external re-fetch), so only a truly
      // unrecognized platform string is skipped here.
      skipped.push({ claimId: claim.id, reason: `unrecognized_platform:${league.platform}` })
      continue
    }

    samples.push({
      claimId: claim.id,
      leagueId: claim.leagueId,
      rosterId: claim.rosterId,
      platform: league.platform,
      managerKey: claim.roster?.platformUserId ?? null,
      addPlayerId: claim.addPlayerId,
      addPlayerName: null,
      dropPlayerId: claim.dropPlayerId ?? null,
      faabBid: claim.faabBid ?? null,
      priorityOrder: claim.priorityOrder,
      realOutcome,
      realFaabDelta: result.faabDelta ?? null,
      processedAt: (claim.processedAt ?? claim.createdAt).toISOString(),
    })
  }

  return { samples, skipped, totalCandidates: claims.length }
}
