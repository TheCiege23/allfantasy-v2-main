// @vitest-environment node
/**
 * App Store download counts for /admin/apps (2026-11-20): report parsing, the
 * pending-vs-zero 404 rule, the per-day cache, and the two store cards.
 */
import { generateKeyPairSync } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppStoreDownloads, parseSalesReport, reportDates } from '@/lib/app-store/appStoreDownloads'
import { resetAppStoreTokenCache } from '@/lib/app-store/appStoreSalesFetch'
import { appleCard, googleCard } from '@/lib/admin-dashboard/storeDownloads'

const HEADER = ['Provider', 'SKU', 'Product Type Identifier', 'Units', 'Apple Identifier', 'Begin Date'].join('\t')
const row = (type: string, units: number, appId = '6815778932') => ['APPLE', 'af', type, String(units), appId, '11/18/2026'].join('\t')
const REPORT = [HEADER, row('1F', 3), row('1', 2), row('3F', 1), row('7F', 9), row('IA1', 4, '999'), row('1F', 50, '111')].join('\n')

const PRIVATE_KEY = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ENV = {
  APP_STORE_CONNECT_KEY_ID: 'KEY123',
  APP_STORE_CONNECT_ISSUER_ID: 'issuer-uuid',
  APP_STORE_CONNECT_PRIVATE_KEY: PRIVATE_KEY.replace(/\n/g, '\\n'),
  APP_STORE_CONNECT_VENDOR_NUMBER: '8800',
  APP_STORE_CONNECT_APP_ID: '6815778932',
}
// 06:00 UTC on Nov 20 is still Nov 19 in Pacific time, so "yesterday" there is Nov 18.
const NOW = new Date('2026-11-20T06:00:00Z')

function fakeDb() {
  const rows = new Map<string, { cacheKey: string; data: unknown; expiresAt: Date }>()
  return {
    rows,
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => rows.get(where.cacheKey) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        rows.set(where.cacheKey, { cacheKey: where.cacheKey, data: create.data, expiresAt: create.expiresAt })
      }),
    },
  }
}

function appleFetch(byDate: Record<string, number | 'report'>) {
  return vi.fn(async (url: unknown) => {
    const date = new URL(String(url)).searchParams.get('filter[reportDate]')!
    const answer = byDate[date] ?? 404
    if (answer === 'report') return new Response(gzipSync(Buffer.from(REPORT)), { status: 200 })
    return new Response('{"errors":[]}', { status: answer })
  })
}

describe('parseSalesReport', () => {
  it('counts first downloads and re-downloads for this app only; updates and purchases are not downloads', () => {
    expect(parseSalesReport(REPORT, '6815778932')).toEqual({ downloads: 5, redownloads: 1 })
    expect(parseSalesReport(REPORT, null)).toEqual({ downloads: 55, redownloads: 1 })
  })

  it('🛑 an unrecognised header is unreadable, not zero', () => {
    expect(parseSalesReport('Foo\tBar\n1\t2', null)).toBeNull()
  })

  it('report days end yesterday on the Pacific calendar', () => {
    expect(reportDates(NOW, 3)).toEqual(['2026-11-18', '2026-11-17', '2026-11-16'])
  })
})

describe('getAppStoreDownloads', () => {
  beforeEach(() => resetAppStoreTokenCache())

  it('needs all four settings', async () => {
    const r = await getAppStoreDownloads({ days: 7, env: {}, db: fakeDb() as never })
    expect(r).toEqual({ status: 'not_configured', missing: ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_PRIVATE_KEY', 'APP_STORE_CONNECT_VENDOR_NUMBER'] })
  })

  it('yesterday\'s 404 is pending (left out, not cached); older 404s are zero; reports are cached', async () => {
    const db = fakeDb()
    const fetchImpl = appleFetch({ '2026-11-16': 'report' })
    const r = await getAppStoreDownloads({ days: 3, now: NOW, env: ENV, db: db as never, fetchImpl: fetchImpl as never })

    expect(r).toEqual({
      status: 'ok',
      scopedToApp: true,
      through: '2026-11-17',
      days: [
        { date: '2026-11-16', downloads: 5, redownloads: 1 },
        { date: '2026-11-17', downloads: 0, redownloads: 0 },
      ],
    })
    expect([...db.rows.keys()].map((k) => k.slice(-10)).sort()).toEqual(['2026-11-16', '2026-11-17'])

    // The key rides in the Authorization header, never the URL.
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).not.toContain('PRIVATE')
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)

    // Second load: only the still-pending day is asked for again.
    const again = appleFetch({})
    await getAppStoreDownloads({ days: 3, now: NOW, env: ENV, db: db as never, fetchImpl: again as never })
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('🛑 a refused key is an error with the status only, and nothing is cached', async () => {
    const db = fakeDb()
    const r = await getAppStoreDownloads({ days: 3, now: NOW, env: ENV, db: db as never, fetchImpl: appleFetch({ '2026-11-18': 401 }) as never })
    expect(r.status).toBe('error')
    expect(r.status === 'error' && r.reason).toContain('401')
    expect(r.status === 'error' && r.reason).not.toContain('PRIVATE')
  })
})

describe('store cards', () => {
  it('🛑 not connected or failed shows no number, never zero', () => {
    expect(appleCard({ status: 'not_configured', missing: ['APP_STORE_CONNECT_KEY_ID'] })).toMatchObject({ state: 'not_configured', count: null })
    expect(googleCard({ status: 'error', reason: 'nope' }, 7)).toMatchObject({ state: 'error', count: null, problem: 'nope' })
  })

  it('Google sums the window ending on its newest report day', () => {
    const daily = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(5 + i).padStart(2, '0')}`, installs: i + 1 }))
    const card = googleCard({
      status: 'ok',
      fetchedAt: '',
      stats: { installsAllTime: 55, installs28Days: 55, installs7Days: 49, activeDevices: null, latestDate: '2026-11-14', installColumn: 'Daily User Installs', reportMonths: 1, daily },
    }, 7)
    expect(card).toMatchObject({ state: 'ok', count: 4 + 5 + 6 + 7 + 8 + 9 + 10, through: '2026-11-14' })
  })

  it('Apple totals the days it has and says when it counts every app on the account', () => {
    const card = appleCard({ status: 'ok', scopedToApp: false, through: '2026-11-18', days: [{ date: '2026-11-18', downloads: 4, redownloads: 2 }, { date: '2026-11-17', downloads: 6, redownloads: 0 }] })
    expect(card).toMatchObject({ count: 10, detail: '2 re-downloads · every app on the account' })
  })
})
