import type { Prisma } from '@prisma/client'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import type { OpeningManifest } from './seasonNativeContract'
import { seasonContractHash } from './seasonCalendarVerification'
import { BlueprintOperationError } from './seasonBlueprintStore'

function payload(raw: unknown, manifest: OpeningManifest) {
  if (!raw || typeof raw !== 'object') throw new BlueprintOperationError('Malformed scoring receipt during start review.', 409)
  const { digest, ...value } = raw as Record<string, unknown>
  if (digest !== seasonContractHash(value) || value.manifestHash !== manifest.manifestHash || value.rulesHash !== manifest.rulesHash || value.mode !== 'locked_setup') throw new BlueprintOperationError('Scoring receipt checksum differs during start review.', 409)
  return value
}

/** Bounded, per-game audit scan. No score, lineup, or finalization record is changed. */
export async function readSeasonGameStartImpact(tx: Prisma.TransactionClient, manifest: OpeningManifest, tournamentId: string, freezeId: string, gameId: string, period: number) {
  const mappings = await tx.gameProviderIdentity.findMany({ where: { provider: 'rolling_insights', sportKey: manifest.config.sport,
    providerGameId: gameId } })
  if (mappings.length > 1 || mappings.some(row => !row.verified || !row.gameId || (row.expiresAt && row.expiresAt.getTime() <= Date.now()))) {
    throw new BlueprintOperationError('Game identity is ambiguous or expired during start review.', 409)
  }
  const canonicalGameId = mappings[0]?.gameId ?? gameId
  let lockedLeagues = 0, scoreRevisions = 0, finalizedWeeks = 0
  const locks: number[] = []
  for (const pool of manifest.leagues) {
    const leagueId = seasonResourceId(freezeId, pool.key), targetId = `${leagueId}:${period}`
    const lineup = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(freezeId, `${pool.key}:scoring-lineup:${canonicalGameId}`) } })
    if (lineup) {
      const data = payload(lineup.data, manifest)
      if (lineup.tournamentId !== tournamentId || lineup.action !== 'season_lineup_locked' || lineup.targetId !== targetId || (data.game as { gameId?: string } | undefined)?.gameId !== canonicalGameId || data.period !== period || !Array.isArray(data.lineups)) throw new BlueprintOperationError('Lineup receipt binding differs during start review.', 409)
      for (const item of data.lineups as Array<{ lockedAt?: string }>) {
        const time = Date.parse(item.lockedAt ?? '')
        if (!Number.isFinite(time)) throw new BlueprintOperationError('Lineup lock time is invalid during start review.', 409)
        locks.push(time)
      }
      lockedLeagues++
    }
    const scores = await tx.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_scores_ingested', targetId }, take: 251 })
    if (scores.length > 250) throw new BlueprintOperationError('Score history exceeds the start-review limit.', 409)
    let affected = Boolean(lineup)
    for (const event of scores) {
      const data = payload(event.data, manifest)
      const evidence = data.evidence as { games?: Array<{ gameId?: string }>; scores?: Array<{ gameId?: string }> } | undefined
      if (event.action !== 'season_scores_ingested' || event.targetId !== targetId || !evidence || !Array.isArray(evidence.games) || !Array.isArray(evidence.scores)) throw new BlueprintOperationError('Score receipt binding differs during start review.', 409)
      if (evidence.games.some(game => game.gameId === canonicalGameId) || evidence.scores.some(score => score.gameId === canonicalGameId)) { scoreRevisions++; affected = true }
    }
    if (!affected) continue
    const finals = await tx.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_week_finalized_setup', targetId }, take: 251 })
    if (finals.length > 250) throw new BlueprintOperationError('Finalization history exceeds the start-review limit.', 409)
    for (const event of finals) { payload(event.data, manifest); if (event.action !== 'season_week_finalized_setup' || event.targetId !== targetId) throw new BlueprintOperationError('Finalization receipt binding differs during start review.', 409) }
    if (finals.length) finalizedWeeks++
  }
  return { lockedLeagues, scoreRevisions, finalizedWeeks, latestLineupLockAt: locks.length ? new Date(Math.max(...locks)).toISOString() : null, receiptReviewRequired: lockedLeagues + scoreRevisions + finalizedWeeks > 0 }
}
