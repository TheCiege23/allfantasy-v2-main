import 'server-only'

import { prisma } from '@/lib/prisma'
import { getWeekBoard } from '@/lib/core-app/weekBoard'
import { nativeWeeklyLeague, weeklyFormat } from '@/lib/core-app/weeklyCapabilities'
import { nativeRosterSeat, NATIVE_PLAYER_SCORE_SOURCE } from '@/lib/redraft/nativePlayerWeeklyScores'
import { importedCategoryCacheKey, parseImportedCategoryPairs, verifiedCategoryPairs, yahooRosterId,
  type ImportedCategoryPair } from '@/lib/import-os/collector/importedCategorySnapshots'
import { fetchYahooCategoryMatchupForWeek } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import { fetchEspnScheduleForSync } from '@/lib/league-import/espn/EspnLeagueFetchService'

function yahooCategoryLabels(settings: unknown): Map<string, string> {
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const prop = (v: unknown, key: string): unknown => Array.isArray(v)
    ? v.map((part) => obj(part)[key]).find((part) => part != null) : obj(v)[key]
  // Yahoo's collection may be numeric-keyed; each value is a fragment array containing `stat`.
  const rawStats = prop(prop(obj(settings).yahoo_settings, 'stat_categories'), 'stats')
  const stats = Array.isArray(rawStats) ? rawStats : Object.values(obj(rawStats))
  const labels = new Map<string, string>()
  for (const wrapper of stats) {
    const parts = prop(wrapper, 'stat') ?? wrapper
    const id = prop(parts, 'stat_id')
    const label = prop(parts, 'display_name') ?? prop(parts, 'name')
    if (typeof id === 'string' || typeof id === 'number') {
      if (typeof label === 'string' && label.trim()) labels.set(String(id), label.trim().slice(0, 60))
    }
  }
  return labels
}

async function importedCategoryMatchup(league: { id: string; name: string | null; sport: string; season: number;
  platform: string | null; platformLeagueId: string | null; settings?: unknown }, userId: string): Promise<string> {
  const provider = String(league.platform ?? '').toLowerCase()
  if (!['yahoo', 'espn'].includes(provider) || !league.platformLeagueId) {
    return `${league.name} uses category scoring. Verified provider category totals are not available for this connection; no points score is asserted.`
  }
  const board = await getWeekBoard(userId, [{ ...league, platform: String(league.platform ?? '') }], league.id)
  const week = board.leagueBoard?.yours?.week
  const rosterId = board.leagueBoard?.yourRosterId
  if (!week || !rosterId) return `No current ${provider.toUpperCase()} category pairing is verified for your roster in ${league.name}.`
  let pair: ImportedCategoryPair | undefined
  let fetchedAt: Date | null = null
  let source = provider === 'yahoo' ? 'stored Yahoo matchup team_stats' : 'stored ESPN matchup cumulativeScore.scoreByStat'
  try {
    if (provider === 'yahoo') {
      const fresh = await fetchYahooCategoryMatchupForWeek(userId, league.platformLeagueId, league.season, week)
      if (fresh) pair = verifiedCategoryPairs(fresh.matchups.map((m) => ({
        teamId1: m.teamKey1, teamId2: m.teamKey2, categories1: m.categories1, categories2: m.categories2,
      })), yahooRosterId).find((p) => p.roster1 === rosterId || p.roster2 === rosterId)
    } else {
      const fresh = (await fetchEspnScheduleForSync(userId, league.platformLeagueId, league.season))
        .find((entry) => entry.week === week)
      if (fresh) pair = verifiedCategoryPairs(fresh.matchups, (id) => id)
        .find((p) => p.roster1 === rosterId || p.roster2 === rosterId)
    }
    if (pair) {
      fetchedAt = new Date()
      source = provider === 'yahoo' ? 'Yahoo current-week scoreboard team_stats' : 'ESPN current-week matchup cumulativeScore.scoreByStat'
    }
  } catch { /* A member may lack provider credentials; retain the collector's last verified snapshot. */ }
  if (!pair) {
    const key = importedCategoryCacheKey(provider, league.platformLeagueId, league.season, week)
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } })
    const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data as Record<string, unknown> : null
    if (data?.provider !== provider || data.leagueId !== league.platformLeagueId || data.season !== league.season || data.week !== week) {
      return `No verified ${provider.toUpperCase()} category totals are stored for your current matchup in ${league.name}; no 0–0 result is inferred.`
    }
    pair = parseImportedCategoryPairs(data.pairs).find((p) => p.roster1 === rosterId || p.roster2 === rosterId)
    fetchedAt = typeof data.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt))
      ? new Date(data.fetchedAt) : null
  }
  if (!pair) return `No verified ${provider.toUpperCase()} category totals are stored for your current pairing in ${league.name}.`
  const own = pair.roster1 === rosterId ? pair.categories1 : pair.categories2
  const other = pair.roster1 === rosterId ? pair.categories2 : pair.categories1
  const lines = [`${provider.toUpperCase()} CATEGORY MATCHUP — ${league.name} (${league.sport}), season ${league.season}, week ${week}.`,
    fetchedAt ? `Provider totals last fetched ${fetchedAt.toISOString()}.` : 'No provider refresh time is recorded.']
  if (!fetchedAt || Date.now() - fetchedAt.getTime() > 15 * 60_000) {
    lines.push('These category totals may be stale; they are not a real-time update.')
  }
  const labels = provider === 'yahoo' ? yahooCategoryLabels(league.settings) : new Map<string, string>()
  for (const id of Object.keys(own).sort((a, b) => Number(a) - Number(b)).slice(0, 40)) {
    lines.push(`${labels.get(id) ?? `${provider === 'yahoo' ? 'Yahoo' : 'ESPN'} stat ${id}`}: you ${own[id]!.toFixed(2)}, opponent ${other[id]!.toFixed(2)}.`)
  }
  lines.push(`Source: ${source}. Stat IDs are ${provider.toUpperCase()} category IDs; direction and category wins are not inferred from raw totals. These are not fantasy point totals.`)
  return lines.join('\n')
}

async function nativeRotoStandings(league: { id: string; name: string | null; sport: string; season: number }, userId: string): Promise<string> {
  const mine = await prisma.redraftRoster.findFirst({ where: { leagueId: league.id, ownerId: userId }, select: { id: true } })
  if (!mine) return `No claimed native roster is on file for you in ${league.name}; rotisserie rank cannot be attributed safely.`
  const finalized = await prisma.teamWeekResult.findFirst({ where: { leagueId: league.id, season: league.season,
    status: 'final' }, select: { week: true, categoryBreakdown: true }, orderBy: { week: 'desc' } })
  const breakdown = finalized?.categoryBreakdown
  const stats = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) && 'teamStats' in breakdown
    ? breakdown.teamStats : null
  if (!stats || typeof stats !== 'object' || Array.isArray(stats) || !Object.keys(stats).length) {
    return `No finalized rotisserie category period is stored for ${league.name}; a pre-season or unscored rank is not asserted.`
  }
  const rows = await prisma.fantasyStanding.findMany({ where: { leagueId: league.id, season: league.season },
    select: { rosterId: true, rank: true, pointsFor: true, updatedAt: true,
      roster: { select: { redraftRosterId: true } } }, orderBy: [{ rank: 'asc' }, { pointsFor: 'desc' }], take: 100 })
  const own = rows.find((row) => row.roster.redraftRosterId === mine.id)
  if (!own || own.rank == null) return `No verified season-to-date rotisserie rank is stored for your roster in ${league.name}. Do not infer a rank from head-to-head points.`
  // A later update to one team must not make every team's table appear fresh.
  const asOf = rows.reduce<Date | null>((oldest, row) => !oldest || row.updatedAt < oldest ? row.updatedAt : oldest, null)
  const ids = rows.map((row) => row.roster.redraftRosterId).filter((id): id is string => Boolean(id))
  const rosters = await prisma.redraftRoster.findMany({ where: { id: { in: ids } }, select: { id: true, teamName: true, ownerName: true } })
  const names = new Map(rosters.map((roster) => [roster.id, roster.teamName || roster.ownerName]))
  const lines = [`ROTISSERIE STANDINGS — ${league.name} (${league.sport}), season ${league.season}.`,
    `Your stored rank: ${own.rank}; ${rows.length} teams have stored standings; ${own.pointsFor.toFixed(2)} category rank points.`,
    asOf ? `Standings last updated ${asOf.toISOString()}.` : 'No refresh time is recorded.']
  if (asOf && Date.now() - asOf.getTime() > 15 * 60_000) lines.push('These standings may be stale; they are not a live category update.')
  for (const row of rows.slice(0, 20)) {
    if (row.rank == null) continue
    const name = row.roster.redraftRosterId ? names.get(row.roster.redraftRosterId) : null
    lines.push(`${row.rank}. ${name ?? 'Unnamed team'} — ${row.pointsFor.toFixed(2)} category rank points${row.roster.redraftRosterId === mine.id ? ' (you)' : ''}.`)
  }
  lines.push('Source: stored native fantasy standings. Rank points sum category placements across teams; they are not head-to-head fantasy points. Only finalized scoring periods are reflected.')
  return lines.join('\n')
}

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
    : importedCategoryMatchup(league, args.userId)
  if (format === 'roto') return nativeWeeklyLeague(league)
    ? nativeRotoStandings(league, args.userId)
    : `${league.name} uses rotisserie scoring. Provider category standings have not been imported; no rank is asserted.`
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
  // The board owns the team score. A newer player row must not make an older team score appear fresh.
  const asOf = matchupUpdated?.updatedAt ?? newestPlayerUpdate
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
