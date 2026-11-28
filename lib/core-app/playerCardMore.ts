import { prisma } from '@/lib/prisma'
import { loadRiSeasonRowsForName } from '@/lib/player-comparison-lab/riSeasonRowsByName'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * The player card's tabbed sections beyond the first screen: Game log, Career and Depth chart.
 *
 * Fetched lazily by the sheet (`/api/core/player-card/more`) so opening a card never waits on them.
 * Every one is a Postgres read of a table an ingestion job already fills — `PlayerGameStat`,
 * `PlayerSeasonStats` (through the same name-bound reader /api/players/season-stats uses) and
 * `DepthChart` — so nothing here calls a provider.
 *
 * ⚠ AN EMPTY SECTION IS AN EMPTY ARRAY, AND THE CARD HIDES ITS TAB. A sport or a player a table does
 * not cover shows no Career tab, never a tab that says "no data".
 */

export type CardGameLogRow = {
  season: number
  week: number
  date: string | null
  opponent: string | null
  points: number
}

export type CardCareerRow = {
  season: string
  team: string | null
  games: number | null
  points: number | null
  perGame: number | null
}

export type CardDepthRow = { name: string; rank: number; isSubject: boolean }

export type PlayerCardMore = {
  gameLog: CardGameLogRow[]
  career: CardCareerRow[]
  depthChart: { position: string; rows: CardDepthRow[] } | null
}

export const EMPTY_MORE: PlayerCardMore = { gameLog: [], career: [], depthChart: null }

const round1 = (n: number) => Math.round(n * 10) / 10

/** The newest season present, its games newest first. Rows of older seasons are Career's job. */
export function shapeGameLog(
  rows: Array<{ season: number; weekOrRound: number; gameDate: Date | null; opponent: string | null; fantasyPoints: number }>,
  limit = 20,
): CardGameLogRow[] {
  if (rows.length === 0) return []
  const season = Math.max(...rows.map((r) => r.season))
  const byGame = new Map<string, CardGameLogRow>()
  for (const r of rows) {
    if (r.season !== season) continue
    const date = r.gameDate ? r.gameDate.toISOString().slice(0, 10) : null
    const key = `${r.weekOrRound}|${date ?? ''}`
    // Several sources can write one game; keep the first (the query orders newest-updated first).
    if (byGame.has(key)) continue
    byGame.set(key, { season, week: r.weekOrRound, date, opponent: r.opponent, points: round1(r.fantasyPoints) })
  }
  return [...byGame.values()]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.week - a.week)
    .slice(0, limit)
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** One position's chart, in depth order, with the card's own player marked. */
export function shapeDepthChart(
  players: unknown,
  subject: { name: string; ids: readonly string[] },
): CardDepthRow[] {
  if (!Array.isArray(players)) return []
  const ids = new Set(subject.ids.filter(Boolean))
  const target = normName(subject.name)
  const rows = players
    .map((p, i) => {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      const name = typeof o.player === 'string' ? o.player : typeof o.name === 'string' ? o.name : null
      if (!name) return null
      const rank = typeof o.rank === 'number' && Number.isFinite(o.rank) ? o.rank : i + 1
      const id = o.id != null ? String(o.id) : null
      return { name, rank, isSubject: (id != null && ids.has(id)) || normName(name) === target }
    })
    .filter((r): r is CardDepthRow => r != null)
  return rows.sort((a, b) => a.rank - b.rank).slice(0, 6)
}

export async function loadPlayerCardMore(input: {
  sport: string
  name: string
  position: string | null
  team: string | null
  ids: readonly string[]
}): Promise<PlayerCardMore> {
  const sport = input.sport.toUpperCase()
  const ids = [...new Set(input.ids.filter(Boolean))]
  const teamCode = input.team ? (sport === 'NFL' ? normalizeTeamAbbrev(input.team) : null) ?? input.team.toUpperCase() : null
  const position = input.position?.toUpperCase() ?? null

  const [games, career, depth] = await Promise.all([
    ids.length
      ? prisma.playerGameStat
          .findMany({
            where: { sportType: sport, playerId: { in: ids } },
            orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
            take: 80,
            select: { season: true, weekOrRound: true, gameDate: true, opponent: true, fantasyPoints: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    loadRiSeasonRowsForName({ name: input.name, sport, position, team: input.team, limit: 6 }).catch(() => null),
    teamCode && position
      ? prisma.depthChart
          .findFirst({ where: { sport, team: teamCode, position }, orderBy: { fetchedAt: 'desc' }, select: { position: true, players: true } })
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const careerRows: CardCareerRow[] =
    career && career.resolution !== 'ambiguous'
      ? career.rows.map((r) => ({
          season: String(r.season),
          team: r.team ?? null,
          games: r.gamesPlayed ?? null,
          points: r.fantasyPoints != null ? round1(r.fantasyPoints) : null,
          perGame: r.fantasyPointsPerGame != null ? round1(r.fantasyPointsPerGame) : null,
        }))
      : []

  const depthRows = depth ? shapeDepthChart(depth.players, { name: input.name, ids }) : []

  return {
    gameLog: shapeGameLog(games),
    career: careerRows.filter((r) => r.games != null || r.points != null),
    // A chart that does not list him is someone else's chart (a stale team or a position mismatch).
    depthChart: depth && depthRows.some((r) => r.isSubject) ? { position: depth.position, rows: depthRows } : null,
  }
}
