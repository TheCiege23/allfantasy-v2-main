// @vitest-environment node
/**
 * /admin/apps people counts (2026-11-21): the counting rules, the queries over our own
 * "app_open" rows, and how those rows are recorded. No third-party analytics service.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { buildPlatformRows, cameBackRate, normalizeWindow, parseDaily } from '@/lib/admin-dashboard/appPlatformStats'
import { appPlatformQueries, getAppPlatformReport } from '@/lib/admin-dashboard/AppPlatformStatsService'
import { APP_OPEN_EVENT, recordAppOpen, resolveAppPlatform } from '@/lib/analytics/appOpen'

describe('appPlatformStats', () => {
  it('only accepts the offered windows', () => {
    expect(normalizeWindow('14')).toBe(14)
    expect(normalizeWindow('1; DROP')).toBe(7)
    expect(normalizeWindow(undefined)).toBe(7)
  })

  it('folds unknown platform values into "Not labelled yet" and hides that row when empty', () => {
    const rows = buildPlatformRows(
      [['ios_app', 12], ['web', 40], ['android_app', 3]],
      [['ios_app', 4, 1], ['web', 10, 5]],
    )
    expect(rows.map((r) => r.platform)).toEqual(['ios_app', 'android_app', 'web'])
    expect(rows[0]).toMatchObject({ active: 12, newUsers: 4, cameBack: 1 })
    expect(rows[1]).toMatchObject({ active: 3, newUsers: 0, cameBack: 0 })

    const withOld = buildPlatformRows([['web', 5], [null, 9], ['tv_app', 1]], null)
    expect(withOld.find((r) => r.platform === 'unlabelled')?.active).toBe(10)
  })

  it('🛑 a failed read is null, never zero', () => {
    const rows = buildPlatformRows(null, null)
    expect(rows.every((r) => r.active === null && r.newUsers === null)).toBe(true)
    expect(cameBackRate({ newUsers: null, cameBack: null })).toBe('—')
    expect(cameBackRate({ newUsers: 0, cameBack: 0 })).toBe('—')
    expect(cameBackRate({ newUsers: 8, cameBack: 3 })).toBe('38%')
  })

  it('groups daily rows by day, in date order', () => {
    const daily = parseDaily([
      ['2026-11-21', 'web', 7],
      ['2026-11-20', 'ios_app', 2],
      ['2026-11-20', 'web', 5],
    ])
    expect(daily.map((d) => d.day)).toEqual(['2026-11-20', '2026-11-21'])
    expect(daily[0]!.counts).toEqual({ ios_app: 2, android_app: 0, web: 5, unlabelled: 0 })
  })
})

describe('AppPlatformStatsService', () => {
  it('🛑 the window and event name travel as bound values, never in the query text', () => {
    const q = appPlatformQueries(30)
    expect(q.active.values).toContain(APP_OPEN_EVENT)
    expect(q.active.values).toContain(30)
    expect(q.daily.values).toContain(29)
    expect(q.newUsers.values).toEqual(expect.arrayContaining([90, 30]))
    for (const query of Object.values(q)) {
      expect(query.sql).toContain('"AnalyticsEvent"')
      expect(query.sql).not.toContain('app_open')
    }
  })

  it('reports a failed query and leaves only that section empty', async () => {
    const $queryRaw = vi.fn(async (query: Prisma.Sql) => {
      const sql = query.sql
      if (sql.includes('to_char')) throw new Error('connection reset — secret detail')
      if (sql.includes('array_agg')) return [{ platform: 'ios_app', new_users: 2, came_back: 1 }]
      if (sql.includes('min("createdAt") AS first')) return [{ first: new Date('2026-11-21T03:00:00Z') }]
      if (sql.includes('GROUP BY 1')) return [{ platform: 'ios_app', users: 5 }, { platform: 'web', users: 9 }]
      return [{ n: 13 }]
    })
    const report = await getAppPlatformReport({ days: '14', db: { $queryRaw } as never })
    expect(report.days).toBe(14)
    expect(report.totalActive).toBe(13)
    expect(report.countingSince).toBe('2026-11-21T03:00:00.000Z')
    expect(report.daily).toBeNull()
    expect(report.errors).toEqual(['Daily chart: the database query failed'])
    expect(report.platforms.find((p) => p.platform === 'ios_app')).toMatchObject({ active: 5, newUsers: 2, cameBack: 1 })
  })

  it('no rows yet: counting has not started, and nothing reads as an error', async () => {
    const $queryRaw = vi.fn(async (query: Prisma.Sql) => (query.sql.includes('AS first') ? [{ first: null }] : query.sql.includes('AS n') ? [{ n: 0 }] : []))
    const report = await getAppPlatformReport({ days: 7, db: { $queryRaw } as never })
    expect(report).toMatchObject({ countingSince: null, totalActive: 0, errors: [] })
  })
})

describe('app_open recording', () => {
  it('trusts the iOS marker over the page, and drops anything it does not know', () => {
    expect(resolveAppPlatform('web', 'Mozilla/5.0 AllFantasyiOS/1.1')).toBe('ios_app')
    expect(resolveAppPlatform('ios_app', 'Mozilla/5.0 Safari')).toBeNull()
    expect(resolveAppPlatform('android_app', 'Mozilla/5.0 Chrome')).toBe('android_app')
    expect(resolveAppPlatform('tv_app', null)).toBeNull()
    expect(resolveAppPlatform(undefined, null)).toBeNull()
  })

  function fakeDb() {
    const rows: Array<{ event: string; sessionId: string | null; userId: string | null; meta: unknown; createdAt: Date }> = []
    return {
      rows,
      analyticsEvent: {
        findMany: vi.fn(async ({ where }: { where: { event: string; createdAt: { gte: Date }; sessionId?: string; userId?: string } }) =>
          rows.filter((r) => r.event === where.event && r.createdAt >= where.createdAt.gte &&
            (where.sessionId ? r.sessionId === where.sessionId : r.userId === where.userId))),
        create: vi.fn(async ({ data }: { data: (typeof rows)[number] }) => {
          rows.push(data)
        }),
      },
    }
  }

  it('one row per device, per platform, per UTC day', async () => {
    const db = fakeDb()
    const at = (iso: string) => ({ platform: 'android_app' as const, sessionId: 'anon-1', userId: null, now: new Date(iso) })
    expect(await recordAppOpen(db as never, at('2026-11-21T01:00:00Z'))).toBe('recorded')
    expect(await recordAppOpen(db as never, at('2026-11-21T23:00:00Z'))).toBe('duplicate')
    // Same Chrome storage, plain browser tab: a different platform counts separately.
    expect(await recordAppOpen(db as never, { ...at('2026-11-21T23:30:00Z'), platform: 'web' })).toBe('recorded')
    expect(await recordAppOpen(db as never, at('2026-11-22T00:05:00Z'))).toBe('recorded')
    expect(db.rows).toHaveLength(3)
    expect(db.rows[0]!.meta).toEqual({ app_platform: 'android_app' })
  })

  it('needs a device or a user to count anyone', async () => {
    const db = fakeDb()
    expect(await recordAppOpen(db as never, { platform: 'web', sessionId: null, userId: null })).toBe('no_person')
    expect(db.analyticsEvent.create).not.toHaveBeenCalled()
  })
})
