import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: async () => null }))

import { loadLiveIntelligence, projectionAccuracyRow } from '@/lib/partner-portal/liveIntelligence'
import { LiveIntelligencePanels } from '@/components/partners/LiveIntelligencePanels'

const table = {
  sport: 'NBA',
  generatedAt: '2026-11-22T10:00:00.000Z',
  observations: 4000,
  overall: { games: 1000, plainMae: 8.2, factorMae: 7.6, improvementPct: 7.3 },
  levels: [
    { factor: 'rest', level: 'back_to_back', multiplier: 0.94, games: 900, holdout: { games: 200, plainMae: 8, factorMae: 7.5 }, published: true, note: '' },
    { factor: 'form', level: 'hot', multiplier: 1.02, games: 300, holdout: { games: 60, plainMae: 8, factorMae: 8.1 }, published: false, note: '' },
  ],
  opponentRatios: {},
}

describe('partner live intelligence', () => {
  it('turns a learned table into a row with only the published factors, partner-safe wording', () => {
    const row = projectionAccuracyRow(table as never)!
    expect(row).toMatchObject({ sport: 'NBA', games: 1000, plainMae: 8.2, afMae: 7.6, closerPct: 7.3 })
    expect(row.factors).toEqual(['second game of a back-to-back -6% (measured on 900 games)'])
  })

  it('has no row without a hold-out check (never an invented number)', () => {
    expect(projectionAccuracyRow({ ...table, overall: { games: 0, plainMae: null, factorMae: null, improvementPct: null } } as never)).toBeNull()
    expect(projectionAccuracyRow(null)).toBeNull()
  })

  it('reads ADP movers going both ways, one row per player, and survives every read failing', async () => {
    const mover = (name: string, trend: number) => ({ sport: 'NFL', playerName: name, averageOverallPick: 40.24, sevenDayTrend: trend, sampleSize: 12, leagueType: 'redraft', rosterFormat: 'standard', scoringFormat: 'ppr', teamCount: 12 })
    const db = {
      sportsDataCache: { findMany: async () => [{ data: table }] },
      allFantasyAdpSnapshot: {
        findMany: async (q: { orderBy: { sevenDayTrend: 'asc' | 'desc' } }) =>
          q.orderBy.sevenDayTrend === 'desc' ? [mover('A', 6.2), mover('A', 5), mover('B', 3)] : [mover('C', -4.4)],
      },
    }
    const live = await loadLiveIntelligence(db as never)
    expect(live.adpRisers.map((r) => [r.playerName, r.movedPicks])).toEqual([['A', 6.2], ['B', 3]])
    expect(live.adpFallers[0]).toMatchObject({ playerName: 'C', movedPicks: -4.4, adp: 40.2, context: 'redraft, ppr, 12 teams' })
    expect(live.projections).toHaveLength(1)

    const broken = { sportsDataCache: { findMany: async () => { throw new Error('db') } }, allFantasyAdpSnapshot: { findMany: async () => { throw new Error('db') } } }
    const empty = await loadLiveIntelligence(broken as never)
    expect(empty).toMatchObject({ record: [], projections: [], adpRisers: [], adpFallers: [] })
    const html = renderToStaticMarkup(<LiveIntelligencePanels data={empty} />)
    expect(html).toContain('The first check runs once a sport has enough stored games.')
    expect(html).not.toMatch(/\bAI\b/)
  })

  it('draws the comparison with words beside the bars, and says "AI" nowhere', () => {
    const html = renderToStaticMarkup(
      <LiveIntelligencePanels data={{ record: [], recordSeason: 2026, projections: [projectionAccuracyRow(table as never)!], adpRisers: [], adpFallers: [] }} />,
    )
    expect(html).toContain('7.3% closer')
    expect(html).toContain('8.20 pts off')
    expect(html).toContain('7.60 pts off')
    expect(html).not.toMatch(/\bAI\b/)
  })
})
