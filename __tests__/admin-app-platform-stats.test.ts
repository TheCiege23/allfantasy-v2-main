/**
 * /admin/apps counting rules and the PostHog read (2026-11-20).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildAppPlatformQueries,
  buildPlatformRows,
  cameBackRate,
  normalizeWindow,
  parseDaily,
} from '@/lib/admin-dashboard/appPlatformStats'
import { getAppPlatformReport, readPostHogQueryConfig, runHogQL } from '@/lib/admin-dashboard/AppPlatformStatsService'

const KEY = 'test-personal-key-not-real'
const config = { host: 'https://us.posthog.com', projectId: '12345', apiKey: KEY }

function ok(results: unknown[][]) {
  return new Response(JSON.stringify({ results }), { status: 200 })
}

describe('appPlatformStats', () => {
  it('only accepts the offered windows, so nothing else reaches the query text', () => {
    expect(normalizeWindow('14')).toBe(14)
    expect(normalizeWindow('1; DROP')).toBe(7)
    expect(normalizeWindow(undefined)).toBe(7)
    const q = buildAppPlatformQueries(30)
    expect(q.active).toContain('toIntervalDay(30)')
    expect(q.daily).toContain('toIntervalDay(29)')
    // Browser events only: server captures carry no platform label.
    for (const text of Object.values(q)) expect(text).toContain("properties.$lib = 'web'")
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
  it('needs both the personal key and a numeric project id', () => {
    expect(readPostHogQueryConfig({})).toBeNull()
    expect(readPostHogQueryConfig({ POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: 'abc' })).toBeNull()
    expect(readPostHogQueryConfig({ POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: '12345', POSTHOG_API_HOST: 'https://eu.posthog.com/' }))
      .toEqual({ host: 'https://eu.posthog.com', projectId: '12345', apiKey: KEY })
  })

  it('🛑 sends the key in the Authorization header only — never in the URL or an error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"detail":"nope"}', { status: 403 })) as unknown as typeof fetch
    const err = await runHogQL(config, 'SELECT 1', fetchImpl).catch((e: Error) => e)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toBe('https://us.posthog.com/api/projects/12345/query/')
    expect(String(url)).not.toContain(KEY)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${KEY}` })
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('403')
    expect((err as Error).message).not.toContain(KEY)
  })

  it('reports a failed query and leaves only that section empty', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)).query.query as string
      if (q.includes('toString(toDate')) return new Response('', { status: 500 })
      if (q.includes('argMin')) return ok([['ios_app', 2, 1]])
      if (q.includes('GROUP BY platform')) return ok([['ios_app', 5], ['web', 9]])
      return ok([[13]])
    }) as unknown as typeof fetch

    const report = await getAppPlatformReport({ days: '14', config, fetchImpl })
    expect(report.days).toBe(14)
    expect(report.totalActive).toBe(13)
    expect(report.daily).toBeNull()
    expect(report.errors).toEqual(['Daily chart: PostHog answered 500'])
    expect(report.platforms.find((p) => p.platform === 'ios_app')).toMatchObject({ active: 5, newUsers: 2, cameBack: 1 })
  })
})
