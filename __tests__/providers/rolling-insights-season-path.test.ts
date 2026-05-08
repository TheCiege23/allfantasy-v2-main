import { describe, expect, it } from 'vitest'

import { buildRestPathCandidates } from '@/lib/workers/providers/rolling-insights'

describe('Rolling Insights REST path — season passthrough', () => {
  it('uses the supplied season in NFL projection paths (2023)', () => {
    const paths = buildRestPathCandidates('projections', 'nfl', '2023')
    expect(paths).toContain('player-stats/2023/NFL')
    expect(paths.some((p) => p.includes('/2023/'))).toBe(true)
    const currentYear = String(new Date().getUTCFullYear())
    if (currentYear !== '2023') {
      expect(paths.some((p) => p.includes(`/${currentYear}/`))).toBe(false)
    }
  })

  it('uses the supplied season in NFL projection paths (2025)', () => {
    const paths = buildRestPathCandidates('projections', 'nfl', '2025')
    expect(paths).toContain('player-stats/2025/NFL')
  })

  it('strips a "YYYY-YYYY" range to the leading year', () => {
    const paths = buildRestPathCandidates('projections', 'nfl', '2024-2025')
    expect(paths).toContain('player-stats/2024/NFL')
    expect(paths.some((p) => p.includes('/2024-2025/'))).toBe(false)
  })

  it('falls back to current UTC year when no season is provided', () => {
    const currentYear = String(new Date().getUTCFullYear())
    const paths = buildRestPathCandidates('projections', 'nfl')
    expect(paths).toContain(`player-stats/${currentYear}/NFL`)
  })

  it('honors season for soccer schedule paths', () => {
    const paths = buildRestPathCandidates('schedule', 'soccer_euro', '2023')
    expect(paths.some((p) => p.startsWith('schedule-season/2023/SOCCER'))).toBe(true)
  })

  it('honors season for ADP year-prefixed candidates', () => {
    const paths = buildRestPathCandidates('adp', 'nfl', '2023')
    expect(paths).toContain('adp/2023/NFL')
  })
})
