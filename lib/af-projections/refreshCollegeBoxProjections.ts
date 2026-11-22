import { prisma } from '@/lib/prisma'
import { ingestCollegeFinalBoxes, type CollegeSport, type WatchedPlayer } from '@/lib/workers/providers/collegeFinalBoxes'
import { collegeFootballBoxSeason, COLLEGE_FINAL_BOX_SOURCE, pickCollegeFootballSeasonLines } from './collegeBoxSeasonLines'
import { extractSeasonAggregate } from './core'
import { writeAfProjectionSnapshotsForSeason } from './writeAfProjectionSnapshots'
import { ingestNcaabFantraxIdentities } from '@/lib/player-identity/ingestNcaabFantraxIdentities'
import { sampleGamesFromReasons } from '@/lib/decision-os/trade/sportPointsValue'

export async function refreshCollegeBoxProjections(sport: CollegeSport, season: number, players: WatchedPlayer[]) {
  const now = new Date()
  const ingested = await ingestCollegeFinalBoxes(sport, season, players, now)
  const result = { boxesWritten: ingested.written, requested: [] as string[], written: 0,
    warnings: ingested.warnings, noGameDates: ingested.noGameDates, linkedPlayers: ingested.players.filter(p => p.owner.fantraxId).length }
  // Basketball's canonical points board already builds its rates from the saved game rows.
  if (!ingested.players.length) return result
  if (sport === 'NCAAB') {
    const unlinked = ingested.players.filter(p => !p.owner.fantraxId)
    if (!unlinked.length) return result
    const verified = await prisma.playerGameStat.findMany({ where: { sportType: sport, season, source: 'rolling_insights_live',
      playerId: { in: unlinked.map(p => p.source.id) }, normalizedStatMap: { path: ['gameFinal'], equals: true } },
      distinct: ['playerId'], select: { playerId: true } })
    const ids = new Set(verified.map(row => row.playerId))
    const candidates = new Set(unlinked.filter(p => ids.has(p.source.id)).map(p => p.watch.rosterId))
    if (candidates.size) {
      const linked = await ingestNcaabFantraxIdentities(false, true, candidates)
      result.linkedPlayers += linked.updated
    }
    return result
  }
  const keys = ingested.players.map(({ owner }) => owner.cfbdId ?? owner.id)
  const [games, lines, snapshots, cfbdOwners] = await Promise.all([
    prisma.playerGameStat.findMany({
      where: { sportType: sport, season, source: 'rolling_insights_live',
        playerId: { in: ingested.players.map(({ source }) => source.id) },
        normalizedStatMap: { path: ['gameFinal'], equals: true } },
      select: { playerId: true, gameId: true, team: true, normalizedStatMap: true },
    }),
    prisma.fantasyStatLine.findMany({
      where: { sport, season: String(season), week: 0, playerId: { in: keys }, source: { in: ['cfbd', COLLEGE_FINAL_BOX_SOURCE] } },
      select: { playerId: true, stats: true, source: true, fetchedAt: true },
    }),
    prisma.aFProjectionSnapshot.findMany({
      where: { sport, season, week: null, eventId: null, playerId: { in: keys } },
      select: { playerId: true, adjustmentFactors: true },
    }),
    prisma.playerIdentityMap.findMany({ where: { sport, cfbdId: { in: keys } }, select: { cfbdId: true } }),
  ])
  for (const { owner, source, matchesGame } of ingested.players) {
    if (!owner.position || !owner.currentTeam) continue
    const key = owner.cfbdId ?? owner.id
    if (owner.cfbdId && cfbdOwners.filter(row => row.cfbdId === key).length !== 1) continue
    const stats = collegeFootballBoxSeason({ canonicalName: owner.canonicalName, position: owner.position, currentTeam: owner.currentTeam },
      games.filter(row => row.playerId === source.id && matchesGame(row.team, row.gameId)))
    if (!stats) continue
    const snapshot = snapshots.find(row => row.playerId === key)?.adjustmentFactors
    const factors = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}
    const available = lines.filter(row => row.playerId === key)
    const oldLine = available.find(line => line.source === COLLEGE_FINAL_BOX_SOURCE)
    const won = pickCollegeFootballSeasonLines([...available.filter(line => line !== oldLine),
      { playerId: key, stats, source: COLLEGE_FINAL_BOX_SOURCE, fetchedAt: now }])[0]
    if (won?.source !== COLLEGE_FINAL_BOX_SOURCE) continue
    const gamesPlayed = stats.regular_season.games_played
    if ((extractSeasonAggregate(oldLine?.stats)?.gamesPlayed ?? 0) > gamesPlayed) continue
    // A reviewed snapshot may include an official stat that the RI box omits (for example a two-point try).
    if (Array.isArray(factors.verifiedInputSources) && factors.sourceSeason === season &&
      (sampleGamesFromReasons(factors.confidenceReasons) ?? 0) >= gamesPlayed) continue
    const oldStats = oldLine?.stats
    const oldVersion = oldStats && typeof oldStats === 'object' && !Array.isArray(oldStats) ? oldStats.verifiedBoxVersion : null
    if (oldVersion !== stats.verifiedBoxVersion) {
      const id = { playerId: key, sport, season: String(season), week: 0, source: COLLEGE_FINAL_BOX_SOURCE }
      const data = { team: owner.currentTeam, stats, fetchedAt: now, expiresAt: new Date(now.getTime() + 400 * 86400_000), fantasyPointsByScoringPreset: {} }
      await prisma.fantasyStatLine.upsert({ where: { uniq_fantasy_stat_line_player_week_source: id },
        create: { ...id, ...data }, update: data })
    }
    if (factors.verifiedBoxVersion !== stats.verifiedBoxVersion || factors.sourceSeason !== season) result.requested.push(key)
  }
  if (result.requested.length) {
    const run = await writeAfProjectionSnapshotsForSeason({ sport, playerIds: result.requested,
      sourceSeason: season, targetSeason: season, writeWeeklySnapshots: false })
    if (run.errors.length) throw new Error(run.errors.join(', '))
    result.written = run.written
  }
  return result
}
