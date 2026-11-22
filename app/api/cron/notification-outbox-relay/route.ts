/**
 * GET/POST /api/cron/notification-outbox-relay
 *
 * Drains `notification_outbox` — the consumer that `lib/automation/notifications.ts` has been
 * promising since it was written ("Twilio / Resend dispatch reads from this table in a later
 * worker") and that never existed. See lib/notifications/outboxRelay.ts for the full account.
 *
 * Scheduled every minute. Also drives multi-sport game engagement alerts in the same slot.
 *
 * Query params:
 *   limit   — rows per pass (default 100, max 500)
 *   dryRun  — count what is due without dispatching or recording a heartbeat
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runSportsEngagement } from "@/lib/engagement-alerts/runSportsEngagement"
import { relayNotificationOutbox } from "@/lib/notifications/outboxRelay"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = "cron-notification-outbox-relay"
const DISCORD_JOB = "cron-discord-inbound"

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw && /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : undefined

  const startedAt = Date.now()
  // Shares the authenticated minute schedule. The pass reads only commissioner-opted
  // league-chat channels and enforces its own short budget; dry runs never import messages.
  const discordPromise = dryRun ? Promise.resolve(null) : (async () => {
    try {
      const { runDiscordInboundPass } = await import('@/lib/discord/inboundPass')
      return await withSyncJobRun({jobName:DISCORD_JOB,trigger:'cron'},
        () => runDiscordInboundPass({budgetMs:8_000}),
        r => ({rowsRead:r.channels,rowsWritten:r.imported,rowsSkipped:r.deferred,
          status:r.errors > 0 ? ('partial' as const) : ('success' as const)}))
    } catch {
      console.warn('[cron/discord-inbound] pass failed')
      return {channels:0,deferred:0,imported:0,errors:1}
    }
  })()

  try {
    // Share the existing minute scheduler slot; a sports feed failure cannot stop retries.
    const engagementPromise = dryRun ? Promise.resolve(null) : runSportsEngagement().catch(e => ({
      games: 0, delivered: 0, errors: [e instanceof Error ? e.message : String(e)],
    }))
    /*
     * The daily "Roster news" email (lib/notifications/playerNewsDigest.ts), checked every 15 minutes
     * in this minute slot: each person gets one at the first check after 8am their time. Isolated, so
     * a digest failure cannot stop the relay.
     */
    const digestPromise = dryRun || new Date().getUTCMinutes() % 15 !== 0 ? Promise.resolve(null) : (async () => {
      try {
        const { sendDuePlayerNewsDigests } = await import("@/lib/notifications/playerNewsDigest")
        return await sendDuePlayerNewsDigests()
      } catch (e) {
        return { error: e instanceof Error ? e.message.slice(0, 200) : "failed" }
      }
    })()
    const run = () => relayNotificationOutbox({ limit, dryRun })

    /*
     * A dry run records NOTHING, deliberately: the freshness probe matches on job_name alone, so a
     * row written by a hand-issued smoke test would be indistinguishable from a scheduled fire and
     * could hide a dead scheduler. Same reasoning as `cron/compute-projections`.
     */
    const relayPromise = dryRun
      ? run()
      : withSyncJobRun({ jobName: JOB, trigger: "cron" }, run, (r) => ({
          rowsRead: r.claimed,
          rowsWritten: r.sent,
          rowsSkipped: r.skipped + r.retried,
          /*
           * PARTIAL, not success, when anything exhausted its retries. A relay that reports
           * success while dropping mail on the floor is the same class of lie this whole worker
           * exists to end.
           */
          status: r.failed > 0 ? ("partial" as const) : ("success" as const),
        }))

    const [result, engagement, discordInbound, playerNewsDigest] = await Promise.all([relayPromise, engagementPromise, discordPromise, digestPromise])

    return NextResponse.json({
      ok: true,
      dryRun,
      engagement,
      playerNewsDigest,
      ...result,
      discordInbound,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/notification-outbox-relay] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), discordInbound: await discordPromise, durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}
