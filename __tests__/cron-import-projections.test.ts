import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * AF_LIVE_DATA_CRON_BUILD §2 + §7 — the scheduled projections ingest handler:
 *   - auth-gated (401 without cron auth, never runs ingest),
 *   - in-season it calls the real generator and reports persisted counts,
 *   - offseason it no-ops cleanly WITHOUT writing (so the health chip's Projections feed keeps
 *     its honest stale fetchedAt rather than a falsely-refreshed one),
 *   - ?force=true overrides the season gate for manual invoke / §7 verification.
 */

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: vi.fn() }))
vi.mock('@/lib/nfl-data-foundation/nflDataFoundationService', () => ({
  generateAndPersistCanonicalNflProjections: vi.fn(),
}))

import { GET, POST, isNflProjectionWindow } from '@/app/api/cron/import-projections/route'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { generateAndPersistCanonicalNflProjections } from '@/lib/nfl-data-foundation/nflDataFoundationService'

function req(url = 'http://localhost/api/cron/import-projections'): NextRequest {
  return new Request(url) as unknown as NextRequest
}

describe('isNflProjectionWindow', () => {
  it('in-season Sep–Jan → true; playoffs through the Super Bowl → true; mid-Feb–Aug → false', () => {
    expect(isNflProjectionWindow(new Date('2026-09-15T12:00:00Z'))).toBe(true)
    expect(isNflProjectionWindow(new Date('2026-12-01T12:00:00Z'))).toBe(true)
    expect(isNflProjectionWindow(new Date('2027-01-10T12:00:00Z'))).toBe(true)
    expect(isNflProjectionWindow(new Date('2027-02-08T12:00:00Z'))).toBe(true) // Super Bowl
    expect(isNflProjectionWindow(new Date('2027-02-20T12:00:00Z'))).toBe(false)
    expect(isNflProjectionWindow(new Date('2026-07-15T12:00:00Z'))).toBe(false) // now (offseason)
    expect(isNflProjectionWindow(new Date('2026-08-31T12:00:00Z'))).toBe(false)
  })
})

describe('GET/POST /api/cron/import-projections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('401 when cron auth fails, and never runs the ingest', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(generateAndPersistCanonicalNflProjections).not.toHaveBeenCalled()
  })

  it('in-season: authed invoke ingests and reports persisted counts', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    vi.mocked(generateAndPersistCanonicalNflProjections).mockResolvedValue({
      generated: 480,
      persisted: 470,
      rosPersisted: 470,
      skipped: 10,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const res = await POST(req())
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.offseason).toBe(false)
    expect(data.persisted).toBe(470)
    expect(generateAndPersistCanonicalNflProjections).toHaveBeenCalledTimes(1)
  })

  it('offseason: no-ops cleanly WITHOUT writing (protects the honest fetchedAt)', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    const res = await GET(req())
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.offseason).toBe(true)
    expect(data.generated).toBe(0)
    expect(generateAndPersistCanonicalNflProjections).not.toHaveBeenCalled()
  })

  it('offseason + ?force=true: overrides the gate and ingests (manual / §7 verification)', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    vi.mocked(generateAndPersistCanonicalNflProjections).mockResolvedValue({
      generated: 12,
      persisted: 12,
      rosPersisted: 12,
      skipped: 0,
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    const res = await GET(req('http://localhost/api/cron/import-projections?force=true'))
    const data = await res.json()
    expect(data.offseason).toBe(false)
    expect(data.persisted).toBe(12)
    expect(generateAndPersistCanonicalNflProjections).toHaveBeenCalledTimes(1)
  })

  it('returns 500 (not a silent success) when the generator throws', async () => {
    vi.mocked(requireCronAuth).mockReturnValue(true)
    vi.mocked(generateAndPersistCanonicalNflProjections).mockRejectedValue(new Error('provider down'))
    const res = await GET(req('http://localhost/api/cron/import-projections?force=true'))
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.ok).toBe(false)
  })
})
