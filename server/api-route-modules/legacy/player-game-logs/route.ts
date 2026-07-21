import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

export const POST = withApiUsage({ endpoint: "/api/legacy/player-game-logs", tool: "LegacyPlayerGameLogs" })(async (req: NextRequest) => {
  const t0 = Date.now()
  try {
    const { player_id, season } = await req.json()

    if (!player_id) {
      return NextResponse.json({ error: 'Player ID required' }, { status: 400 })
    }

    const rawSeason = String(season || '2025')
    const currentSeason = /^\d{4}$/.test(rawSeason) ? rawSeason : '2025'
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

    let scheduleMap: Record<string, { opponent: string }> = {}
    try {
      const schedRes = await fetch(
        `https://api.sleeper.com/schedule/nfl/regular/${currentSeason}`,
        { next: { revalidate: 86400 } }
      )
      if (schedRes.ok) {
        const schedData = await schedRes.json()
        if (Array.isArray(schedData)) {
          // Phase 3: canonical read path. This site needs only the player's team, so it uses
          // the lightweight bulk accessor rather than `getCanonicalPlayerBySleeperId`, which
          // would hydrate all seven satellites to answer a one-field question.
          const { getCanonicalPlayersBySleeperIds } = await import('@/lib/canonical/getCanonicalPlayer')
          const canonical = await getCanonicalPlayersBySleeperIds([player_id])
          const playerTeam = canonical.get(player_id)?.team

          if (playerTeam) {
            for (const game of schedData) {
              const week = game.week
              if (game.home === playerTeam) {
                scheduleMap[week] = { opponent: game.away }
              } else if (game.away === playerTeam) {
                scheduleMap[week] = { opponent: `@${game.home}` }
              }
            }
          }
        }
      }
    } catch {}

    const gameLogs: WeekStats[] = []

    if (Array.isArray(rawData)) {
      for (const entry of rawData) {
        if (!entry || typeof entry !== 'object') continue
        const stats = entry.stats || entry
        const week = entry.week || stats.week

        if (!week) continue

        const schedule = scheduleMap[String(week)]

        gameLogs.push({
          week: Number(week),
          opponent: schedule?.opponent || stats.opponent || undefined,
          pts_ppr: stats.pts_ppr ?? stats.fantasy_points_ppr ?? undefined,
          pts_half_ppr: stats.pts_half_ppr ?? undefined,
          pts_std: stats.pts_std ?? undefined,
          gp: stats.gp ?? stats.gms_active ?? undefined,
          pass_att: stats.pass_att ?? undefined,
          pass_cmp: stats.pass_cmp ?? undefined,
          pass_yd: stats.pass_yd ?? undefined,
          pass_td: stats.pass_td ?? undefined,
          pass_int: stats.pass_int ?? undefined,
          rush_att: stats.rush_att ?? undefined,
          rush_yd: stats.rush_yd ?? undefined,
          rush_td: stats.rush_td ?? undefined,
          rec_tgt: stats.rec_tgt ?? undefined,
          rec: stats.rec ?? undefined,
          rec_yd: stats.rec_yd ?? undefined,
          rec_td: stats.rec_td ?? undefined,
          fum_lost: stats.fum_lost ?? undefined,
        })
      }
    } else if (rawData && typeof rawData === 'object') {
      for (const [weekKey, stats] of Object.entries(rawData)) {
        const weekNum = parseInt(weekKey)
        if (isNaN(weekNum)) continue
        if (!stats || typeof stats !== 'object') continue
        const s = stats as Record<string, unknown>
        const schedule = scheduleMap[weekKey]

        gameLogs.push({
          week: weekNum,
          opponent: schedule?.opponent || undefined,
          pts_ppr: s.pts_ppr as number ?? s.fantasy_points_ppr as number ?? undefined,
          pts_half_ppr: s.pts_half_ppr as number ?? undefined,
          pts_std: s.pts_std as number ?? undefined,
          gp: s.gp as number ?? s.gms_active as number ?? undefined,
          pass_att: s.pass_att as number ?? undefined,
          pass_cmp: s.pass_cmp as number ?? undefined,
          pass_yd: s.pass_yd as number ?? undefined,
          pass_td: s.pass_td as number ?? undefined,
          pass_int: s.pass_int as number ?? undefined,
          rush_att: s.rush_att as number ?? undefined,
          rush_yd: s.rush_yd as number ?? undefined,
          rush_td: s.rush_td as number ?? undefined,
          rec_tgt: s.rec_tgt as number ?? undefined,
          rec: s.rec as number ?? undefined,
          rec_yd: s.rec_yd as number ?? undefined,
          rec_td: s.rec_td as number ?? undefined,
          fum_lost: s.fum_lost as number ?? undefined,
        })
      }
    }

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
