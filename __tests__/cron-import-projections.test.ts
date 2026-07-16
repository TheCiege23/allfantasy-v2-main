import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * AF_LIVE_DATA_CRON_BUILD §2 + §7 — the scheduled projections ingest handler:
 *   - auth-gated (401 without cron auth, never touches a provider),
 *   - in-season (or ?force=true) it calls fetchWithChain per sport and persists
 *     provider-backed rows into FantasyProjection,
 *   - offseason it no-ops cleanly WITHOUT calling any provider (so the health
 *     chip's Projections feed keeps its honest stale fetchedAt rather than a
 *     falsely-refreshed one),
 *   - a provider row with no usable projection field is skipped, not a hard error.
 */

const mocks = vi.hoisted(() => ({
  fetchWithChain: vi.fn(),
  fantasyProjectionUpsert: vi.fn(),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: vi.fn() }))
vi.mock('@/lib/workers/api-chain', () => ({ fetchWithChain: mocks.fetchWithChain }))
vi.mock('@/lib/prisma', () => ({
  prisma: { fantasyProjection: { upsert: mocks.fantasyProjectionUpsert } },
}))

import { GET, POST, isInSeason } from '@/app/api/cron/import-projections/route'
import { requireCronAuth } from '@/app/api/cron/_auth'

function req(url = 'http://localhost/api/cron/import-projections'): NextRequest {
  return new Request(url) as unknown as NextRequest
}

describe('isInSeason', () => {
  it('NFL: Aug season kickoff through Feb championship → true; March–July → false', () => {
    expect(isInSeason('NFL', new Date('2026-09-15T12:00:00Z'))).toBe(true)
    expect(isInSeason('NFL', new Date('2026-12-01T12:00:00Z'))).toBe(true)
    expect(isInSeason('NFL', new Date('2027-02-08T12:00:00Z'))).toBe(true)
    expect(isInSeason('NFL', new Date('2026-07-15T12:00:00Z'))).toBe(false) // now (offseason)
    expect(isInSeason('NFL', new Date('2026-03-20T12:00:00Z'))).toBe(false)
  })

  it('NCAAF: Aug–Jan → true; Feb–July → false', () => {
    expect(isInSeason('NCAAF', new Date('2026-10-01T12:00:00Z'))).toBe(true)
    expect(isInSeason('NCAAF', new Date('2027-01-05T12:00:00Z'))).toBe(true)
    expect(isInSeason('NCAAF', new Date('2027-02-08T12:00:00Z'))).toBe(false)
    expect(isInSeason('NCAAF', new Date('2026-07-15T12:00:00Z'))).toBe(false)
  })
})

describe('GET/POST /api/cron/import-projections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mocks.fantasyProjectionUpsert.mockResolvedValue({})
  })
  afterEach(() => vi.useRealTimers())

  it('401 when cron auth fails, and never touches a provider', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mocks.fetchWithChain).not.toHaveBeenCalled()
  })

  it('offseason: no-ops cleanly WITHOUT calling any provider (protects the honest fetchedAt)', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z')) // solidly offseason for NFL and NCAAF
    const res = await GET(req())
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.results.NFL).toMatchObject({ ok: true, skipped: true })
    expect(data.results.NCAAF).toMatchObject({ ok: true, skipped: true })
    expect(mocks.fetchWithChain).not.toHaveBeenCalled()
    expect(mocks.fantasyProjectionUpsert).not.toHaveBeenCalled()
  })

  it('writes FantasyProjection rows via fetchWithChain when forced', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    mocks.fetchWithChain.mockResolvedValue({
      data: [
        { playerId: 'cs_1', name: 'Test Player', projectedPoints: 18.4, week: 5 },
        { playerId: 'cs_2', name: 'No Points Player' }, // no usable projection field — must be skipped
      ],
      fromCache: false,
      source: 'clearsports',
    })

    const res = await POST(
      req('http://localhost/api/cron/import-projections?sport=NFL&season=2026&force=true'),
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.results.NFL).toMatchObject({ ok: true, synced: 1, source: 'clearsports' })
    expect(mocks.fetchWithChain).toHaveBeenCalledWith(
      expect.objectContaining({ sport: 'nfl', dataType: 'projections', forceRefresh: true }),
    )
    expect(mocks.fantasyProjectionUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.fantasyProjectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uniq_fantasy_projection_player_week_scoring_source: expect.objectContaining({
            playerId: 'cs_1',
            sport: 'NFL',
            season: '2026',
            week: 5,
            scoringPresetId: 'ppr',
            source: 'clearsports',
          }),
        },
        create: expect.objectContaining({ projectedPoints: 18.4 }),
      }),
    )
  })

  it('reports a clean non-error result (not a 500) when the provider chain returns no rows', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    mocks.fetchWithChain.mockResolvedValue({ data: null, fromCache: false, error: 'All providers failed' })

    const res = await GET(req('http://localhost/api/cron/import-projections?sport=NFL&force=true'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.results.NFL).toMatchObject({ ok: false, synced: 0, error: 'All providers failed' })
    expect(mocks.fantasyProjectionUpsert).not.toHaveBeenCalled()
  })

  it('returns 500 (not a silent success) on an unexpected failure', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    mocks.fetchWithChain.mockRejectedValue(new Error('provider down'))

    const res = await GET(req('http://localhost/api/cron/import-projections?sport=NFL&force=true'))
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.ok).toBe(false)
  })
})
