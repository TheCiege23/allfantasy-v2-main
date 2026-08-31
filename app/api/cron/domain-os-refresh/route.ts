import { NextResponse, type NextRequest } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { createOsStore, safeRead } from '@/lib/decision-os/domain-os'
import { createDraftOs, draftRulesSource } from '@/lib/decision-os/draft-os'

/**
 * GET /api/cron/domain-os-refresh
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * THE GATHERING HALF OF THE DOMAIN OS FEEDS. `OsFeed` has always exposed two methods — `get`
 * (read-through) and `refresh` (populate without reading) — and until now **nothing anywhere in
 * this repository called `refresh`**. A search across `lib/`, `app/api/cron/` and `scripts/`
 * returned zero callers, which `waiver-os/index.ts` had already predicted in its own words:
 *
 *     "The 6h league entry is not dead — it is a refresh() target for a scheduler that does not
 *      exist yet (see OsFeed.refresh: 'the gathering half; it needs a scheduler')."
 *
 * The consequence was not a broken feature, which is why it survived: reads still worked, because
 * `get` derives on a miss. But every league-level fact was re-derived per USER instead of once per
 * league, so the entire saving the level split exists to produce was never collected.
 *
 * ── 🛑 WHY THIS SCHEDULES EXACTLY ONE SOURCE, AND NOT THE OTHER FOUR ────────────────────────
 *
 * The plan this implements said "call `feed.refresh(source, args)` for every registered source".
 * Reading the sources says otherwise, and shipping the wider version would have planted a bug.
 *
 * A source is schedulable only if its `derive` can be satisfied from LEAGUE-level inputs alone.
 * Exactly one can:
 *
 *   ✅ draftRulesSource   derive = resolveCanonicalLeagueRules(leagueId).  League in, league out.
 *                         Also the most expensive: seven queries on every draft-runtime resolve,
 *                         which during a live draft is every poll and every pick.
 *
 *   ❌ waiverSettingsSource   level:'league', scopeKey: leagueId — but `derive` is the SHARED
 *                             deriveWorldFacts({ userId, leagueId }), which returns the whole
 *                             WaiverWorldFacts INCLUDING that user's FAAB balance and priority.
 *   ❌ tradeSettingsSource    same shape: scopeKey is `${leagueId}:${seasonId}`, but `derive`
 *                             needs an ordered roster PAIR and returns both sides' record and
 *                             FAAB.
 *
 * Refreshing either from a scheduler means inventing a userId or a roster pair, and then storing
 * ONE MANAGER'S PRIVATE RESOURCE FACTS UNDER A LEAGUE-SCOPED KEY. Nothing reads those entries
 * today — reads go through the user-level sources — so it would not break anything now. It would
 * lie later, the first time anyone reads through the league entry, and it is the precise failure
 * `waiver-os/index.ts` warns about reached from the WRITE side instead of the read side: it would
 * "let the system tell someone they can afford a bid they cannot".
 *
 *   Making those two schedulable is a real, small refactor — split the shared `derive` so the
 *   settings source derives only the league-shaped subset — and it belongs in its own change with
 *   its own test, not smuggled into a cron. Until then, one honest source beats three that include
 *   a lie, which is `draft-os`'s own argument for declaring one source in the first place.
 *
 *   ❌ lineupWarehouseSource / lineupSignalSource are user- and week-parameterised by nature
 *      (playerIds, week, a specific roster). They are not league facts and never will be.
 *
 * ── Bounds, copied from decision-os-activity-ingest's hard-won shape ─────────────────────────
 *
 * That route's header documents three compounding defects that hung it for weeks: untimed
 * fetches, a budget checked only BETWEEN units, and a platform kill leaving `running` rows behind.
 * Two of the three cannot occur here — `resolveCanonicalLeagueRules` is Postgres-only, so there is
 * no provider socket to hang on — and the third is handled by `withSyncJobRun`, whose
 * `reapAbandonedRuns` closes any row a previous kill orphaned.
 *
 * `rotateForFairness` is not decoration. A fixed-order walk that stops when the budget runs out
 * refreshes the first N leagues forever and never reaches the tail — which `runBudget.ts` records
 * happening in production, where NBA/NHL/MLB/SOCCER sat frozen at one date while NFL kept
 * updating. Rotation gives every league the lead position within one cycle.
 *
 * ⚠ NFL ONLY, AND THAT IS THE SOURCE'S CONSTRAINT RATHER THAN A CHOICE HERE.
 * `draftRulesSource.sport` is hardcoded `() => 'NFL'`, so a fact derived for any other sport would
 * be filed under the wrong partition. Widening it is a D17 follow-up on the SOURCE; scoping this
 * walk to NFL is what keeps the two consistent in the meantime.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Leagues considered per fire. Well under what the budget allows — each unit is a handful of
 * indexed Postgres reads, not a provider round trip — so the cap is about bounding DB load on a
 * shared instance, not about time.
 */
const LEAGUE_CAP = 200

/** Runs every 30 min, so the fairness period matches the fire interval. */
const ROTATION_PERIOD_MS = 30 * 60 * 1000

/** League statuses that mean "no longer playing"; refreshing their rules helps nobody. */
const DEAD_STATUSES = ['ARCHIVED', 'COMPLETE', 'COMPLETED', 'CLOSED']

type RefreshCounts = {
  considered: number
  due: number
  written: number
  unavailable: number
  failed: number
  skippedForTime: number
  errors: string[]
}

export async function GET(req: NextRequest) {
  // Name CRON_SECRET explicitly: a bare requireCronAuth checks LEAGUE_CRON_SECRET first and 401s
  // whenever that is set to something else (the #284/#289 production regression).
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await withSyncJobRun(
    { jobName: 'cron-domain-os-refresh', sport: 'NFL', trigger: 'cron' },
    () => run(),
    (r) => ({
      rowsRead: r.considered,
      rowsWritten: r.written,
      rowsSkipped: r.skippedForTime + r.unavailable,
      errors: r.errors,
      status: r.failed > 0 ? 'partial' : 'success',
      metadata: { due: r.due, unavailable: r.unavailable, failed: r.failed },
    }),
  )

  return NextResponse.json(result)
}

async function run(): Promise<RefreshCounts> {
  const budget = createRunBudget()
  const counts: RefreshCounts = {
    considered: 0, due: 0, written: 0, unavailable: 0, failed: 0, skippedForTime: 0, errors: [],
  }

  const leagues = await prisma.league
    .findMany({
      where: { sport: 'NFL', NOT: { status: { in: DEAD_STATUSES } } },
      select: { id: true },
      take: LEAGUE_CAP,
      orderBy: { updatedAt: 'desc' },
    })
    .catch((e: unknown) => {
      counts.errors.push(`league_query: ${e instanceof Error ? e.message : String(e)}`)
      return [] as { id: string }[]
    })

  counts.considered = leagues.length
  if (leagues.length === 0) return counts

  const store = createOsStore()
  const feed = createDraftOs({ store })
  const ordered = rotateForFairness(leagues, ROTATION_PERIOD_MS)

  for (const league of ordered) {
    // Checked BETWEEN units, per RunBudget's contract. Every remaining league is reported as
    // skipped rather than silently dropped — a truncated walk that looks complete is the failure
    // this repo keeps finding.
    if (budget.exhausted()) {
      counts.skippedForTime = ordered.length - (counts.due + counts.unavailable + counts.failed)
      break
    }

    const args = { leagueId: league.id }

    /**
     * DUE-NESS IS A READ, NOT A GUESS. `refresh()` re-derives unconditionally, so calling it on
     * every league every fire would do the expensive work even when the stored fact is still
     * warm. Reading first with the source's own `ttlMs` asks exactly the question `get` asks —
     * a hit means a live consumer would have been served from the store, so there is nothing to
     * do. Producer and consumer therefore share one definition of stale instead of drifting.
     */
    const hit = await safeRead(store, {
      domain: 'draft',
      kind: draftRulesSource.kind,
      level: draftRulesSource.level,
      scopeKey: draftRulesSource.scopeKey(args),
      ttlMs: draftRulesSource.ttlMs,
    })
    if (hit) continue

    counts.due += 1

    // Per-league isolation: one league that cannot resolve must not end the walk. `refresh`
    // already swallows a derive rejection into 'unavailable'; this catch covers a store write
    // failing, which it does not.
    try {
      const outcome = await feed.refresh(draftRulesSource, args)
      if (outcome === 'written') counts.written += 1
      else counts.unavailable += 1
    } catch (e) {
      counts.failed += 1
      if (counts.errors.length < 10) {
        counts.errors.push(`${league.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return counts
}
