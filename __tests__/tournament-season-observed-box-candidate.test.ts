import { describe, expect, it } from 'vitest'
import { planSeasonObservedBoxCandidates } from '@/lib/tournament/seasonObservedBoxCandidate'
import { seasonOutcomeSubjectKey } from '@/lib/tournament/seasonOutcomeEvidence'

const game = (sport: 'NBA' | 'NFL', status = 'completed') => ({ game_ID: 'g1', sport, status, season_type: 'Regular Season',
  player_box: { away_team: { p1: { player: 'Example', status: 'ACT', points: 0 } }, home_team: { p2: { player: 'Other', status: 'ACT', points: 7 } } } })
const pair = (providerGameId: string | null, providerPlayerId: string | null) => ({ providerGameId, providerPlayerId })
const base = { sourceDate: '2026-10-11', observedAt: '2026-10-13T18:00:00Z' }

describe('bounded observed-box candidate plan', () => {
  for (const sport of ['NBA', 'NFL'] as const) it(`captures ${sport} box-line presence without calling ACT played or zero`, () => {
    const result = planSeasonObservedBoxCandidates({ ...base, sport, rawGames: new Map([['g1', game(sport)]]),
      lockedPairs: [pair('g1', 'p1'), pair('g1', 'missing'), pair(null, 'p2')] })
    expect(result).toMatchObject({ absentPlayerPairs: 1, unresolvedPairs: 1, contractVerified: false, scoringCertified: false })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.claim).toMatchObject({ outcome: 'box_line_present', source: { contract: 'unverified' } })
    expect(result.candidates[0]!.artifact).toMatchObject({ providerPlayerId: 'p1', playerLine: { points: 0, status: 'ACT' } })
    expect(JSON.stringify(result)).not.toContain('"outcome":"played"')
    expect(JSON.stringify(result)).not.toContain('"outcome":"dnp"')
  })

  it('fails closed for nonfinal, postseason and ambiguous player boxes', () => {
    const live = planSeasonObservedBoxCandidates({ ...base, sport: 'NBA', rawGames: new Map([['g1', game('NBA', 'inprogress')]]), lockedPairs: [pair('g1', 'p1')] })
    expect(live).toMatchObject({ nonFinalPairs: 1, candidates: [] })
    const post = { ...game('NBA'), season_type: 'Postseason' }
    expect(planSeasonObservedBoxCandidates({ ...base, sport: 'NBA', rawGames: new Map([['g1', post]]), lockedPairs: [pair('g1', 'p1')] })).toMatchObject({ nonFinalPairs: 1, candidates: [] })
    const duplicate = { ...game('NBA'), player_box: { away_team: { p1: { status: 'ACT' } }, home_team: { p1: { status: 'ACT' } } } }
    expect(planSeasonObservedBoxCandidates({ ...base, sport: 'NBA', rawGames: new Map([['g1', duplicate]]), lockedPairs: [pair('g1', 'p1')] })).toMatchObject({ unverifiedBoxPairs: 1, candidates: [] })
  })

  it('bounds writes and changes request identity when a source line is corrected', () => {
    const pairs = [pair('g1', 'p1'), pair('g1', 'p2')]
    const first = planSeasonObservedBoxCandidates({ ...base, sport: 'NFL', rawGames: new Map([['g1', game('NFL')]]), lockedPairs: pairs, maxCandidates: 1 })
    expect(first).toMatchObject({ deferredByLimit: 1, candidates: [expect.objectContaining({ requestId: expect.stringMatching(/^boxline-[a-f0-9]{64}$/) })] })
    const existing = first.candidates[0]!.claim
    const unchanged = planSeasonObservedBoxCandidates({ ...base, sport: 'NFL', rawGames: new Map([['g1', game('NFL')]]), lockedPairs: pairs,
      latestObservedArtifacts: new Map([[seasonOutcomeSubjectKey(existing.subject), existing.source.artifactDigest]]), maxCandidates: 1 })
    expect(unchanged).toMatchObject({ unchangedPairs: 1, deferredByLimit: 0 })
    expect(unchanged.candidates).toHaveLength(1)
    expect(unchanged.candidates[0]!.claim.subject).toMatchObject({ providerPlayerId: 'p2' })
    const corrected = game('NFL')
    corrected.player_box.away_team.p1.points = 1
    const second = planSeasonObservedBoxCandidates({ ...base, sport: 'NFL', rawGames: new Map([['g1', corrected]]), lockedPairs: pairs, maxCandidates: 1 })
    expect(second.candidates[0]!.requestId).not.toBe(first.candidates[0]!.requestId)
    expect(() => planSeasonObservedBoxCandidates({ ...base, sport: 'NFL', rawGames: new Map([['g1', game('NFL')]]), lockedPairs: [pair('g1', 'p1'), pair('g1', 'p1')] })).toThrow('Duplicate locked')
    expect(() => planSeasonObservedBoxCandidates({ ...base, sport: 'NFL', rawGames: new Map([['g1', game('NFL')]]), lockedPairs: pairs, maxCandidates: 51 })).toThrow('bounded input')
  })

  it('does not downgrade an existing explicit outcome to a weaker box-line observation', () => {
    const subject = seasonOutcomeSubjectKey({ kind: 'player_game', providerGameId: 'g1', providerPlayerId: 'p1' })
    const result = planSeasonObservedBoxCandidates({ ...base, sport: 'NBA', rawGames: new Map([['g1', game('NBA')]]),
      lockedPairs: [pair('g1', 'p1'), pair('g1', 'p2')], suppressedSubjects: new Set([subject]) })
    expect(result).toMatchObject({ suppressedPairs: 1, candidates: [expect.objectContaining({ claim: expect.objectContaining({ subject: { kind: 'player_game', providerGameId: 'g1', providerPlayerId: 'p2' } }) })] })
  })
})
