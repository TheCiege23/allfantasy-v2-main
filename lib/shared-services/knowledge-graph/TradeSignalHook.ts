/**
 * Real integration point for lib/league-trade-engine/tradeService.ts. A trade
 * involves two managers (proposer and receiver) — both get a signal for the
 * same outcome, since both are legitimately "involved in an accepted/
 * rejected trade" for the purposes of this phase's simple frequency-based
 * ManagerBehaviorProfile. Distinguishing proposer-vs-receiver role in the
 * aggregate itself is a documented future refinement, not built here.
 *
 * Never throws — wraps the roster lookup + signal capture so a Knowledge
 * Graph failure can never affect a real trade transaction, matching the
 * existing captureLiveTradeOffer/captureLiveTradeOutcome convention this
 * file sits alongside in tradeService.ts.
 */

import { prisma } from '@/lib/prisma'
import { captureTradeSignal } from './SignalIngestionService'
import type { CaptureTradeSignalInput } from './SignalIngestionService'

export interface RecordTradeOutcomeSignalInput {
  tradeId: string
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  outcome: CaptureTradeSignalInput['signalType']
  emittedFrom: string
}

export async function recordTradeOutcomeSignal(input: RecordTradeOutcomeSignalInput): Promise<void> {
  try {
    const rosters = await prisma.roster.findMany({
      where: { id: { in: [input.proposerRosterId, input.receiverRosterId] } },
      select: { id: true, platformUserId: true },
    })
    await Promise.all(
      rosters
        .filter((r) => r.platformUserId)
        .map((r) =>
          captureTradeSignal({
            signalType: input.outcome,
            leagueId: input.leagueId,
            managerKey: r.platformUserId,
            tradeId: input.tradeId,
            emittedFrom: input.emittedFrom,
          })
        )
    )
  } catch (err) {
    console.warn('[knowledge-graph] recordTradeOutcomeSignal failed (non-fatal):', err)
  }
}
