// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickSuperseded, reapOnce } from '../../scripts/cron-build-reaper.mjs'

/*
 * The reaper cancels production builds, so every case below is a way it could cancel the WRONG one
 * — leaving nothing to ship, cancelling the newest, or letting an old build land over new code.
 */

const at = (min: number) => new Date(Date.UTC(2026, 9, 2, 0, min)).toISOString()
const dep = (id: string, status: string, min: number) => ({ id, status, createdAt: at(min), commitHash: `${id}sha` })
const ids = (d: ReturnType<typeof pickSuperseded>) => d.map((x: { id: string }) => x.id)

describe('pickSuperseded', () => {
  it('five parallel builds (the 2026-10-02 00:16 picture): cancels all but the newest', () => {
    const d = [dep('a', 'BUILDING', 0), dep('b', 'BUILDING', 8), dep('c', 'BUILDING', 9), dep('d', 'BUILDING', 11), dep('e', 'BUILDING', 16)]
    expect(ids(pickSuperseded(d))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('never cancels the newest in-flight build', () => {
    expect(pickSuperseded([dep('only', 'BUILDING', 0)])).toEqual([])
  })

  it('a newer FAILED build supersedes nothing — the older good build still ships', () => {
    expect(pickSuperseded([dep('old', 'BUILDING', 0), dep('new', 'FAILED', 5)])).toEqual([])
    for (const s of ['CRASHED', 'REMOVED', 'SKIPPED']) {
      expect(pickSuperseded([dep('old', 'BUILDING', 0), dep('new', s, 5)]), s).toEqual([])
    }
  })

  it('a newer build that is already LIVE cancels a slower older one (no old code landing last)', () => {
    expect(ids(pickSuperseded([dep('old', 'BUILDING', 0), dep('new', 'SUCCESS', 5)]))).toEqual(['old'])
  })

  it('never cancels DEPLOYING or anything already finished', () => {
    const d = [dep('a', 'DEPLOYING', 0), dep('b', 'SUCCESS', 1), dep('c', 'REMOVED', 2), dep('d', 'BUILDING', 3)]
    expect(pickSuperseded(d)).toEqual([])
  })

  it('cancels QUEUED and INITIALIZING too, and orders by createdAt not by input order', () => {
    const d = [dep('new', 'BUILDING', 9), dep('q', 'QUEUED', 1), dep('i', 'INITIALIZING', 2)]
    expect(ids(pickSuperseded(d)).sort()).toEqual(['i', 'q'])
  })
})

describe('reapOnce', () => {
  afterEach(() => vi.unstubAllGlobals())
  const env = {
    RAILWAY_TOKEN: 'tok-SECRET-123',
    BUILD_REAPER_SERVICE_IDS: 'svc1',
    RAILWAY_PROJECT_ID: 'p',
    RAILWAY_ENVIRONMENT_ID: 'e',
  }
  const listing = {
    data: {
      deployments: {
        edges: [
          { node: { id: 'old', status: 'BUILDING', createdAt: at(0), meta: { commitHash: 'aaaaaaaaa1' } } },
          { node: { id: 'new', status: 'BUILDING', createdAt: at(5), meta: { commitHash: 'bbbbbbbbb2' } } },
        ],
      },
    },
  }

  function fakeFetch() {
    const calls: { headers: Record<string, string>; body: { query: string; variables: Record<string, unknown> } }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      const body = JSON.parse(init.body)
      calls.push({ headers: init.headers, body })
      const isCancel = body.query.includes('deploymentCancel')
      return { ok: true, json: async () => (isCancel ? { data: { deploymentCancel: true } } : listing) }
    }))
    return calls
  }

  it('dry-run by default: lists, logs "would cancel", sends no cancel', async () => {
    const calls = fakeFetch()
    const lines: string[] = []
    await reapOnce({ env, log: (l: string) => lines.push(l) })
    expect(calls.some((c) => c.body.query.includes('deploymentCancel'))).toBe(false)
    expect(lines.join('\n')).toMatch(/would cancel old \(aaaaaaaaa\), superseded by new/)
  })

  it('BUILD_REAPER_LIVE=1 cancels exactly the superseded build, authenticating by header', async () => {
    const calls = fakeFetch()
    await reapOnce({ env: { ...env, BUILD_REAPER_LIVE: '1' }, log: () => {} })
    const cancels = calls.filter((c) => c.body.query.includes('deploymentCancel'))
    expect(cancels.map((c) => c.body.variables.id)).toEqual(['old'])
    expect(calls[0].headers['Project-Access-Token']).toBe('tok-SECRET-123')
    expect(calls[0].body.variables).toMatchObject({ input: { projectId: 'p', environmentId: 'e', serviceId: 'svc1' } })
  })

  it('never puts the token in a log line, even when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const lines: string[] = []
    await reapOnce({ env: { ...env, BUILD_REAPER_LIVE: '1' }, log: (l: string) => lines.push(l) })
    expect(lines.join('\n')).toMatch(/HTTP 401/)
    expect(lines.join('\n')).not.toContain('SECRET')
  })

  it('without a token it does nothing and never throws', async () => {
    const calls = fakeFetch()
    await expect(reapOnce({ env: { ...env, RAILWAY_TOKEN: '' }, log: () => {} })).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})
