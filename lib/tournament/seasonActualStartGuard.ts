import type { Prisma } from '@prisma/client'
import { seasonContractHash } from './seasonCalendarVerification'
import { assessSeasonActualStart, type GameStartObservation } from './seasonActualStartEvidence'
import { BlueprintOperationError } from './seasonBlueprintStore'

type StartContext = {
  tournamentId: string
  manifestHash: string
  rulesHash: string
  sport: 'NFL' | 'NBA'
  periodStartsAt: string
  periodEndsAt: string
}
type LockedGame = { gameId: string; actualStartsAt: string; lineups: Array<{ lockedAt: string }> }

/** Saved vendor observations can veto a claimed start; they never create an exact timestamp. */
export async function assertSeasonObservedStartsConsistent(tx: Prisma.TransactionClient, context: StartContext, games: LockedGame[]) {
  const registry = await tx.gameProviderIdentity.findMany({ where: { provider: 'rolling_insights', sportKey: context.sport,
    gameId: { in: games.map(game => game.gameId) } } })
  for (const game of games) {
    const mappings = registry.filter(row => row.gameId === game.gameId)
    if (mappings.length > 1 || mappings.some(row => !row.verified || !row.providerGameId || (row.expiresAt && row.expiresAt.getTime() <= Date.now()))) {
      throw new BlueprintOperationError(`Game ${game.gameId} has an ambiguous or expired start-evidence identity. Correction review is required.`, 409)
    }
    const providerGameId = mappings[0]?.providerGameId ?? game.gameId
    const rows = await tx.tournamentAuditLog.findMany({
      where: { tournamentId: context.tournamentId, action: 'season_game_start_observed', targetId: providerGameId },
      take: 101,
    })
    if (!rows.length) continue // Older locked-setup receipts remain provisional, never launch-certified.
    if (rows.length > 100) throw new BlueprintOperationError('Game-start observation history exceeds its limit. Correction review is required.', 409)
    const observations: GameStartObservation[] = rows.map(row => {
      if (!row.data || typeof row.data !== 'object') throw new BlueprintOperationError('Malformed game-start receipt. Correction review is required.', 409)
      const { digest, ...payload } = row.data as Record<string, unknown>
      if (row.action !== 'season_game_start_observed' || row.targetId !== providerGameId || payload.version !== 1 ||
        payload.manifestHash !== context.manifestHash || payload.rulesHash !== context.rulesHash ||
        digest !== seasonContractHash(payload)) throw new BlueprintOperationError('Game-start receipt binding differs. Correction review is required.', 409)
      return {
        providerGameId: payload.providerGameId as string, sport: payload.sport as 'NFL' | 'NBA',
        state: payload.state as GameStartObservation['state'], observedAt: payload.observedAt as string,
        scheduledAt: payload.scheduledAt as string | null, rawDigest: payload.rawDigest as string,
      }
    })
    const locks = game.lineups.map(lineup => Date.parse(lineup.lockedAt))
    if (!locks.length || locks.some(lock => !Number.isFinite(lock))) throw new BlueprintOperationError('Game lineup locks need correction review.', 409)
    const latestLineupLockAt = new Date(Math.max(...locks)).toISOString()
    const result = assessSeasonActualStart(observations, {
      providerGameId, sport: context.sport,
      periodStartsAt: context.periodStartsAt, periodEndsAt: context.periodEndsAt,
      lineupLockedAt: latestLineupLockAt,
    })
    if (!result.verifiedWindow || !result.startAfter || !result.startedBy) throw new BlueprintOperationError(`Game ${game.gameId} needs start/correction review: ${result.reason}`, 409)
    const claimed = Date.parse(game.actualStartsAt)
    if (!Number.isFinite(claimed) || claimed <= Date.parse(result.startAfter) || claimed > Date.parse(result.startedBy)) {
      throw new BlueprintOperationError(`Game ${game.gameId} claims an actual start outside the observed window. Correction review is required.`, 409)
    }
  }
}
