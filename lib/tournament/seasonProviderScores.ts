import 'server-only'
import type { PrismaClient } from '@prisma/client'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { dailyTeamCode, readDailyTeamNames } from '@/lib/redraft/dailyTeamIdentity'
import { boxCertifiesNoContribution } from '@/lib/sports-data/gameBoxCoverage'
import { coverageGameKey, readStatCoverage, statCoverageCorrectionsReady } from '@/lib/sports-data/statCoverage'

export type HistoricalPlayerState = {
  id: string; rosterId: string; playerId: string; sport: string; position: string
  team: string | null; slotType: string; droppedAt: string | null; playerName?: string
}
type HistoricalContribution = { player: HistoricalPlayerState; stats: Record<string, number>; gameId: string; gameStartsAt?: number }
export type HistoricalPeriod = {
  contributions: HistoricalContribution[]; eligible: HistoricalPlayerState[]; missingPlayerIds: string[]
  slateFinal: boolean; correctionsReady: boolean; end: Date
  nflFirstFinalObservedAt?: Date
}

export async function loadHistoricalPeriod(db: PrismaClient, args: {
  leagueId: string; seasonId: string; sport: string; season: number; week: number
  freshNflStats?: ReadonlyMap<string, Record<string, number>>
  frozenTournament: { players: HistoricalPlayerState[]; startsAt: Date; endsAt: Date; now: Date; minimumGames: number }
}): Promise<HistoricalPeriod> {
  const { sport, season, week, frozenTournament: { players, startsAt, endsAt, now, minimumGames } } = args
  const normalize = sport === 'NBA' ? getDailySportNormalizer(sport) : null
  if (sport !== 'NFL' && !normalize) throw new Error('Unsupported tournament scoring sport.')
  const start = normalize ? easternCalendarDay(startsAt)! : new Date(Date.UTC(season, 0, 1))
  const end = normalize ? new Date(easternCalendarDay(new Date(endsAt.getTime() - 1))!.getTime() + 86_400_000) : new Date(Date.UTC(season + 1, 0, 1))
  const teamNames = normalize ? await readDailyTeamNames(db, sport) : undefined
  const teamCode = (team: string | null | undefined) => sport === 'NFL' ? normalizeNflTeam(team) : dailyTeamCode(sport, team, teamNames)
  const games = await db.sportsGame.findMany({ where: { sport, ...(normalize
    ? { startTime: { gte: start, lt: new Date(end.getTime() + 6 * 3600_000) } } : { season, week }) } })
  const slate = pickFreshestSourceRows(games.map(game => ({ ...game, week, season }))).filter(game => {
    if (!game.startTime || game.startTime < startsAt || game.startTime >= endsAt
      || normalizeGameStatus(game.status) === 'cancelled' || /postpon/i.test(game.status ?? '')
      || (game.seasonType && /pre|post|playoff/i.test(game.seasonType))) return false
    return now >= endsAt || (game.startTime <= now && normalizeGameStatus(game.status) === 'final')
  })
  const expected = new Map<string, { player: HistoricalPlayerState; game: typeof slate[number] }>()
  const eligible = new Map<string, HistoricalPlayerState>()
  for (const game of slate) for (const player of players) {
    const team = teamCode(player.team)
    if (team === teamCode(game.homeTeam) || team === teamCode(game.awayTeam)) {
      expected.set([game.id, player.rosterId, player.playerId].join(':'), { player, game })
      eligible.set([player.rosterId, player.playerId].join(':'), player)
    }
  }
  const proofs = await readStatCoverage(db, sport, season, week, start, end)
  const contributions: HistoricalContribution[] = []
  const missing = new Set(players.filter(player => !teamCode(player.team)).map(player => player.playerId))
  const slateKeys = slate.map(game => coverageGameKey(game, teamCode)).sort()
  let correctionsReady = false
  let nflFirstFinalObservedAt: Date | undefined
  if (!normalize) {
    const ids = [...new Set([...eligible.values()].map(player => player.playerId))]
    const rows = args.freshNflStats ? [] : await db.playerWeeklyScore.findMany({ where: { sport, season, week, playerId: { in: ids } } })
    const proof = proofs.find(row => row.kind === 'week' && row.identitySpace === 'sleeper' && row.source === 'sleeper_weekly_stats'
      && row.week === week && JSON.stringify(row.gameKeys) === JSON.stringify(slateKeys))
    const verified = proof ? new Set((await db.playerIdentityMap.findMany({
      where: { sport, sleeperId: { in: ids } }, select: { sleeperId: true },
    })).map(row => row.sleeperId)) : new Set<string>()
    for (const player of eligible.values()) {
      const stats = args.freshNflStats
        ? args.freshNflStats.get(player.playerId)
        : rows.find(row => row.playerId === player.playerId)?.stats
      if (stats && typeof stats === 'object' && !Array.isArray(stats) && Object.keys(stats).length) {
        contributions.push({ player, stats: stats as Record<string, number>, gameId: 'week:' + week })
      } else if (!(proof && verified.has(player.playerId) && !proof.participantIds.includes(player.playerId)
        && (!args.freshNflStats || args.freshNflStats.has(player.playerId)))) {
        missing.add(player.playerId)
      }
    }
    nflFirstFinalObservedAt = proof?.firstFinalObservedAt
    correctionsReady = !!proof && statCoverageCorrectionsReady(proof, now)
  } else {
    const covered = new Set<string>()
    const bridge = await bridgeRosterIdsToGameLogIds(db, [sport], [...new Set(players.map(player => player.playerId))])
    if (bridge.ambiguous.length) throw new Error('Tournament game stats have an ambiguous player identity.')
    const rows = await db.playerGameStat.findMany({ where: { sportType: sport, playerId: { in: bridge.gameLogIds }, gameDate: { gte: start, lt: end } } })
    for (const row of rows) {
      const raw = row.normalizedStatMap as Record<string, unknown> | null
      if (raw?.seasonType === 'pre' || raw?.seasonType === 'post') continue
      const candidates = slate.filter(game => game.externalId === row.providerGameId || game.externalId === row.gameId
        || (row.gameDate && easternCalendarDay(game.startTime!)?.getTime() === row.gameDate.getTime()
          && [teamCode(game.homeTeam), teamCode(game.awayTeam)].includes(teamCode(row.team))))
      const measured = typeof raw?.gameStartTimeUtc === 'string' ? Date.parse(raw.gameStartTimeUtc) : NaN
      if (Number.isFinite(measured) && (measured < startsAt.getTime() || measured >= endsAt.getTime())) continue
      const kickoff = Number.isFinite(measured) ? measured : candidates.length === 1 ? candidates[0]!.startTime!.getTime() : null
      const game = candidates.find(candidate => (candidate.externalId === row.providerGameId || candidate.externalId === row.gameId)
        && candidate.startTime!.getTime() === kickoff) ?? candidates.find(candidate => candidate.startTime!.getTime() === kickoff)
      if (!game && now < endsAt) continue
      if (!game || kickoff === null) throw new Error('A tournament game stat could not be matched to its kickoff.')
      const rosterPlayerId = bridge.rosterIdFor(row.playerId)
      for (const player of players.filter(player => player.playerId === rosterPlayerId)) {
        const key = [game.id, player.rosterId, player.playerId].join(':')
        expected.set(key, { player, game })
        const stats = normalize(raw ?? {}).stats
        if (!Object.keys(stats).length) { missing.add(player.playerId); continue }
        covered.add(key)
        eligible.set([player.rosterId, player.playerId].join(':'), player)
        contributions.push({ player, stats, gameId: game.id, gameStartsAt: kickoff })
      }
    }
    const boxes = proofs.filter(proof => proof.kind === 'game' && proof.identitySpace === 'canonical' && proof.source === 'rolling_insights_live')
    const canonicalByRoster = new Map<string, string>()
    if (boxes.length) for (const row of await db.playerIdentityMap.findMany({ where: { sport, id: { in: bridge.gameLogIds } }, select: { id: true } })) {
      const rosterId = bridge.rosterIdFor(row.id)
      if (rosterId) canonicalByRoster.set(rosterId, row.id)
    }
    for (const [key, { player, game }] of expected) {
      if (covered.has(key)) continue
      const canonicalId = canonicalByRoster.get(player.playerId)
      if (!canonicalId || boxes.filter(proof => boxCertifiesNoContribution({ sport: proof.sport, providerGameId: proof.periodId,
        season: proof.season, startTime: proof.startTime, homeTeam: proof.teams[0]!, awayTeam: proof.teams[1]!, participantIds: proof.participantIds },
      game, canonicalId, teamCode)).length !== 1) missing.add(player.playerId)
    }
    const correctionGames = [...new Map([...expected.values()].map(({ game }) => [game.id, game])).values()]
    correctionsReady = correctionGames.every(game => boxes.some(proof => proof.startTime.getTime() === game.startTime!.getTime()
      && proof.gameKeys.some(key => {
        try { const [home, away, time] = JSON.parse(key); return JSON.stringify([teamCode(home), teamCode(away), time]) === coverageGameKey(game, teamCode) }
        catch { return false }
      }) && statCoverageCorrectionsReady(proof, now)))
  }
  return { contributions, eligible: [...eligible.values()], missingPlayerIds: [...missing], end, correctionsReady, nflFirstFinalObservedAt,
    slateFinal: correctionsReady && slate.length >= minimumGames && slate.every(game => normalizeGameStatus(game.status) === 'final')
      && Math.max(...slate.map(game => game.startTime!.getTime())) + 12 * 3600_000 <= now.getTime() && endsAt <= now }
}
