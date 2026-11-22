import type { buildProjectionCoverageReport } from './projectionCoverageReport'

type Report = Awaited<ReturnType<typeof buildProjectionCoverageReport>>

const labels: Record<string, string> = {
  checked: 'Active weekly slate',
  no_regular_week: 'Outside regular-season slate',
  week_unresolved: 'Weekly slate unavailable',
  no_rostered_league: 'No rostered league in sample',
  category_leagues_only: 'Category scoring in sample',
  read_failed: 'Read failed',
  projected: 'Projected',
  no_game_this_week: 'Zero scheduled games',
  no_nba_roster: 'Verified scoring baseline with no current NBA roster assignment',
  weekly_schedule_missing: 'Per-game rate available, weekly schedule missing',
  stored_projection_missing_on_board: 'Stored AF projection missing from league board',
  verified_stats_without_projection: 'Verified stats available, AF projection missing',
  identity_missing: 'Roster identity missing',
  identity_ambiguous: 'Roster identity ambiguous',
  roster_id_space_unsupported: 'Roster ID space unavailable for this check',
  one_verified_game: 'One verified scoring appearance',
  prior_baseline_without_current_sample: 'Prior-season baseline with insufficient current evidence',
  no_verified_scoring_sample: 'No verified scoring sample found',
}

function md(value: unknown) {
  return String(value ?? '—').replace(/[|\r\n<>]/g, ' ')
}

export function formatProjectionCoverage(report: Report): string {
  const out = [
    '# AF projection coverage',
    '',
    'Generated ' + report.generatedAt,
    '',
    'The report checks up to one points league per sport, 400 rostered athletes per league, and six name-based Chimmy lookups per league. Counts describe the selected rosters. A blank weekly count indicates that a regular-season week could not be checked.',
    '',
    '| Sport | Platform | Season | Week | Roster checked | Weekly | Full season | Latest stored baselines | Evidence to review | Reader disagreements | Chimmy sample | State |',
    '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|',
  ]
  for (const sport of report.sports) {
    const { players } = sport
    const week = 'week' in sport ? sport.week : null
    const lineupUnavailable = 'lineupAvailable' in sport && week != null && !sport.lineupAvailable
    out.push('| ' + [
      sport.sport, 'platform' in sport ? sport.platform : null, 'season' in sport ? sport.season : null, week,
      'rosterSize' in sport ? players.length + '/' + sport.rosterSize : null,
      week != null ? players.filter(p => p.points.weekly != null).length : null,
      'season' in sport ? players.filter(p => p.points.fullSeason != null).length : null,
      sport.inventory ? sport.inventory.rows.toLocaleString('en-US') + ' (' + sport.inventory.season + ')' : null,
      'season' in sport ? players.filter(p => p.needsProjectionReview).length : null,
      'season' in sport ? players.filter(p => p.mismatches.length).length : null,
      'season' in sport ? players.filter(p => p.chimmy?.state === 'read').length + '/' + players.filter(p => p.chimmy).length : null,
      labels[sport.state] + (lineupUnavailable ? ' · Roster reader unavailable' : ''),
    ].map(md).join(' | ') + ' |')
  }
  for (const sport of report.sports) {
    const counts = new Map<string, number>()
    for (const player of sport.players) counts.set(player.reason, (counts.get(player.reason) ?? 0) + 1)
    if (!counts.size) continue
    out.push('', '## ' + sport.sport, '')
    if ('boardNote' in sport && sport.boardNote) out.push(md(sport.boardNote), '')
    for (const [reason, count] of counts) out.push('- ' + (labels[reason] ?? reason) + ' — ' + count)
    const issues = sport.players.filter(player => player.needsProjectionReview || player.mismatches.length)
    if (!issues.length) continue
    out.push('', '| Player | Finding | Verified games |', '|---|---|---:|')
    for (const issue of issues.slice(0, 15)) {
      const note = [issue.needsProjectionReview ? labels[issue.reason] : null, ...issue.mismatches].filter(Boolean).join(', ')
      out.push('| ' + [issue.name ?? issue.id, note, issue.evidenceGames].map(md).join(' | ') + ' |')
    }
    if (issues.length > 15) out.push('', 'Showing 15 of ' + issues.length + ' findings. The JSON report includes every audited player.')
  }
  return out.join('\n') + '\n'
}
