import type { PrismaClient } from '@prisma/client'

import { applyLearnedFactors, type FactorLevels, type LearnedFactorLevel } from './factorLearner'
import { situationOf, usageOf, type GameLine } from './factorObservations'
import { FACTOR_TABLE_KEY, FACTOR_TABLE_MAX_AGE_MS, projectionFactorsOn, type StoredFactorTable } from './factorLearning'
import type { GameContextLevels } from './gameContext'

/**
 * The live half of AF's projection factors: read a sport's learned table and move a player's projection for the game(s)
 * ahead by the factors his situation has — only PUBLISHED ones (they made later games closer in the hold-out check).
 * Never throws; with no table, an old table or `AF_PROJECTION_FACTORS=off`, every multiplier is 1 and every projection
 * is exactly what it was.
 */

type CacheDb = Pick<PrismaClient, 'sportsDataCache'>
type StatsDb = Pick<PrismaClient, 'playerGameStat'>

const memo = new Map<string, { at: number; table: StoredFactorTable | null }>()
const MEMO_MS = 10 * 60_000

/** A sport's learned table, or null (off, missing, older than 21 days, unreadable). */
export async function loadFactorTable(db: CacheDb, sport: string, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<StoredFactorTable | null> {
  if (!projectionFactorsOn(env)) return null
  const s = sport.toUpperCase()
  const hit = memo.get(s)
  if (hit && now.getTime() - hit.at < MEMO_MS) return hit.table
  let table: StoredFactorTable | null = null
  try {
    const row = await db.sportsDataCache.findUnique({ where: { cacheKey: FACTOR_TABLE_KEY(s) }, select: { data: true } })
    const d = row?.data as StoredFactorTable | null | undefined
    const at = d ? Date.parse(d.generatedAt) : NaN
    table = d && Array.isArray(d.levels) && Number.isFinite(at) && now.getTime() - at <= FACTOR_TABLE_MAX_AGE_MS ? d : null
  } catch {
    table = null
  }
  memo.set(s, { at: now.getTime(), table })
  return table
}

/** Test hook. */
export function resetFactorTableMemo(): void {
  memo.clear()
}

/** A published factor, said plainly, for the "why" beside a projection. PURE. */
export function factorReason(l: LearnedFactorLevel): string {
  const pct = Math.round((l.multiplier - 1) * 100)
  const signed = `${pct > 0 ? '+' : ''}${pct}%`
  const what: Record<string, string> = {
    'rest:back_to_back': 'second game of a back-to-back',
    'rest:short_rest': 'short rest',
    'rest:long_rest': 'extra rest',
    'form:hot': 'hot over his last 3 games',
    'form:cold': 'cold over his last 3 games',
    'usage:rising': 'playing time rising',
    'usage:falling': 'playing time falling',
    'opponent:soft': 'opponent allows more than average',
    'opponent:tough': 'opponent allows less than average',
    'team_change:new_team': 'new team',
    'returning:returning': 'first game back after a layoff',
    'vegas:high': 'his team is expected to score 3+ points more than the week’s average (closing line)',
    'vegas:low': 'his team is expected to score 3+ points less than the week’s average (closing line)',
    'weather:bad': 'wind 15+ mph or rain or snow likely',
    'weather:dome': 'played indoors',
    'coaching:new_coach': 'first season under a new head coach',
  }
  return `${what[`${l.factor}:${l.level}`] ?? `${l.factor} ${l.level}`} ${signed} (measured on ${l.games.toLocaleString('en-US')} games)`
}

export type FactorAdjustment = { multiplier: number; reasons: string[]; levels: FactorLevels }

/**
 * Each player's adjustment for his next game, from his recent stored lines. `next.drop` removes factors the caller
 * cannot know for this period (rest and opponent when a week holds several games). Players with too few recent games
 * get no entry.
 */
export async function liveFactorAdjustments(
  db: StatsDb,
  args: {
    sport: string
    table: StoredFactorTable | null
    players: ReadonlyArray<{ key: string; gameLogId: string; next: { atMs: number; opponent?: string | null; drop?: ReadonlyArray<keyof FactorLevels>; context?: GameContextLevels } }>
    now?: Date
  },
): Promise<Map<string, FactorAdjustment>> {
  const out = new Map<string, FactorAdjustment>()
  const { table } = args
  if (!table || !table.levels.some((l) => l.published) || args.players.length === 0) return out
  const sport = args.sport.toUpperCase()
  const now = args.now ?? new Date()
  const ids = [...new Set(args.players.map((p) => p.gameLogId))]
  const rows = await db.playerGameStat
    .findMany({
      where: { playerId: { in: ids }, sportType: { in: [sport, sport.toLowerCase()] }, OR: [{ gameDate: { gte: new Date(now.getTime() - 120 * 86_400_000) } }, { gameDate: null, season: { gte: now.getUTCFullYear() - 1 } }] },
      select: { playerId: true, gameId: true, providerGameId: true, gameDate: true, season: true, weekOrRound: true, team: true, fantasyPoints: true, normalizedStatMap: true },
    })
    .catch(() => [])
  const byPlayer = new Map<string, GameLine[]>()
  for (const r of rows) {
    const map = r.normalizedStatMap as { scored?: unknown } | null
    if (map && (map.scored === false || String(map.scored) === 'false')) continue
    const line: GameLine = {
      playerId: r.playerId,
      gameKey: r.providerGameId || String(r.gameId ?? '').split(':')[0],
      atMs: r.gameDate ? r.gameDate.getTime() : Date.UTC(r.season, 8, 1) + Math.max(0, r.weekOrRound - 1) * 7 * 86_400_000,
      team: r.team,
      opponent: null,
      points: Number(r.fantasyPoints ?? 0),
      usage: usageOf(sport, r.normalizedStatMap),
    }
    byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), line])
  }
  for (const p of args.players) {
    const lines = byPlayer.get(p.gameLogId)
    if (!lines) continue
    // One line per game (MLB two-way lines are two rows), oldest first.
    const games = new Map<string, GameLine>()
    for (const l of lines) {
      const g = games.get(l.gameKey)
      games.set(l.gameKey, g ? { ...g, points: g.points + l.points, usage: g.usage ?? l.usage } : { ...l })
    }
    const past = [...games.values()].filter((g) => g.atMs < p.next.atMs).sort((a, b) => a.atMs - b.atMs)
    const ratio = p.next.opponent ? table.opponentRatios?.[p.next.opponent] ?? null : null
    /*
     * His team is read from the FEED (his latest line), never the roster row: the learner compared feed codes with feed
     * codes, and a roster's spelling ("Los Angeles Lakers") against a feed code ("LAL") would read as a trade.
     */
    const sit = situationOf(sport, past, { atMs: p.next.atMs, team: past.length ? past[past.length - 1]!.team : null, context: p.next.context }, ratio)
    if (!sit) continue
    for (const f of p.next.drop ?? []) delete sit.levels[f]
    const { multiplier, applied } = applyLearnedFactors(1, sit.levels, table)
    if (applied.length === 0) continue
    out.set(p.key, { multiplier, reasons: applied.map(factorReason), levels: sit.levels })
  }
  return out
}
