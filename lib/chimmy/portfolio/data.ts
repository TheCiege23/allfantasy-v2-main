import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { resolveRosterPlayerIdentities } from '@/lib/player-identity/resolveRosterPlayerIdentities'
import { getRosterGrade } from '@/lib/core-app/rosterGrade'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { isLeagueNotStarted } from '@/lib/core-app/leagueNotStarted'
import { buildLineupOptimization } from '@/lib/chimmy/lineupOptimizerGrounding'
import { weeklyLeagueStrength } from './weeklyStrength'
import { leaguePercentile, rosterStructure } from './metrics'
import type { NamedLeague } from '@/lib/chimmy/tools/leagueByName'
import type { PortfolioHorizon, PortfolioTeam } from './types'

export function unavailableTeam(l: NamedLeague, reason: string, status: PortfolioTeam['status'] = 'unavailable'): PortfolioTeam {
  return { leagueId: l.id, leagueName: l.name, teamName: null, sport: l.sport, season: l.season, status,
    lastSyncedAt: null, stale: true, rank: null, outOf: null, percentile: null, metrics: [], weakestPosition: null, gaps: [reason],
    actions: [{ label: status === 'unclaimed' ? 'Claim your team' : 'Open roster', href: '/core/my-team?league=' + encodeURIComponent(l.id) }] }
}

/** Small version query before cache reuse: membership, imports and roster edits cannot reuse another snapshot. */
export async function portfolioVersion(ids: string[]): Promise<string> {
  const [leagues, rosters] = await Promise.all([
    prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, lastSyncedAt: true } }),
    prisma.roster.groupBy({ by: ['leagueId'], where: { leagueId: { in: ids } }, _max: { updatedAt: true } }),
  ])
  return JSON.stringify([leagues.map(l => [l.id, l.updatedAt, l.lastSyncedAt]).sort(), rosters.map(r => [r.leagueId, r._max.updatedAt]).sort()])
}

export async function loadPortfolioTeam(l: NamedLeague, userId: string, horizon: PortfolioHorizon): Promise<PortfolioTeam> {
  if (isLeagueNotStarted(l)) return unavailableTeam(l, 'This league has not drafted yet; no roster comparison exists.', 'not_drafted')
  const rules = await resolveNormalizedLeagueContext({ leagueId: l.id, userId })
  if (!rules.ok) return unavailableTeam(l, 'Your team or verified league rules could not be read. Open the roster to claim or sync it.')
  const c = rules.context
  const team = await resolveAiTeamContext({ userId, leagueId: l.id, sport: l.sport, season: l.season, currentPeriod: c.matchupPeriod.currentPeriod })
  if (!team) return unavailableTeam(l, 'No own team could be resolved. Claim your team before comparing it.', 'unclaimed')
  const refs = [...team.starters, ...team.bench, ...team.injuredReserve, ...team.taxi].filter(p => p.playerId && p.playerId !== '0')
  if (!refs.length) return unavailableTeam(l, 'This claimed team has no loaded roster players. Sync the league.', 'empty')
  const native = c.sourceType === 'native_af'
  const identities = await resolveRosterPlayerIdentities(native ? 'allfantasy' : c.platform, l.sport, refs.map(p => p.playerId)).catch(() => new Map())
  const direct = native || ['sleeper', 'allfantasy'].includes(c.platform.toLowerCase())
  const resolved = refs.map(p => ({ ...p, name: identities.get(p.playerId)?.name ?? (direct ? p.name : null),
    position: identities.get(p.playerId)?.position ?? (direct ? p.position : null), team: identities.get(p.playerId)?.team ?? (direct ? p.team : null) }))
  const gaps = [...team.dataGaps]
  const unresolved = resolved.filter(p => !p.name || !p.position).length
  if (unresolved) gaps.push(unresolved + ' roster players could not be fully identified.')
  const lastSyncedAt = c.importHealth.lastSyncedAt
  const stale = !native && (!lastSyncedAt || Date.now() - Date.parse(lastSyncedAt) > 24 * 60 * 60 * 1000)
  if (stale) gaps.push('Roster freshness is unknown or older than 24 hours; refresh the league before relying on the order.')
  if (!native && !c.importHealth.mappingOk) gaps.push('The league import mapping needs review.')
  const reserveIds = new Set([...team.injuredReserve, ...team.taxi].map(p => p.playerId))
  const metrics = rosterStructure(!unresolved && Array.isArray(c.roster.starters) ? c.roster.starters.map(String) : null,
    resolved.map(p => ({ id: p.playerId, position: p.position, reserve: reserveIds.has(p.playerId) })))
  // Classic Best Ball or best ball Guilly: no lineup to review (lib/bestball/bestBallLeagueState.ts).
  const autoLineup = c.lineupBehavior?.lineupSetsItself ?? c.flags.bestBallMode
  const canDynasty = c.flags.isDynasty || c.flags.isKeeper || c.flags.isDevy || c.flags.isC2C
  const [grade, weekly, lineup, injuries] = await Promise.all([
    horizon !== 'week' && (horizon !== 'dynasty' || canDynasty) ? getRosterGrade({ leagueId: l.id,
      myPlatformUserIds: [team.platformUserId, c.team?.platformUserId, c.team?.externalId, userId].filter((id): id is string => Boolean(id)),
      isDynasty: horizon === 'dynasty', starters: c.roster.starters, scoringSettings: c.scoring.pointsByStat }).catch(() => null) : Promise.resolve(null),
    horizon === 'week' ? weeklyLeagueStrength(l.id, userId).catch(() => null) : Promise.resolve(null),
    l.sport === 'NFL' && !autoLineup ? buildLineupOptimization({ leagueId: l.id, userId }).catch(() => null) : Promise.resolve(null),
    resolveInjuryFacts({ sport: l.sport, players: resolved.filter(p => p.name).map(p => ({ name: p.name!, position: p.position, team: p.team })) }).catch(() => null),
  ])
  if (horizon === 'dynasty' && !canDynasty) gaps.push('Dynasty outlook is not applicable to this redraft team.')
  const rank = horizon === 'week' ? weekly?.rank ?? null : grade?.rank ?? null
  const outOf = horizon === 'week' ? weekly?.outOf ?? null : grade?.outOf ?? null
  const percentile = rank != null && outOf != null ? leaguePercentile(rank, outOf) : null
  if (percentile == null) gaps.push('A verified within-league strength ranking is unavailable for this horizon.')
  metrics.unshift({ key: 'strength', label: horizon === 'week' ? 'Weekly lineup strength' : horizon === 'dynasty' ? 'Dynasty roster value' : 'Season roster value', value: percentile,
    detail: rank && outOf ? rank + ' of ' + outOf + ' in this league. ' + (weekly?.detail ??
      (grade?.basis.leagueScored ? 'Values adjusted to this league’s scoring.' : 'Market-value baseline; not fully adjusted to this league’s scoring.')) : 'Not computed; missing values are not zero.' })
  if (grade) {
    metrics.push({ key: 'value_coverage', label: 'Priced roster coverage', value: Math.round(100 * grade.pricedPlayers / Math.max(1, grade.totalPlayers)), detail: grade.pricedPlayers + ' of ' + grade.totalPlayers + ' own players priced; value source captured ' + (grade.basis.capturedAt ?? 'at an unknown time') + '.' })
    if (grade.pricedPlayers < grade.totalPlayers) gaps.push('Some own players lack values; the market comparison is incomplete.')
    if (!grade.basis.leagueScored) gaps.push('Roster values are a market baseline, not a complete custom-scoring valuation.')
  }
  const weakest = weekly?.weakest ?? grade?.weakest
  metrics.push({ key: 'balance', label: 'Weakest-position strength', value: weakest ? leaguePercentile(weakest.rank, weakest.outOf) : null,
    detail: weakest ? weakest.position + ': ' + weakest.rank + ' of ' + weakest.outOf + (weekly ? ' by active-roster weekly projections within this league.' : ' within this league by value.') : 'No verified positional comparison is available.' })
  const starterIds = new Set(team.starters.map(p => p.playerId))
  const injuryPlayers: NonNullable<PortfolioTeam['injuryPlayers']> = []
  for (const p of resolved) {
    const fact = p.name ? injuries?.byPlayer.get(normalizeMatchName(p.name)) : null
    if (p.name && fact?.status && !injuryPlayers.some(x => x.name === p.name)) injuryPlayers.push({ name: p.name, status: fact.status,
      reportedAt: fact.reportedAt?.toISOString() ?? null, starter: starterIds.has(p.playerId), stale: fact.stale })
  }
  const outStarters = injuryPlayers.filter(p => p.starter && !p.stale && /^(?:out|o|ir|injured reserve|doubtful|suspended)$/i.test(p.status))
  metrics.push({ key: 'injuries', label: 'Reported unavailable starters', value: injuries?.coverage.sourceAvailable && !injuries.feedStale ? outStarters.length : null,
    detail: injuryPlayers.length ? injuryPlayers.map(p => p.name + ': ' + p.status + (p.stale ? ' (stale report)' : '') + ', ' + (p.reportedAt ?? 'date unknown')).join('; ') : 'No matched reports returned. This does not mean all players are healthy.' })
  if (injuries?.feedStale) gaps.push('The injury feed is stale; absence of a report is not evidence of availability.')
  if (!injuries?.coverage.sourceAvailable) gaps.push('Injury report coverage is unavailable for this sport.')
  if (injuryPlayers.some(p => p.stale)) gaps.push('Some injury reports are stale.')
  if (lineup?.status === 'ready') metrics.push({ key: 'lineup_gain', label: 'Available lineup gain', value: lineup.gain,
    detail: lineup.gain == null ? 'The current lineup could not be fully priced.' : 'Week ' + lineup.week.week + ': ' + lineup.gain.toFixed(1) + ' projected points from the shared lineup optimizer. Recheck locks before confirming changes.' })
  else if (autoLineup) metrics.push({ key: 'lineup_gain', label: 'Lineup management', value: null, detail: 'Best ball selects scoring starters automatically; manual start/sit changes do not apply.' })
  if (native) metrics.push({ key: 'source', label: 'Roster source', value: null, detail: 'Native AllFantasy roster read directly; no external sync is required.' })
  if (horizon === 'dynasty') gaps.push('This compares roster assets only. Draft picks, contracts and future-season outcomes are not included in the construction index.')
  const href = '/core/my-team?league=' + encodeURIComponent(l.id)
  const actions: PortfolioTeam['actions'] = [{ label: 'View roster', href }]
  const position = weakest?.position
  if (l.sport === 'NFL') actions.push({ label: 'Find an upgrade', prompt: 'Find me a trade' + (position ? ' for ' + position : '') + ' in ' + l.name })
  if (l.sport === 'NFL') actions.push({ label: 'Check waivers', prompt: 'Who is the best pickup' + (position ? ' at ' + position : '') + ' in ' + l.name + '?' })
  if (l.sport === 'NFL' && !autoLineup) actions.push({ label: 'Review lineup', prompt: 'Check my lineup in ' + l.name })
  const importantGaps = unresolved > 0 || stale || percentile == null || !native && !c.importHealth.mappingOk || Boolean(grade && (grade.pricedPlayers < grade.totalPlayers || !grade.basis.leagueScored))
  return { leagueId: l.id, leagueName: l.name, teamName: team.teamName, sport: l.sport, season: l.season,
    status: importantGaps ? 'partial' : 'ready', lastSyncedAt, stale, rank, outOf, percentile, metrics,
    weakestPosition: position ?? null, injuryPlayers, rosterNames: [...new Set(resolved.flatMap(p => p.name ? [p.name] : []))].slice(0, 200), gaps, actions }
}
