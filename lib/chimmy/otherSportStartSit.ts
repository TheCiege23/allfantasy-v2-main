import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { normalizeToSupportedSport, canRunSeasonForSport } from '@/lib/sport-scope'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { viewerRosterOf, activePlayerIds } from './leagueRosterIndex'
import { isForeignIdSpace } from '@/lib/core-app/rosterIdSpace'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { checkStartedGames } from './actions/gameLocks'
import { unavailableForLineup } from './lineupAvailability'
import { ELIGIBILITY } from './lineupOptimizerOtherSports'
import { weeklyFormat } from '@/lib/core-app/weeklyCapabilities'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { computeCategoryValue } from '@/lib/category-scoring/CategoryMatchupResolver'
import { loadOtherSportPeriodSchedule } from './otherSportPeriodSchedule'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { loadOpponentScoreAdjustments } from './opponentStrength'

type Result = { ready: boolean; text: string }
const missing = (text: string): Result => ({ ready: false, text })
const MAX_GAMES = 5

/** Current-period comparison from league-scored form and a verified game slate. */
export async function buildOtherSportStartSit(args: {
  leagueId: string
  userId: string
  players: string[]
}): Promise<Result> {
  if (args.players.length !== 2) return missing('Name two players on your roster to compare.')
  const world = await resolveCanonicalWorld(args.leagueId)
  if (!world) return missing('The selected league could not be read, so no start/sit call was made.')
  const sport = String(world.league.sport).toUpperCase()
  if (sport === 'NFL') return missing('Use the NFL weekly projection engine for this comparison.')
  const eligibility = ELIGIBILITY[sport]
  if (!eligibility) return missing(`Starting-slot eligibility for ${sport} is not on file.`)
  if (isForeignIdSpace(world.provenance?.provider)) return missing('This imported league uses player IDs we cannot safely match to stats yet. Compare these players on the league platform.')
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { sport: true, settings: true, season: true, leagueType: true, bestBallMode: true } })
  if (!league || league.bestBallMode) return missing('This league has no manual start/sit decision on file.')
  if (sport === 'SOCCER') await ensureDailySportSeasonStart('SOCCER', league.season, { db: prisma }).catch(() => null)
  if (!canRunSeasonForSport(sport, league.season)) return missing(`${sport} fantasy scoring is not operational for a full season yet. No league-specific start/sit call can be made.`)
  const roster = viewerRosterOf(world, args.userId)
  if (!roster) return missing('Your claimed roster is not on file for this league.')
  const activeIds = activePlayerIds(roster)
  const metadata = await resolveNames(normalizeToSupportedSport(sport), activeIds, 120)
  const named = args.players.map((raw) => {
    const key = normalizePlayerName(raw)
    return activeIds.filter((id) => normalizePlayerName(metadata.get(id)?.name ?? '') === key)
  })
  if (named.some((hits) => hits.length !== 1) || named[0]![0] === named[1]![0]) {
    return missing('Both full player names must resolve uniquely to different active players on your roster.')
  }
  const ids = [named[0]![0]!, named[1]![0]!] as const
  const slots = (world.league.rosterSettings.starterSlots ?? []).map((s) => s.toUpperCase())
    .filter((s) => !['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'IL', 'NA'].includes(s))
  const positions = ids.map((id) => String(metadata.get(id)?.position ?? '').toUpperCase().split(/[\/,\s]+/).filter(Boolean))
  const shared = slots.some((slot) => positions.every((list) => list.some((p) => eligibility[slot]?.includes(p))))
  if (!shared) return missing('These players do not compete for a verified starting slot in this league. Ask for a whole-lineup check instead.')

  const format = weeklyFormat(league)
  const category = ['categories', 'roto'].includes(format) ? nativeCategoryScoringContext(league.settings, sport) : null
  if (['categories', 'roto'].includes(format) && !category) {
    return missing('The category list for this league is not verified. No fantasy-points ranking can replace its category rules.')
  }
  const scorer = category ? null : buildLeagueStatScorer(league)
  if (!category && !scorer) return missing(`The ${sport} scoring categories could not be resolved for this league.`)
  const now = new Date()
  const scheduleSports = sport === 'NCAAF' ? ['NCAAF', 'NCAAFB'] : sport === 'NCAAB' ? ['NCAAB', 'NCAABB'] : [sport]
  const schedule = await loadOtherSportPeriodSchedule({ sport, season: league.season,
    week: world.league.currentWeek ?? 1, teams: ids.map((id) => metadata.get(id)?.team ?? ''), now })
  if (!schedule) return missing('No complete current scoring-period schedule is verified for this league season. An old season or partial slate cannot support a start/sit call.')
  const sportKeys = [...new Set(scheduleSports.flatMap((key) => [key, key.toLowerCase()]))]
  const bridge = sport === 'NCAAF'
    ? await bridgeNcaafRosterIdsToCfbdIds(prisma as never, [...ids])
    : await bridgeRosterIdsToGameLogIds(prisma, sportKeys, [...ids],
      new Map(ids.map((id) => [id, metadata.get(id)?.name ?? null])))
  if (ids.some((id) => bridge.ambiguous.includes(id) || ('nameRefused' in bridge && bridge.nameRefused.includes(id)) ||
    ('fantraxRefused' in bridge && bridge.fantraxRefused.includes(id)) || ('unresolved' in bridge && bridge.unresolved.includes(id)))) {
    return missing('A roster player ID could not be matched uniquely to a game-log identity. No start/sit call was made.')
  }
  const gameLogIds = 'cfbdIds' in bridge ? bridge.cfbdIds : bridge.gameLogIds
  const daily = sport !== 'NCAAF'
  const seasonStart = daily ? resolveDailySportSeasonStart(sport, league.season) : null
  if (daily && !seasonStart) return missing('This sport has no verified regular-season opener, so recent game logs cannot be limited to this league season.')
  const logs = await prisma.playerGameStat.findMany({
    where: { sportType: { in: sportKeys }, playerId: { in: gameLogIds },
      ...(daily ? { gameDate: { gte: new Date(seasonStart!), lte: now } } : { season: league.season }) },
    select: { playerId: true, gameId: true, providerGameId: true, normalizedStatMap: true, gameDate: true, weekOrRound: true, sportType: true, season: true },
    orderBy: [{ gameDate: 'desc' }, { weekOrRound: 'desc' }],
    take: 200,
  })
  const perPlayer = ids.map((id) => {
    const games = new Map<string, unknown[]>()
    const recent = logs.filter((r) => bridge.rosterIdFor(r.playerId) === id &&
      !['pre', 'post'].includes(resolveStoredSeasonType({ normalizedStatMap: r.normalizedStatMap,
        sport: r.sportType, season: r.season, gameDate: r.gameDate }) ?? '')).sort((a, b) =>
      (b.gameDate?.getTime() ?? 0) - (a.gameDate?.getTime() ?? 0) || b.weekOrRound - a.weekOrRound)
    for (const row of recent) {
      const gameKey = row.providerGameId || String(row.gameId ?? '').split(':')[0]
      if (!gameKey || (!games.has(gameKey) && games.size >= MAX_GAMES)) continue
      games.set(gameKey, [...(games.get(gameKey) ?? []), row.normalizedStatMap])
    }
    const normalizer = daily ? getDailySportNormalizer(sport) : null
    const canonical = [...games.values()].map((rows) => daily
      ? normalizer ? aggregateWeeklyStats(rows, normalizer).stats : {}
      : aggregateNcaafWeek(rows).stats).filter((stats) => Object.keys(stats).length > 0)
    const totals = scorer ? canonical.map((stats) => scorer(stats, metadata.get(id)?.position ?? null)) : []
    const averageStats: Record<string, number> = {}
    for (const stats of canonical) for (const [key, value] of Object.entries(stats)) averageStats[key] = (averageStats[key] ?? 0) + value / canonical.length
    return { id, name: metadata.get(id)?.name ?? id, team: metadata.get(id)?.team ?? null,
      injury: metadata.get(id)?.injury ?? null, games: canonical.length, averageStats,
      lastGame: recent.find((r) => r.gameDate)?.gameDate ?? null,
      average: totals.length ? totals.reduce((sum, n) => sum + n, 0) / totals.length : null }
  })
  const [a, b] = perPlayer
  if (a!.games < 3 || b!.games < 3 || (!category && (a!.average == null || b!.average == null))) {
    return missing(`Not enough current-season game logs to compare ${a!.name} and ${b!.name} under this league's scoring (need at least three games each).`)
  }
  if (!category && a!.average === 0 && b!.average === 0) {
    return missing('The stored game stats did not produce a scoring difference under this league’s rules. No start/sit edge was computed.')
  }
  const injuries = await resolveInjuryFacts({ sport, players: perPlayer.map((p) => ({
    name: p!.name, position: metadata.get(p!.id)?.position ?? null, team: p!.team,
  })) }).catch(() => null)
  const injuryNotes: string[] = []
  for (const p of perPlayer) {
    const fact = injuries?.byPlayer.get(normalizeMatchName(p!.name))
    if (fact && !fact.stale) {
      if (unavailableForLineup(fact.status)) return missing(`${p!.name} has a current ${fact.status} injury designation (reported ${fact.reportedAt.toISOString()}); check an eligible replacement.`)
      if (fact.status) injuryNotes.push(`${p!.name}: ${fact.status}, reported ${fact.reportedAt.toISOString()}`)
    } else if (fact?.stale) injuryNotes.push(`${p!.name}: older injury report is stale and not used as a current designation`)
    else if (unavailableForLineup(p!.injury)) return missing(`${p!.name} has an undated ${p!.injury} roster designation; verify it before starting them.`)
  }
  if (!injuries) injuryNotes.push('injury store could not be read')
  else if (!injuries.coverage.sourceAvailable) injuryNotes.push(injuries.coverage.reason ?? 'no current injury source for this sport')
  else if (injuries.feedStale) injuryNotes.push('injury feed is stale')
  if (injuries?.ambiguous.length) injuryNotes.push(`ambiguous injury identities: ${injuries.ambiguous.join(', ')}`)
  const remaining = perPlayer.map((p) => schedule.byTeam.get(p!.team ?? '') ?? { count: 0, opponents: [], verified: false })
  if (remaining.some((r) => !r.verified)) return missing('The current-period games could not be matched to both players’ teams. No schedule-adjusted start/sit call was made.')
  const locks = await checkStartedGames({ sport, season: league.season, week: world.league.currentWeek ?? 1,
    players: perPlayer.map((p) => ({ playerId: p!.id, name: p!.name, team: p!.team, gameTime: null })) })
  if (ids.some((id) => locks.started.has(id))) return missing('At least one player has already started a game in the current scoring window. Verify lineup locks before changing a starter.')
  if (ids.some((id) => locks.unverified.includes(id))) return missing('A current game could not be verified for both players, so no start/sit call was made. Check the league schedule and ask again.')
  const strength = !category && remaining.every((r) => r.count > 0 && r.opponents.length === r.count)
    ? await loadOpponentScoreAdjustments({ sport, season: league.season, now,
        players: perPlayer.map((p, i) => ({ position: metadata.get(p!.id)?.position ?? null,
          opponents: remaining[i]!.opponents })) }).catch(() => [null, null])
    : [null, null]
  const lines = [`${sport} start/sit in this league (${schedule.label}; ${schedule.source}):`]
  lines.push(`Injury check: ${injuryNotes.length ? injuryNotes.join('; ') : 'no current designation on file for these players; that does not establish they are healthy'}.`)
  for (const [i, p] of perPlayer.entries()) {
    const r = remaining[i]!
    lines.push(`${p!.name}: ${r.count} remaining verified game(s)${r.opponents.length ? ` versus ${r.opponents.join(', ')}` : ''}; ${p!.games} recent regular-season game logs, last recorded ${p!.lastGame?.toISOString().slice(0, 10) ?? 'unknown'}.`)
  }
  if (category) {
    const values = category.categories.map((cat) => {
      const scaled = perPlayer.map((p, i) => Object.fromEntries(Object.entries(p!.averageStats).map(([k, v]) => [k, v * remaining[i]!.count])))
      const av = computeCategoryValue(scaled[0]!, cat)
      const bv = computeCategoryValue(scaled[1]!, cat)
      const who = av == null && bv == null ? 'unqualified' : av === bv ? 'even' :
        av == null ? b!.name : bv == null ? a!.name : (cat.direction === 'higher' ? av > bv : av < bv) ? a!.name : b!.name
      return `${cat.label}: ${who} (${av?.toFixed(2) ?? 'unqualified'} vs ${bv?.toFixed(2) ?? 'unqualified'})`
    })
    lines.push(`Estimated category contributions from recent per-game rates and remaining games: ${values.join('; ')}.`)
    lines.push('No overall category winner is claimed: team totals, category needs, rate denominators and other players decide the matchup or rotisserie rank.')
  } else {
    const strengthVerified = strength.length === 2 && strength.every(Boolean)
    const estimates = perPlayer.map((p, i) => p!.average! * remaining[i]!.count * (strengthVerified ? strength[i]!.factor : 1))
    lines.push(`${a!.name}: ${a!.average!.toFixed(1)} league-scored points per recent game, ${estimates[0]!.toFixed(1)} ${strengthVerified ? 'schedule- and opponent-adjusted' : 'schedule-adjusted'} baseline.`)
    lines.push(`${b!.name}: ${b!.average!.toFixed(1)} league-scored points per recent game, ${estimates[1]!.toFixed(1)} ${strengthVerified ? 'schedule- and opponent-adjusted' : 'schedule-adjusted'} baseline.`)
    if (strengthVerified) lines.push(`Opponent strength: ${a!.name} ${(strength[0]!.factor * 100 - 100).toFixed(1)}%, ${b!.name} ${(strength[1]!.factor * 100 - 100).toFixed(1)}% relative to league scoring average, capped at 10% per fixture. Source: ${strength[0]!.source}, at least five games per opponent. This uses real points/goals/runs scored or allowed as a proxy, not fantasy points allowed by position.`)
    const diff = estimates[0]! - estimates[1]!
    if (Math.abs(diff) < 1) lines.push('This is a close call on the current-period baseline; no clear start/sit edge.')
    else lines.push(`Lean ${diff > 0 ? a!.name : b!.name} on the schedule-adjusted baseline (${Math.abs(diff).toFixed(1)} points higher).`)
  }
  lines.push(`This baseline is an estimate from past games, not a certified projection. ${strength.every(Boolean) && !category ? 'Opponent strength is a bounded real-score proxy.' : 'Opponent strength could not be verified for both players and was not applied.'} Confirm late injuries and platform locks before changing a lineup.`)
  if (sport === 'SOCCER') lines.push('Soccer comparison uses the verified current gameweek; future seasons require a published gameweek calendar before scoring can advance.')
  return { ready: true, text: lines.join('\n') }
}
