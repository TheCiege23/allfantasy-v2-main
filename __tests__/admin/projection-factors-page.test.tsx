// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/adminAuth', () => ({ getAdminAccessState: async () => ({ status: 'ok' }) }))
const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import Page from '@/app/admin/projection-factors/page'

describe('/admin/projection-factors', () => {
  it('per sport: when it learned, whether the published factors beat the plain average, and every factor with its status', async () => {
    findMany.mockResolvedValue([{ cacheKey: 'af-projections:factors:NBA', data: {
      sport: 'NBA', generatedAt: '2026-11-22T10:00:00Z', observations: 41000, opponentRatios: {},
      overall: { games: 10000, plainMae: 8.1, factorMae: 7.9, improvementPct: 2.5 },
      levels: [
        { factor: 'rest', level: 'back_to_back', multiplier: 0.93, games: 5200, published: true, holdout: {}, note: 'measured on 5200 games; closer on 1300 later ones' },
        { factor: 'opponent', level: 'soft', multiplier: 1.04, games: 90, published: false, holdout: {}, note: 'not enough games yet (90 of 150, 20 of 40 later)' },
      ],
    } }])
    render(await Page())
    expect(screen.getByTestId('factors-summary-NBA').textContent).toMatch(/41,000 games.*2\.5% closer to what was scored/)
    expect(screen.getByText('second game of a back-to-back -7% (measured on 5,200 games)')).toBeTruthy()
    expect(screen.getAllByText('Not used')).toHaveLength(1)
    // Sports not learned yet say so.
    expect(screen.getAllByText(/Not learned yet/).length).toBe(6)
  })
})
