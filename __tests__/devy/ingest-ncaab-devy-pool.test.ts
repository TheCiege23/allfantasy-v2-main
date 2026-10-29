/**
 * The NCAAB devy pool's scheduled writer: a weekly cadence marker around `seedCollegePlayers`.
 *
 * WHY IT EXISTS. `seedCollegeBasketballPlayers` is the only writer of `DevyPlayer` rows with
 * sport 'NCAAB', and its only caller was `lib/workers/devy-data-worker.ts`, reachable only from
 * a Redis job type nothing enqueues (`enqueueDevy` has zero callers) and a worker entrypoint no
 * deploy starts. So the pool had no scheduled writer, which is the `ingestCFBDStats` failure.
 *
 * What these pin: the marker gates to once a week, a partial run RESUMES rather than restarting
 * (and is not mistaken for a finished week), and an empty provider answer does not stamp the week
 * as done.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  marker: null as { data: unknown } | null,
  upserts: [] as Array<{ cacheKey: string; data: Record<string, unknown> }>,
  seed: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async () => h.marker),
      upsert: vi.fn(async (args: { where: { cacheKey: string }; create: { data: Record<string, unknown> } }) => {
        h.upserts.push({ cacheKey: args.where.cacheKey, data: args.create.data })
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/devy/CollegePlayerSeedService', () => ({ seedCollegePlayers: h.seed }))

import { NCAAB_DEVY_POOL_MARKER_KEY, ingestNcaabDevyPoolIfDue } from '@/lib/devy/ingestNcaabDevyPool'

const DAY = 86_400_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const deadlineAt = () => Date.now() + 45_000

const complete = (over: Record<string, unknown> = {}) => ({
  sport: 'NCAAB',
  source: 'rolling_insights',
  seeded: 4200,
  updated: 0,
  totalInPool: 4300,
  errors: [],
  fetched: 4210,
  nextOffset: null,
  ...over,
})

beforeEach(() => {
  h.marker = null
  h.upserts.length = 0
  h.seed.mockReset()
})

describe('weekly cadence', () => {
  it('runs when there is no marker, seeding NCAAB from the start, and stamps the week', async () => {
    h.seed.mockResolvedValue(complete())

    const r = await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(h.seed).toHaveBeenCalledTimes(1)
    expect(h.seed.mock.calls[0][0]).toMatchObject({ sport: 'NCAAB', startAt: 0 })
    expect(typeof h.seed.mock.calls[0][0].deadlineAt).toBe('number')
    expect(r).toMatchObject({ seeded: 4200, fetched: 4210, complete: true })
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0].cacheKey).toBe(NCAAB_DEVY_POOL_MARKER_KEY)
    expect(typeof h.upserts[0].data.at).toBe('string')
    expect(h.upserts[0].data.resumeFrom).toBe(0)
  })

  it('runs when the marker is more than a week old', async () => {
    h.marker = { data: { at: ago(8 * DAY), resumeFrom: 0 } }
    h.seed.mockResolvedValue(complete())

    await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(h.seed).toHaveBeenCalledTimes(1)
  })

  it('skips without touching the provider when the marker is fresh', async () => {
    h.marker = { data: { at: ago(2 * DAY), resumeFrom: 0 } }

    const r = await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(h.seed).not.toHaveBeenCalled()
    expect(h.upserts).toHaveLength(0)
    expect(r).toMatchObject({ skipped: 'weekly cadence' })
  })
})

describe('resumable', () => {
  it('a run stopped by its deadline records where to resume and does NOT stamp the week', async () => {
    const previousAt = ago(9 * DAY)
    h.marker = { data: { at: previousAt, resumeFrom: 0 } }
    h.seed.mockResolvedValue(complete({ seeded: 1500, nextOffset: 1500 }))

    const r = await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(r).toMatchObject({ complete: false, resumeFrom: 1500 })
    expect(h.upserts[0].data).toMatchObject({ at: previousAt, resumeFrom: 1500 })
  })

  it('a pending resume runs even though the last FULL pass was recent, from the stored offset', async () => {
    h.marker = { data: { at: ago(1 * DAY), resumeFrom: 1500, lastAttemptAt: ago(6 * 3_600_000) } }
    h.seed.mockResolvedValue(complete({ nextOffset: null }))

    await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(h.seed.mock.calls[0][0]).toMatchObject({ startAt: 1500 })
    expect(h.upserts[0].data.resumeFrom).toBe(0)
  })
})

describe('an empty provider answer is a failure, not a finished week', () => {
  it('throws (so the heartbeat records failed) and records the attempt without stamping `at`', async () => {
    const previousAt = ago(10 * DAY)
    h.marker = { data: { at: previousAt, resumeFrom: 0 } }
    h.seed.mockResolvedValue(complete({ fetched: 0, seeded: 0, source: 'cache', errors: ['All providers failed'] }))

    await expect(ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })).rejects.toThrow(/no rows/i)

    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0].data.at).toBe(previousAt)
    expect(typeof h.upserts[0].data.lastAttemptAt).toBe('string')
  })

  it('backs off for a day after a failed attempt rather than retrying every tick', async () => {
    h.marker = { data: { at: ago(10 * DAY), resumeFrom: 0, lastAttemptAt: ago(6 * 3_600_000), lastError: 'no rows' } }

    const r = await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })

    expect(h.seed).not.toHaveBeenCalled()
    expect(r).toMatchObject({ skipped: 'retry backoff' })
  })
})

describe('the 200-row cached answer is never a refresh', () => {
  it('asks the provider for the full list on every pass', async () => {
    h.seed.mockResolvedValue(complete())
    await ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })
    expect(h.seed).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NCAAB', forceRefresh: true }))
  })

  it('refuses a cached answer: no week stamped, error recorded, retried after back-off', async () => {
    h.seed.mockResolvedValue(complete({ source: 'cache', fetched: 200, seeded: 200 }))
    await expect(ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })).rejects.toThrow(/at most 200 rows/)
    const written = h.upserts.at(-1)!.data
    expect(written.at).toBeNull()
    expect(String(written.lastError)).toMatch(/cache/)
  })

  it('restarts a resumed pass whose list came back shorter than the resume offset', async () => {
    h.marker = { data: { at: ago(9 * DAY), resumeFrom: 3000 } }
    h.seed.mockResolvedValue(complete({ fetched: 200, seeded: 0 }))
    await expect(ingestNcaabDevyPoolIfDue({ deadlineAt: deadlineAt() })).rejects.toThrow(/resume offset 3000/)
    const written = h.upserts.at(-1)!.data
    expect(written.resumeFrom).toBe(0)
    expect(written.at).toBe(h.marker.data && (h.marker.data as { at: string }).at)
  })
})
