import { constructionIndex } from './metrics'
import type { PortfolioEvidence } from './types'

export function renderPortfolioAnswer(e: PortfolioEvidence, mode: string = 'fast_take'): string {
  const label = e.horizon === 'week' ? 'this week' : e.horizon === 'dynasty' ? 'dynasty roster value' : 'season roster construction'
  const lines: string[] = []
  if (e.status === 'blocked') lines.push('I could not complete a supported comparison for ' + label + '. This answer is not charged.')
  else if (e.intent === 'injuries') {
    if (e.focusPlayer) {
      const held = e.teams.filter(t => t.rosterNames?.includes(e.focusPlayer!))
      lines.push(e.focusPlayer + ' appears on ' + held.length + ' compared own team(s): ' + held.map(t => t.leagueName).join(', ') + '. Unchecked or unresolved rosters may increase this count.')
    }
    const exposure = new Map<string, { status: string; leagues: Set<string> }>()
    for (const t of e.teams) for (const p of t.injuryPlayers ?? []) {
      if (e.focusPlayer && p.name !== e.focusPlayer) continue
      const item = exposure.get(p.name) ?? { status: p.status, leagues: new Set<string>() }
      item.leagues.add(t.leagueName)
      exposure.set(p.name, item)
    }
    lines.push(exposure.size ? 'Reported injuries affecting your compared own teams:' : 'No matched injury reports were returned for the checked teams. This does not establish that every player is healthy.')
    for (const [name, p] of exposure) lines.push(name + ': ' + p.status + ' on ' + p.leagues.size + ' team(s) — ' + [...p.leagues].join(', ') + '.')
  } else {
    const sports = [...new Set(e.teams.map(t => t.sport))]
    for (const sport of sports) {
      const candidates = e.teams.filter(t => t.sport === sport && (e.intent === 'championship' ? t.metrics.some(m => m.key === 'title' && m.value != null) : (e.intent === 'attention' || e.intent === 'weakness' ? t.metrics.some(m => m.value != null) : (t.percentile != null || t.metrics.some(m => m.key === 'depth' && m.value != null)) && !t.stale)))
      const first = candidates[0]
      if (!first) continue
      const title = first.metrics.find(m => m.key === 'title')
      lines.push(e.intent === 'championship' ? first.leagueName + ' has your highest computed ' + sport + ' championship chance on this pass: ' + title!.value!.toFixed(1) + '%.' :
        e.intent === 'attention' || e.intent === 'weakness' ? 'Start your ' + sport + ' roster review with ' + first.leagueName + '.' :
          first.leagueName + (first.percentile == null ? ' leads the available roster-structure assessment; player-strength rankings are unavailable, so this compares only verified coverage and depth' : constructionIndex(first) != null ? ' leads your measured ' + sport + ' construction comparison (' + constructionIndex(first) + '/100 index)' : ' has the highest available ' + sport + ' league-strength measure; overall completeness could not be fully assessed') + ' for ' + label + ' among the readable teams.')
      const signals = first.metrics.filter(m => ['strength', 'balance', 'slots', 'depth', 'lineup_gain', 'injuries'].includes(m.key) && m.value != null)
      lines.push(...signals.slice(0, mode === 'deep_analysis' ? 4 : 2).map(m => m.label + ': ' + m.detail))
      const upgrade = first.actions.find(a => a.label === 'Find an upgrade')
      if (upgrade?.prompt) lines.push('Next: ' + upgrade.prompt + '.')
    }
  }
  lines.push('Compared ' + e.compared + ' of ' + e.total + ' teams for this scope and horizon. Last checked ' + e.generatedAt + '.')
  if (mode === 'deep_analysis') {
    for (const t of e.teams.slice(0, 6)) {
      lines.push('\n' + t.leagueName + ' (' + t.sport + ', ' + t.season + '): ' + t.status + '.')
      lines.push(...t.metrics.map(m => m.label + ': ' + m.detail), ...t.gaps)
    }
    if (e.teams.length > 6) lines.push('Evidence for the remaining teams is available in their comparison cards.')
    lines.push(...e.methodology)
  } else if (mode === 'social_story') lines.push('The roster receipts are in the comparison below. Depth still matters when the stars need a week off.')
  lines.push(...e.caveats)
  if (e.status === 'blocked') lines.push(...e.teams.flatMap(t => t.gaps.map(g => t.leagueName + ': ' + g)))
  return lines.join('\n\n')
}
