import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A LOST TELEMETRY ROW WAS COMPLETELY INVISIBLE, AND THE MONITOR BUILT ON IT WAS NOT.
 *
 * `recordSyncJobRun` and `startRun`/`finishRun` were best-effort in the strong sense: a missing
 * `prisma.syncJobRun` delegate returned early and a failed write hit a bare `catch {}`. Correct as
 * BEHAVIOUR — telemetry must never fail the job it observes — and wrong as SILENCE, because
 * `scripts/cron-freshness-check.mjs` then reports CONFIG ("no sync_job_runs rows for job_name X"),
 * which reads as a registry mistake rather than a write that failed.
 *
 * Measured on production 2026-09-06, dispatcher log against the table:
 *
 *     06:09  import-news?xnews=1  OK 200 ( 78900ms)  ->  no row
 *     12:07  import-news?xnews=1  OK 200 (251446ms)  ->  no row
 *     18:21  import-news?xnews=1  OK 200 (215529ms)  ->  row written
 *
 * The job ran, returned 200, and left no trace twice out of three. All eleven of that day's
 * deployments contained the instrumentation, so "not deployed" was ruled out.
 */

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { syncJobRun: undefined as unknown } }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

let errors: string[]

beforeEach(() => {
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  prismaMock.syncJobRun = undefined
})

const CTX = { jobName: 'cron-import-news-xnews', trigger: 'cron' }

describe('a telemetry write that goes missing says so', () => {
  it('names the job when the prisma delegate is absent', async () => {
    prismaMock.syncJobRun = undefined
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    await recordSyncJobRun(CTX, {}, 1234)

    expect(errors.join('\n')).toMatch(/LOST a run row for "cron-import-news-xnews"/)
    expect(errors.join('\n')).toMatch(/delegate is absent/)
  })

  it('names the job AND the reason when the write throws', async () => {
    prismaMock.syncJobRun = { create: vi.fn().mockRejectedValue(new Error('connection refused')) }
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    await recordSyncJobRun(CTX, {}, 1234)

    expect(errors.join('\n')).toMatch(/LOST a run row for "cron-import-news-xnews"/)
    expect(errors.join('\n')).toMatch(/write threw: .*connection refused/)
  })

  /*
   * ⚠ THE TWO PATHS MUST STAY DISTINGUISHABLE. They produce the identical outcome from outside —
   * no row, no throw, HTTP 200 — so a single shared message would leave the next person exactly
   * where this started. This is the assertion that fails if they are collapsed.
   */
  it('the two failure modes do not report the same thing', async () => {
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    prismaMock.syncJobRun = undefined
    await recordSyncJobRun(CTX, {}, 1)
    const absent = errors.join('\n')

    errors = []
    prismaMock.syncJobRun = { create: vi.fn().mockRejectedValue(new Error('boom')) }
    await recordSyncJobRun(CTX, {}, 1)
    const threw = errors.join('\n')

    expect(absent).not.toBe(threw)
    expect(absent).toMatch(/delegate is absent/)
    expect(threw).toMatch(/write threw/)
  })

  /*
   * 🛑 BEHAVIOUR IS UNCHANGED, AND THAT IS THE WHOLE CONTRACT. Telemetry must never fail the job it
   * observes. If this ever throws, an unrelated cron starts dying because its logging broke.
   */
  it('still never throws, and still returns void, in either failure mode', async () => {
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    prismaMock.syncJobRun = undefined
    await expect(recordSyncJobRun(CTX, {}, 1)).resolves.toBeUndefined()

    prismaMock.syncJobRun = { create: vi.fn().mockRejectedValue(new Error('boom')) }
    await expect(recordSyncJobRun(CTX, {}, 1)).resolves.toBeUndefined()
  })

  it('says nothing at all when the write succeeds', async () => {
    prismaMock.syncJobRun = { create: vi.fn().mockResolvedValue({ id: 'r1' }) }
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    await recordSyncJobRun(CTX, {}, 1234)

    expect(errors).toEqual([])
  })

  /*
   * 🛑 THE ERROR PATH IS EXACTLY WHERE SECRETS ESCAPE — CLAUDE.md records a keystore password and
   * `RSC_token` both leaking through one. A Prisma connection error carries the database URL, and
   * this repo is PUBLIC. The message must be redacted BEFORE it is capped: capping first can cut a
   * credential in half and leave the readable front of it in the log.
   */
  it('redacts a credential in the thrown message rather than slicing it in half', async () => {
    const secretish = 'connect failed: postgresql://neondb_owner:npg_SUPERSECRETVALUE@ep-x.aws.neon.tech/neondb'
    prismaMock.syncJobRun = { create: vi.fn().mockRejectedValue(new Error(secretish)) }
    const { recordSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')

    await recordSyncJobRun(CTX, {}, 1)

    const line = errors.join('\n')
    expect(line).not.toContain('npg_SUPERSECRETVALUE')
    // Not merely truncated away — a prefix of the credential must not survive either.
    expect(line).not.toContain('npg_SUPER')
  })
})
