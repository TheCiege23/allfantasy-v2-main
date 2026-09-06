import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { resolveCadence } from '@/lib/import-os/season'
import {
  runDueLeagues,
  runExternalMatchupParity,
  runFantraxMatchupParity,
} from '@/lib/import-os/collector'
import { refreshProfilesForExternalLeagues } from '@/lib/psychological-profiles/ProfileRefreshService'
import { materializeSleeperDraftSessions } from '@/lib/sleeper/sync/materializeSleeperDraftSessions'

/**
 * Fantasy OS — season-aware read-model refresh heartbeat, all providers (durable cron entrypoint).
 *
 * Deploy this on a FREQUENT fixed schedule (every 30 min, per cron-schedule.json). Each invocation enumerates
 * the canonical imported leagues of every syncable provider and refreshes only the ones DUE for their
 * season-aware cadence
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
// ⚠ 300s AND THE CADENCE ARE ONE DECISION, NOT TWO, AND TWO SEPARATE TESTS SAY SO.
//
// `cron-fast-tier-timeouts` requires any fast-tier job declaring 300s to run no more often
// than every 15 minutes — a job allowed to run five minutes must not be re-fired inside its
// own worst case. `cron-fast-tier-phase-stagger` is stricter and more specific: it encodes
// the 2026-09-03 production incident, in which this route is named as one of FIVE
// every-30-minute jobs that must stay phase-separated.
//
// This sat at every-10-minutes and failed both — the only one of the five 300s jobs under
// the line (the others run every 15, 30, 30 and 30 minutes). Every-30-minutes is what the
// header above always said, what the stagger test counts on, and what the per-league
// due-ness cadence (~30 min in season) already is; every-15 satisfies the timeout test
// alone and leaves the stagger test red.
//
// Fixed by widening the cadence rather than trimming the budget: nothing measures how long
// this sync actually needs, and truncating it mid-run is the worse failure. If you tighten
// this schedule, lower `maxDuration` in the same change — both tests will say so.
//
// ⚠ LINE COMMENTS, DELIBERATELY. A cron expression written literally in a BLOCK comment
// ends it: the star-slash in "*/30" is the close-comment token, so everything below turns
// into syntax errors. Caught here by `npm run typecheck` reporting 48 errors against a
// 143-error baseline — a count BELOW the baseline meant a file had stopped parsing, not
// that anything got better.
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
  /*
   * ⚠ `limit` IS NOW PER PROVIDER, NOT A TOTAL, and it needs a default it never had.
   *
   * While this was Sleeper-only, no default meant "every Sleeper league", which was fine.
   * Across six providers an unbounded enumeration would fan out a full normalized read for
   * every imported league on the platform inside one 300s invocation — the collector's own
   * per-league due-check keeps most of them cheap, but the first tick after a quiet period has
   * no such protection. A per-provider ceiling bounds the worst case without starving anyone,
   * because the cadence check rotates which leagues are due across heartbeats.
   */
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 25
  const concurrency = Number.isFinite(concRaw) && concRaw > 0 ? Math.min(Math.floor(concRaw), 8) : undefined
  /*
   * ⚠ RAISED FROM 3, WHICH WAS A HARD CEILING ON FRESHNESS NOBODY HAD COSTED.
   *
   * Three leagues per 30-minute tick is SIX PER HOUR, platform-wide — not per user. The
   * seventh non-Sleeper league on the platform could not meet an hourly freshness bar no
   * matter how often this cron fired, and raising the cron frequency would not have moved it.
   *
   * Still bounded, because these are full provider reads and this invocation has 300s: the
   * parity collectors keep their own 6h per-league TTL, so this number caps a burst rather
   * than setting a rate. Overridable per run for ops.
   */
  const parityRaw = Number(url.searchParams.get('parityLeagues'))
  const parityLeagues =
    Number.isFinite(parityRaw) && parityRaw > 0 ? Math.min(Math.floor(parityRaw), 50) : 10

  try {
    /*
     * 🛑 THIS WAS `runDueSleeperLeagues`, AND THAT IS WHY ONLY ONE PLATFORM STAYED FRESH.
     *
     * ESPN, Yahoo and Fantrax got a weekly-matchup parity pass and nothing else — no league
     * state, no rosters, no standings — while MFL and Fleaflicker got nothing at all. Every
     * non-Sleeper league was a snapshot ageing from the moment it imported, which is a poor
     * foundation for an OS that reasons about what changed.
     */
    const summary = await runDueLeagues({ now, limit, concurrency })

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

    // Draft materialization rides the same heartbeat: a Sleeper league whose synced
    // status has reached pre_draft/drafting gets a DraftSession + sleeperDraftId here,
    // so the draft-tick mirror can populate its board without anyone visiting the page.
    // Bounded and swallowed — same contract as the profile refresh above.
    let draftSessions: unknown = null
    try {
      draftSessions = await materializeSleeperDraftSessions({ maxLeagues: 25 })
    } catch (draftErr) {
      draftSessions = {
        error: draftErr instanceof Error ? draftErr.message.slice(0, 160) : 'draft session materialization failed',
      }
    }

    // ESPN/Yahoo weekly-matchup parity rides the same heartbeat. Sleeper
    // leagues get WeeklyMatchup rows from ensureMatchupsCached inside the
    // collector above; ESPN and Yahoo leagues had NO writer at all, so every
    // WeeklyMatchup-backed surface was empty for them. The parity collector
    // keeps its own 6h per-league cadence in SportsDataCache (full provider
    // reads are heavier than Sleeper's), tries each importing user's stored
    // credentials, and skips a league honestly when none work. Bounded and
    // swallowed — same contract as the profile refresh and draft
    // materialization above.
    let externalMatchups: unknown = null
    try {
      externalMatchups = await runExternalMatchupParity({ now, maxLeagues: parityLeagues })
    } catch (externalErr) {
      externalMatchups = {
        error: externalErr instanceof Error ? externalErr.message.slice(0, 160) : 'external matchup parity failed',
      }
    }

    /*
     * 🛑 THE WRITER IS THE HALF THAT IS EASY TO SKIP AND FATAL TO SKIP. A
     * collector with no scheduled caller keeps its table empty in production
     * while every local test of it passes — the same failure `ingestCFBDStats`
     * shipped for months. Fantrax leagues had no WeeklyMatchup writer at all,
     * which is why their league home reports "we cannot tell which week this
     * league is in yet" and "no week has been scored yet".
     *
     * Bounded (one request per PLAYED period per league, three leagues a tick)
     * and swallowed, same contract as the collectors above.
     */
    let fantraxMatchups: unknown = null
    try {
      fantraxMatchups = await runFantraxMatchupParity({ now, maxLeagues: parityLeagues })
    } catch (fantraxErr) {
      fantraxMatchups = {
        error:
          fantraxErr instanceof Error
            ? fantraxErr.message.slice(0, 160)
            : 'fantrax matchup parity failed',
      }
    }

    return NextResponse.json({
      ...heartbeat,
      executed: true,
      summary,
      profiles,
      draftSessions,
      externalMatchups,
      fantraxMatchups,
    })
  } catch (err) {
    return NextResponse.json(
      { ...heartbeat, executed: false, error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 },
    )
  }
}
