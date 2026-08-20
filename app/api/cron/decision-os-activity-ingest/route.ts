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
import {
  OutboxRelay,
  PrismaOutboxStore,
  inProcessEventBus,
  createPrismaAuditFeedConsumer,
  type PrismaLike,
  type AuditFeedPrisma,
} from "@/lib/events"
// Import the consumer DIRECTLY rather than through the `lib/intelligence` barrel — that barrel
// re-exports server-only-tainted modules. Same reason `scripts/run-outbox-relay.ts` does this.
import { createIntelligenceSnapshotConsumer } from "@/lib/intelligence/projections/snapshotProjection"

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
 * ── Aug 2026, step 1: THE HANG ────────────────────────────────────────────────────────────
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
 *
 * ── Aug 2026, step 2: THE OUTBOX RELAY DRAIN ──────────────────────────────────────────────
 * Exactly the same bug class this cron was created to fix, one layer down. `event_outbox` held
 * 7,809 rows in prod and EVERY ONE was still `pending`: the relay that projects them exists, but
 * its only non-doc caller was `app/api/e2e/run-relay/route.ts` — an e2e-only drain route. Nothing
 * scheduled it. So `IntelligenceLeagueSnapshot` stayed empty, and because Decision OS resolves its
 * evidence through that snapshot (`loadLeagueSourceVersion` → `buildLeagueIntelligenceEvidence`),
 * every three-brain request would have returned an honest `evidence_unavailable`.
 *
 * The drain is appended HERE rather than as a new route because this repo does not add API routes
 * (it sits at Vercel's 2048-route ceiling). Running it after the ingest loop also means any events
 * this fire just emitted are projected in the same pass.
 *
 * Safety: the relay claims rows with a worker id + stale-claim timeout, so an overlapping fire
 * cannot double-deliver. Both consumers are idempotent (`intelligence_processed_event` /
 * audit-feed markers with `skipDuplicates`), so a re-drain is a no-op. A relay failure is caught
 * and reported — it never fails the ingest job that ran before it.
 *
 * Why a DAILY drain is enough (measured on prod 2026-08-20): events accrue at ~100–290/day
 * (7,809 total spanning Jun 28 → Aug 20). One 60s fire drains well over a thousand, so steady
 * state has ~4x headroom and the accumulated backlog clears in roughly a week of fires. If the
 * accrual rate climbs materially, give the drain its own more-frequent schedule rather than
 * widening RELAY_BUDGET_MS into the ingest budget.
 */
/**
 * Ingest budget. Deliberately 180s rather than the full `maxDuration` — the outbox drain below
 * needs the tail. Both changes that landed in Aug 2026 chose the same name AND value for this, so
 * they never disagree about the budget.
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
/**
 * Reserved tail of the fire for the outbox drain.
 *
 * The relay-drain branch originally documented a worst case of "180 + one league + 60 + one
 * batch" here, because the ingest budget was only checked BETWEEN leagues and could overshoot by
 * a whole league. The per-league clamp added by the hang fix (`LEAGUE_DEADLINE_MS`, bounded by
 * the remaining budget) removes that overshoot: the ingest phase cannot exceed 180s, so the relay
 * genuinely gets its full 60s inside `maxDuration` (300s). Keep that clamp if you raise either
 * number — without it this comment reverts to the old, looser guarantee.
 */
const RELAY_BUDGET_MS = 60_000
/** Small batches keep the per-batch overshoot past `relayDeadline` correspondingly small. */
const RELAY_BATCH_SIZE = 100
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
        return {
          storeUnavailable: true, discovered: 0, processed: 0, failed: 0, skippedForTime: 0, created: 0, updated: 0,
          errors: [] as string[],
          // Keep the shape identical on both return paths so `summary.relay` stays a single type.
          relay: { fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, relayFailed: 0, relayError: null as string | null },
        }
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

      // ── Outbox drain (see the header note). Bounded by RELAY_BUDGET_MS; whatever is left
      // stays `pending` and is picked up by the next fire, so a large backlog drains across
      // days rather than blowing this fire's `maxDuration`.
      const relayDeadline = startedAt + INGEST_BUDGET_MS + RELAY_BUDGET_MS
      const relay = { fetched: 0, dispatched: 0, retried: 0, deadLettered: 0, relayFailed: 0, relayError: null as string | null }
      try {
        const outboxRelay = new OutboxRelay(new PrismaOutboxStore(prisma as unknown as PrismaLike), {
          // Both durable consumers, matching scripts/run-outbox-relay.ts. NOTE: do NOT use
          // `getOutboxRelay()` here — the container's default relay is best-effort fan-out with
          // NO DB consumers, so it would drain the outbox while projecting nothing.
          consumers: [
            createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma),
            createIntelligenceSnapshotConsumer(prisma as unknown as Parameters<typeof createIntelligenceSnapshotConsumer>[0]),
          ],
          bus: inProcessEventBus,
          batchSize: RELAY_BATCH_SIZE,
          // Unique per fire so an overlapping run claims different rows instead of double-delivering.
          workerId: `cron-activity-ingest-${startedAt}`,
        })
        const r = await outboxRelay.run({
          stopWhenEmpty: true,
          shouldStop: () => Date.now() > relayDeadline,
        })
        relay.fetched = r.fetched
        relay.dispatched = r.dispatched
        relay.retried = r.retried
        relay.deadLettered = r.deadLettered
        relay.relayFailed = r.failed
      } catch (error) {
        // Isolated: the ingest above already succeeded and must still be reported as such.
        relay.relayError = error instanceof Error ? error.message : "relay_failed"
      }

      return { storeUnavailable: false, discovered: leagues.length, processed, failed, skippedForTime, created, updated, errors, relay }
    },
    (s) => ({
      rowsRead: s.discovered,
      // Projected events are real writes too — count them so the relay's progress is visible
      // in SyncJobRun telemetry rather than hidden inside the ingest job's numbers.
      rowsWritten: s.created + s.updated + s.relay.dispatched,
      rowsSkipped: s.skippedForTime,
      errors: [
        ...(s.storeUnavailable ? ["imported_activity_store_unavailable"] : s.errors),
        // A relay failure must be visible, not swallowed by the isolating catch above.
        ...(s.relay.relayError ? [`outbox_relay: ${s.relay.relayError}`] : []),
      ],
      warnings: [
        ...(s.skippedForTime > 0 ? [`${s.skippedForTime} leagues deferred by the ${INGEST_BUDGET_MS / 1000}s ingest budget`] : []),
        // Dead-lettered rows will never be retried by the relay — they need a human.
        ...(s.relay.deadLettered > 0 ? [`${s.relay.deadLettered} outbox events dead-lettered`] : []),
      ],
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
    relay: summary.relay,
    created: summary.created,
    updated: summary.updated,
    errors: summary.errors,
  })
}
