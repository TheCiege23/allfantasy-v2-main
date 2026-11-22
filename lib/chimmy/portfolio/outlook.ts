import 'server-only'
import { prisma } from '@/lib/prisma'
import { withTimeout } from '@/lib/async-utils'
import { getSeasonOutlook } from '@/lib/core-app/seasonOutlook'
import type { NamedLeague } from '@/lib/chimmy/tools/leagueByName'
import type { PortfolioEvidence } from './types'

/** The Season Outlook screen's simulator, restricted to the same membership-proven scope. */
export async function addPortfolioOutlook(report: PortfolioEvidence, userId: string, leagues: NamedLeague[]): Promise<void> {
  const ids = report.teams.map(t => t.leagueId).slice(0, 20)
  const result = await withTimeout((async () => {
    const rows = await prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true, sport: true } })
    return getSeasonOutlook(userId, rows, report.state.focusLeagueId)
  })(), 8000).catch(() => null)
  if (!result?.ok) {
    report.status = 'blocked'
    report.compared = 0
    report.caveats.push('The season simulator did not complete. No championship or playoff probabilities were computed; this answer is not charged.')
    return
  }
  let count = 0
  for (const t of report.teams) {
    const l = result.value.leagues.find(l => l.leagueId === t.leagueId)
    if (!l?.you?.modelled) { t.gaps.push('This own team has no supported current-season playoff simulation.'); continue }
    count++
    t.metrics.unshift({ key: 'title', label: 'Championship chance', value: l.you.titlePct,
      detail: 'Season Outlook simulation under this league’s schedule and playoff format. Estimates are not guarantees.' },
      { key: 'playoff', label: 'Playoff chance', value: l.you.playoffPct, detail: l.whatDecidesIt })
    for (const missing of l.assumptions.missing) t.gaps.push(missing)
  }
  report.teams.sort((a, b) => a.sport.localeCompare(b.sport) ||
    (b.metrics.find(m => m.key === 'title')?.value ?? -1) - (a.metrics.find(m => m.key === 'title')?.value ?? -1))
  report.compared = count
  report.status = count === 0 ? 'blocked' : count < leagues.length ? 'partial' : 'ready'
  report.state.orderedLeagueIds = report.teams.map(t => t.leagueId)
  report.state.focusLeagueId = report.teams.find(t => t.metrics.some(m => m.key === 'title'))?.leagueId ?? null
  if (ids.length < leagues.length) report.caveats.push('Playoff simulation covered at most ' + ids.length + ' teams on this pass; no account-wide championship winner is asserted.')
}
