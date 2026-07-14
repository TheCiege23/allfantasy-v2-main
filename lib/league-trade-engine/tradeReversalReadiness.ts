export type TradeReversalBlocker = { code: 'MISSING_EXECUTION_SNAPSHOT' | 'PLAYER_ALREADY_MOVED' | 'PLAYER_DROPPED' | 'FAAB_ALREADY_SPENT' | 'IDP_CAP_DEPENDENCY' | 'DEPENDENT_TRANSACTION_EXISTS' | 'DRAFT_ASSET_ALREADY_MOVED' | 'SCORING_PERIOD_FINALIZED' | 'PLAYOFF_RESULT_FINALIZED' | 'CROSS_SEASON_REVERSAL_BLOCKED' | 'SNAPSHOT_INCOMPLETE'; message: string; playerId?: string; relatedTransactionId?: string }

type SnapshotPlayer = { playerId: string; rosterId: string; droppedAt?: string | Date | null }
type SnapshotRoster = { id: string; faabBalance: number | null }
type SnapshotSalary = { id: string; playerId: string; rosterId: string }

export type ReversalEvidenceSnapshot = {
  id: string
  completeness: string
  seasonId: string | null
  beforeState: { players?: SnapshotPlayer[]; rosters?: SnapshotRoster[]; idpSalaries?: SnapshotSalary[] }
  afterState: { players?: SnapshotPlayer[]; rosters?: SnapshotRoster[]; idpSalaries?: SnapshotSalary[] }
}

export function evaluateTradeReversalReadiness(input: {
  snapshot: ReversalEvidenceSnapshot | null
  currentSeasonId: string
  currentPlayers: SnapshotPlayer[]
  currentRosters: SnapshotRoster[]
  currentIdpSalaries: SnapshotSalary[]
  scoringPeriodFinalized?: boolean
  playoffResultFinalized?: boolean
}): { reversible: boolean; snapshotId: string | null; blockers: TradeReversalBlocker[]; warnings: Array<{ code: string; message: string }> } {
  if (!input.snapshot) return { reversible: false, snapshotId: null, blockers: [{ code: 'MISSING_EXECUTION_SNAPSHOT', message: 'Immutable trade execution evidence is unavailable.' }], warnings: [] }
  const blockers: TradeReversalBlocker[] = []
  const snapshot = input.snapshot
  if (snapshot.completeness !== 'complete') blockers.push({ code: 'SNAPSHOT_INCOMPLETE', message: 'Execution evidence is not complete enough for deterministic restoration.' })
  if (snapshot.seasonId !== input.currentSeasonId) blockers.push({ code: 'CROSS_SEASON_REVERSAL_BLOCKED', message: 'Trade reversal cannot cross a season boundary.' })
  if (input.scoringPeriodFinalized) blockers.push({ code: 'SCORING_PERIOD_FINALIZED', message: 'A finalized scoring period depends on the completed trade.' })
  if (input.playoffResultFinalized) blockers.push({ code: 'PLAYOFF_RESULT_FINALIZED', message: 'A finalized playoff result depends on the completed trade.' })

  const currentPlayers = new Map(input.currentPlayers.map((row) => [row.playerId, row]))
  for (const expected of snapshot.afterState.players ?? []) {
    const current = currentPlayers.get(expected.playerId)
    if (!current || current.droppedAt) blockers.push({ code: 'PLAYER_DROPPED', message: 'A traded player is no longer active on a roster.', playerId: expected.playerId })
    else if (current.rosterId !== expected.rosterId) blockers.push({ code: 'PLAYER_ALREADY_MOVED', message: 'A traded player moved after execution.', playerId: expected.playerId })
  }
  const currentRosters = new Map(input.currentRosters.map((row) => [row.id, row.faabBalance ?? 0]))
  for (const expected of snapshot.afterState.rosters ?? []) {
    if (currentRosters.get(expected.id) !== (expected.faabBalance ?? 0)) blockers.push({ code: 'FAAB_ALREADY_SPENT', message: 'A franchise FAAB balance changed after execution.' })
  }
  const currentSalaries = new Map(input.currentIdpSalaries.map((row) => [row.id, row]))
  for (const expected of snapshot.afterState.idpSalaries ?? []) {
    if (currentSalaries.get(expected.id)?.rosterId !== expected.rosterId) blockers.push({ code: 'IDP_CAP_DEPENDENCY', message: 'IDP salary ownership changed after execution.', playerId: expected.playerId })
  }
  return { reversible: blockers.length === 0, snapshotId: snapshot.id, blockers, warnings: [] }
}
