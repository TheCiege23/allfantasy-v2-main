import type { PrismaClient } from '@prisma/client'

import { describeFactorTable, learnFactors, type LearnedFactorTable } from './factorLearner'
import { buildFactorObservations, opponentRatios, usageOf, type GameLine } from './factorObservations'

/**
 * The scheduled half of AF's projection factors (`factorLearner.ts`): read a sport's stored game lines, learn, store.
 *
 * ONE SPORT PER CALL — the stalest one — so it can ride the ten-minute maintenance cron (`decision-os-intelligence-
 * maintenance`) without a cron slot of its own (the registry is at its ceiling) and without ever holding that cron
 * for more than one sport's read. A sport relearns once a day at most; with seven sports, each gets a fresh table every
 * day as long as the cron runs at least seven times, which it does ~144 times.
 *
 * `AF_PROJECTION_FACTORS=off` stops the learning AND the applying (`factorTables.ts`). With no table, every
 * projection is exactly what it was before this existed.
 */

export const FACTOR_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAB', 'NCAAF', 'SOCCER'] as const
export const FACTOR_TABLE_KEY = (sport: string) => `af-projections:factors:${sport.toUpperCase()}`
export const AF_PROJECTION_FACTORS_ENV = 'AF_PROJECTION_FACTORS'
export const projectionFactorsOn = (env: NodeJS.ProcessEnv = process.env) => String(env[AF_PROJECTION_FACTORS_ENV] ?? '').trim().toLowerCase() !== 'off'

/** A table is relearned once it is this old. */
export const RELEARN_AFTER_MS = 24 * 3_600_000
/** A table older than this is not used to move a projection. */
export const FACTOR_TABLE_MAX_AGE_MS = 21 * 86_400_000
/** Games read per sport: the last ~14 months, newest first, bounded. */
const LOOKBACK_MS = 420 * 86_400_000
const MAX_ROWS = 200_000
const DAY = 86_400_000

const SPORT_KEYS: Record<string, string[]> = {
  NCAAF: ['NCAAF', 'NCAAFB', 'ncaaf', 'ncaafb'],
  NCAAB: ['NCAAB', 'NCAABB', 'ncaab', 'ncaabb'],
}
const keysFor = (sport: string) => SPORT_KEYS[sport] ?? [sport, sport.toLowerCase()]
const USAGE_SPORTS = new Set(['NBA', 'NCAAB', 'NHL', 'NFL'])

type Db = Pick<PrismaClient, 'playerGameStat' | 'sportsDataCache'>

/** Read one sport's game lines as `GameLine`s. */
export async function readGameLines(db: Pick<PrismaClient, 'playerGameStat'>, sport: string, now: Date): Promise<GameLine[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS)
  const year = now.getUTCFullYear()
  const withUsage = USAGE_SPORTS.has(sport)
  const rows = await db.playerGameStat.findMany({
    where: {
      sportType: { in: keysFor(sport) },
      // Weekly NFL lines can carry no game date; those are placed by season and week instead.
      OR: [{ gameDate: { gte: since } }, { gameDate: null, season: { gte: year - 1 } }],
    },
    orderBy: { gameDate: 'desc' },
    take: MAX_ROWS,
    select: {
      playerId: true, gameId: true, providerGameId: true, gameDate: true, season: true, weekOrRound: true,
      team: true, opponent: true, fantasyPoints: true, ...(withUsage ? { normalizedStatMap: true } : {}),
    },
  })
  const out: GameLine[] = []
  for (const r of rows as Array<{ playerId: string; gameId: string; providerGameId: string | null; gameDate: Date | null; season: number; weekOrRound: number; team: string | null; opponent: string | null; fantasyPoints: number; normalizedStatMap?: unknown }>) {
    const map = r.normalizedStatMap as { scored?: unknown } | null | undefined
    if (map && (map.scored === false || String(map.scored) === 'false')) continue
    const atMs = r.gameDate ? r.gameDate.getTime() : Date.UTC(r.season, 8, 1) + Math.max(0, r.weekOrRound - 1) * 7 * DAY
    out.push({
      playerId: r.playerId,
      gameKey: r.providerGameId || String(r.gameId ?? '').split(':')[0] || `${r.season}:${r.weekOrRound}`,
      atMs,
      team: r.team,
      opponent: r.opponent,
      points: Number(r.fantasyPoints ?? 0),
      usage: withUsage ? usageOf(sport, r.normalizedStatMap) : null,
    })
  }
  return out
}

/** Which sport is next: no table first, then the oldest, skipping any learned in the last day. PURE. */
export function nextFactorSport(ages: ReadonlyMap<string, number | null>, nowMs: number): string | null {
  let pick: { sport: string; at: number } | null = null
  for (const sport of FACTOR_SPORTS) {
    const at = ages.get(sport) ?? null
    if (at != null && nowMs - at < RELEARN_AFTER_MS) continue
    const key = at ?? -Infinity
    if (!pick || key < pick.at) pick = { sport, at: key }
  }
  return pick?.sport ?? null
}

/** What is stored: the learned table plus what each opponent allows now. */
export type StoredFactorTable = LearnedFactorTable & { opponentRatios: Record<string, number> }

export type FactorLearningTick = { status: 'off' } | { status: 'fresh' } | { status: 'learned'; sport: string; line: string; observations: number }

export async function runFactorLearningTick(db: Db, opts: { now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<FactorLearningTick> {
  if (!projectionFactorsOn(opts.env)) return { status: 'off' }
  const now = opts.now ?? new Date()
  const stored = await db.sportsDataCache.findMany({
    where: { cacheKey: { in: FACTOR_SPORTS.map(FACTOR_TABLE_KEY) } },
    select: { cacheKey: true, data: true },
  })
  const ages = new Map<string, number | null>()
  for (const sport of FACTOR_SPORTS) {
    const row = stored.find((r) => r.cacheKey === FACTOR_TABLE_KEY(sport))
    const at = row?.data && typeof row.data === 'object' ? Date.parse(String((row.data as { generatedAt?: unknown }).generatedAt ?? '')) : NaN
    ages.set(sport, Number.isFinite(at) ? at : null)
  }
  const sport = nextFactorSport(ages, now.getTime())
  if (!sport) return { status: 'fresh' }
  const lines = await readGameLines(db, sport, now)
  // The opponents' current state rides with the table, so a live projection reads the same "soft" and "tough".
  const table: StoredFactorTable = { ...learnFactors(sport, buildFactorObservations(sport, lines), now), opponentRatios: opponentRatios(lines) }
  const expiresAt = new Date(now.getTime() + FACTOR_TABLE_MAX_AGE_MS)
  await db.sportsDataCache.upsert({
    where: { cacheKey: FACTOR_TABLE_KEY(sport) },
    create: { cacheKey: FACTOR_TABLE_KEY(sport), expiresAt, data: table as unknown as object },
    update: { expiresAt, data: table as unknown as object },
  })
  return { status: 'learned', sport, line: describeFactorTable(table), observations: table.observations }
}
