import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { ingestSportStats } from '@/lib/schedule-stats'

/**
 * COLLEGE FOOTBALL GAME LOGS, FROM A RESPONSE WE WERE ALREADY FETCHING AND THROWING AWAY.
 *
 * `syncCfbdPlayerStatsToDb` calls CFBD `/games/players` for every regular-season week on each 6-hour
 * run, only to COUNT the games each player appeared in — then discarded every box-score line. So
 * `player_game_stats` held 0 NCAAF rows (measured on production 2026-09-23) while the lines were
 * downloaded four times a day. This module keeps them. It makes NO provider call of its own.
 *
 * SHAPE — captured 2026-09-23 (`__tests__/fixtures/cfbd/games-players.2026-w3.sample.json`, one call):
 *   [{ id, teams: [{ team, conference, homeAway, points, categories: [
 *       { name: 'passing', types: [{ name: 'C/ATT', athletes: [{ id, name, stat: '20/34' }] }, …] }, …] }] }]
 *   Every stat is a STRING. Week 3 of 2026: 128 games, every division (FBS, FCS, D-II), 9,183
 *   player-game lines — ~140k a season.
 *
 * KEYS match the season totals in `fantasy_stat_lines` (`passing.YDS`, `rushing.TD`, …), and the two
 * "made/attempted" strings are split into the same names the season rows use (`passing.COMPLETIONS`
 * / `passing.ATT`), so a game line and a season line read the same way.
 *
 * ⚠ `team` / `opponent` ARE LEFT NULL ON PURPOSE. Those columns are VarChar(8), hold NFL-style
 * abbreviations, and feed the opponent-adjustment queries. CFBD sends school names ("Vanderbilt",
 * 10 characters), which would fail the write — and truncating them would invent abbreviations. The
 * school names travel in the stat payload (`_team`, `_opponent`) instead.
 */

type Db = Pick<typeof defaultPrisma, "statIngestionJob" | "sportsGame">

export type CfbdAthlete = { id?: unknown; name?: unknown; stat?: unknown }
export type CfbdGame = {
  id?: unknown
  teams?: Array<{
    team?: unknown
    conference?: unknown
    homeAway?: unknown
    points?: unknown
    categories?: Array<{ name?: unknown; types?: Array<{ name?: unknown; athletes?: CfbdAthlete[] }> }>
  }>
}

export type CfbdGameLogRow = {
  playerId: string
  gameId: string
  statPayload: Record<string, number | string>
}

/** "20/34" style values, split into the names the season rows already use. */
const SPLIT_KEYS: Record<string, [string, string]> = {
  'passing.C/ATT': ['passing.COMPLETIONS', 'passing.ATT'],
  'kicking.FG': ['kicking.FGM', 'kicking.FGA'],
  'kicking.XP': ['kicking.XPM', 'kicking.XPA'],
}

function statValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!/^-?[0-9]+([.][0-9]+)?$/.test(t)) return null
  return Number(t)
}

function splitPair(raw: unknown): [number, number] | null {
  if (typeof raw !== 'string') return null
  const m = /^\s*([0-9]+)\s*[/-]\s*([0-9]+)\s*$/.exec(raw)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** One game id namespace for CFBD rows, so they can never collide with another provider's ids. */
export function cfbdGameId(id: unknown): string | null {
  const s = id == null ? '' : String(id).trim()
  return s ? `cfbd:${s}` : null
}

/**
 * One row per player per game, with every category they appeared in merged into one flat map.
 * Pure: no I/O, so the fixture test exercises exactly what production runs.
 */
export function parseCfbdGamePlayers(games: unknown): CfbdGameLogRow[] {
  if (!Array.isArray(games)) return []
  const rows = new Map<string, CfbdGameLogRow>()

  for (const game of games as CfbdGame[]) {
    const gameId = cfbdGameId(game?.id)
    if (!gameId || !Array.isArray(game.teams)) continue
    const schools = game.teams.map((t) => String(t?.team ?? '').trim())

    game.teams.forEach((team, teamIndex) => {
      const school = schools[teamIndex]
      const opponent = schools.find((_, i) => i !== teamIndex) ?? ''
      for (const category of team?.categories ?? []) {
        const cat = String(category?.name ?? '').trim()
        if (!cat) continue
        for (const type of category?.types ?? []) {
          const statName = String(type?.name ?? '').trim()
          if (!statName) continue
          const key = `${cat}.${statName}`
          for (const athlete of type?.athletes ?? []) {
            const playerId = athlete?.id == null ? '' : String(athlete.id).trim()
            // CFBD emits team-total rows with a negative/zero id ("Team"); they are not players.
            if (!playerId || !/^[0-9]+$/.test(playerId)) continue
            const rowKey = `${gameId}|${playerId}`
            let row = rows.get(rowKey)
            if (!row) {
              row = {
                playerId,
                gameId,
                statPayload: {
                  name: String(athlete.name ?? '').trim(),
                  _team: school,
                  _opponent: opponent,
                  _homeAway: String(team?.homeAway ?? ''),
                },
              }
              rows.set(rowKey, row)
            }
            const split = SPLIT_KEYS[key]
            if (split) {
              const pair = splitPair(athlete.stat)
              if (pair) {
                row.statPayload[split[0]] = pair[0]
                row.statPayload[split[1]] = pair[1]
              }
              continue
            }
            const v = statValue(athlete.stat)
            if (v != null) row.statPayload[key] = v
          }
        }
      }
    })
  }
  return [...rows.values()]
}

// ── Persistence ──────────────────────────────────────────────────────────────────────────────

/** The ledger source these rows are written under (via `ingestSportStats`' own job row). */
export const CFBD_GAME_LOG_SOURCE = 'cfbd-weekly'

/** As for the NFL import: a week is settled 36h after its last kickoff (games + corrections). */
export const NCAAF_WEEK_SETTLE_MS = 36 * 60 * 60 * 1000

/**
 * Weeks written per run. The first run after deploy backfills every week played so far (~9k rows
 * each) inside the cron's budget; four runs a day clear a season's backlog quickly.
 */
export const MAX_WEEKS_PER_RUN = 2

export type CfbdGameLogReport = {
  weeksWritten: Array<{ week: number; rows: number }>
  weeksSkippedComplete: number[]
  weeksDeferred: number[]
  errors: string[]
}

/**
 * Decides, from OUR tables and before any fetch, which weeks still need writing — so the fetch
 * loop keeps parsed rows only for those (a raw week is ~3.8 MB; holding fifteen would be ~57 MB).
 *
 * Same rule as the NFL fix (`findWeeksNeedingWork`): a week is done only once it has SETTLED and a
 * completed ledger row was written AFTER that point. Unsettled weeks are rewritten each run, so late
 * games and stat corrections land. A week with no schedule rows is treated as not done — safe,
 * because the upserts are idempotent.
 */
export async function planCfbdGameLogs(
  args: { season: number; now?: Date },
  db: Db = defaultPrisma,
): Promise<{ isComplete: (week: number) => boolean; dateByGame: Map<string, Date> }> {
  const now = (args.now ?? new Date()).getTime()
  const [ledger, schedule] = await Promise.all([
    db.statIngestionJob.findMany({
      where: { sportType: 'NCAAF', season: args.season, source: CFBD_GAME_LOG_SOURCE, status: 'completed' },
      select: { weekOrRound: true, completedAt: true },
    }),
    db.sportsGame.findMany({
      where: { sport: 'NCAAF', season: args.season, source: 'cfbd', week: { not: null }, startTime: { not: null } },
      select: { externalId: true, week: true, startTime: true },
    }),
  ])

  const lastKickoff = new Map<number, number>()
  const dateByGame = new Map<string, Date>()
  for (const g of schedule) {
    if (g.startTime == null || g.week == null) continue
    const id = cfbdGameId(g.externalId)
    if (id) dateByGame.set(id, g.startTime)
    const t = g.startTime.getTime()
    if (t > (lastKickoff.get(g.week) ?? -Infinity)) lastKickoff.set(g.week, t)
  }

  return {
    dateByGame,
    isComplete: (week) => {
      const kickoff = lastKickoff.get(week)
      if (kickoff == null) return false
      const settledAt = kickoff + NCAAF_WEEK_SETTLE_MS
      return (
        now >= settledAt &&
        ledger.some((r) => r.weekOrRound === week && r.completedAt != null && r.completedAt.getTime() >= settledAt)
      )
    },
  }
}

/**
 * Collects parsed weeks during the fetch loop (only the ones the plan wants, at most
 * MAX_WEEKS_PER_RUN), then writes them. Never throws: a game-log failure must not fail the
 * season-stat import it rides along with — it is reported on the result instead.
 */
export function createCfbdGameLogCollector(plan: Awaited<ReturnType<typeof planCfbdGameLogs>>) {
  const kept = new Map<number, CfbdGameLogRow[]>()
  const report: CfbdGameLogReport = { weeksWritten: [], weeksSkippedComplete: [], weeksDeferred: [], errors: [] }

  return {
    report,
    offer(week: number, games: unknown): void {
      if (plan.isComplete(week)) {
        report.weeksSkippedComplete.push(week)
        return
      }
      if (kept.size >= MAX_WEEKS_PER_RUN) {
        report.weeksDeferred.push(week)
        return
      }
      const rows = parseCfbdGamePlayers(games)
      if (rows.length > 0) kept.set(week, rows)
    },
    async flush(args: { season: number }, ingest: typeof ingestSportStats = ingestSportStats): Promise<CfbdGameLogReport> {
      for (const [week, rows] of kept) {
        try {
          await ingest({
            sportType: 'NCAAF',
            season: args.season,
            weekOrRound: week,
            source: CFBD_GAME_LOG_SOURCE,
            playerStats: rows.map((r) => ({
              playerId: r.playerId,
              gameId: r.gameId,
              /*
               * The payload carries the school names (`_team`, `_opponent`) and the player name
               * as strings next to the numbers. `normalizeStatPayload` skips non-numbers, so they
               * reach the stored payload and never the normalized map or the points.
               */
              statPayload: r.statPayload as Record<string, number>,
              gameDate: plan.dateByGame.get(r.gameId) ?? null,
            })),
          })
          report.weeksWritten.push({ week, rows: rows.length })
        } catch (e) {
          if (report.errors.length < 5) {
            report.errors.push(`week ${week}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`)
          }
        }
      }
      kept.clear()
      return report
    },
  }
}
