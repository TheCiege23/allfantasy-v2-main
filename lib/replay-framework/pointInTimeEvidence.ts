import type { TradeReplayPayload } from './types'

export type PointInTimeEvidenceCheck = { eligible: true; newestEvidenceAt: string } | { eligible: false; reason: string }

export function checkTradeReplayPointInTimeEvidence(
  payload: TradeReplayPayload,
  proposedAt: Date,
): PointInTimeEvidenceCheck {
  if (Number.isNaN(proposedAt.getTime())) return { eligible: false, reason: 'The trade decision time is invalid.' }
  const evidence = [...payload.assetsGiven, ...payload.assetsReceived, ...(payload.proposerRoster ?? []), ...(payload.counterpartyRoster ?? [])]
  if (evidence.length === 0) return { eligible: false, reason: 'The replay has no decision-time assets.' }
  let newest = 0
  for (const row of evidence) {
    if (!row.observedAt) return { eligible: false, reason: `Missing decision-time evidence timestamp for ${row.name}.` }
    const at = new Date(row.observedAt).getTime()
    if (!Number.isFinite(at)) return { eligible: false, reason: `Invalid evidence timestamp for ${row.name}.` }
    if (at > proposedAt.getTime()) return { eligible: false, reason: `${row.name} uses evidence observed after the trade decision.` }
    newest = Math.max(newest, at)
  }
  return { eligible: true, newestEvidenceAt: new Date(newest).toISOString() }
}
