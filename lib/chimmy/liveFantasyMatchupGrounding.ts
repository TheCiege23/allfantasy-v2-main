import 'server-only'

import { prisma } from '@/lib/prisma'
import { getWeekBoard } from '@/lib/core-app/weekBoard'
import { nativeWeeklyLeague, weeklyFormat } from '@/lib/core-app/weeklyCapabilities'
import { nativeRosterSeat, NATIVE_PLAYER_SCORE_SOURCE } from '@/lib/redraft/nativePlayerWeeklyScores'

async function nativeCategoryMatchup(league: { id: string; name: string | null; sport: string; season: number }, userId: string): Promise<string> {
  const roster = await prisma.redraftRoster.findFirst({ where: { leagueId: league.id, ownerId: userId }, select: { id: true } })
  if (!roster) return `No claimed native roster is on file for you in ${league.name}; category matchup data cannot be shown.`
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId: league.id, season: league.season },
    select: { currentWeek: true } })
  if (!season?.currentWeek) return `No current scoring week is recorded for ${league.name}; no category matchup is asserted.`
  const rows = await prisma.redraftMatchup.findMany({
    where: { leagueId: league.id, season: { season: league.season }, week: season.currentWeek,
      OR: [{ homeRosterId: roster.id }, { awayRosterId: roster.id }] },
    select: { week: true, homeRosterId: true, awayRosterId: true, status: true, lineupSnapshots: true },
    orderBy: { week: 'desc' }, take: 12,
  })
  for (const row of rows) {
    const snap = row.lineupSnapshots && typeof row.lineupSnapshots === 'object' && !Array.isArray(row.lineupSnapshots)
      ? row.lineupSnapshots as Record<string, unknown> : null
    const value = snap?.categoryMatchup
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const category = value as Record<string, unknown>
    if (!Array.isArray(category.categories)) continue
    const mineIsHome = row.homeRosterId === roster.id
    const scoring = snap?.redraftScoring && typeof snap.redraftScoring === 'object' && !Array.isArray(snap.redraftScoring)
      ? snap.redraftScoring as Record<string, unknown> : null
    const scoredAt = typeof scoring?.scoredAt === 'string' && Number.isFinite(Date.parse(scoring.scoredAt))
      ? new Date(scoring.scoredAt) : null
    const lines = [`CATEGORY FANTASY MATCHUP — ${league.name} (${league.sport}), season ${league.season}, week ${row.week}.`,
      scoredAt ? `Stored ${row.status} category snapshot computed ${scoredAt.toISOString()}.` : `Stored ${row.status} category snapshot. Its refresh time is not recorded; do not call this real-time.`]
    if (scoredAt && Date.now() - scoredAt.getTime() > 15 * 60_000 && row.status !== 'final') {
      lines.push('This category snapshot has not refreshed in over 15 minutes. Treat it as stale, not a live update.')
    }
    for (const item of category.categories.slice(0, 20)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const c = item as Record<string, unknown>
      const label = typeof c.label === 'string' ? c.label : null
      const mine = mineIsHome ? c.aValue : c.bValue
      const theirs = mineIsHome ? c.bValue : c.aValue
      if (!label || (typeof mine !== 'number' && mine !== null) || (typeof theirs !== 'number' && theirs !== null)) continue
      const fmt = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : 'unqualified'
      lines.push(`${label}: you ${fmt(mine)}, opponent ${fmt(theirs)}.`)
    }
    if (!lines.some((line) => line.startsWith('PTS:') || line.includes(': you '))) continue
    lines.push('Source: native redraft category matchup snapshot. Category wins depend on the stored rules; these values are not fantasy point totals.')
    return lines.join('\n')
  }
  return `No current category matchup snapshot is stored for your team in ${league.name}. Do not infer a 0–0 category score.`
}

/** The board supplies the score and pairing; player rows supply league-scored contributions. */
export async function buildLiveFantasyMatchupContext(args: { leagueId: string; userId: string }): Promise<string> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, name: true, sport: true, season: true, platform: true, platformLeagueId: true, leagueType: true, settings: true },
  })
  if (!league) return 'The selected league could not be read. Do not report a matchup score.'
  const format = weeklyFormat(league)
  if (format === 'categories') return nativeWeeklyLeague(league)
    ? nativeCategoryMatchup(league, args.userId)
    : `${league.name} uses category scoring. Its provider category matchup has not been imported here; no points score is asserted.`
  if (format === 'roto') return `${league.name} uses rotisserie scoring. It has season-long category ranks, not a head-to-head fantasy score; current ranks are not available in this tool.`
  const native = nativeWeeklyLeague(league)
  const board = await getWeekBoard(args.userId, [{ ...league, platform: String(league.platform ?? '') }], league.id)
  const match = board.leagueBoard?.yours
  const elimination = board.eliminationWeeks.find((e) => e.leagueId === league.id)
  if (!match && !elimination) return `No current matchup is on file for ${league.name}. Do not infer a score from the schedule.`
  const season = match?.season ?? elimination!.season
  const week = match?.week ?? elimination!.week
  const ownRosterId = board.leagueBoard?.yourRosterId ?? elimination?.yourRosterId ?? null
  const opponentRosterId = match?.opponent.rosterId ?? null
  const source = native ? NATIVE_PLAYER_SCORE_SOURCE : String(league.platform ?? '').toLowerCase()
  const scoreLeagueId = native ? league.id : league.platformLeagueId
  const seats = [ownRosterId, opponentRosterId].filter((id): id is string => Boolean(id))
    .map((id) => native ? nativeRosterSeat(id) : Number(id)).filter(Number.isSafeInteger)
  // A rare native hash collision must not attribute the opponent's points to the viewer.
  const seatsUnambiguous = new Set(seats).size === seats.length
  const rows = scoreLeagueId && seats.length && seatsUnambiguous ? await prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: scoreLeagueId, seasonYear: season, week, source, rosterId: { in: seats }, isStarter: true },
    select: { playerId: true, rosterId: true, points: true, updatedAt: true },
    orderBy: { points: 'desc' },
    take: 120,
  }).catch(() => []) : []

  const names = new Map<string, string>()
  if (rows.length && native) {
    const players = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: [ownRosterId, opponentRosterId].filter((id): id is string => Boolean(id)) }, playerId: { in: rows.map((r) => r.playerId) }, droppedAt: null },
      select: { playerId: true, playerName: true },
    }).catch(() => [])
    for (const p of players) names.set(p.playerId, p.playerName)
  } else if (rows.length && String(league.platform).toLowerCase() === 'sleeper') {
    const players = await prisma.sportsPlayer.findMany({
      where: { sport: String(league.sport), sleeperId: { in: rows.map((r) => r.playerId) } },
      select: { sleeperId: true, name: true },
      take: 500,
    }).catch(() => [])
    const ambiguous = new Set<string>()
    for (const p of players) {
      if (!p.sleeperId) continue
      if (names.has(p.sleeperId) && names.get(p.sleeperId) !== p.name) ambiguous.add(p.sleeperId)
      else names.set(p.sleeperId, p.name)
    }
    for (const id of ambiguous) names.delete(id)
  }

  const matchupUpdated = !native && scoreLeagueId && seats.length ? await prisma.weeklyMatchup.findFirst({
    where: { leagueId: scoreLeagueId, seasonYear: season, week, rosterId: ownRosterId ?? '' },
    select: { updatedAt: true },
  }).catch(() => null) : null
  const newestPlayerUpdate = rows.reduce<Date | null>((latest, row) => !latest || row.updatedAt > latest ? row.updatedAt : latest, null)
  const asOf = [matchupUpdated?.updatedAt, newestPlayerUpdate].filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const stamp = asOf ? `Score data last updated ${asOf.toISOString()}.` : 'No score refresh time is on file; do not call this real-time.'
  const lines = [`FANTASY MATCHUP SCOREBOARD — ${league.name} (${league.sport}), season ${season}, week ${week}.`, stamp]
  if (asOf && Date.now() - asOf.getTime() > 15 * 60_000 && !match?.live?.final) {
    lines.push('This score has not refreshed in over 15 minutes. Treat it as stale, not a live update.')
  }
  if (match?.live) {
    lines.push(`${match.live.final ? 'FINAL' : 'CURRENT SCORE ON FILE'}: your team ${match.live.you.toFixed(2)}, ${match.opponent.name ?? 'opponent'} ${match.live.them.toFixed(2)}. ${match.live.margin >= 0 ? 'Ahead' : 'Behind'} by ${Math.abs(match.live.margin).toFixed(2)}.`)
  } else if (elimination?.yourScore != null) {
    lines.push(`Elimination league: your score ${elimination.yourScore.toFixed(2)}; cut line ${elimination.cutLine?.toFixed(2) ?? 'unavailable'}; rank ${elimination.rank ?? 'unavailable'} of ${elimination.fieldSize}.`)
  } else {
    lines.push('No fantasy points are on the board for your team yet. Do not call this 0–0 or claim the games have started.')
  }
  const scoreStarted = Boolean(match?.live || elimination?.yourScore != null)
  const named = scoreStarted ? rows.filter((r) => names.has(r.playerId)) : []
  for (const [label, id] of [['Your starters', ownRosterId], ['Opponent starters', opponentRosterId]] as const) {
    if (!id) continue
    const seat = native ? nativeRosterSeat(id) : Number(id)
    const side = named.filter((r) => r.rosterId === seat).slice(0, 8)
    if (side.length) lines.push(`${label} with reported points: ${side.map((r) => `${names.get(r.playerId)} ${r.points.toFixed(2)}`).join('; ')}.`)
  }
  if (!scoreStarted) lines.push('Player contributions are withheld until the matchup board reports points.')
  else if (!rows.length) lines.push('Individual player contributions are not on file for this matchup. Team scores above remain the board source of truth.')
  if (!seatsUnambiguous) lines.push('Player contributions are omitted because roster identities collided; team scores remain on file.')
  else if (named.length < rows.length) lines.push(`${rows.length - named.length} reported player lines could not be identified safely; they are omitted, not scored as zero.`)
  lines.push(`Source: AllFantasy week board${rows.length ? ` and ${source} per-player fantasy scores` : ''}.`)
  lines.push('These are points already reported under this league\'s scoring, not remaining-game projections. A score in progress can change through live plays and stat corrections.')
  return lines.join('\n')
}
