import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression cover for the `cron-decision-os-activity-ingest` hang (Aug 2026).
 *
 * Six prod `SyncJobRun` rows sat in `running` forever because a Vercel `maxDuration` kill runs no
 * user code — so `withSyncJobRun`'s catch, and therefore `finishRun`, never executed. These tests
 * pin the reaper that closes such rows and the guarantee that it can never break the job it runs
 * in front of.
 */

const prismaMock = vi.hoisted(() => ({
  syncJobRun: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { reapAbandonedRuns, withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

const NOW = Date.parse("2026-08-20T07:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.syncJobRun.create.mockResolvedValue({ id: "run-1" })
  prismaMock.syncJobRun.update.mockResolvedValue({})
  prismaMock.syncJobRun.updateMany.mockResolvedValue({ count: 0 })
})

describe("reapAbandonedRuns", () => {
  it("marks only this job's long-running rows failed, scoped by startedAt", async () => {
    prismaMock.syncJobRun.updateMany.mockResolvedValue({ count: 6 })

    const count = await reapAbandonedRuns("cron-decision-os-activity-ingest", { now: NOW })

    expect(count).toBe(6)
    const args = prismaMock.syncJobRun.updateMany.mock.calls[0][0]

    // Scoped to one jobName — reaping must never disturb another job's telemetry.
    expect(args.where.jobName).toBe("cron-decision-os-activity-ingest")
    expect(args.where.status).toBe("running")
    expect(args.data.status).toBe("failed")

    // 30 min cutoff: ~6x the longest legitimate run, so a live invocation is never reaped.
    const cutoff = args.where.startedAt.lt as Date
    expect(NOW - cutoff.getTime()).toBe(30 * 60_000)
  })

  it("leaves a run that started inside the window alone", async () => {
    // A fire that began 5 minutes ago is still plausibly alive (maxDuration is 300s).
    await reapAbandonedRuns("cron-decision-os-activity-ingest", { now: NOW })
    const cutoff = prismaMock.syncJobRun.updateMany.mock.calls[0][0].where.startedAt.lt as Date
    expect(cutoff.getTime()).toBeLessThan(NOW - 5 * 60_000)
  })

  it("records WHY the row was closed rather than inventing a duration", async () => {
    await reapAbandonedRuns("job-x", { now: NOW })
    const data = prismaMock.syncJobRun.updateMany.mock.calls[0][0].data

    expect(String(data.errorMessage)).toContain("abandoned")
    // durationMs is deliberately untouched: we do not know how long the killed run actually ran,
    // and writing a fabricated number would be worse than leaving it null.
    expect(data).not.toHaveProperty("durationMs")
  })

  it("is best-effort — a DB failure returns 0 instead of throwing", async () => {
    prismaMock.syncJobRun.updateMany.mockRejectedValue(new Error("connection lost"))
    await expect(reapAbandonedRuns("job-x", { now: NOW })).resolves.toBe(0)
  })
})

describe("withSyncJobRun reaps before it starts", () => {
  it("closes orphaned rows on the next fire of the same job", async () => {
    prismaMock.syncJobRun.updateMany.mockResolvedValue({ count: 6 })

    await withSyncJobRun({ jobName: "cron-decision-os-activity-ingest" }, async () => ({ ok: true }))

    expect(prismaMock.syncJobRun.updateMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.syncJobRun.updateMany.mock.calls[0][0].where.jobName).toBe(
      "cron-decision-os-activity-ingest",
    )
    // The job itself still ran and still closed its own row.
    expect(prismaMock.syncJobRun.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.syncJobRun.update.mock.calls[0][0].data.status).toBe("success")
  })

  it("still runs the job when the reaper fails", async () => {
    prismaMock.syncJobRun.updateMany.mockRejectedValue(new Error("db down"))
    const fn = vi.fn(async () => ({ ok: true }))

    await expect(withSyncJobRun({ jobName: "job-x" }, fn)).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("tolerates a Prisma client generated without updateMany", async () => {
    // Older generated clients in some environments lack the delegate method entirely.
    const original = prismaMock.syncJobRun.updateMany
    // @ts-expect-error — deliberately removing the method to simulate an older client.
    prismaMock.syncJobRun.updateMany = undefined

    await expect(reapAbandonedRuns("job-x", { now: NOW })).resolves.toBe(0)

    prismaMock.syncJobRun.updateMany = original
  })
})
