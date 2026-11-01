import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadCareerGames } from '@/lib/core-app/careerRecords'
import { NO_CAREER_FILTER } from '@/lib/core-app/careerModel'
import { nativeWeeklyLeague, weeklyFormat } from '@/lib/core-app/weeklyCapabilities'
import { NATIVE_PLAYER_SCORE_SOURCE } from '@/lib/redraft/nativePlayerWeeklyScores'
import { importedCategoryCacheKey, parseImportedCategoryPairs } from '@/lib/import-os/collector/importedCategorySnapshots'
import { getWeekBoard } from '@/lib/core-app/weekBoard'

async function playerFantasyHistory(args: { league: { id: string; name: string | null; sport: string; platform: string | null;
  platformLeagueId: string | null; leagueType: string | null; settings: unknown }; player: string;
  season: number | null; week: number | null; limit: number }): Promise<string> {
  const native = nativeWeeklyLeague(args.league)
  const platform = String(args.league.platform ?? '').toLowerCase()
  const name = args.player.trim()
  if (!name) return 'Name the player whose league-scored fantasy history you want.'
  let ids: string[] = []
  if (native) {
    const rows = await prisma.redraftRosterPlayer.findMany({ where: { roster: { leagueId: args.league.id },
      playerName: { equals: name, mode: 'insensitive' } }, select: { playerId: true }, take: 100 })
    ids = [...new Set(rows.map((row) => row.playerId))]
  } else if (platform === 'sleeper') {
    const rows = await prisma.sportsPlayer.findMany({ where: { sport: args.league.sport,
      name: { equals: name, mode: 'insensitive' } }, select: { sleeperId: true }, take: 100 })
    ids = [...new Set(rows.map((row) => row.sleeperId)
      .filter((id): id is string => Boolean(id)))]
  } else if (platform === 'fantrax') {
    const rows = await prisma.playerIdentityMap.findMany({ where: { sport: args.league.sport,
      canonicalName: { equals: name, mode: 'insensitive' }, fantraxId: { not: null } },
    select: { fantraxId: true }, take: 100 })
    ids = [...new Set(rows.map((row) => row.fantraxId).filter((id): id is string => Boolean(id)))]
  } else if (platform === 'espn' || platform === 'fleaflicker' || platform === 'mfl') {
    const field = platform === 'espn' ? 'espnId' : platform === 'fleaflicker' ? 'fleaflickerId' : 'mflId'
    const rows = await prisma.playerIdentityMap.findMany({ where: { sport: args.league.sport,
      canonicalName: { equals: name, mode: 'insensitive' }, [field]: { not: null } },
      select: { espnId: true, fleaflickerId: true, mflId: true }, take: 100 })
    ids = [...new Set(rows.map((row) => row[field]).filter((id): id is string => Boolean(id)))]
  } else return `Historical per-player fantasy scores for ${platform || 'this provider'} have no verified identity mapping here.`
  if (!ids.length) return `${name} could not be matched to a player ID in ${args.league.name}; no fantasy points are asserted.`
  if (ids.length !== 1) return `${name} matches multiple player IDs in ${args.league.name}. Use a more specific name; no fantasy points are attributed.`
  const leagueId = native ? args.league.id : args.league.platformLeagueId
  if (!leagueId) return `No provider league ID is stored for ${args.league.name}; player scores cannot be read safely.`
  const rows = await prisma.leaguePlayerWeeklyScore.findMany({ where: { leagueId, playerId: ids[0],
    source: native ? NATIVE_PLAYER_SCORE_SOURCE : platform,
    ...(args.season == null ? {} : { seasonYear: args.season }),
    ...(args.week == null ? {} : { week: args.week }) },
  select: { seasonYear: true, week: true, points: true, isStarter: true, isFinalized: true, updatedAt: true },
  orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }], take: args.limit + 1 })
  if (!rows.length) return `No league-scored weekly fantasy rows are stored for ${name} in ${args.league.name}${args.season ? ` in ${args.season}` : ''}${args.week ? ` week ${args.week}` : ''}. This is a data gap, not a zero-point result.`
  const shown = rows.slice(0, args.limit)
  const lines = [`PLAYER FANTASY HISTORY — ${name} in ${args.league.name} (${args.league.sport}).`]
  for (const row of shown) lines.push(`${row.seasonYear} week ${row.week}: ${row.points.toFixed(2)} league-scored fantasy points (${row.isStarter ? 'starter' : 'bench'}, ${row.isFinalized ? 'finalized' : 'subject to correction'}; updated ${row.updatedAt.toISOString()}).`)
  if (rows.length > args.limit) lines.push(`Showing ${args.limit} most recent stored weeks; narrow by season or week for more.`)
  lines.push(`Source: ${native ? 'AllFantasy' : platform} per-player weekly fantasy scores for this league. These are this league's scoring results, not real-sports box scores.`)
  return lines.join('\n')
}

async function importedCategoryHistory(args: { league: { id: string; name: string | null; sport: string;
  season: number; platform: string | null; platformLeagueId: string | null }; userId: string;
  season: number | null; week: number | null; limit: number }): Promise<string> {
  const { league } = args
  const provider = String(league.platform ?? '').toLowerCase()
  if (!['yahoo', 'espn'].includes(provider) || !league.platformLeagueId) {
    return `No verified imported category snapshots are stored for ${league.name} from ${provider || 'this provider'}.`
  }
  if (args.season != null && args.season !== league.season) {
    return `The imported category snapshots for ${league.name} are tied to its connected ${league.season} season; ${args.season} category totals are not on file.`
  }
  const claimed = await prisma.leagueTeam.findMany({ where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true }, take: 4 })
  const ownIds = new Set(claimed.map((team) => team.externalId))
  if (!ownIds.size) {
    const board = await getWeekBoard(args.userId, [{ ...league, platform: provider }], league.id)
    if (board.leagueBoard?.yourRosterId) ownIds.add(board.leagueBoard.yourRosterId)
  }
  if (ownIds.size !== 1) return `Your team could not be identified uniquely in ${league.name}; category history cannot be attributed.`
  const ownId = [...ownIds][0]!
  const prefix = importedCategoryCacheKey(provider, league.platformLeagueId, league.season, args.week ?? 0)
  const cachePrefix = args.week == null ? prefix.slice(0, prefix.lastIndexOf(':') + 1) : prefix
  const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { startsWith: cachePrefix } },
    select: { data: true }, take: 65 })
  const shown = rows.flatMap((row) => {
    const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data as Record<string, unknown> : null
    if (!data || data.provider !== provider || data.leagueId !== league.platformLeagueId ||
      data.season !== league.season || !Number.isInteger(data.week) ||
      (args.week != null && data.week !== args.week)) return []
    const pair = parseImportedCategoryPairs(data.pairs).find((p) => p.roster1 === ownId || p.roster2 === ownId)
    if (!pair) return []
    const own = pair.roster1 === ownId ? pair.categories1 : pair.categories2
    const other = pair.roster1 === ownId ? pair.categories2 : pair.categories1
    const at = typeof data.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : null
    const totals = Object.keys(own).sort((a, b) => Number(a) - Number(b))
      .map((id) => `stat ${id} ${own[id]!.toFixed(2)} vs ${other[id]!.toFixed(2)}`).join('; ')
    return [{ week: data.week as number, text: `${league.season} week ${data.week}: ${totals}${at ? ` (fetched ${at})` : ''}.` }]
  }).sort((a, b) => b.week - a.week).slice(0, args.limit)
  if (!shown.length) return `No verified ${provider.toUpperCase()} category totals are stored for your team in ${league.name}${args.week ? ` week ${args.week}` : ''}. Missing totals are a data gap.`
  return [`IMPORTED CATEGORY HISTORY — ${league.name} (${league.sport}).`, ...shown.map((row) => row.text),
    `Source: stored ${provider.toUpperCase()} matchup category snapshots. Fetch time is shown where recorded; final status, category winners and fantasy points are not inferred.`].join('\n')
}

async function importedRotoHistory(args: { league: { id: string; name: string | null; sport: string };
  season: number | null; week: number | null; limit: number }): Promise<string> {
  if (args.week != null) return `Only season standings are stored for imported rotisserie league ${args.league.name}; week ${args.week} rank history is unavailable.`
  const [facts, teams] = await Promise.all([
    prisma.seasonStandingFact.findMany({ where: { leagueId: args.league.id,
      ...(args.season == null ? {} : { season: args.season }) },
      select: { season: true, teamId: true, rank: true, wins: true, losses: true,
        ties: true, pointsFor: true }, orderBy: [{ season: 'desc' }, { rank: 'asc' }], take: 300 }),
    prisma.leagueTeam.findMany({ where: { leagueId: args.league.id },
      select: { externalId: true, teamName: true, ownerName: true }, take: 100 }),
  ])
  const played = new Set(facts.filter((f) => f.wins || f.losses || f.ties || f.pointsFor !== 0).map((f) => f.season))
  const names = new Map(teams.map((t) => [t.externalId, t.teamName || t.ownerName]))
  const rows = facts.filter((f) => played.has(f.season) && f.rank != null && f.rank > 0)
    .slice(0, args.limit * 10)
  if (!rows.length) return `No played historical rotisserie standings with ranks are stored for ${args.league.name}${args.season ? ` in ${args.season}` : ''}. Missing standings are a data gap.`
  const seasons = [...new Set(rows.map((row) => row.season))].slice(0, args.limit)
  const lines = [`IMPORTED ROTISSERIE SEASON HISTORY — ${args.league.name} (${args.league.sport}).`]
  for (const season of seasons) {
    lines.push(`${season}: ${rows.filter((row) => row.season === season).map((row) =>
      `${row.rank}. ${names.get(row.teamId) || `team ${row.teamId}`}`).join('; ')}.`)
  }
  lines.push('Source: imported season standing facts. These are stored placements, not per-category totals. Current team names may differ from historical names; no past manager identity is inferred.')
  return lines.join('\n')
}

async function nativeCategoryHistory(args: { leagueId: string; userId: string; leagueName: string;
  format: 'categories' | 'roto'; season: number | null; week: number | null; limit: number }): Promise<string> {
  const rosters = await prisma.redraftRoster.findMany({ where: { leagueId: args.leagueId, ownerId: args.userId },
    select: { id: true } })
  if (!rosters.length) return `No claimed native roster is on file for you in ${args.leagueName}; historical category results cannot be attributed safely.`
  const rosterIds = rosters.map((r) => r.id)
  const rosterSet = new Set(rosterIds)
  const rows = await prisma.redraftMatchup.findMany({ where: {
    leagueId: args.leagueId, status: 'final',
    OR: [{ homeRosterId: { in: rosterIds } }, { awayRosterId: { in: rosterIds } }],
    ...(args.season == null ? {} : { season: { season: args.season } }),
    ...(args.week == null ? {} : { week: args.week }),
  }, select: { week: true, homeRosterId: true, lineupSnapshots: true, season: { select: { season: true } } },
  orderBy: [{ season: { season: 'desc' } }, { week: 'desc' }], take: 200 })
  const lines: string[] = []
  for (const row of rows) {
    const snap = row.lineupSnapshots && typeof row.lineupSnapshots === 'object' && !Array.isArray(row.lineupSnapshots)
      ? row.lineupSnapshots as Record<string, unknown> : null
    const raw = snap?.categoryMatchup
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const category = raw as Record<string, unknown>
    if (!Array.isArray(category.categories)) continue
    const mineHome = rosterSet.has(row.homeRosterId)
    const parts = category.categories.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const c = item as Record<string, unknown>
      const mine = mineHome ? c.aValue : c.bValue
      const theirs = mineHome ? c.bValue : c.aValue
      if (typeof c.label !== 'string') return []
      const fmt = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : 'unqualified'
      return [`${c.label} ${fmt(mine)} vs ${fmt(theirs)}`]
    })
    if (!parts.length) continue
    const wins = mineHome ? category.aWins : category.bWins
    const losses = mineHome ? category.bWins : category.aWins
    const record = args.format === 'categories' && typeof wins === 'number' && typeof losses === 'number'
      ? `, categories won ${wins}-${losses}${typeof category.ties === 'number' ? `-${category.ties} tied` : ''}` : ''
    lines.push(`${row.season.season} week ${row.week}${record}: ${parts.join('; ')}.`)
    if (lines.length >= args.limit) break
  }
  if (!lines.length) return `No finalized ${args.format} snapshot is stored for your team in ${args.leagueName}${args.season ? ` in ${args.season}` : ''}${args.week ? ` week ${args.week}` : ''}. This is a data gap, not evidence of a zero score.`
  return [`HISTORICAL ${args.format.toUpperCase()} SNAPSHOTS — ${args.leagueName}.`, ...lines,
    'Source: finalized native redraft category snapshots. These are recorded category values, not fantasy points. Rotisserie ranks and historical opponent identity are not available from these snapshots.'].join('\n')
}

/** Historical head-to-head results from the same fact/live merge as the Career record book. */
export async function buildLeagueFantasyHistoryContext(args: {
  leagueId: string; userId: string; season?: number | null; week?: number | null; limit?: number | null; player?: string | null
}): Promise<string> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId },
    select: { id: true, name: true, sport: true, season: true, leagueType: true, settings: true, platform: true, platformLeagueId: true } })
  if (!league) return 'The selected league could not be read. Do not infer historical results.'
  const leagueName = String(league.name ?? '').trim()
  if (!leagueName) return 'The selected league has no recorded name, so its Career history cannot be matched safely.'
  const season = Number.isInteger(args.season) && (args.season ?? 0) >= 2000 && (args.season ?? 0) <= 2100 ? args.season ?? null : null
  const week = Number.isInteger(args.week) && (args.week ?? 0) >= 1 && (args.week ?? 0) <= 60 ? args.week ?? null : null
  const limit = Math.min(20, Math.max(1, Number.isInteger(args.limit) ? args.limit! : 8))
  if (args.player?.trim()) return playerFantasyHistory({ league, player: args.player, season, week, limit })
  const format = weeklyFormat(league)
  if (format === 'categories' || format === 'roto') {
    if (!nativeWeeklyLeague(league)) return format === 'categories'
      ? importedCategoryHistory({ league, userId: args.userId, season, week, limit })
      : importedRotoHistory({ league, season, week, limit })
    return nativeCategoryHistory({ leagueId: league.id, userId: args.userId, leagueName, format, season, week, limit })
  }
  const filter = { ...NO_CAREER_FILTER, league: leagueName.toLowerCase(),
    fromSeason: season, toSeason: season }
  const result = await loadCareerGames(args.userId, filter)
  const games = result.games.filter((g) => g.leagueId === league.id && (season == null || g.season === season) && (week == null || g.week === week))
    .sort((a, b) => b.season - a.season || b.week - a.week)
  if (!games.length) return `No played head-to-head matchup is stored for your team in ${leagueName}${season ? ` in ${season}` : ''}${week ? ` week ${week}` : ''}. This is a data gap, not proof no game happened. Elimination formats may have weekly scores without pairings.`
  const shown = games.slice(0, limit)
  const w = games.filter((g) => g.result === 'W').length
  const l = games.filter((g) => g.result === 'L').length
  const t = games.filter((g) => g.result === 'T').length
  const lines = [`HISTORICAL FANTASY MATCHUPS — ${leagueName} (${league.sport}).`,
    `${games.length} played result(s) on file${season ? ` for ${season}` : ''}${week ? `, week ${week}` : ''}: ${w} W, ${l} L, ${t} T.`]
  for (const g of shown) lines.push(`${g.season} week ${g.week}: ${g.result} ${g.myScore.toFixed(2)}–${g.oppScore.toFixed(2)} versus ${g.oppName ?? 'unnamed opponent'}.`)
  if (shown.length < games.length) lines.push(`Showing ${shown.length} of ${games.length} played results; ask for a season or week to narrow this history.`)
  lines.push('Source: Career matchup facts for backfilled seasons, with current-season weekly matchups only where facts are absent. Unplayed 0–0 fixtures are excluded. Historical roster membership and per-player fantasy scoring are not implied by team results.')
  return lines.join('\n')
}
