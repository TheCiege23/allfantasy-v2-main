/**
 * `/api/cron/import-injuries` — availability vs emptiness.
 *
 * WHY THIS EXISTS. ESPN's `site.api.espn.com` is blocked at the Akamai edge (403 on every path,
 * from two unrelated networks, unchanged by a full browser header set). It was NCAAF's ONLY injury
 * source, so this cron returned HTTP 500 every hour for a condition no retry can fix — and an
 * hourly red is a red nobody reads.
 *
 * The fix carves out exactly one case: a sport with NO AVAILABLE PROVIDER has not failed, it has
 * no job it can do. The danger is that such a carve-out quietly swallows real failures, because
 * this handler already carries a comment about a previous version that returned `ok:true`
 * unconditionally and hid a 17-day outage.
 *
 * So these tests pin the NARROWNESS, not the feature:
 *   - NFL with Rolling Insights broken must STILL be a 500.
 *   - NCAAF must STILL be a 500 the moment ESPN is reachable and writes nothing.
 *   - A thrown error must never count as "unavailable".
 * The permissive case is one line; the three guards around it are the point.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { riMock, espnMock } = vi.hoisted(() => ({ riMock: vi.fn(), espnMock: vi.fn() }))

vi.mock('@/lib/injuries/rollingInsightsInjuries', () => ({ syncRollingInsightsInjuriesToDb: riMock }))
vi.mock('@/lib/injuries/espnInjuries', () => ({ syncEspnInjuriesToDb: espnMock }))

import { GET } from '@/app/api/cron/import-injuries/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

function req(path: string): never {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as never
}

/** Rolling Insights result shape. NFL only — it answers 304-empty for NCAAF. */
function ri(written: number) {
  return { fetched: written, written, unparseableStatus: 0, legacyExpired: 0, errors: [] as string[] }
}

/** ESPN result shape. `unavailable` is the whole point: skipped, not attempted-and-failed. */
function espn(written: number, unavailable: boolean, errors: string[] = []) {
  return { sport: 'x', fetched: written, written, skippedNoPlayer: 0, unavailable, errors }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  process.env.NODE_ENV = 'test'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('a sport with no available provider is a gap, not a failure', () => {
  it('NCAAF returns HTTP 200 with ok:false and providerUnavailable when ESPN is blocked', async () => {
    riMock.mockResolvedValue(ri(0))
    espnMock.mockResolvedValue(espn(0, true, ['espn site.api unavailable: blocked at the Akamai edge']))

    const res = await GET(req('/api/cron/import-injuries?sport=NCAAF'))
    const body = await res.json()

    // 200 because retrying cannot help; ok:false because no data landed. Both are true at once,
    // and providerUnavailable is what stops that pair reading as the old masking bug.
    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.providerUnavailable).toBe(true)
    expect(body.synced).toBe(0)
  })

  it('NFL succeeds on Rolling Insights alone while ESPN is blocked', async () => {
    riMock.mockResolvedValue(ri(395))
    espnMock.mockResolvedValue(espn(0, true))

    const res = await GET(req('/api/cron/import-injuries?sport=NFL'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.synced).toBe(395)
    // NFL still HAS a provider, so it is never flagged as a coverage gap.
    expect(body.providerUnavailable).toBeUndefined()
    expect(body.espn.unavailable).toBe(true)
  })
})

describe('the carve-out does not swallow real failures', () => {
  it('NFL writing nothing is STILL a 500 — the regression that matters most', async () => {
    // Rolling Insights broken. NFL has an available provider that produced nothing: a failure,
    // exactly as before the carve-out existed. If this ever returns 200, the handler has gone
    // back to hiding outages.
    riMock.mockResolvedValue(ri(0))
    espnMock.mockResolvedValue(espn(0, true))

    const res = await GET(req('/api/cron/import-injuries?sport=NFL'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.providerUnavailable).toBeUndefined()
  })

  it('NCAAF is a 500 again the moment ESPN is reachable and writes nothing', async () => {
    riMock.mockResolvedValue(ri(0))
    espnMock.mockResolvedValue(espn(0, false, ['espn responded 500']))

    const res = await GET(req('/api/cron/import-injuries?sport=NCAAF'))
    expect(res.status).toBe(500)
  })

  it('NCAAF succeeds when ESPN is reachable and writes rows', async () => {
    riMock.mockResolvedValue(ri(0))
    espnMock.mockResolvedValue(espn(3, false))

    const res = await GET(req('/api/cron/import-injuries?sport=NCAAF'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.synced).toBe(3)
  })

  it('a THROWN provider error is never treated as unavailable', async () => {
    // The route's own .catch() supplies unavailable:false. If it ever supplied true, a crashing
    // provider would silently become an accepted coverage gap.
    riMock.mockResolvedValue(ri(0))
    espnMock.mockRejectedValue(new Error('socket hang up'))

    const res = await GET(req('/api/cron/import-injuries?sport=NCAAF'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.providerUnavailable).toBeUndefined()
  })
})
