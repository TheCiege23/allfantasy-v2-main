import { prisma } from "@/lib/prisma"
import { logApiFailure } from "@/lib/error-tracking"
import { ENGINE } from "@/lib/analytics/eventNames"
import { recordEngineTelemetrySample } from "@/lib/analytics/recordAnalyticsEvent"

/**
 * `api_phase` carries PHASE ATTRIBUTION for one request, not a second usage record for it.
 *
 * 🛑 IT IS A SEPARATE SCOPE FOR A LOAD-BEARING REASON. `upsertRollups` keys on
 * [bucketType, bucketStart, scope, tool, endpoint, leagueId], so a distinct scope gets distinct
 * rollup rows — a phase event therefore cannot inflate the `scope: 'api'` call counts or move the
 * p95 that motivated measuring in the first place. Reusing 'api' would have made the instrumentation
 * corrupt the very number it exists to explain.
 */
type UsageScope = "api" | "legacy_tool" | "api_phase"
type BucketType = "hour" | "day" | "week" | "month"

function nowUtc() {
  return new Date()
}

function bucketStartUTC(d: Date, type: BucketType) {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  const h = d.getUTCHours()

  if (type === "hour") return new Date(Date.UTC(y, m, day, h, 0, 0, 0))
  if (type === "day") return new Date(Date.UTC(y, m, day, 0, 0, 0, 0))
  if (type === "month") return new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))

  const date = new Date(Date.UTC(y, m, day, 0, 0, 0, 0))
  const dow = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dow)
  return date
}

function approxP95(samples: number[]) {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.floor(0.95 * (sorted.length - 1))
  return sorted[idx]
}

async function upsertRollups(args: {
  ts: Date
  scope: UsageScope
  tool: string
  endpoint: string
  leagueId: string
  ok: boolean
  status?: number | null
  durationMs?: number | null
  bytesIn?: number | null
  bytesOut?: number | null
}) {
  const bucketTypes: BucketType[] = ["hour", "day", "week", "month"]
  const duration = Number.isFinite(args.durationMs as any) ? (args.durationMs as number) : null

  for (const bt of bucketTypes) {
    const start = bucketStartUTC(args.ts, bt)
    const key = {
      bucketType: bt,
      bucketStart: start,
      scope: args.scope,
      tool: args.tool,
      endpoint: args.endpoint,
      leagueId: args.leagueId
    }

    const row = await prisma.apiUsageRollup.findUnique({
      where: { uniq_usage_rollup_bucket_key: key as any }
    })

    let samples: number[] = []
    if (row) {
      const meta = row.meta as any
      if (meta?.samples && Array.isArray(meta.samples)) {
        samples = meta.samples.filter((x: any) => Number.isFinite(x))
      }
    }
    if (duration != null) {
      samples.push(duration)
      if (samples.length > 200) samples = samples.slice(samples.length - 200)
    }

    const p95 = samples.length ? approxP95(samples) : null
    const maxMs = Math.max(row?.maxMs ?? 0, duration ?? 0) || null

    const newCount = (row?.count ?? 0) + 1
    const prevAvg = row?.avgMs ?? null
    const newAvg =
      duration == null
        ? prevAvg
        : prevAvg == null
          ? duration
          : Math.round((prevAvg * (newCount - 1) + duration) / newCount)

    const bytesInSum = BigInt(row?.bytesInSum ?? 0) + BigInt(args.bytesIn ?? 0)
    const bytesOutSum = BigInt(row?.bytesOutSum ?? 0) + BigInt(args.bytesOut ?? 0)

    await prisma.apiUsageRollup.upsert({
      where: { uniq_usage_rollup_bucket_key: key as any },
      create: {
        ...key,
        count: 1,
        okCount: args.ok ? 1 : 0,
        errCount: args.ok ? 0 : 1,
        avgMs: duration ?? null,
        p95Ms: duration ?? null,
        maxMs: duration ?? null,
        bytesInSum: BigInt(args.bytesIn ?? 0),
        bytesOutSum: BigInt(args.bytesOut ?? 0),
        meta: { samples }
      },
      update: {
        count: newCount,
        okCount: (row?.okCount ?? 0) + (args.ok ? 1 : 0),
        errCount: (row?.errCount ?? 0) + (args.ok ? 0 : 1),
        avgMs: newAvg,
        p95Ms: p95,
        maxMs,
        bytesInSum,
        bytesOutSum,
        meta: { samples }
      }
    })
  }
}

export async function logUsageEvent(args: {
  scope: UsageScope
  tool?: string
  endpoint?: string
  method?: string
  status?: number
  ok?: boolean
  durationMs?: number
  bytesIn?: number
  bytesOut?: number
  userId?: string
  username?: string
  leagueId?: string
  meta?: any
}) {
  const ts = nowUtc()
  const ok = args.ok ?? (args.status ? args.status >= 200 && args.status < 400 : true)

  await prisma.apiUsageEvent.create({
    data: {
      ts,
      scope: args.scope,
      tool: args.tool ?? "",
      endpoint: args.endpoint ?? "",
      method: args.method ?? null,
      status: args.status ?? null,
      ok,
      durationMs: args.durationMs ?? null,
      bytesIn: args.bytesIn ?? null,
      bytesOut: args.bytesOut ?? null,
      userId: args.userId ?? null,
      username: args.username ?? null,
      leagueId: args.leagueId ?? "",
      meta: args.meta ?? null
    }
  })

  await upsertRollups({
    ts,
    scope: args.scope,
    tool: args.tool || "",
    endpoint: args.endpoint || "",
    leagueId: args.leagueId || "",
    ok,
    status: args.status ?? null,
    durationMs: args.durationMs ?? null,
    bytesIn: args.bytesIn ?? null,
    bytesOut: args.bytesOut ?? null
  })

  if (!ok || (args.status != null && args.status >= 400)) {
    recordEngineTelemetrySample(ENGINE.API_FAILURE, {
      userId: args.userId ?? null,
      meta: {
        scope: args.scope,
        tool: args.tool ?? "",
        endpoint: args.endpoint ?? "",
        method: args.method ?? null,
        status: args.status ?? null,
        durationMs: args.durationMs ?? null,
      },
    })
  }
}

export function withApiUsage(meta: { endpoint: string; tool?: string; leagueIdFromParams?: string }) {
  return function wrap(handler: any) {
    return async (req: Request, ctx: any) => {
      const start = Date.now()
      let status = 200
      let ok = true
      let caught: unknown = null
      try {
        const res = await handler(req, ctx)
        status = (res?.status ?? 200) as number
        ok = status >= 200 && status < 400
        return res
      } catch (e) {
        status = 500
        ok = false
        caught = e
        throw e
      } finally {
        const durationMs = Date.now() - start
        const leagueId =
          ctx?.params?.leagueId ??
          (meta.leagueIdFromParams && ctx?.params?.[meta.leagueIdFromParams]) ??
          ""

        await logUsageEvent({
          scope: "api",
          tool: meta.tool || "API",
          endpoint: meta.endpoint || "(unknown)",
          method: req.method,
          status,
          ok,
          durationMs,
          leagueId: leagueId ? String(leagueId) : ""
        }).catch(() => {})

        if (!ok || status >= 400) {
          logApiFailure({
            endpoint: meta.endpoint || "(unknown)",
            method: req.method,
            status,
            durationMs,
            leagueId: leagueId ? String(leagueId) : null,
            error: caught ?? undefined,
          })
        }
      }
    }
  }
}
