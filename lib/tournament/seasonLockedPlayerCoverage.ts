import { classifyRiLiveStartState } from './seasonActualStartEvidence'
import { readMeasuredNbaPlayerBoxIds } from './seasonPeriodBoxAudit'

export type LockedProviderPair = { providerGameId: string | null; providerPlayerId: string | null }

type PlayerIdentity = { playerId: string | null; providerPlayerId: string; expiresAt: Date | null }
type GameIdentity = { gameId: string | null; providerGameId: string; expiresAt: Date | null }

/** Keep the canonical receipt ID alongside its unique current provider ID. */
export function resolveSeasonLockedProviderGames(input: {
  frames: Array<{ gameId: string }>; gameIdentities: GameIdentity[]; now: Date
}): Array<{ gameId: string; providerGameId: string | null }> {
  return [...new Set(input.frames.map(frame => frame.gameId))].map(gameId => {
    const matches = input.gameIdentities.filter(row => row.gameId === gameId &&
      (!row.expiresAt || row.expiresAt.getTime() > input.now.getTime()))
    const providerGameId = matches.length === 1 ? matches[0]!.providerGameId : null
    return { gameId, providerGameId: providerGameId &&
      input.gameIdentities.filter(row => row.providerGameId === providerGameId).length === 1 ? providerGameId : null }
  })
}

/** Only one current identity in each direction can resolve a frozen receipt ID. */
export function resolveSeasonLockedProviderPairs(input: {
  frames: Array<{ gameId: string; playerIds: string[] }>; playerIdentities: PlayerIdentity[]; gameIdentities: GameIdentity[]; now: Date
}): { lockedGames: number; pairs: LockedProviderPair[] } {
  const current = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() > input.now.getTime()
  const player = (id: string) => {
    const matches = input.playerIdentities.filter(row => row.playerId === id && current(row.expiresAt))
    if (matches.length !== 1) return null
    const providerId = matches[0]!.providerPlayerId
    return providerId && input.playerIdentities.filter(row => row.providerPlayerId === providerId).length === 1 ? providerId : null
  }
  const games = resolveSeasonLockedProviderGames(input)
  return { lockedGames: input.frames.length, pairs: input.frames.flatMap(frame => frame.playerIds.map(id => ({
    providerGameId: games.find(game => game.gameId === frame.gameId)?.providerGameId ?? null, providerPlayerId: player(id) }))) }
}

/** Compare one locked league against one fetched period. Absence is unresolved, never zero. */
export function compareSeasonLockedPlayerCoverage(input: {
  sport: 'NBA' | 'NFL'; lockedGames: number; pairs: LockedProviderPair[]; rawGames: Map<string, Record<string, unknown>>
  publishedGameIds?: string[]; futureGameIds?: string[]; draftedPlayers?: number; draftedPlayersWithoutLockedGame?: number
}) {
  const published = new Set(input.publishedGameIds ?? [])
  const future = new Set(input.futureGameIds ?? [])
  const boundGames = new Set(input.pairs.map(pair => pair.providerGameId).filter((id): id is string => Boolean(id)))
  const result = { lockedGames: input.lockedGames, lockedPlayerGamePairs: input.pairs.length, matchedPairs: 0,
    unresolvedIdentityPairs: 0, missingGamePairs: 0, unverifiedBoxPairs: 0, absentFinalPlayerPairs: 0,
    pendingPlayerPairs: 0, scheduledFuturePlayerPairs: 0, boxContractMeasured: input.sport === 'NBA', scoringCertified: false as const,
    publishedGames: published.size, publishedGamesPending: [...published].filter(id => future.has(id)).length,
    publishedGameRowsMissing: [...published].filter(id => !future.has(id) && !input.rawGames.has(id)).length,
    publishedGamesWithoutLockedReceipt: [...published].filter(id => !future.has(id) && !boundGames.has(id)).length,
    lockedGamesOutsidePublication: [...boundGames].filter(id => !published.has(id)).length,
    draftedPlayers: input.draftedPlayers ?? 0, draftedPlayersWithoutLockedGame: input.draftedPlayersWithoutLockedGame ?? 0,
    explicitDnpOutcomes: 0, completeGameAndPlayerCoverageVerified: false as const }
  const boxCache = new Map<string, Set<string> | null>()
  for (const pair of input.pairs) {
    if (!pair.providerGameId || !pair.providerPlayerId) { result.unresolvedIdentityPairs++; continue }
    if (future.has(pair.providerGameId)) { result.scheduledFuturePlayerPairs++; continue }
    const raw = input.rawGames.get(pair.providerGameId)
    if (!raw) { result.missingGamePairs++; continue }
    if (input.sport !== 'NBA') { result.unverifiedBoxPairs++; continue }
    if (!boxCache.has(pair.providerGameId)) boxCache.set(pair.providerGameId, readMeasuredNbaPlayerBoxIds(raw))
    const ids = boxCache.get(pair.providerGameId)
    if (!ids) { result.unverifiedBoxPairs++; continue }
    if (ids.has(pair.providerPlayerId)) result.matchedPairs++
    else if (classifyRiLiveStartState(raw.status ?? raw.game_status) === 'final') result.absentFinalPlayerPairs++
    else result.pendingPlayerPairs++
  }
  return result
}
