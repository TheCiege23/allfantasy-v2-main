import { describe, expect, it } from 'vitest'
import { compareSeasonLockedPlayerCoverage, resolveSeasonLockedProviderGames, resolveSeasonLockedProviderPairs } from '@/lib/tournament/seasonLockedPlayerCoverage'

const raw = (status: string) => ({ status, player_box: { away_team: { p1: { points: 0 } }, home_team: { p2: { points: 0 } } } })
const pair = (providerGameId: string | null, providerPlayerId: string | null) => ({ providerGameId, providerPlayerId })

describe('locked league player/game coverage preview', () => {
  it('retains canonical-to-provider bindings and rejects ambiguous or expired matches', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    expect(resolveSeasonLockedProviderGames({ frames: [{ gameId: 'canonical-g1' }, { gameId: 'canonical-g2' }, { gameId: 'canonical-g3' }],
      gameIdentities: [
        { gameId: 'canonical-g1', providerGameId: 'ri-g1', expiresAt: null },
        { gameId: 'canonical-g2', providerGameId: 'ri-g2', expiresAt: new Date('2026-10-19T00:00:00Z') },
        { gameId: 'canonical-g3', providerGameId: 'ri-g1', expiresAt: null },
      ], now })).toEqual([
      { gameId: 'canonical-g1', providerGameId: null },
      { gameId: 'canonical-g2', providerGameId: null },
      { gameId: 'canonical-g3', providerGameId: null },
    ])
  })
  it('uses unique current verified registry rows and leaves ambiguous or expired IDs unresolved', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    const frames = [{ gameId: 'canonical-g1', playerIds: ['canonical-p1', 'canonical-p2', 'canonical-p3'] }]
    const playerIdentities = [
      { playerId: 'canonical-p1', providerPlayerId: 'ri-p1', expiresAt: null },
      { playerId: 'canonical-p2', providerPlayerId: 'ri-p2', expiresAt: new Date('2026-10-19T00:00:00Z') },
      { playerId: 'canonical-p3', providerPlayerId: 'ri-p3', expiresAt: null },
      { playerId: 'other', providerPlayerId: 'ri-p3', expiresAt: null },
    ]
    expect(resolveSeasonLockedProviderPairs({ frames, playerIdentities, gameIdentities: [{ gameId: 'canonical-g1', providerGameId: 'ri-g1', expiresAt: null }], now })).toEqual({
      lockedGames: 1, pairs: [pair('ri-g1', 'ri-p1'), pair('ri-g1', null), pair('ri-g1', null)],
    })
  })
  it('separates matched, absent final, missing game, and unresolved identities without scoring zero', () => {
    const report = compareSeasonLockedPlayerCoverage({ sport: 'NBA', lockedGames: 2,
      pairs: [pair('g1', 'p1'), pair('g1', 'p3'), pair('g2', 'p2'), pair(null, 'p1'), pair('g1', null)],
      rawGames: new Map([['g1', raw('final')]]), publishedGameIds: ['g1', 'g2', 'g3'], draftedPlayers: 6, draftedPlayersWithoutLockedGame: 1 })
    expect(report).toMatchObject({ lockedGames: 2, lockedPlayerGamePairs: 5, matchedPairs: 1, absentFinalPlayerPairs: 1,
      missingGamePairs: 1, unresolvedIdentityPairs: 2, pendingPlayerPairs: 0, scoringCertified: false,
      publishedGames: 3, publishedGamesPending: 0, publishedGameRowsMissing: 2, publishedGamesWithoutLockedReceipt: 1,
      draftedPlayers: 6, draftedPlayersWithoutLockedGame: 1, explicitDnpOutcomes: 0, completeGameAndPlayerCoverageVerified: false })
  })
  it('treats an absent player during live play as pending and an invalid box as unverified', () => {
    const pending = compareSeasonLockedPlayerCoverage({ sport: 'NBA', lockedGames: 1, pairs: [pair('g1', 'p3')], rawGames: new Map([['g1', raw('inprogress')]]) })
    expect(pending).toMatchObject({ pendingPlayerPairs: 1, absentFinalPlayerPairs: 0 })
    const invalid = compareSeasonLockedPlayerCoverage({ sport: 'NBA', lockedGames: 1, pairs: [pair('g1', 'p1')], rawGames: new Map([['g1', { status: 'final', player_box: { away_team: { p1: {} }, home_team: { p1: {} } } }]]) })
    expect(invalid).toMatchObject({ unverifiedBoxPairs: 1, matchedPairs: 0 })
  })
  it('keeps scheduled future games and player pairs pending rather than missing', () => {
    const result = compareSeasonLockedPlayerCoverage({ sport: 'NBA', lockedGames: 1, pairs: [pair('g2', 'p2')], rawGames: new Map(),
      publishedGameIds: ['g1', 'g2'], futureGameIds: ['g2'], draftedPlayers: 1, draftedPlayersWithoutLockedGame: 0 })
    expect(result).toMatchObject({ publishedGames: 2, publishedGamesPending: 1, publishedGameRowsMissing: 1,
      publishedGamesWithoutLockedReceipt: 1, scheduledFuturePlayerPairs: 1, missingGamePairs: 0, scoringCertified: false })
  })
  it('does not interpret NBA box shape as verified NFL player coverage', () => {
    expect(compareSeasonLockedPlayerCoverage({ sport: 'NFL', lockedGames: 1, pairs: [pair('g1', 'p1')], rawGames: new Map([['g1', raw('final')]]) })).toMatchObject({ boxContractMeasured: false, unverifiedBoxPairs: 1, matchedPairs: 0 })
  })
})
