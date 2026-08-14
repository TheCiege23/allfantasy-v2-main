import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { resolveCadence } from '@/lib/fantasy-os/sync/season'
import { runDueSleeperLeagues } from '@/lib/fantasy-os/sync/collector'
import { refreshProfilesForExternalLeagues } from '@/lib/psychological-profiles/ProfileRefreshService'

/**
 * Fantasy OS — season-aware Sleeper read-model refresh heartbeat (durable cron entrypoint).
 *
 * Deploy this on a FREQUENT fixed schedule (every 30 min, per vercel.json). Each invocation enumerates
 * the canonical imported Sleeper leagues and refreshes only the ones DUE for their season-aware cadence
 * (≈30 min in season / 4h offseason) — the fixed heartbeat runs often, but the per-league scheduler
 * decides due-ness, so refreshes never depend on a customer page view and the provider is never hammered.
 *
 * The live collector (rate-limited Sleeper fetch → normalize → idempotent canonical upsert, driven by
 * `runSync` with a Prisma-backed SyncStore + the leased AutomationLock) is gated behind
 * `FANTASY_OS_EXEC_SYNC_LIVE === 'true'`, so deploying this heartbeat is safe and does nothing until the
 * collector is explicitly enabled in an approved environment. Read-only against Sleeper.
 *
 * FUTURE (not in this batch): a live-game optimization could refresh event-sensitive scopes
 * (`teams_rosters` / matchups) more frequently during active game windows — either a second, tighter
 * cron or an in-season cadence override keyed on the game schedule. The durable runner already supports
 * per-scope checkpoints + a season-aware cadence resolver, so this is an additive cadence change, not an
 * architecture change; deliberately deferred to keep provider load bounded and this batch focused.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  // NOTE: name CRON_SECRET explicitly — a bare requireCronAuth checks LEAGUE_CRON_SECRET first and 401s
  // whenever that is set to something else (the #284/#289 production regression).
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const { state: seasonState, cadenceMinutes, warning } = resolveCadence({ sport: 'nfl', provider: 'sleeper', now })
  const heartbeat = {
    provider: 'sleeper' as const,
    seasonState,
    cadenceMinutes,
    ...(warning ? { warning } : {}),
  }

  const liveEnabled = process.env.FANTASY_OS_EXEC_SYNC_LIVE === 'true'
  if (!liveEnabled) {
    // Safe default: the heartbeat records the season decision but does not touch the provider.
    return NextResponse.json({
      ...heartbeat,
      executed: false,
      reason: 'live sync disabled (set FANTASY_OS_EXEC_SYNC_LIVE=true to enable the rate-limited collector)',
    })
  }

  // Optional operational bounds via query string (?limit=, ?concurrency=) for large portfolios.
  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit'))
  const concRaw = Number(url.searchParams.get('concurrency'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined
  const concurrency = Number.isFinite(concRaw) && concRaw > 0 ? Math.min(Math.floor(concRaw), 8) : undefined

  try {
    const summary = await runDueSleeperLeagues({ now, limit, concurrency })

    // Psychological profiles are refreshed AFTER a sync lands, never at import:
    // a freshly imported league has no drafts, trades or rosters yet, so
    // profiling it would characterise every manager from nothing. Once the sync
    // has written real history there is something to observe.
    //
    // Bounded and swallowed — profiling is enrichment and must never take down
    // the collector it rides along with. `manager_psych_profiles` sat at 0 rows
    // because the engine had no caller; this is that caller.
    let profiles: unknown = { leaguesProfiled: 0, managersProfiled: 0 }
    try {
      const syncedExternalIds = (summary.results ?? [])
        .filter((r) => r.executed && !r.error)
        // runKey is `<provider>:<externalLeagueId>:<season>`.
        .map((r) => String(r.runKey ?? '').split(':')[1] ?? '')
        .filter(Boolean)

      if (syncedExternalIds.length > 0) {
        const refreshed = await refreshProfilesForExternalLeagues({
          externalLeagueIds: syncedExternalIds,
          maxLeagues: 10,
        })
        profiles = {
          leaguesProfiled: refreshed.leaguesProfiled,
          managersProfiled: refreshed.managersProfiled,
        }
      }
    } catch (profileErr) {
      profiles = {
        error: profileErr instanceof Error ? profileErr.message.slice(0, 160) : 'profile refresh failed',
      }
    }

    return NextResponse.json({ ...heartbeat, executed: true, summary, profiles })
  } catch (err) {
    return NextResponse.json(
      { ...heartbeat, executed: false, error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    )
  }
}
