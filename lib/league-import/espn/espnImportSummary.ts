/**
 * What an ESPN import brought in, as rows the results screen can render: "Teams 12 ✓, Draft —
 * not available (ESPN did not return draft data)". Built from the normalized result's own counts
 * and coverage buckets, so it reports what was actually persisted rather than what we asked for.
 *
 * Pure: no fetch, no prisma. Safe to import from a route or a test.
 */

import type { ImportCoverageBucket, ImportCoverageState, NormalizedImportResult } from '@/lib/league-import/types'

export type EspnImportSummaryRow = {
  key: 'teams' | 'rosters' | 'settings' | 'scoring' | 'schedule' | 'draft' | 'transactions' | 'history'
  label: string
  count: number | null
  state: ImportCoverageState
  note: string | null
}

function row(
  key: EspnImportSummaryRow['key'],
  label: string,
  count: number | null,
  bucket: ImportCoverageBucket | undefined,
  fallbackState: ImportCoverageState,
): EspnImportSummaryRow {
  return {
    key,
    label,
    count,
    state: bucket?.state ?? fallbackState,
    note: bucket?.note?.trim() || null,
  }
}

export function buildEspnImportSummary(normalized: Pick<
  NormalizedImportResult,
  'rosters' | 'schedule' | 'draft_picks' | 'transactions' | 'coverage' | 'scoring' | 'previous_seasons'
>): EspnImportSummaryRow[] {
  const c = normalized.coverage
  const rosters = normalized.rosters ?? []
  const playerCount = rosters.reduce((n, r) => n + (Array.isArray(r.player_ids) ? r.player_ids.length : 0), 0)
  const weeks = new Set((normalized.schedule ?? []).map((m) => m.week)).size
  return [
    row('teams', 'Teams & owners', rosters.length, c?.currentStandings, rosters.length ? 'full' : 'missing'),
    row('rosters', 'Rosters & lineups', playerCount, c?.currentRosters, playerCount ? 'full' : 'missing'),
    row('settings', 'League settings', null, c?.leagueSettings, 'full'),
    row('scoring', 'Scoring rules', normalized.scoring?.rules?.length ?? 0, c?.scoringSettings, normalized.scoring ? 'full' : 'missing'),
    row('schedule', 'Schedule & weekly scores', weeks, c?.currentSchedule, weeks ? 'full' : 'missing'),
    row('draft', 'Draft & keepers', normalized.draft_picks?.length ?? 0, c?.draftHistory, normalized.draft_picks?.length ? 'full' : 'missing'),
    row('transactions', 'Transactions', normalized.transactions?.length ?? 0, c?.tradeHistory, 'partial'),
    row('history', 'Past seasons', normalized.previous_seasons?.length ?? 0, c?.previousSeasons, normalized.previous_seasons?.length ? 'partial' : 'missing'),
  ]
}
