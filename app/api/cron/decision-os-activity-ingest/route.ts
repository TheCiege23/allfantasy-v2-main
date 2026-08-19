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
 * Bounds: ≤40 Sleeper leagues per fire (freshest-updated first), 240s time budget with honest
 * skippedForTime, per-league failure isolation. Telemetry: SyncJobRun
 * `cron-decision-os-activity-ingest`. Runs 07:00 UTC — 30 min before the snapshot-capture walk,
 * so each day's snapshots see that day's ingested activity.
 */
const TIME_BUDGET_MS = 240_000
const LEAGUE_CAP = 40
const WEEKS = 18

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

  const rosters = await getLeagueRosters(sourceLeagueId)
  if (rosters.length === 0) return { created: 0, updated: 0, skipped: 0 }

  const ownerIds = collectRosterOwnerIds(rosters)
  const resolveAfUserId = async (sleeperUserId: string): Promise<string | null> => {
    const profile = await prisma.userProfile.findFirst({ where: { sleeperUserId }, select: { userId: true } })
    return profile?.userId ?? null
  }
  const mappings = await Promise.all(ownerIds.map((id) => buildSleeperManagerMapping(id, resolveAfUserId)))
  const identityIndex = buildManagerIdentityIndex(mappings)

  const rawTransactions = (
    await Promise.all(buildWeekRange(WEEKS).map((week) => getLeagueTransactions(sourceLeagueId, week)))
  ).flat()
  const transactions = rawTransactions.map(mapSleeperTransactionToRaw)

  const drafts = await getLeagueDrafts(sourceLeagueId)
  let draftPicks: ReturnType<typeof mapSleeperDraftPickResponseItem>[] = []
  let draftPicksOccurredAt: string | null = null
  if (drafts.length > 0) {
    const draft = drafts[0]
    const draftId = getDraftId(draft)
    draftPicksOccurredAt = resolveDraftOccurredAt(draft)
    if (draftId) {
      const rawPicks = await getDraftPicks(draftId)
      draftPicks = rawPicks.map((p) => mapSleeperDraftPickResponseItem(p, draftId, league.season?.toString()))
    }
  }
  const validDraftPicks = draftPicks.filter((p): p is NonNullable<typeof p> => p !== null)

  const result = await ingestSleeperImportedActivity(
    { leagueId: league.id, transactions, draftPicks: validDraftPicks, rosters, draftPicksOccurredAt },
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
      for (const league of leagues) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          skippedForTime += 1
          continue
        }
        try {
          const r = await ingestOneLeague(league, store)
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
      warnings: s.skippedForTime > 0 ? [`${s.skippedForTime} leagues deferred by the ${TIME_BUDGET_MS / 1000}s time budget`] : [],
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
