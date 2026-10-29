import { describe, expect, it } from 'vitest'

import { depthChartPlayerNames, selectCurrentDepthRows } from '@/lib/depthChartRows'

const NOW = new Date('2026-10-18T02:00:00Z')

function row(over: Partial<{ team: string; position: string; source: string; players: unknown; fetchedAt: string; expiresAt: string }>) {
  return {
    team: over.team ?? 'GSW',
    position: over.position ?? 'C',
    source: over.source ?? 'rolling_insights_rest',
    players: over.players ?? [],
    fetchedAt: new Date(over.fetchedAt ?? '2026-10-18T01:31:58Z'),
    expiresAt: new Date(over.expiresAt ?? '2026-10-18T13:31:58Z'),
  }
}

// The shapes below are the ones in production depth_charts on 2026-10-18: the May
// `rolling_insights` rows hold name strings, the REST rows hold objects with `rank`.
const MAY_STRINGS = row({
  source: 'rolling_insights',
  players: ['Kevon Looney', 'Trayce Jackson-Davis'],
  fetchedAt: '2026-05-01T00:46:18Z',
  expiresAt: '2026-05-01T12:46:18Z',
})
const OCT_REST = row({
  players: [
    { id: '143', rank: 1, number: null, player: 'Draymond Green', status: null, position: 'C' },
    { id: '1501', rank: 2, number: null, player: 'Quinten Post', status: null, position: 'C' },
  ],
})

describe('selectCurrentDepthRows', () => {
  it('keeps one row per team/position, and the October chart beats the May one either way round', () => {
    for (const rows of [[MAY_STRINGS, OCT_REST], [OCT_REST, MAY_STRINGS]]) {
      const picked = selectCurrentDepthRows(rows, NOW)
      expect(picked).toHaveLength(1)
      expect(picked[0]!.source).toBe('rolling_insights_rest')
    }
  })

  it('prefers an unexpired row over a newer-fetched expired one', () => {
    const live = row({ source: 'a', fetchedAt: '2026-10-17T20:00:00Z', expiresAt: '2026-10-18T08:00:00Z' })
    const expired = row({ source: 'b', fetchedAt: '2026-10-18T01:00:00Z', expiresAt: '2026-10-18T01:30:00Z' })
    expect(selectCurrentDepthRows([expired, live], NOW)[0]!.source).toBe('a')
  })

  it('falls back to the most recent fetch when every row has expired (the weekly cron, mid-week)', () => {
    const older = row({ source: 'old', fetchedAt: '2026-10-14T04:00:00Z', expiresAt: '2026-10-14T16:00:00Z' })
    const newer = row({ source: 'new', fetchedAt: '2026-10-15T04:00:00Z', expiresAt: '2026-10-15T16:00:00Z' })
    expect(selectCurrentDepthRows([newer, older], NOW)[0]!.source).toBe('new')
  })

  it('leaves distinct team/position pairs alone and sorts them', () => {
    const picked = selectCurrentDepthRows(
      [row({ team: 'LAL', position: 'PG' }), row({ team: 'GSW', position: 'SG' }), row({ team: 'GSW', position: 'C' })],
      NOW,
    )
    expect(picked.map((r) => `${r.team}/${r.position}`)).toEqual(['GSW/C', 'GSW/SG', 'LAL/PG'])
  })
})

describe('depthChartPlayerNames', () => {
  it('reads names out of object entries -- the old cast handed callers the objects', () => {
    expect(depthChartPlayerNames(OCT_REST.players)).toEqual(['Draymond Green', 'Quinten Post'])
  })

  it('orders object entries by rank when every entry has one', () => {
    expect(
      depthChartPlayerNames([
        { player: 'Backup', rank: 2 },
        { player: 'Starter', rank: 1 },
      ]),
    ).toEqual(['Starter', 'Backup'])
  })

  it('keeps stored order for the NFL GraphQL shape, which carries no rank', () => {
    expect(
      depthChartPlayerNames([
        { id: '6779', img: null, number: 23, player: 'Skyy Moore', status: null, position: 'WR' },
        { id: '1', player: 'Second', position: 'WR' },
      ]),
    ).toEqual(['Skyy Moore', 'Second'])
  })

  it('passes plain name strings through and drops anything without a name', () => {
    expect(depthChartPlayerNames(['  Kevon Looney ', '', null, 7, { id: '9' }, 'Trayce Jackson-Davis'])).toEqual([
      'Kevon Looney',
      'Trayce Jackson-Davis',
    ])
    expect(depthChartPlayerNames(null)).toEqual([])
  })
})
