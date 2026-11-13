export type SeasonReportRow = {
  entrantId: string
  leagueId: string
  manager: string
  rank: number | null
  leagueRank: number | null
  divisionRank: number | null
  seedMovement: number | null
  weekPoints: number | null
  weekAgainst: number | null
  pointsFor: number | null
  pointsAgainst: number | null
  wins: number
  losses: number
  ties: number
  missing: number
  standing: 'Awaiting scores' | 'In' | 'Bubble' | 'Out' | 'Under review' | 'Alive' | 'Advanced' | 'Eliminated' | 'Champion'
  reason: string
}

export type SeasonReportLeague = { id: string; key: string; name: string; division: string | null }
export type SeasonReportSnapshot = {
  schemaVersion: 1
  stage: number
  period: number
  revision: number
  status: 'provisional' | 'corrected' | 'final'
  official?: boolean
  previousId: string | null
  decisionId: string | null
  tournamentName: string
  manifestHash: string
  contentHash: string
  leagues: SeasonReportLeague[]
  rows: SeasonReportRow[]
}
export type SeasonReport = SeasonReportSnapshot & { id: string; publishedAt: string }
export type SeasonReportVersion = Pick<SeasonReport, 'id' | 'stage' | 'period' | 'revision' | 'status' | 'official' | 'previousId' | 'publishedAt'>
export type SeasonReportView = SeasonReportVersion & Pick<SeasonReport, 'decisionId' | 'leagues'> & {
  rows: Omit<SeasonReportRow, 'entrantId'>[]
  summary: string
}

export function seasonReportPath(tournamentId: string, reportId?: string) {
  return '/api/tournament/' + encodeURIComponent(tournamentId) + '/season-reports'
    + (reportId ? '?reportId=' + encodeURIComponent(reportId) : '')
}

export function seasonReportCsvPath(tournamentId: string, reportId: string, leagueId?: string) {
  return seasonReportPath(tournamentId, reportId) + '&format=csv' + (leagueId ? '&leagueId=' + encodeURIComponent(leagueId) : '')
}

export function seasonReportCsv(report: SeasonReport, rows: SeasonReportRow[]) {
  const leagues = new Map(report.leagues.map(league => [league.id, league]))
  const cells: (string | number | null)[][] = [[
    'Report ID', 'Revision', 'Status', 'Supersedes', 'Published (UTC)', 'Stage', 'Period', 'Decision ID',
    'Division', 'League', 'Manager', 'Tournament rank or bracket seed', 'League rank', 'Division rank', 'Rank movement',
    'Wins', 'Losses', 'Ties', 'Period points', 'Period points against', 'Stage points', 'Stage points against', 'Missing periods', 'Standing', 'Reason', 'Finalized',
  ], ...rows.map(row => [
    report.id, report.revision, report.status, report.previousId, report.publishedAt, report.stage, report.period, report.decisionId,
    leagues.get(row.leagueId)?.division ?? null, leagues.get(row.leagueId)?.name ?? null, row.manager, row.rank, row.leagueRank, row.divisionRank, row.seedMovement,
    row.wins, row.losses, row.ties, row.weekPoints, row.weekAgainst, row.pointsFor, row.pointsAgainst, row.missing, row.standing, row.reason, report.status === 'final' || report.official ? 'Yes' : 'No',
  ])]
  const escape = (value: string | number | null) => {
    if (value === null) return ''
    if (typeof value === 'number') return String(value)
    const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  return cells.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n'
}

export function seasonReportSummary(rows: SeasonReportRow[]) {
  const counts = new Map<SeasonReportRow['standing'], number>()
  for (const row of rows) counts.set(row.standing, (counts.get(row.standing) ?? 0) + 1)
  return [...counts].map(([standing, count]) => count + ' ' + standing.toLowerCase()).join(' · ')
}
