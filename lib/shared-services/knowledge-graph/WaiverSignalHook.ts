/**
 * Real integration point for lib/waiver-wire/process-engine.ts. Unlike
 * trades, the resolving roster's `platformUserId` is already loaded at both
 * call sites this hooks into (the success path and the shared `pushFail`
 * helper), so no extra query is needed here — just a never-throwing wrapper
 * matching the same safety convention as TradeSignalHook.ts and this file's
 * existing sibling, onWaiverRunComplete(...).catch(() => {}).
 */

import { captureWaiverSignal } from './SignalIngestionService'

export interface RecordWaiverClaimSignalInput {
  outcome: 'waiver_claim_won' | 'waiver_claim_lost'
  leagueId: string
  managerKey: string | null | undefined
  claimId: string
  addPlayerId: string
  dropPlayerId?: string | null
  emittedFrom: string
}

export async function recordWaiverClaimSignal(input: RecordWaiverClaimSignalInput): Promise<void> {
  const managerKey = input.managerKey?.trim()
  if (!managerKey) return
  try {
    await captureWaiverSignal({
      signalType: input.outcome,
      leagueId: input.leagueId,
      managerKey,
      claimId: input.claimId,
      addPlayerId: input.addPlayerId,
      dropPlayerId: input.dropPlayerId,
      emittedFrom: input.emittedFrom,
    })
  } catch (err) {
    console.warn('[knowledge-graph] recordWaiverClaimSignal failed (non-fatal):', err)
  }
}
