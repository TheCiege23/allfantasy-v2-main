import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { currentFantasySeason } from '@/lib/core-app/connectLeague'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/** TTL for cached game logs: 6 hours (stats are stable during off-season; acceptable lag in-season). */
const GAME_LOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface WeekStats {
  week: number
  opponent?: string
  pts_ppr?: number
  pts_half_ppr?: number
  pts_std?: number
  pass_yd?: number
  pass_td?: number
  pass_int?: number
  pass_att?: number
  pass_cmp?: number
  rush_yd?: number
  rush_td?: number
  rush_att?: number
  rec?: number
  rec_yd?: number
  rec_td?: number
  rec_tgt?: number
  fum_lost?: number
  gp?: number
  gms_active?: number
}

function normalizeCachedWeekStats(payload: unknown): WeekStats[] {
  if (!Array.isArray(payload)) return []

  const logs: WeekStats[] = []
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue
    const stats = entry as Record<string, unknown>
    const week = typeof stats.week === 'number' ? stats.week : Number(stats.week)
    if (!Number.isFinite(week)) continue

    logs.push({
      week,
      opponent: typeof stats.opponent === 'string' ? stats.opponent : undefined,
      pts_ppr: typeof stats.pts_ppr === 'number' ? stats.pts_ppr : undefined,
      pts_half_ppr: typeof stats.pts_half_ppr === 'number' ? stats.pts_half_ppr : undefined,
      pts_std: typeof stats.pts_std === 'number' ? stats.pts_std : undefined,
      pass_yd: typeof stats.pass_yd === 'number' ? stats.pass_yd : undefined,
      pass_td: typeof stats.pass_td === 'number' ? stats.pass_td : undefined,
      pass_int: typeof stats.pass_int === 'number' ? stats.pass_int : undefined,
      pass_att: typeof stats.pass_att === 'number' ? stats.pass_att : undefined,
      pass_cmp: typeof stats.pass_cmp === 'number' ? stats.pass_cmp : undefined,
      rush_yd: typeof stats.rush_yd === 'number' ? stats.rush_yd : undefined,
      rush_td: typeof stats.rush_td === 'number' ? stats.rush_td : undefined,
      rush_att: typeof stats.rush_att === 'number' ? stats.rush_att : undefined,
      rec: typeof stats.rec === 'number' ? stats.rec : undefined,
      rec_yd: typeof stats.rec_yd === 'number' ? stats.rec_yd : undefined,
      rec_td: typeof stats.rec_td === 'number' ? stats.rec_td : undefined,
      rec_tgt: typeof stats.rec_tgt === 'number' ? stats.rec_tgt : undefined,
      fum_lost: typeof stats.fum_lost === 'number' ? stats.fum_lost : undefined,
      gp: typeof stats.gp === 'number' ? stats.gp : undefined,
      gms_active: typeof stats.gms_active === 'number' ? stats.gms_active : undefined,
    })
  }

  return logs
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface SleeperWeekRow {
  week: number
  /** The opponent as the GAME ROW states it, or null when the row does not say. */
  opponent: string | null
  /** The team the player played for in THIS game, as the row states it — not his current team. */
  team: string | null
  stats: Record<string, unknown>
}

/**
 * Sleeper's `grouping=week` payload, normalized. It arrives either as an array of rows or as an
 * object keyed by week; a row's stat line may be flat or nested under `stats` (the same two shapes
 * `PlayerGameLogImportService.normalizeStats` and `teamDefenseProvider` accept). Row-level
 * `opponent` / `team` are read from the row, as the import service does.
 *
 * ⚠ THE OBJECT BRANCH USED TO READ STATS OFF THE ROW WITHOUT UNWRAPPING `stats`. The one non-DEF
 * player row in production's `player_game_log_cache` (season 2025, synced 2026-04-27) holds
 * seventeen weeks of `{week, opponent}` and not one stat — the opponents came from the current-team
 * schedule and the stat line was never found.
 */
function toSleeperWeekRows(raw: unknown): SleeperWeekRow[] {
  const entries: Array<{ key: string | null; value: unknown }> = Array.isArray(raw)
    ? raw.map((value) => ({ key: null, value }))
    : isRecord(raw)
      ? Object.entries(raw).map(([key, value]) => ({ key, value }))
      : []

  const rows: SleeperWeekRow[] = []
  for (const { key, value } of entries) {
    if (!isRecord(value)) continue // a bye week is `null`
    const stats = isRecord(value.stats) ? value.stats : value
    const week = Number(value.week ?? stats.week ?? key)
    if (!Number.isFinite(week) || week <= 0) continue
    const opponentRaw = typeof value.opponent === 'string' ? value.opponent : typeof stats.opponent === 'string' ? stats.opponent : null
    const teamRaw = typeof value.team === 'string' ? value.team : null
    rows.push({
      week,
      opponent: opponentRaw && opponentRaw.trim() ? opponentRaw.trim() : null,
      team: normalizeTeamAbbrev(teamRaw),
      stats,
    })
  }
  return rows
}

export const POST = withApiUsage({ endpoint: "/api/legacy/player-game-logs", tool: "LegacyPlayerGameLogs" })(async (req: NextRequest) => {
  const t0 = Date.now()
  try {
    const { player_id, season } = await req.json()

    if (!player_id) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

    // Default to the CURRENT NFL season, derived — a literal '2025' here outlived the 2025 season.
    const defaultSeason = String(currentFantasySeason(new Date()))
    const rawSeason = String(season || defaultSeason)
    const currentSeason = /^\d{4}$/.test(rawSeason) ? rawSeason : defaultSeason
    const sport = 'NFL'
    const seasonType = 'regular'

    // ── DB-first: check PlayerGameLogCache ──────────────────────────────────
    const cached = await prisma.playerGameLogCache.findUnique({
      where: {
        uniq_player_game_log_cache: {
          playerId: String(player_id),
          sport,
          season: currentSeason,
          seasonType,
        },
      },
    }).catch(() => null)

    const now = new Date()
    if (cached && cached.expiresAt > now) {
      const elapsedMs = Date.now() - t0
      const gameLogs = normalizeCachedWeekStats(cached.payload)
      console.log(`[player-game-logs GET] cache hit { playerId: '${player_id}', season: '${currentSeason}', elapsedMs: ${elapsedMs} }`)
      return NextResponse.json({
        ok: true,
        season: currentSeason,
        gameLogs,
        meta: { source: 'db-cache', syncedAt: cached.syncedAt.toISOString(), expiresAt: cached.expiresAt.toISOString() },
      })
    }

    // ── Cache miss: fetch from Sleeper ───────────────────────────────────────
    console.log(`[player-game-logs GET] cache miss { playerId: '${player_id}', season: '${currentSeason}' } — fetching Sleeper`)

    const res = await fetch(
      `https://api.sleeper.com/stats/nfl/player/${player_id}?season_type=regular&season=${currentSeason}&grouping=week`,
      { next: { revalidate: 3600 } }
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch game logs from Sleeper' }, { status: 502 })
    }

    const rawData = await res.json()

    const weekRows = toSleeperWeekRows(rawData)

    /*
     * 🛑 THE OPPONENT COMES FROM THE GAME ROW, NEVER FROM THE PLAYER'S *CURRENT* TEAM. This used to
     * build every week's opponent from today's team, so a past season for a player who has since
     * moved showed his NEW team's schedule beside his OLD team's stats. Now: the row's own
     * `opponent`; else the row's own `team` (the team he played for THAT week) looked up in that
     * season's schedule; else nothing. A blank cell is a gap — an invented opponent is a false fact.
     */
    const needsSchedule = weekRows.some((r) => !r.opponent && r.team)
    const scheduleOpponents = new Map<string, string>()
    try {
      const schedRes = needsSchedule ? await fetch(
        `https://api.sleeper.com/schedule/nfl/regular/${currentSeason}`,
        { next: { revalidate: 86400 } }
      ) : null
      if (schedRes?.ok) {
        const schedData = await schedRes.json()
        if (Array.isArray(schedData)) {
          for (const game of schedData) {
            const week = Number(game?.week)
            const home = normalizeTeamAbbrev(typeof game?.home === 'string' ? game.home : null)
            const away = normalizeTeamAbbrev(typeof game?.away === 'string' ? game.away : null)
            if (!Number.isFinite(week) || !home || !away) continue
            scheduleOpponents.set(`${week}:${home}`, away)
            scheduleOpponents.set(`${week}:${away}`, `@${home}`)
          }
        }
      }
    } catch {}

    const gameLogs: WeekStats[] = weekRows.map((row) => {
      const s = row.stats
      return {
        week: row.week,
        opponent: row.opponent ?? (row.team ? scheduleOpponents.get(`${row.week}:${row.team}`) : undefined),
        pts_ppr: num(s.pts_ppr) ?? num(s.fantasy_points_ppr),
        pts_half_ppr: num(s.pts_half_ppr),
        pts_std: num(s.pts_std),
        gp: num(s.gp) ?? num(s.gms_active),
        pass_att: num(s.pass_att),
        pass_cmp: num(s.pass_cmp),
        pass_yd: num(s.pass_yd),
        pass_td: num(s.pass_td),
        pass_int: num(s.pass_int),
        rush_att: num(s.rush_att),
        rush_yd: num(s.rush_yd),
        rush_td: num(s.rush_td),
        rec_tgt: num(s.rec_tgt),
        rec: num(s.rec),
        rec_yd: num(s.rec_yd),
        rec_td: num(s.rec_td),
        fum_lost: num(s.fum_lost),
      }
    })

    gameLogs.sort((a, b) => a.week - b.week)

    // ── Write to PlayerGameLogCache ──────────────────────────────────────────
    const expiresAt = new Date(Date.now() + GAME_LOG_CACHE_TTL_MS)
    prisma.playerGameLogCache.upsert({
      where: {
        uniq_player_game_log_cache: {
          playerId: String(player_id),
          sport,
          season: currentSeason,
          seasonType,
        },
      },
      update: { payload: gameLogs as object[], syncedAt: now, expiresAt, updatedAt: now },
      create: {
        playerId: String(player_id),
        sport,
        season: currentSeason,
        seasonType,
        payload: gameLogs as object[],
        syncedAt: now,
        expiresAt,
      },
    }).catch((e) => console.warn('[player-game-logs] cache write failed:', e instanceof Error ? e.message : e))

    const elapsedMs = Date.now() - t0
    console.log(`[player-game-logs GET] live-refresh { playerId: '${player_id}', season: '${currentSeason}', logCount: ${gameLogs.length}, elapsedMs: ${elapsedMs} }`)

    return NextResponse.json({
      ok: true,
      season: currentSeason,
      gameLogs,
      meta: { source: 'live-refresh', syncedAt: now.toISOString(), expiresAt: expiresAt.toISOString() },
    })
  } catch (error: unknown) {
    console.error('Game logs error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch game logs' }, { status: 500 })
  }
})
