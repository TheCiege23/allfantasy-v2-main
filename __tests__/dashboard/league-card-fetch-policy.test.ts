import { describe, expect, it } from 'vitest'
import { shouldFetchLeagueScopedData } from '@/lib/dashboard/league-card-fetch-policy'

/**
 * Regression guard for the dashboard league-card fan-out that took production's Postgres down
 * (2026-07-17): 543 AF Legacy board rows × ~4 league-scoped fetches each ≈ 2,000 requests per
 * dashboard load, plus a sustained ~6 req/s from useActivityFeed's 90s poll. Surfaced as
 * `53200 out of memory` on unrelated routes and 645 `/api/league/detail` 404s.
 */
describe('shouldFetchLeagueScopedData', () => {
  it('skips fetches for AF Legacy rows, whose id is not in the leagues table', () => {
    // getLegacyLeagueBoardItems emits exactly this marker; /api/league/detail 404s by construction.
    expect(shouldFetchLeagueScopedData({ hasUnifiedRecord: false })).toBe(false)
  })

  it('fetches for rows with a real leagues record', () => {
    expect(shouldFetchLeagueScopedData({ hasUnifiedRecord: true })).toBe(true)
  })

  it('fetches when the flag is absent or null rather than blanking the card', () => {
    // Only an explicit false marks legacy-only. Defaulting the other way would silently stop
    // fetching for any caller/mapper that does not set the flag.
    expect(shouldFetchLeagueScopedData({})).toBe(true)
    expect(shouldFetchLeagueScopedData({ hasUnifiedRecord: null })).toBe(true)
    expect(shouldFetchLeagueScopedData({ hasUnifiedRecord: undefined })).toBe(true)
  })

  it('holds for the real shape the board renders: 9 unified + 543 legacy', () => {
    // Mirrors the production account that triggered the incident (theciege24): 9 rows in `leagues`,
    // 543 LegacyLeague rows with no unified record. Only the 9 may issue league-scoped fetches.
    const board = [
      ...Array.from({ length: 9 }, () => ({ hasUnifiedRecord: true })),
      ...Array.from({ length: 543 }, () => ({ hasUnifiedRecord: false })),
    ]

    const fetching = board.filter(shouldFetchLeagueScopedData)

    expect(fetching).toHaveLength(9)
    // The whole point: 543 cards must contribute zero league-scoped requests, not fewer.
    expect(board.length - fetching.length).toBe(543)
  })
})
