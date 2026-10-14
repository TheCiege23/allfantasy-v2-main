import { seasonContractHash } from './seasonCalendarVerification'

export type SeasonOutcomeSubject =
  | { kind: 'player_game'; providerGameId: string; providerPlayerId: string }
  | { kind: 'player_period'; playerId: string }
  | { kind: 'game_period'; providerGameId: string }

export type SeasonOutcomeClaim = {
  subject: SeasonOutcomeSubject
  outcome: 'box_line_present' | 'played' | 'dnp' | 'no_game' | 'game_expected' | 'no_drafted_players' | 'drafted_players_expected'
  source: { provider: 'rolling_insights'; reference: string; artifactDigest: string; observedAt: string; contract: 'unverified' }
}

export type SeasonOutcomeScope = {
  tournamentId: string; freezeId: string; leagueId: string; period: number; manifestHash: string; rulesHash: string
}

export type SeasonOutcomeReceipt = SeasonOutcomeScope & SeasonOutcomeClaim & {
  version: 1; revision: number; previousDigest: string | null; requestId: string; recordedAt: string; artifact: Record<string, unknown>; digest: string
}

const digestPattern = /^[a-f0-9]{64}$/
const idPattern = /^[A-Za-z0-9:_-]{1,200}$/
const allowed: Record<SeasonOutcomeSubject['kind'], SeasonOutcomeClaim['outcome'][]> = {
  player_game: ['box_line_present', 'played', 'dnp'],
  player_period: ['no_game', 'game_expected'],
  game_period: ['no_drafted_players', 'drafted_players_expected'],
}

export function seasonOutcomeSubjectKey(subject: SeasonOutcomeSubject): string {
  if (subject.kind === 'player_game') return `player_game:${subject.providerGameId}:${subject.providerPlayerId}`
  if (subject.kind === 'player_period') return `player_period:${subject.playerId}`
  return `game_period:${subject.providerGameId}`
}

function assertClaim(claim: SeasonOutcomeClaim): void {
  if (!claim || !claim.subject || !allowed[claim.subject.kind]?.includes(claim.outcome)) throw new Error('Outcome does not match its subject.')
  const subject = claim.subject
  const ids = subject.kind === 'player_game' ? [subject.providerGameId, subject.providerPlayerId] :
    subject.kind === 'player_period' ? [subject.playerId] : [subject.providerGameId]
  if (ids.some(id => typeof id !== 'string' || !idPattern.test(id))) throw new Error('Outcome subject has an invalid identity.')
  const source = claim.source
  if (!source || source.provider !== 'rolling_insights' || source.contract !== 'unverified' ||
    typeof source.reference !== 'string' || !source.reference.trim() || source.reference.length > 300 ||
    !digestPattern.test(source.artifactDigest) || !Number.isFinite(Date.parse(source.observedAt))) {
    throw new Error('Outcome source provenance is incomplete or claims an unverified contract is verified.')
  }
}

function checkedArtifact(artifact: unknown, digest: string): Record<string, unknown> {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) throw new Error('Outcome source artifact is missing or malformed.')
  let json: string
  try { json = JSON.stringify(artifact) } catch { throw new Error('Outcome source artifact is not serializable.') }
  if (!json || json.length > 200000 || seasonContractHash(JSON.parse(json)) !== digest) {
    throw new Error('Outcome source artifact is missing, oversized or differs from its checksum.')
  }
  return JSON.parse(json) as Record<string, unknown>
}

/** Audit receipts record claims only. They cannot certify a DNP, zero score or complete period. */
export function readSeasonOutcomeHistory(raw: unknown[], scope: SeasonOutcomeScope): SeasonOutcomeReceipt[] {
  if (raw.length > 10000) throw new Error('Outcome evidence history exceeds the review limit.')
  const receipts = raw.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed outcome evidence receipt.')
    const { digest, ...payload } = value as SeasonOutcomeReceipt
    if (!digestPattern.test(digest) || seasonContractHash(payload) !== digest) throw new Error('Outcome evidence checksum differs.')
    const receipt = value as SeasonOutcomeReceipt
    if (receipt.version !== 1 || receipt.tournamentId !== scope.tournamentId || receipt.freezeId !== scope.freezeId ||
      receipt.leagueId !== scope.leagueId || receipt.period !== scope.period || receipt.manifestHash !== scope.manifestHash ||
      receipt.rulesHash !== scope.rulesHash || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 ||
      !idPattern.test(receipt.requestId) || !Number.isFinite(Date.parse(receipt.recordedAt))) throw new Error('Outcome evidence differs from the frozen league scope.')
    assertClaim(receipt)
    checkedArtifact(receipt.artifact, receipt.source.artifactDigest)
    return receipt
  }).sort((a, b) => a.revision - b.revision)
  const requestIds = new Set<string>()
  for (let i = 0; i < receipts.length; i++) {
    if (receipts[i]!.revision !== i + 1 || receipts[i]!.previousDigest !== (i ? receipts[i - 1]!.digest : null)) throw new Error('Outcome evidence revision chain is broken.')
    if (requestIds.has(receipts[i]!.requestId)) throw new Error('Outcome evidence request ID was reused.')
    requestIds.add(receipts[i]!.requestId)
  }
  return receipts
}

export function appendSeasonOutcomeReceipt(raw: unknown[], scope: SeasonOutcomeScope, requestId: string,
  claim: SeasonOutcomeClaim, artifact: Record<string, unknown>, recordedAt: string): { receipt: SeasonOutcomeReceipt; existing: boolean } {
  const history = readSeasonOutcomeHistory(raw, scope)
  assertClaim(claim)
  const savedArtifact = checkedArtifact(artifact, claim.source.artifactDigest)
  if (!idPattern.test(requestId) || !Number.isFinite(Date.parse(recordedAt))) throw new Error('Outcome evidence request ID or recording time is invalid.')
  const retry = history.find(item => item.requestId === requestId)
  if (retry) {
    if (seasonContractHash({ subject: retry.subject, outcome: retry.outcome, source: retry.source, artifact: retry.artifact }) !== seasonContractHash({ ...claim, artifact })) throw new Error('Outcome evidence request ID conflicts with its saved claim.')
    return { receipt: retry, existing: true }
  }
  const payload = { ...scope, ...claim, version: 1 as const, revision: history.length + 1,
    previousDigest: history.at(-1)?.digest ?? null, requestId, recordedAt, artifact: savedArtifact }
  return { receipt: { ...payload, digest: seasonContractHash(payload) }, existing: false }
}

export function latestSeasonOutcomeClaims(history: SeasonOutcomeReceipt[]) {
  const latest = new Map<string, SeasonOutcomeReceipt>()
  for (const receipt of history) latest.set(seasonOutcomeSubjectKey(receipt.subject), receipt)
  return latest
}

export function summarizeSeasonOutcomeCandidates(history: SeasonOutcomeReceipt[]) {
  const latest = [...latestSeasonOutcomeClaims(history).values()]
  return {
    revisions: history.length, correctedSubjects: history.length - latest.length,
    candidateDnp: latest.filter(item => item.outcome === 'dnp').length,
    candidateNoGame: latest.filter(item => item.outcome === 'no_game').length,
    candidateNoDraftedPlayers: latest.filter(item => item.outcome === 'no_drafted_players').length,
    contractVerified: false as const, scoringCertified: false as const,
  }
}
