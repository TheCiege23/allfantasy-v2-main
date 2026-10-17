import { seasonContractHash } from './seasonCalendarVerification'
import { seasonStatBatchSchema, type SeasonStatBatch } from './seasonStatAdapter'

type Game = SeasonStatBatch['games'][number]
type Row = Game['rows'][number]
export type SeasonStatReconciliation = {
  version: 1
  previousSnapshotDigest: string | null
  snapshotDigest: string
  baselineRows: number
  correctedRows: number
  backfilledRows: number
  statusChangedGames: number
  versionAdvancedRows: number
}

function normalized(input: SeasonStatBatch) {
  return {
    provider: input.provider, format: input.format, period: input.period, coverage: input.coverage,
    games: input.games.map(game => ({
      providerGameId: game.providerGameId, actualStartsAt: game.actualStartsAt,
      seasonType: game.seasonType, status: game.status,
      rows: [...game.rows].sort((a, b) => a.providerPlayerId.localeCompare(b.providerPlayerId)),
    })).sort((a, b) => a.providerGameId.localeCompare(b.providerGameId)),
  }
}
function index(input: SeasonStatBatch) {
  const games = new Map<string, Game>()
  for (const game of input.games) {
    if (games.has(game.providerGameId)) throw new Error('Duplicate game in full-period stat snapshot.')
    games.set(game.providerGameId, game)
    if (new Set(game.rows.map(row => row.providerPlayerId)).size !== game.rows.length) throw new Error('Duplicate player in full-period stat snapshot.')
  }
  return games
}
function rows(game: Game) { return new Map<string, Row>(game.rows.map(row => [row.providerPlayerId, row])) }

/** Compare two full current-period snapshots. Never infer a deleted result to be zero. */
export function reconcileSeasonStatSnapshots(previousRaw: unknown, currentRaw: unknown): SeasonStatReconciliation {
  const current = seasonStatBatchSchema.parse(currentRaw)
  const currentGames = index(current)
  const currentDigest = seasonContractHash(normalized(current))
  if (previousRaw == null) return {
    version: 1, previousSnapshotDigest: null, snapshotDigest: currentDigest,
    baselineRows: current.games.reduce((sum, game) => sum + game.rows.length, 0),
    correctedRows: 0, backfilledRows: 0, statusChangedGames: 0, versionAdvancedRows: 0,
  }
  const previous = seasonStatBatchSchema.parse(previousRaw)
  const previousGames = index(previous)
  if (previous.provider !== current.provider || previous.format !== current.format || previous.period !== current.period) throw new Error('Provider snapshot source or scoring period changed. Reconciliation is required.')
  if (previous.coverage === 'complete' && current.coverage !== 'complete') throw new Error('Complete provider coverage cannot be downgraded silently.')
  let correctedRows = 0, backfilledRows = 0, statusChangedGames = 0, versionAdvancedRows = 0
  for (const [gameId, before] of previousGames) {
    const after = currentGames.get(gameId)
    if (!after) throw new Error('A previously observed game vanished from the full-period provider snapshot.')
    if (before.actualStartsAt !== after.actualStartsAt || before.seasonType !== after.seasonType) throw new Error('A game start or season classification changed. Schedule correction review is required.')
    const changedStatus = before.status !== after.status
    if (changedStatus) statusChangedGames++
    const newer = rows(after)
    for (const [playerId, oldRow] of rows(before)) {
      const row = newer.get(playerId)
      if (!row) throw new Error('A previously observed player result vanished from the full-period provider snapshot.')
      if (row.revision < oldRow.revision) throw new Error('A provider player revision moved backward.')
      const changed = changedStatus || seasonContractHash(oldRow.stats) !== seasonContractHash(row.stats)
      if (changed && row.revision <= oldRow.revision) throw new Error('Changed provider stats or game finality require a newer player revision.')
      if (changed) correctedRows++
      if (row.revision > oldRow.revision) versionAdvancedRows++
    }
  }
  for (const [gameId, after] of currentGames) {
    const before = previousGames.get(gameId)
    if (!before) { backfilledRows += after.rows.length; continue }
    const oldRows = rows(before)
    backfilledRows += after.rows.filter(row => !oldRows.has(row.providerPlayerId)).length
  }
  return {
    version: 1, previousSnapshotDigest: seasonContractHash(normalized(previous)), snapshotDigest: currentDigest,
    baselineRows: previous.games.reduce((sum, game) => sum + game.rows.length, 0),
    correctedRows, backfilledRows, statusChangedGames, versionAdvancedRows,
  }
}
