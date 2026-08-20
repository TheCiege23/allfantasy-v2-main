import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { ingestSleeperImportedActivity } from "@/lib/decision-os/ingestion/sleeperActivityEmitter"
import { buildManagerIdentityIndex } from "@/lib/decision-os/ingestion/importedActivityNormalizer"
import { PrismaImportedActivityStore } from "@/lib/decision-os/ingestion/prismaImportedActivityStore"
import {
  buildWeekRange,
  mapSleeperTransactionToRaw,
  mapSleeperDraftPickResponseItem,
  resolveDraftOccurredAt,
  getDraftId,
  buildSleeperManagerMapping,
  collectRosterOwnerIds,
} from "@/scripts/decision-os-ingest-sleeper-activity-helpers"
import { getLeagueRosters, getLeagueTransactions, getLeagueDrafts, getDraftPicks } from "@/lib/sleeper-client"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * GET /api/cron/decision-os-activity-ingest?discover=1
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (same pattern as the snapshot-capture cron).
 *
 * Aug 2026 — the PRODUCTION wiring for the Decision OS imported-activity pipeline. The whole
 * emitter → normalizer → writer → store chain (Phase A) plus the real-Sleeper orchestration
 * (Phase D Inc. 7's nonprod script) existed fully built and tested, but nothing scheduled it —
 * so `DecisionOsImportedActivity` stayed empty in prod and every behavioral surface
 * (dashboard-intelligence, league pulse, snapshots, Manager DNA) read zero imported activity.
 *
 * This cron reuses that exact orchestration, unchanged in shape:
 *   rosters → real identity mapping (UserProfile.sleeperUserId reverse-lookup, honest
 *   external-only fallback) → per-week transactions → draft picks → ingest (idempotent writer,
 *   externalSourceKey dedupe — safe to re-run daily).
 *
 * Bounds: ≤40 Sleeper leagues per fire (freshest-updated first), 180s ingest budget with honest
 * skippedForTime, per-league failure isolation. Telemetry: SyncJobRun
 * `cron-decision-os-activity-ingest`. Runs 07:00 UTC — 30 min before the snapshot-capture walk,
 * so each day's snapshots see that day's ingested activity.
 *
 * ── Aug 2026: THE HANG ────────────────────────────────────────────────────────────────────────
 * This job stopped completing after 2026-08-17 and left six `SyncJobRun` rows stuck in `running`
 * with `rows_read: 0` — the giveaway that the row was never UPDATED at all, since `rowsRead` is
 * `discovered`, which is only known once the body returns. Three defects compounded:
 *
 *   1. Every `lib/sleeper-client.ts` call was a bare `fetch()` with no timeout. Node applies no
 *      total-request deadline, so one stalled Sleeper connection hangs forever.
 *   2. The time budget was only ever checked BETWEEN leagues. Nothing bounded the work INSIDE
 *      `ingestOneLeague`, so a single hung league could never be skipped — the budget check it
 *      was supposed to hit was on the far side of the await that never resolved.
 *   3. Once the invocation blew past `maxDuration`, Vercel killed it. A platform kill runs no
 *      user code, so `withSyncJobRun`'s catch never fired and the `running` row was never closed.
 *
 * The likely trigger is Sleeper throttling: one fire issued up to 40 x 21 = 840 requests, with
 * the 18 transaction weeks fired as one concurrent burst per league. That is why the weeks are
 * now walked in bounded chunks rather than all at once.
 *
 * Fixes: `sleeperFetch` gives every provider call a 12s `AbortSignal.timeout`; `strict: true`
 * makes an unreachable Sleeper a counted FAILURE instead of an empty league; each league races a
 * deadline that can never exceed the remaining budget; and `reapAbandonedRuns` closes rows that a
 * future kill still manages to orphan.
 */
/**
 * Ingest budget. Deliberately 180s rather than the full `maxDuration` — `feat/decision-os-outbox-
 * relay-drain` appends a 60s outbox drain to this same route and needs the tail. Adopting that
 * branch's name AND value here means the two changes never disagree about the budget, so the
 * remaining merge conflicts in this file are textual rather than semantic: each is a union of two
 * additions (this constant block, and the `warnings`/`errors` arrays below). Verified with
 * `git merge-tree` — the conflicts are real, they are just mechanical.
 *
 * The clamp in the loop below also removes that branch's documented overshoot caveat: because no
 * league may run past `ingestDeadline`, the ingest phase cannot exceed 180s, which leaves the
 * relay its full 60s inside `maxDuration` instead of "180 + one league + 60 + one batch".
 */
const INGEST_BUDGET_MS = 180_000
/**
 * Hard ceiling on one league. Backstop for pathology only: a healthy league takes ~1.5s (the last
 * good run did 40 leagues in 59s), and the worst honest case is a handful of 12s fetch timeouts.
 *
 * Always clamped to the budget that is actually left (see `leagueDeadline`), so a slow league
 * cannot push the ingest phase past `INGEST_BUDGET_MS` at all. That zero-overshoot property is
 * what leaves the relay drain its full 60s tail inside `maxDuration`.
 *
 * The loop's own budget check is deliberately left in its original
 * `Date.now() - startedAt > INGEST_BUDGET_MS` shape: that makes the line byte-identical to the
 * one the relay-drain branch produces, so it auto-merges instead of conflicting.
 */
const LEAGUE_DEADLINE_MS = 45_000
/**
 * Transaction weeks fetched at once. Was all 18 — a burst that, multiplied across 40 leagues,
 * is the most plausible reason Sleeper began stalling this caller. Sleeper documents no public
 * rate limit; 6 keeps the peak in-flight count per league modest while still costing only three
 * sequential rounds.
 */
const WEEK_FETCH_CONCURRENCY = 6
const LEAGUE_CAP = 40
const WEEKS = 18

/** Map with a bounded number of in-flight promises, preserving input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))))
  }
  return out
}

/**
 * Reject if `promise` has not settled by `deadline`.
 *
 * This abandons the pending work rather than cancelling it — but every provider call underneath
 * now carries its own `AbortSignal.timeout`, so the abandoned work unwinds on its own instead of
 * living on. The race is the guarantee that the LOOP keeps moving, which is precisely what defect
 * (2) above cost us.
 */
async function withDeadline<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`deadline_exceeded:${label}`)), Math.max(0, deadline - Date.now()))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
  if (bearer && bearer === secret) return true
  if (process.env.NODE_ENV !== "production") {
    const q = new URL(request.url).searchParams.get("secret")
    if (q && q === secret) return true
  }
  return false
}

type LeagueRow = { id: string; platformLeagueId: string | null; season: number | null }

async function ingestOneLeague(
  league: LeagueRow,
  store: PrismaImportedActivityStore,
): Promise<{ created: number; updated: number; skipped: number }> {
  const sourceLeagueId = league.platformLeagueId as string

  // `strict` so an unreachable Sleeper throws instead of returning `[]`. Without it a timed-out
  // league is indistinguishable from a genuinely empty one, and the job reports a clean
  // "processed" for a league it never actually read.
  const rosters = await getLeagueRosters(sourceLeagueId, { strict: true })
  if (rosters.length === 0) return { created: 0, updated: 0, skipped: 0 }

  const ownerIds = collectRosterOwnerIds(rosters)
  const resolveAfUserId = async (sleeperUserId: string): Promise<string | null> => {
    const profile = await prisma.userProfile.findFirst({ where: { sleeperUserId }, select: { userId: true } })
    return profile?.userId ?? null
  }
  const mappings = await Promise.all(ownerIds.map((id) => buildSleeperManagerMapping(id, resolveAfUserId)))
  const identityIndex = buildManagerIdentityIndex(mappings)

  const rawTransactions = (
    await mapWithConcurrency(buildWeekRange(WEEKS), WEEK_FETCH_CONCURRENCY, (week) =>
      getLeagueTransactions(sourceLeagueId, week, { strict: true }),
    )
  ).flat()
  const transactions = rawTransactions.map(mapSleeperTransactionToRaw)

  const drafts = await getLeagueDrafts(sourceLeagueId, { strict: true })
  let draftPicks: ReturnType<typeof mapSleeperDraftPickResponseItem>[] = []
  let draftPicksOccurredAt: string | null = null
  if (drafts.length > 0) {
    const draft = drafts[0]
    const draftId = getDraftId(draft)
    draftPicksOccurredAt = resolveDraftOccurredAt(draft)
    if (draftId) {
      const rawPicks = await getDraftPicks(draftId, { strict: true })
      draftPicks = rawPicks.map((p) => mapSleeperDraftPickResponseItem(p, draftId, league.season?.toString()))
    }
  }
  const validDraftPicks = draftPicks.filter((p): p is NonNullable<typeof p> => p !== null)

  const result = await ingestSleeperImportedActivity(
    {
      // `providerLeagueId` is Sleeper's own id (the same one every fetch above used); `afLeagueId`
      // is AllFantasy's canonical `League.id`. Passing `league.id` as the provider id was the
      // Aug 2026 column-misuse bug: it wrote the canonical uuid into `providerLeagueId`, left
      // `afLeagueId` NULL on all 6,429 rows, and baked the uuid into the idempotency key.
      providerLeagueId: sourceLeagueId,
      afLeagueId: league.id,
      transactions,
      draftPicks: validDraftPicks,
      rosters,
      draftPicksOccurredAt,
    },
    identityIndex,
    store,
  )
  return { created: result.writer.created, updated: result.writer.updated, skipped: result.writer.skipped }
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const summary = await withSyncJobRun(
    { jobName: "cron-decision-os-activity-ingest", trigger: "cron" },
    async () => {
      const startedAt = Date.now()

      // Same honest-refusal precedent as the snapshot route: without the generated
      // delegate this environment cannot store activity at all.
      const delegate = (prisma as unknown as { decisionOsImportedActivity?: unknown }).decisionOsImportedActivity
      if (!delegate) {
        return { storeUnavailable: true, discovered: 0, processed: 0, failed: 0, skippedForTime: 0, created: 0, updated: 0, errors: [] as string[] }
      }
      const store = new PrismaImportedActivityStore(
        delegate as ConstructorParameters<typeof PrismaImportedActivityStore>[0],
      )

      const leagues = (await prisma.league
        .findMany({
          where: {
            platform: "sleeper",
            platformLeagueId: { not: "" },
            status: { notIn: ["complete", "completed", "archived"] },
          },
          select: { id: true, platformLeagueId: true, season: true },
          orderBy: { updatedAt: "desc" },
          take: LEAGUE_CAP,
        })
        .catch(() => [])) as LeagueRow[]

      let processed = 0
      let failed = 0
      let skippedForTime = 0
      let created = 0
      let updated = 0
      const errors: string[] = []
      const ingestDeadline = startedAt + INGEST_BUDGET_MS
      for (const league of leagues) {
        if (Date.now() - startedAt > INGEST_BUDGET_MS) {
          skippedForTime += 1
          continue
        }
        // Clamped to whatever budget is actually left, so no single league can carry the ingest
        // phase past `ingestDeadline`. That keeps the phase's overshoot at zero.
        const leagueDeadline = Math.min(Date.now() + LEAGUE_DEADLINE_MS, ingestDeadline)
        try {
          const r = await withDeadline(ingestOneLeague(league, store), leagueDeadline, "league_ingest")
          processed += 1
          created += r.created
          updated += r.updated
        } catch (error) {
          failed += 1
          if (errors.length < 5) errors.push(`${league.id}: ${error instanceof Error ? error.message : "unknown_error"}`)
        }
      }
      return { storeUnavailable: false, discovered: leagues.length, processed, failed, skippedForTime, created, updated, errors }
    },
    (s) => ({
      rowsRead: s.discovered,
      rowsWritten: s.created + s.updated,
      rowsSkipped: s.skippedForTime,
      errors: s.storeUnavailable ? ["imported_activity_store_unavailable"] : s.errors,
      warnings: s.skippedForTime > 0 ? [`${s.skippedForTime} leagues deferred by the ${INGEST_BUDGET_MS / 1000}s ingest budget`] : [],
    }),
  )

  if (summary.storeUnavailable) {
    return NextResponse.json({ ok: false, error: "imported_activity_store_unavailable" }, { status: 503 })
  }
  return NextResponse.json({
    ok: summary.failed === 0,
    discovered: summary.discovered,
    processed: summary.processed,
    failed: summary.failed,
    skippedForTime: summary.skippedForTime,
    created: summary.created,
    updated: summary.updated,
    errors: summary.errors,
  })
}
