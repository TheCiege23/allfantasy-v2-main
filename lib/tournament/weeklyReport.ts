import type { StandingsBoard } from './standingsBoard'

export type WeeklyResult = { leagueId: string; rosterId: string; pointsFor: number; updatedAt: Date | string }
export type ReportSheet = { name: string; rows: Array<Array<string | number>> }
export type WeeklyReport = { season: number; week: number; sheets: ReportSheet[] }

/** Flatten every conference; missing scores stay blank, never zero. */
export function buildWeeklyReport(
  board: StandingsBoard,
  season: number,
  week: number,
  leagueSources: Array<{ id: string; platformLeagueId: string | null }>,
  results: WeeklyResult[],
): WeeklyReport {
  const sources = new Map(leagueSources.map((l) => [l.id, l.platformLeagueId]))
  const scores = new Map(results.map((r) => [`${r.leagueId}:${r.rosterId}`, r]))
  const managers: ReportSheet['rows'] = [['Conference', 'League', 'Manager', 'Status today', 'Conference rank today', 'Record today', 'Season points today', `Week ${week} points`, 'Weekly score updated', 'Standings updated']]
  const leaders: Array<{ name: string; league: string; conference: string; points: number }> = []
  const coverage: ReportSheet['rows'] = [['Conference', 'League', 'Managers', 'Weekly scores available', 'Missing weekly scores']]
  for (const conf of board.conferences) {
    for (const league of conf.leagues) {
      let available = 0
      for (const row of league.rows) {
        const source = league.leagueId ? sources.get(league.leagueId) : null
        const score = !row.unmatched && source && row.externalRosterId
          ? scores.get(`${source}:${row.externalRosterId}`) : undefined
        const points = score && Number.isFinite(score.pointsFor) ? score.pointsFor : null
        if (points != null) {
          available++
          leaders.push({ name: row.displayName, league: league.name, conference: conf.name, points })
        }
        managers.push([conf.name, league.name, row.displayName,
          row.unmatched ? 'Needs team link' : row.standing === 'in' ? 'Above cut' : row.standing === 'bubble' ? 'Bubble' : 'Below cut',
          row.unmatched ? '' : row.conferenceRank,
          row.unmatched ? '' : `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ''}`,
          row.unmatched ? '' : row.pointsFor, points ?? '',
          score ? new Date(score.updatedAt).toISOString() : 'Not collected',
          league.oldestUpdatedAt ? new Date(league.oldestUpdatedAt).toISOString() : 'Unknown'])
      }
      coverage.push([conf.name, league.name, league.rows.length, available, league.rows.length - available])
    }
  }
  leaders.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  return { season, week, sheets: [
    { name: 'Manager status', rows: managers },
    { name: 'Weekly top scorers', rows: [['Rank', 'Manager', 'League', 'Conference', `Week ${week} points`], ...leaders.slice(0, 25).map((r, i) => [i + 1, r.name, r.league, r.conference, r.points])] },
    { name: 'Coverage', rows: coverage },
    { name: 'Report notes', rows: [
      ['Tournament', board.name], ['Season', season], ['Scoring week', week], ['Round', board.roundNumber],
      ['Standings', 'Current synced standings and cut status; not historical standings for the selected week.'],
      ['Weekly points', 'As last collected from each host league. Scores may be in progress. Blank means unavailable.'],
      ['Comparison', 'Each league uses its own scoring settings. Top scorers include only managers with collected weekly scores.'],
    ] },
  ] }
}

export function reportTsv(report: WeeklyReport): string {
  const safe = (v: string | number) => {
    if (typeof v === 'number') return String(v)
    const text = v.replace(/[\t\r\n]/g, ' ')
    return /^\s*[=+@-]/.test(text) ? `'${text}` : text
  }
  return report.sheets.map((s) => [s.name, ...s.rows.map((r) => r.map(safe).join('\t'))].join('\n')).join('\n\n')
}
