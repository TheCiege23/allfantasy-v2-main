import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { easternDateKey } from '@/lib/core-app/rankingsEngine'
import { loadRatedGames } from '@/lib/rank/skillRating/loadRatedGames'
import { replayAll, type GameLogEntry } from '@/lib/rank/skillRating/replay'

/**
 * The per-game skill rating, computed once a day and stored for the Rankings
 * tab to read.
 *
 * ⚠ STORED IN `sportsDataCache`, NOT A NEW TABLE — the same call the daily rank
 * snapshots made (`lib/core-app/rankingsSnapshots.ts`): a table is a migration,
 * and a migration is the user's call. Two kinds of document:
 *
 *   skill-rating:v1:board        every AllFantasy user's rating per sport, plus
 *                                the rating distribution of EVERY rated
 *                                manager (on AF or not) as percentiles
 *   skill-rating:v1:log:<user>   that user's recent games per sport
 *
 * ⚠ THE WRITER HAS A SCHEDULE. `runSkillRatingDaily` runs from
 * `/api/cron/domain-os-refresh`, once per Eastern day. A rating nothing
 * refreshes is worse than none, because it reads as "nobody moved".
 *
 * ⚠ IT IS A FULL REPLAY EVERY DAY, ON PURPOSE. Glicko-2 is order-dependent, so a
 * backfill that lands a 2019 season today has to move every rating after it.
 * Incremental updates would bake the old order in forever. Replaying ~100k games
 * in memory takes seconds; reading them is the cost.
 */

export const SKILL_BOARD_KEY = 'skill-rating:v1:board'
export const SKILL_LOG_PREFIX = 'skill-rating:v1:log:'
const RETENTION_DAYS = 400
/** Games kept per user per sport in the log document. */
export const SKILL_LOG_LIMIT = 60
const WRITE_BATCH = 100

export type SkillBoardRow = {
  /** AllFantasy user id. */
  u: string
  /** Rating, deviation, volatility. */
  r: number
  rd: number
  v: number
  /** Games, wins, losses, ties. */
  g: number
  w: number
  l: number
  t: number
  /** Last period played (see replay.periodOrdinal). */
  lp: number
}

export type SkillSportBoard = {
  games: number
  periods: number
  latestPeriod: number
  /** Everyone rated in this sport, on AllFantasy or not. */
  rated: number
  /** Conservative ratings (r - 2·rd) of every rated manager at the 0th…100th percentile. */
  percentiles: number[]
  rows: SkillBoardRow[]
}

export type SkillBoard = {
  date: string
  computedAt: string
  sources: { facts: number; weeks: number; native: number }
  sports: Record<string, SkillSportBoard>
}

export type SkillLog = {
  computedAt: string
  sports: Record<string, GameLogEntry[]>
}

function isBoard(v: unknown): v is SkillBoard {
  if (!v || typeof v !== 'object') return false
  const b = v as Partial<SkillBoard>
  return typeof b.date === 'string' && typeof b.computedAt === 'string' && !!b.sports && typeof b.sports === 'object'
}

function isLog(v: unknown): v is SkillLog {
  if (!v || typeof v !== 'object') return false
  const l = v as Partial<SkillLog>
  return typeof l.computedAt === 'string' && !!l.sports && typeof l.sports === 'object'
}

export async function readSkillBoard(): Promise<SkillBoard | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: SKILL_BOARD_KEY }, select: { data: true } })
    .catch(() => null)
  return row && isBoard(row.data) ? row.data : null
}

export async function readSkillLog(userId: string): Promise<SkillLog | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${SKILL_LOG_PREFIX}${userId}` }, select: { data: true } })
    .catch(() => null)
  return row && isLog(row.data) ? row.data : null
}

/** True once today's (Eastern) replay is stored — the cheap check before deciding to run. */
export async function skillRatingWrittenToday(now: Date = new Date()): Promise<boolean> {
  const board = await readSkillBoard()
  return board?.date === easternDateKey(now)
}

/** 101 values: the conservative rating at each whole percentile. */
export function percentilesOf(values: number[]): number[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  return Array.from({ length: 101 }, (_, p) => {
    const idx = Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1)))
    return Math.round(sorted[idx])
  })
}

/** Share of rated managers a conservative rating is at or above, 0–100. */
export function percentileRank(percentiles: number[], value: number): number | null {
  if (percentiles.length === 0) return null
  let p = 0
  for (let i = 0; i < percentiles.length; i++) if (value >= percentiles[i]) p = i
  return p
}

const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp

export type SkillRatingCounts = {
  date: string | null
  written: number
  alreadyWritten: number
  failed: number
  games: number
  rated: number
  afUsers: number
  ms: number
  errors: string[]
}

export function emptySkillRatingCounts(): SkillRatingCounts {
  return { date: null, written: 0, alreadyWritten: 0, failed: 0, games: 0, rated: 0, afUsers: 0, ms: 0, errors: [] }
}

/**
 * Recompute and store every rating, once per Eastern day.
 * `SKILL_RATING_DISABLED=true` turns it off; `force` ignores the once-a-day check.
 */
export async function runSkillRatingDaily(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<SkillRatingCounts> {
  const out = emptySkillRatingCounts()
  if (String(process.env.SKILL_RATING_DISABLED ?? '').toLowerCase() === 'true') return out
  const started = Date.now()
  const date = easternDateKey(now)
  out.date = date
  try {
    if (!opts.force) {
      const current = await readSkillBoard()
      if (current?.date === date) {
        out.alreadyWritten = 1
        return out
      }
    }

    const { games, sources } = await loadRatedGames()
    const replays = replayAll(games, (k) => k.startsWith('af:'))
    const computedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000)

    const board: SkillBoard = { date, computedAt, sources, sports: {} }
    const logs = new Map<string, SkillLog>()
    for (const [sport, rep] of replays) {
      const rows: SkillBoardRow[] = []
      const conservative: number[] = []
      for (const m of rep.managers.values()) {
        conservative.push(m.conservative)
        if (!m.key.startsWith('af:')) continue
        rows.push({
          u: m.key.slice(3),
          r: round(m.rating, 1),
          rd: round(m.rd, 1),
          v: round(m.volatility, 5),
          g: m.games,
          w: m.wins,
          l: m.losses,
          t: m.ties,
          lp: m.lastPeriod,
        })
      }
      board.sports[sport] = {
        games: rep.games,
        periods: rep.periods,
        latestPeriod: rep.latestPeriod,
        rated: rep.managers.size,
        percentiles: percentilesOf(conservative),
        rows,
      }
      out.games += rep.games
      out.rated += rep.managers.size
      for (const [key, entries] of rep.logs) {
        const userId = key.slice(3)
        const held = logs.get(userId) ?? { computedAt, sports: {} }
        held.sports[sport] = entries.slice(-SKILL_LOG_LIMIT)
        logs.set(userId, held)
      }
    }

    const boardData = board as unknown as Prisma.InputJsonValue
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: SKILL_BOARD_KEY },
      create: { cacheKey: SKILL_BOARD_KEY, data: boardData, expiresAt },
      update: { data: boardData, expiresAt },
    })

    const entries = [...logs.entries()]
    for (let i = 0; i < entries.length; i += WRITE_BATCH) {
      await prisma.$transaction(
        entries.slice(i, i + WRITE_BATCH).map(([userId, log]) => {
          const cacheKey = `${SKILL_LOG_PREFIX}${userId}`
          const data = log as unknown as Prisma.InputJsonValue
          return prisma.sportsDataCache.upsert({
            where: { cacheKey },
            create: { cacheKey, data, expiresAt },
            update: { data, expiresAt },
          })
        }),
      )
    }

    out.written = 1
    out.afUsers = logs.size
  } catch (e) {
    out.failed = 1
    out.errors.push(`skill_rating: ${e instanceof Error ? e.message : String(e)}`)
  }
  out.ms = Date.now() - started
  return out
}
