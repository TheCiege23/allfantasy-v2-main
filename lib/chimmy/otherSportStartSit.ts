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

type Result = { ready: boolean; text: string }
const missing = (text: string): Result => ({ ready: false, text })
const MAX_GAMES = 5

/** A past-game trend under this league's scoring. It is never labelled a future projection. */
export async function buildOtherSportStartSit(args: {
  leagueId: string
  userId: string
  players: string[]
}): Promise<Result> {
  if (args.players.length !== 2) return missing('Name two players on your roster to compare.')
  const world = await resolveCanonicalWorld(args.leagueId)
  if (!world) return missing('The selected league could not be read, so no start/sit call was made.')
  const sport = String(world.league.sport).toUpperCase()
  if (!canRunSeasonForSport(sport)) return missing(`${sport} fantasy scoring is not operational for a full season yet. No league-specific start/sit call can be made.`)
  if (sport === 'NFL') return missing('Use the NFL weekly projection engine for this comparison.')
  const eligibility = ELIGIBILITY[sport]
  if (!eligibility) return missing(`Starting-slot eligibility for ${sport} is not on file.`)
  if (isForeignIdSpace(world.provenance?.provider)) return missing('This imported league uses player IDs we cannot safely match to stats yet. Compare these players on the league platform.')
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

  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { sport: true, settings: true, season: true, leagueType: true, bestBallMode: true } })
  if (!league || league.bestBallMode) return missing('This league has no manual start/sit decision on file.')
  if (['categories', 'roto'].includes(weeklyFormat(league))) {
    return missing('This league uses category or rotisserie scoring. A single fantasy-points average cannot rank its start/sit choices yet.')
  }
  const scorer = buildLeagueStatScorer(league)
  if (!scorer) return missing(`The ${sport} scoring categories could not be resolved for this league.`)
  const now = new Date()
  const scheduleSports = sport === 'NCAAF' ? ['NCAAF', 'NCAAFB'] : sport === 'NCAAB' ? ['NCAAB', 'NCAABB'] : [sport]
  const currentSeasonGame = await prisma.sportsGame.findFirst({
    where: { sport: { in: scheduleSports }, season: league.season,
      startTime: { gte: new Date(now.getTime() - 3 * 86_400_000), lte: new Date(now.getTime() + 8 * 86_400_000) } },
    select: { id: true },
  })
  if (!currentSeasonGame) return missing('No current scoring-period games are verified for this league season, so an old season cannot be used for a start/sit call.')
  const sportKeys = [...new Set(scheduleSports.flatMap((key) => [key, key.toLowerCase()]))]
  const bridge = await bridgeRosterIdsToGameLogIds(prisma, sportKeys, [...ids],
    new Map(ids.map((id) => [id, metadata.get(id)?.name ?? null])))
  if (ids.some((id) => bridge.ambiguous.includes(id) || bridge.nameRefused.includes(id) || bridge.fantraxRefused.includes(id))) {
    return missing('A roster player ID could not be matched uniquely to a game-log identity. No start/sit call was made.')
  }
  const logs = await prisma.playerGameStat.findMany({
    where: { sportType: { in: sportKeys }, season: league.season, playerId: { in: bridge.gameLogIds } },
    select: { playerId: true, gameId: true, providerGameId: true, normalizedStatMap: true, gameDate: true, weekOrRound: true, sportType: true, season: true },
    orderBy: [{ weekOrRound: 'desc' }, { gameDate: 'desc' }],
    take: 100,
  })
  const perPlayer = ids.map((id) => {
    const games = new Map<string, Record<string, number>>()
    const recent = logs.filter((r) => bridge.rosterIdFor(r.playerId) === id &&
      !['pre', 'post'].includes(resolveStoredSeasonType({ normalizedStatMap: r.normalizedStatMap,
        sport: r.sportType, season: r.season, gameDate: r.gameDate }) ?? '')).sort((a, b) =>
      (b.gameDate?.getTime() ?? 0) - (a.gameDate?.getTime() ?? 0) || b.weekOrRound - a.weekOrRound)
    for (const row of recent) {
      const gameKey = row.providerGameId || String(row.gameId ?? '').split(':')[0]
      if (!gameKey || (!games.has(gameKey) && games.size >= MAX_GAMES)) continue
      const stats = games.get(gameKey) ?? {}
      const raw = row.normalizedStatMap
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
          if (typeof value === 'number' && Number.isFinite(value)) stats[key] = (stats[key] ?? 0) + value
        }
      }
      if (Object.keys(stats).length > 0) games.set(gameKey, stats)
    }
    const totals = [...games.values()].map((stats) => scorer(stats, metadata.get(id)?.position ?? null))
    return { id, name: metadata.get(id)?.name ?? id, team: metadata.get(id)?.team ?? null,
      injury: metadata.get(id)?.injury ?? null, games: totals.length,
      lastGame: recent.find((r) => r.gameDate)?.gameDate ?? null,
      average: totals.length ? totals.reduce((sum, n) => sum + n, 0) / totals.length : null }
  })
  const [a, b] = perPlayer
  if (a!.average == null || b!.average == null || a!.games < 3 || b!.games < 3) {
    return missing(`Not enough current-season game logs to compare ${a!.name} and ${b!.name} under this league's scoring (need at least three games each).`)
  }
  if (a!.average === 0 && b!.average === 0) {
    return missing('The stored game stats did not produce a scoring difference under this league’s rules. No start/sit edge was computed.')
  }
  if (unavailableForLineup(a!.injury) || unavailableForLineup(b!.injury)) {
    return missing(`${[a, b].filter((p) => unavailableForLineup(p!.injury)).map((p) => p!.name).join(' and ')} is reported unavailable; check a healthy eligible replacement.`)
  }
  const locks = await checkStartedGames({ sport, season: league.season, week: world.league.currentWeek ?? 1,
    players: perPlayer.map((p) => ({ playerId: p!.id, name: p!.name, team: p!.team, gameTime: null })) })
  if (ids.some((id) => locks.started.has(id))) return missing('At least one player has already started a game in the current scoring window. Verify lineup locks before changing a starter.')
  if (ids.some((id) => locks.unverified.includes(id))) return missing('A current game could not be verified for both players, so no start/sit call was made. Check the league schedule and ask again.')
  const diff = a!.average - b!.average
  const lines = [`${sport} start/sit in this league, using current-season game logs scored with its own rules:`,
    `${a!.name}: ${a!.average.toFixed(1)} fantasy points per game over ${a!.games} recent games${a!.lastGame ? ` (last recorded ${a!.lastGame.toISOString().slice(0, 10)})` : ''}.`,
    `${b!.name}: ${b!.average.toFixed(1)} fantasy points per game over ${b!.games} recent games${b!.lastGame ? ` (last recorded ${b!.lastGame.toISOString().slice(0, 10)})` : ''}.`]
  if (Math.abs(diff) < 1) lines.push('This is a close call on recent form; no clear start/sit edge.')
  else lines.push(`Lean ${diff > 0 ? a!.name : b!.name} on recent league-scored form (${Math.abs(diff).toFixed(1)} points per game higher).`)
  lines.push('This is a recent-game trend, not a projection. It does not account for how many games each player has left in this scoring period, future opponents, or a late injury. Check those before locking the lineup.')
  return { ready: true, text: lines.join('\n') }
}
