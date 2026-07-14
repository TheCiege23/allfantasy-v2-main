/**
 * Signal Ingestion Service — the only write path into the Knowledge Graph
 * (Knowledge Graph spec Part 14). Called from the real, verified emission
 * points in lib/league-trade-engine/tradeService.ts and
 * lib/waiver-wire/process-engine.ts.
 *
 * Every capture function here fails safe: it never throws, and a failure is
 * only logged — matching the exact convention already established in this
 * codebase for observational side-effects (see tradeService.ts's own
 * captureLiveTradeOffer/captureLiveTradeOutcome and process-engine.ts's
 * onWaiverRunComplete, both of which follow this same "never block the real
 * transaction" rule).
 */

import { randomUUID } from 'crypto'
import { defaultSignalStore, type SignalStore } from './SignalStore'
import type { Signal, SignalType, SourceAttribution } from './types'

function buildSignal(
  signalType: SignalType,
  leagueId: string,
  managerKey: string,
  payload: Record<string, unknown>,
  emittedFrom: string
): Signal {
  const sourceAttribution: SourceAttribution = {
    source: 'af_native',
    emittedFrom,
    recordedAt: new Date(),
  }
  return {
    id: randomUUID(),
    signalType,
    leagueId,
    managerKey,
    occurredAt: new Date(),
    payload,
    sourceAttribution,
  }
}

async function safeAppend(store: SignalStore, signal: Signal): Promise<void> {
  try {
    await store.append(signal)
  } catch (err) {
    console.warn(`[knowledge-graph] failed to record ${signal.signalType} signal (non-fatal):`, err)
  }
}

export interface CaptureTradeSignalInput {
  signalType: 'trade_accepted' | 'trade_rejected' | 'trade_cancelled' | 'trade_vetoed'
  leagueId: string
  managerKey: string
  tradeId: string
  emittedFrom: string
  store?: SignalStore
}

/** Called from the verified trade outcome transitions in tradeService.ts. */
export async function captureTradeSignal(input: CaptureTradeSignalInput): Promise<void> {
  const store = input.store ?? defaultSignalStore
  const signal = buildSignal(
    input.signalType,
    input.leagueId,
    input.managerKey,
    { tradeId: input.tradeId },
    input.emittedFrom
  )
  await safeAppend(store, signal)
}

export interface CaptureWaiverSignalInput {
  signalType: 'waiver_claim_won' | 'waiver_claim_lost'
  leagueId: string
  managerKey: string
  claimId: string
  addPlayerId: string
  dropPlayerId?: string | null
  emittedFrom: string
  store?: SignalStore
}

/** Called from the verified waiver claim resolution transitions in process-engine.ts. */
export async function captureWaiverSignal(input: CaptureWaiverSignalInput): Promise<void> {
  const store = input.store ?? defaultSignalStore
  const signal = buildSignal(
    input.signalType,
    input.leagueId,
    input.managerKey,
    { claimId: input.claimId, addPlayerId: input.addPlayerId, dropPlayerId: input.dropPlayerId ?? null },
    input.emittedFrom
  )
  await safeAppend(store, signal)
}
