import { describe, expect, it } from 'vitest'
import { appendSeasonOutcomeReceipt, latestSeasonOutcomeClaims, readSeasonOutcomeHistory, summarizeSeasonOutcomeCandidates, type SeasonOutcomeClaim, type SeasonOutcomeScope } from '@/lib/tournament/seasonOutcomeEvidence'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'

const scope: SeasonOutcomeScope = { tournamentId: 't1', freezeId: 'f1', leagueId: 'l1', period: 1, manifestHash: 'a'.repeat(64), rulesHash: 'b'.repeat(64) }
const artifact = { game_ID: 'g1', player_box: { p1: { status: 'DNP' } } }
const source: SeasonOutcomeClaim['source'] = { provider: 'rolling_insights', reference: 'live/NBA/2026-10-20/g1', artifactDigest: seasonContractHash(artifact), observedAt: '2026-10-21T02:00:00Z', contract: 'unverified' }
const dnp: SeasonOutcomeClaim = { subject: { kind: 'player_game', providerGameId: 'g1', providerPlayerId: 'p1' }, outcome: 'dnp', source }
const at = '2026-10-21T02:01:00Z'

describe('candidate outcome evidence chain', () => {
  it('appends a revision, retries idempotently, and retains corrections without erasing the prior claim', () => {
    const first = appendSeasonOutcomeReceipt([], scope, 'capture-1', dnp, artifact, at)
    expect(first).toMatchObject({ existing: false, receipt: { revision: 1, previousDigest: null } })
    expect(appendSeasonOutcomeReceipt([first.receipt], scope, 'capture-1', dnp, artifact, at)).toEqual({ receipt: first.receipt, existing: true })
    const correctedArtifact = { game_ID: 'g1', player_box: { p1: { minutes: 1 } } }
    const played = { ...dnp, outcome: 'played' as const, source: { ...source, artifactDigest: seasonContractHash(correctedArtifact) } }
    const second = appendSeasonOutcomeReceipt([first.receipt], scope, 'capture-2', played, correctedArtifact, '2026-10-21T03:00:00Z').receipt
    const history = readSeasonOutcomeHistory([second, first.receipt], scope)
    expect(second).toMatchObject({ revision: 2, previousDigest: first.receipt.digest })
    expect(history).toHaveLength(2)
    expect([...latestSeasonOutcomeClaims(history).values()].map(row => row.outcome)).toEqual(['played'])
    expect(summarizeSeasonOutcomeCandidates(history)).toEqual({ revisions: 2, correctedSubjects: 1, candidateDnp: 0, candidateNoGame: 0, candidateNoDraftedPlayers: 0, contractVerified: false, scoringCertified: false })
  })

  it('rejects reused requests, changed scope, altered receipts and broken chains', () => {
    const first = appendSeasonOutcomeReceipt([], scope, 'capture-1', dnp, artifact, at).receipt
    expect(() => appendSeasonOutcomeReceipt([first], scope, 'capture-1', { ...dnp, outcome: 'played' }, artifact, at)).toThrow('conflicts')
    expect(() => readSeasonOutcomeHistory([first], { ...scope, period: 2 })).toThrow('frozen league scope')
    expect(() => readSeasonOutcomeHistory([{ ...first, outcome: 'played' }], scope)).toThrow('checksum')
    const second = appendSeasonOutcomeReceipt([first], scope, 'capture-2', dnp, artifact, '2026-10-21T03:00:00Z').receipt
    expect(() => readSeasonOutcomeHistory([second], scope)).toThrow('revision chain')
    expect(() => readSeasonOutcomeHistory([first, first], scope)).toThrow('revision chain')
  })

  it('requires an explicit unverified source and keeps outcomes bound to valid subjects', () => {
    expect(() => appendSeasonOutcomeReceipt([], scope, 'capture-1', { ...dnp, subject: { kind: 'player_period', playerId: 'p1' } }, artifact, at)).toThrow('does not match')
    expect(() => appendSeasonOutcomeReceipt([], scope, 'capture-1', { ...dnp, source: { ...source, contract: 'verified' as never } }, artifact, at)).toThrow('source provenance')
    expect(() => appendSeasonOutcomeReceipt([], scope, 'capture-1', { ...dnp, source: { ...source, artifactDigest: 'missing' } }, artifact, at)).toThrow('source provenance')
    expect(() => appendSeasonOutcomeReceipt([], scope, 'capture-1', dnp, { altered: true }, at)).toThrow('source artifact')
    expect(appendSeasonOutcomeReceipt([], scope, 'capture-1', { subject: { kind: 'player_period', playerId: 'canonical-p2' }, outcome: 'no_game', source }, artifact, at).receipt.outcome).toBe('no_game')
    expect(appendSeasonOutcomeReceipt([], scope, 'capture-1', { subject: { kind: 'game_period', providerGameId: 'g2' }, outcome: 'no_drafted_players', source }, artifact, at).receipt.outcome).toBe('no_drafted_players')
  })

  it('retains a JSON copy of the source artifact even if the caller later mutates its object', () => {
    const mutable = { game_ID: 'g1', status: 'final' }
    const claim = { ...dnp, source: { ...source, artifactDigest: seasonContractHash(mutable) } }
    const receipt = appendSeasonOutcomeReceipt([], scope, 'capture-1', claim, mutable, at).receipt
    mutable.status = 'changed'
    expect(receipt.artifact).toEqual({ game_ID: 'g1', status: 'final' })
    expect(readSeasonOutcomeHistory([receipt], scope)).toHaveLength(1)
  })
})
