// @vitest-environment node
/**
 * The multi-year NBA draft history (contracts/cbbd GAPS B-03). The backfill runs through the REAL adapter
 * (lib/cbbd/cbbdFetch.ts -> lib/cfbd-fetch.ts) over a stubbed global `fetch`, so "the key is a header and never
 * a URL or a log line" is checked on the actual request, not on a mock of the function that builds it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: new Map<string, { data: unknown; expiresAt: Date }>(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => (h.rows.has(where.cacheKey) ? { data: h.rows.get(where.cacheKey)!.data } : null)),
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { in: string[] } } }) => where.cacheKey.in.filter((k) => h.rows.has(k)).map((k) => ({ data: h.rows.get(k)!.data }))),
      upsert: vi.fn(async ({ where, update }: { where: { cacheKey: string }; update: { data: unknown; expiresAt: Date } }) => {
        h.rows.set(where.cacheKey, { data: update.data, expiresAt: update.expiresAt })
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/league/collegePro/draftNotices', () => ({ notifyNewDraftPicks: vi.fn(async () => null) }))

import {
  backfillCbbdDraftHistory,
  backfillRangeError,
  CBBD_DRAFT_HISTORY_KEY_PREFIX,
  lastFinalDraftYear,
  readDraftHistory,
  toDraftHistoryRow,
} from '@/lib/devy/cbbdDraftHistoryIngest'
import { refreshCbbdDraftPicks } from '@/lib/devy/cbbdDraftPicksStore'
import { __resetCfbdQuotaForTests } from '@/lib/cfbd-quota'

const KEY = 'sekret-cbbd-key-0123456789'
const NOW = new Date('2026-11-28T12:00:00Z')
const PICKS_2025: Array<Record<string, unknown>> = JSON.parse(readFileSync(join(process.cwd(), 'contracts/cbbd/fixtures/draft-picks-2025.json'), 'utf8')).response
/** The 2025 capture relabelled to another year: the same shape, which is all a backfill test needs. */
const picksFor = (year: number) => PICKS_2025.map((p) => ({ ...p, year }))

type Call = { url: string; headers: Record<string, string> }
let calls: Call[] = []
let respond: (year: number) => Response
const logged: string[] = []

beforeEach(() => {
  h.rows.clear()
  calls = []
  logged.length = 0
  __resetCfbdQuotaForTests()
  process.env.CFBD_API_KEY = KEY
  respond = (year) => new Response(JSON.stringify(picksFor(year)), { status: 200, headers: { 'x-calllimit-remaining': '70000' } })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const year = Number(new URL(String(url)).searchParams.get('year'))
    return respond(year)
  }))
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')) })
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.CFBD_API_KEY
})

/** Only the history rows: every CBBD response also records the shared quota reading (`cfbd:quota:v1`). */
const history = () => new Map([...h.rows].filter(([k]) => k.startsWith(CBBD_DRAFT_HISTORY_KEY_PREFIX)))

const noSleep = { sleep: vi.fn(async () => undefined), quotaAllowed: async () => ({ allowed: true, reason: null }) }

describe('backfillCbbdDraftHistory', () => {
  it('stores every year in the range under its own key, one call each, with the key only in the header', async () => {
    const r = await backfillCbbdDraftHistory({ from: 2018, to: 2020, now: NOW, deps: noSleep })
    expect(r).toMatchObject({ calls: 3, stoppedEarly: null })
    expect(r.years.map((y) => y.status)).toEqual(['stored', 'stored', 'stored'])
    expect([...history().keys()].sort()).toEqual([2018, 2019, 2020].map((y) => `${CBBD_DRAFT_HISTORY_KEY_PREFIX}${y}`))
    const stored = h.rows.get(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2019`)!
    expect(stored.expiresAt.getUTCFullYear()).toBe(2100)
    expect(stored.data).toMatchObject({ year: 2019, final: true, counts: { picks: 59, college: 46, collegeWithAthleteId: 45 } })
    // Every call: CBBD host, the year in the query, the key in Authorization and nowhere in the URL.
    for (const c of calls) {
      expect(c.url).toMatch(/^https:\/\/api\.collegebasketballdata\.com\/draft\/picks\?year=20(18|19|20)$/)
      expect(c.url).not.toContain(KEY)
      expect(c.headers.Authorization).toBe(`Bearer ${KEY}`)
    }
  })

  it('is idempotent and keeps prior years: a second run makes no call and rewrites nothing', async () => {
    await backfillCbbdDraftHistory({ from: 2018, to: 2019, now: NOW, deps: noSleep })
    const before = JSON.stringify([...history().entries()])
    calls = []
    const again = await backfillCbbdDraftHistory({ from: 2017, to: 2019, now: NOW, deps: noSleep })
    expect(calls.map((c) => new URL(c.url).searchParams.get('year'))).toEqual(['2017'])
    expect(again.years.filter((y) => y.status === 'skipped').map((y) => y.year)).toEqual([2018, 2019])
    // 2018 and 2019 exactly as they were; 2017 added beside them.
    const after = history()
    for (const [k, v] of JSON.parse(before) as Array<[string, unknown]>) expect(JSON.stringify(after.get(k))).toBe(JSON.stringify(v))
    expect(after.size).toBe(3)
  })

  it('paces its calls: one pause between each pair, none before the first', async () => {
    const sleep = vi.fn(async () => undefined)
    await backfillCbbdDraftHistory({ from: 2016, to: 2019, now: NOW, delayMs: 1234, deps: { ...noSleep, sleep } })
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.every((c) => (c as unknown[])[0] === 1234)).toBe(true)
  })

  it('refuses an out-of-bounds range before making any call', async () => {
    for (const [from, to] of [[1999, 2005], [2010, 2027], [2020, 2010], [1990, 2026]] as const) {
      await expect(backfillCbbdDraftHistory({ from, to, now: NOW, deps: noSleep })).rejects.toThrow(/refused/)
    }
    expect(backfillRangeError(2000, 2026, NOW, 30)).toBeNull()
    expect(backfillRangeError(2000, 2026, NOW, 20)).toMatch(/more than the 20/)
    expect(calls).toEqual([])
    // A draft still in its window belongs to the scheduled writer.
    expect(lastFinalDraftYear(new Date('2027-06-30T00:00:00Z'))).toBe(2026)
    expect(lastFinalDraftYear(new Date('2027-07-11T00:00:00Z'))).toBe(2027)
  })

  it('stops at the shared quota reserve and on the first failure, keeping what it wrote — and never logs the key', async () => {
    let gateCalls = 0
    const gated = await backfillCbbdDraftHistory({
      from: 2010, to: 2015, now: NOW,
      deps: { sleep: noSleep.sleep, quotaAllowed: async () => (++gateCalls > 2 ? { allowed: false, reason: 'CFBD quota reserve: 14000 calls left' } : { allowed: true, reason: null }) },
    })
    expect(gated).toMatchObject({ calls: 2, stoppedEarly: expect.stringContaining('quota reserve') })
    expect(history().size).toBe(2)

    respond = (year) => (year === 2013 ? new Response('{"message":"Monthly call quota exceeded."}', { status: 429 }) : new Response(JSON.stringify(picksFor(year)), { status: 200 }))
    const failed = await backfillCbbdDraftHistory({ from: 2010, to: 2015, now: NOW, deps: noSleep })
    expect(failed.stoppedEarly).toBe('2013: quota')
    expect(failed.years.find((y) => y.year === 2013)).toMatchObject({ status: 'error' })
    expect(calls.some((c) => c.url.endsWith('year=2014'))).toBe(false)
    expect(h.rows.has(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2012`)).toBe(true)
    expect(JSON.stringify([gated, failed])).not.toContain(KEY)
    expect(logged.join('\n')).not.toContain(KEY)
  })

  it('never stores a malformed response as a year of history', () => {
    expect(toDraftHistoryRow(2019, [], NOW)).toEqual({ ok: false, reason: 'no picks published' })
    expect(toDraftHistoryRow(2019, picksFor(2018), NOW)).toMatchObject({ ok: false, reason: expect.stringContaining('year 2018') })
    expect(toDraftHistoryRow(2019, [{ ...picksFor(2019)[0], overall: null }], NOW)).toMatchObject({ ok: false })
    const ok = toDraftHistoryRow(2025, PICKS_2025, NOW)
    expect(ok.ok && ok.row.picks[0]).toMatchObject({ athleteId: 205, name: 'Cooper Flagg', overall: 1, overallRank: 1, college: true, position: 'F' })
  })

  it('reads the stored years back for the measurement', async () => {
    await backfillCbbdDraftHistory({ from: 2020, to: 2021, now: NOW, deps: noSleep })
    const read = await readDraftHistory([2019, 2020, 2021])
    expect([...read.keys()].sort()).toEqual([2020, 2021])
  })
})

describe('the scheduled writer keeps history', () => {
  it('stores its year in the history key from the draft call it already makes, and keeps the linked row permanently', async () => {
    const duke = JSON.parse(readFileSync(join(process.cwd(), 'contracts/cbbd/fixtures/roster-2025-duke.json'), 'utf8')).response
    respond = () => new Response('[]', { status: 200 })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url: String(url), headers: {} })
      return String(url).includes('/draft/picks') ? new Response(JSON.stringify(PICKS_2025.filter((p) => p.sourceTeamLocation === 'Duke')), { status: 200 }) : new Response(JSON.stringify(duke), { status: 200 })
    }))
    const r = await refreshCbbdDraftPicks({ now: new Date('2025-11-01T12:00:00Z') })
    expect(r).toMatchObject({ year: 2025, stored: 5 })
    expect(calls.filter((c) => c.url.includes('/draft/picks'))).toHaveLength(1)
    expect(h.rows.get(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2025`)?.data).toMatchObject({ year: 2025, final: true, counts: { picks: 5 } })
    expect(h.rows.get('cbbd:draft-picks:v1:2025')!.expiresAt.getUTCFullYear()).toBe(2100)
    // It wrote only its own year's keys.
    expect([...h.rows.keys()].filter((k) => k.startsWith('cbbd:')).sort()).toEqual([`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2025`, 'cbbd:draft-picks:v1:2025'])
  })

  it('keeps the draft history even when a roster read fails and the linked row is withheld', async () => {
    h.rows.set(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2024`, { data: { year: 2024, fetchedAt: '2024-08-01T00:00:00Z', picks: [{}] }, expiresAt: new Date('2100-01-01') })
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/draft/picks') ? new Response(JSON.stringify(PICKS_2025), { status: 200 }) : new Response('{"message":"Monthly call quota exceeded."}', { status: 429 }),
    ))
    const r = await refreshCbbdDraftPicks({ now: new Date('2025-11-01T12:00:00Z') })
    expect('error' in r).toBe(true)
    expect(h.rows.has('cbbd:draft-picks:v1:2025')).toBe(false)
    expect(h.rows.get(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2025`)?.data).toMatchObject({ counts: { picks: 59 } })
    // A prior year is untouched.
    expect(h.rows.get(`${CBBD_DRAFT_HISTORY_KEY_PREFIX}2024`)?.data).toMatchObject({ year: 2024, fetchedAt: '2024-08-01T00:00:00Z' })
  })
})
