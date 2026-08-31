import { NextResponse, type NextRequest } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { createRunBudget, rotateForFairness } from '@/lib/cron/runBudget'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { createOsStore, safeRead, type OsDomain, type OsFactSource, type OsFeed } from '@/lib/decision-os/domain-os'
import { createDraftOs, draftRulesSource } from '@/lib/decision-os/draft-os'
import { createWaiverOs, waiverSettingsSource } from '@/lib/decision-os/waiver-os'

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
 * ── 🛑 WHICH SOURCES THIS WALKS, AND WHY THE REST ARE NOT ELIGIBLE ──────────────────────────
 *
 * The plan said "call `feed.refresh(source, args)` for every registered source". That was wrong
 * and shipping it would have planted a bug. A source is eligible only if ALL THREE hold: its
 * `derive` is satisfiable from a league id alone, its `scopeKey` is the league id alone, and its
 * TTL is long enough that a 30-minute fire can keep it warm.
 *
 *   ✅ draftRulesSource      derive = resolveCanonicalLeagueRules(leagueId). League in, league out.
 *   ✅ waiverSettingsSource  eligible SINCE 1.1b, and it is why 1.1b existed — see below.
 *
 * ⚠ AND THIS FILE'S FIRST VERSION OVERCLAIMED WHAT THAT SAVES. It said "seven queries on every
 * draft-runtime resolve, which during a live draft is every poll and every pick", quoting
 * `draft-os/index.ts`. The figure is real; the traffic is not. `resolveNflRedraftDraftRuntime` —
 * the only consumer of `draftRulesSource` — has **zero callers**. No route, no component, no
 * service; the sole reference in the tree is `__tests__/draft-os.test.ts`. Live drafts run on
 * `lib/live-draft-engine/DraftSessionService` and never reach it.
 *
 * So today this cron warms a fact that is true, cheap, and read by nothing. That is the inverse of
 * the `ingestCFBDStats` failure this repo records — not a surface reading a table nobody writes,
 * but a writer filling a cache nobody reads. Harmless, and worth stating plainly rather than
 * leaving a number in place that a later decision might be justified with.
 *
 * 🛑 THE SAVING IS REAL AND IT IS SOMEWHERE ELSE. `resolveCanonicalLeagueRules` IS on live request
 * paths — just not that one:
 *
 *     playoff-runtime   4 routes        roster-runtime   1 route
 *     schedule-runtime  1 route         draft-runtime    0   <- the odd one out of four
 *
 * The fact this source maintains is LEAGUE RULES, not draft rules. It is misplaced in `draft-os`
 * rather than wrong, and pointed at those three resolvers it would deliver to real traffic exactly
 * what the original sentence claimed. Tracked as 1.2a in docs/decision-os/HUB_BUILD_PLAN.md;
 * whether the canonical draft resolver should get a route at all is 1.2b, and a product decision.
 *
 * ⚠ Found by opening the ticket to wire Draft OS and discovering it would connect a dead feed to a
 * dead resolver — i.e. by trying to USE the thing, which is the only reason it surfaced at all.
 *
 * ── WAIVER: WHY IT WAS INELIGIBLE, AND WHAT 1.1b CHANGED ────────────────────────────────────
 *
 * `waiverSettingsSource` was always declared `level: 'league'` with `scopeKey: leagueId`, and was
 * still underivable at the league level: it shared `deriveWorldFacts({ userId, leagueId })` with
 * the user source, which returns the whole `WaiverWorldFacts` INCLUDING that manager's FAAB
 * balance and priority. Warming it from here would have meant inventing a userId and storing ONE
 * MANAGER'S PRIVATE RESOURCES UNDER A LEAGUE-SCOPED KEY — the write-side form of the exact failure
 * `waiver-os/index.ts` warns about: it would "let the system tell someone they can afford a bid
 * they cannot".
 *
 * 1.1b split it. `loadWaiverLeagueFacts(leagueId)` derives the league half from three deps and no
 * user, so the source is now genuinely what it always claimed to be. It also stopped being
 * underivable for a non-member — the old path returned null when the caller had no roster.
 *
 * ── STILL NOT ELIGIBLE, WITH THE SPECIFIC REASON EACH ───────────────────────────────────────
 *
 *   ❌ tradeSettingsSource   ITS DERIVE IS SPLIT TOO (1.1b), so this one is not about the derive:
 *                            it is keyed `${leagueId}:${seasonId}` and this walk has no season.
 *                            Bridging that means deciding which season is "current" for a league
 *                            and what to do when several qualify — and a wrong answer warms the
 *                            WRONG SEASON'S entry, which is worse than warming nothing.
 *   ❌ leagueRulesSource     60s TTL. Expired long before the next 30-minute fire, so scheduling
 *                            it would spend the derive, warm nothing, and report healthy work.
 *                            Short-TTL facts are read-through by nature.
 *   ❌ lineup sources        user- and week-parameterised (playerIds, week, a specific roster).
 *                            Not league facts, and never will be.
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

/**
 * Bind one league-keyed source to its feed, erasing the fact type at the boundary.
 *
 * ⚠ THE HELPER IS NOT DECORATION. `OsFactSource<TArgs, TFacts>` is INVARIANT in `TFacts` — its
 * optional `measure(facts: TFacts)` puts the type in an input position — so an array typed
 * `OsFactSource<…, unknown>[]` will not accept a concrete source, however obviously compatible it
 * looks. Capturing each source inside a closure while it still has its real type is what lets two
 * domains share one walk.
 */
function target<TFacts>(
  domain: OsDomain,
  feed: OsFeed,
  source: OsFactSource<{ leagueId: string }, TFacts>,
) {
  return {
    domain,
    kind: source.kind,
    level: source.level,
    ttlMs: source.ttlMs,
    scopeKey: source.scopeKey,
    refresh: (args: { leagueId: string }) => feed.refresh(source, args),
  }
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

  /**
   * Every league-keyed source this cron warms.
   *
   * ⚠ THE LIST IS NOT "EVERY SOURCE", AND IT CANNOT BE. Membership requires all three: a
   * `derive` satisfiable from a league id alone, a `scopeKey` of the league id alone, and a TTL
   * long enough that a 30-minute fire can actually keep it warm.
   *
   *   draft   rules     ✅ but read by nothing — resolveNflRedraftDraftRuntime has no callers
   *   waiver  settings  ✅ and the reason 1.1b existed: its derive used to need a userId
   *   trade   settings  ❌ keyed `${leagueId}:${seasonId}`; this walk has no season
   *   league  rules     ❌ 60s TTL — expired long before the next fire; read-through by nature
   *   lineup  both      ❌ user- and week-parameterised; not league facts
   */
  const targets = [
    target('draft', createDraftOs({ store }), draftRulesSource),
    target('waiver', createWaiverOs({ store }), waiverSettingsSource),
  ]

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

    for (const t of targets) {
    /**
     * DUE-NESS IS A READ, NOT A GUESS. `refresh()` re-derives unconditionally, so calling it on
     * every league every fire would do the expensive work even when the stored fact is still
     * warm. Reading first with the source's own `ttlMs` asks exactly the question `get` asks —
     * a hit means a live consumer would have been served from the store, so there is nothing to
     * do. Producer and consumer therefore share one definition of stale instead of drifting.
     */
    const hit = await safeRead(store, {
      domain: t.domain,
      kind: t.kind,
      level: t.level,
      scopeKey: t.scopeKey(args),
      ttlMs: t.ttlMs,
    })
    if (hit) continue

    counts.due += 1

    // Per-league isolation: one league that cannot resolve must not end the walk. `refresh`
    // already swallows a derive rejection into 'unavailable'; this catch covers a store write
    // failing, which it does not.
    try {
      const outcome = await t.refresh(args)
      if (outcome === 'written') counts.written += 1
      else counts.unavailable += 1
    } catch (e) {
      counts.failed += 1
      if (counts.errors.length < 10) {
        counts.errors.push(`${t.domain}/${league.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    }
  }

  return counts
}
