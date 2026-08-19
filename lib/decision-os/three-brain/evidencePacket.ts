/**
 * Evidence-packet assembly — deterministic + server-owned. The packet is the ONLY thing the models see, so
 * it is minimized (short summaries + stringified values, never whole DB/user/roster/chat records) and every
 * signal + fact carries a stable id the models must cite. The `evidenceFingerprint` is a sha256 (reusing
 * `buildAiInputHash`) that later phases use as the deterministic cache key.
 */
import { randomUUID } from 'crypto'
import { buildAiInputHash } from '@/lib/ai/ai-result-cache'
import {
  THREE_BRAIN_SCHEMA_VERSION,
  type DecisionOSEvidencePacket,
  type DecisionOSSignal,
  type VerifiedDecisionFact,
  type DecisionFreshness,
  type DecisionMode,
  type DecisionProviderStatus,
} from './types'

/** Deterministic fingerprint over the decision-relevant evidence (NOT over volatile fields like requestId). */
export function computeEvidenceFingerprint(input: {
  canonicalLeagueId?: string
  decisionType: string
  signals: DecisionOSSignal[]
  facts: VerifiedDecisionFact[]
  freshness: DecisionFreshness
  missingInformation: string[]
}): string {
  return buildAiInputHash({
    feature: 'decision_os_three_brain',
    scopeType: input.canonicalLeagueId ? 'league' : 'global',
    scopeId: input.canonicalLeagueId ?? null,
    payload: {
      decisionType: input.decisionType,
      signals: input.signals.map((s) => ({ id: s.id, kind: s.kind, summary: s.summary, severity: s.severity ?? null })),
      facts: input.facts.map((f) => ({ id: f.id, label: f.label, value: f.value, source: f.source ?? null })),
      freshness: input.freshness,
      missing: [...input.missingInformation].sort(),
    },
  })
}

/** All evidence ids present in a packet — used to reject/remove model claims that cite unknown ids. */
export function evidenceIdSet(packet: DecisionOSEvidencePacket): Set<string> {
  const ids = new Set<string>()
  for (const s of packet.deterministicSignals) ids.add(s.id)
  for (const f of packet.relevantFacts) ids.add(f.id)
  return ids
}

function stableId(prefix: string, provided: string | undefined, index: number): string {
  if (provided && provided.trim()) return provided.trim()
  // Deterministic-within-packet id; the index keeps it stable + citable.
  return `${prefix}-${index + 1}`
}

/**
 * Assemble a server-owned evidence packet from deterministic inputs. Assigns stable ids where missing and
 * computes the fingerprint. `requestId` / `generatedAt` default to server values but are overridable for
 * deterministic tests. Nothing here calls a model or a provider.
 */
export function buildEvidencePacket(input: {
  userId: string
  sport: string
  decisionType: string
  mode: DecisionMode
  signals: Array<Omit<DecisionOSSignal, 'id'> & { id?: string }>
  facts: Array<Omit<VerifiedDecisionFact, 'id'> & { id?: string }>
  freshness: DecisionFreshness
  missingInformation?: string[]
  providerStatus?: DecisionProviderStatus[]
  canonicalLeagueId?: string
  platform?: string
  platformLeagueId?: string
  season?: string
  teamOrRosterId?: string
  userRole?: string
  requestId?: string
  generatedAt?: string
}): DecisionOSEvidencePacket {
  const deterministicSignals: DecisionOSSignal[] = input.signals.map((s, i) => ({
    ...s,
    id: stableId('sig', s.id, i),
  }))
  const relevantFacts: VerifiedDecisionFact[] = input.facts.map((f, i) => ({
    ...f,
    id: stableId('fact', f.id, i),
  }))
  const missingInformation = (input.missingInformation ?? []).filter((x) => typeof x === 'string' && x.trim())

  const evidenceFingerprint = computeEvidenceFingerprint({
    canonicalLeagueId: input.canonicalLeagueId,
    decisionType: input.decisionType,
    signals: deterministicSignals,
    facts: relevantFacts,
    freshness: input.freshness,
    missingInformation,
  })

  return {
    schemaVersion: THREE_BRAIN_SCHEMA_VERSION,
    requestId: input.requestId ?? randomUUID(),
    userId: input.userId,
    canonicalLeagueId: input.canonicalLeagueId,
    platform: input.platform,
    platformLeagueId: input.platformLeagueId,
    sport: input.sport,
    season: input.season,
    teamOrRosterId: input.teamOrRosterId,
    userRole: input.userRole,
    mode: input.mode,
    decisionType: input.decisionType,
    deterministicSignals,
    relevantFacts,
    freshness: input.freshness,
    providerStatus: input.providerStatus ?? [],
    missingInformation,
    evidenceFingerprint,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}

/** The minimized, model-facing view of the packet — omits internal identity fields the models must never
 *  treat as authoritative (userId, platformLeagueId, requestId, fingerprint). Only evidence + light context. */
export function toModelFacingEvidence(packet: DecisionOSEvidencePacket): Record<string, unknown> {
  return {
    sport: packet.sport,
    season: packet.season ?? null,
    mode: packet.mode,
    decisionType: packet.decisionType,
    userRole: packet.userRole ?? null,
    freshness: packet.freshness,
    signals: packet.deterministicSignals.map((s) => ({ id: s.id, kind: s.kind, summary: s.summary, severity: s.severity ?? null })),
    facts: packet.relevantFacts.map((f) => ({ id: f.id, label: f.label, value: f.value, source: f.source ?? null })),
    missingInformation: packet.missingInformation,
    providerStatus: packet.providerStatus,
  }
}
