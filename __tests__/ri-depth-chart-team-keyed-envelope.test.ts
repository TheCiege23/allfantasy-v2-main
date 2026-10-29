import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  describeDepthChartPayload,
  extractRiDepthChartTeamBlocks,
  normalizeRiDepthCharts,
} from '@/lib/sports-data/rollingInsightsDepthCharts'

/**
 * The field map documents depth charts as `<team>.<position_key>.<rank_key>`: the team is the
 * MAP KEY. Before this test the unwrap discarded those keys, every block was skipped for having no
 * team, and production reported `teams: 0` with no error for NBA, NHL and MLB on every run.
 */
const teamKeyed = {
  data: {
    NBA: {
      'Atlanta Hawks': {
        PG: { '1': { id: '101', player: 'Trae Young' }, '2': { id: '102', player: 'Kobe Bufkin' } },
        C: { '1': { id: '103', player: 'Onyeka Okongwu' } },
      },
      'Boston Celtics': {
        SF: [{ id: '201', player: 'Jayson Tatum' }],
      },
    },
  },
}

describe('extractRiDepthChartTeamBlocks', () => {
  it('keeps the team when it is the map key (the documented shape)', () => {
    const { teams } = normalizeRiDepthCharts(extractRiDepthChartTeamBlocks(teamKeyed, 'NBA'))
    expect(teams.map((t) => t.team)).toEqual(['Atlanta Hawks', 'Boston Celtics'])
    const hawks = teams[0]!
    expect(hawks.positions.PG!.map((p) => [p.player, p.rank])).toEqual([
      ['Trae Young', 1],
      ['Kobe Bufkin', 2],
    ])
    expect(teams[1]!.positions.SF![0]!.player).toBe('Jayson Tatum')
  })

  it('positive control: the generic Object.values unwrap loses every team', () => {
    // This is what `resolveRiEnvelope` hands the parser for the same body.
    const valuesOnly = Object.values(teamKeyed.data.NBA)
    expect(normalizeRiDepthCharts(valuesOnly).teams).toHaveLength(0)
  })

  it('still accepts an array of blocks that name their own team', () => {
    const body = { data: { MLB: [{ team: 'Houston Astros', team_id: '7', '3B': [{ player: 'Isaac Paredes' }] }] } }
    const { teams } = normalizeRiDepthCharts(extractRiDepthChartTeamBlocks(body, 'MLB'))
    expect(teams).toHaveLength(1)
    expect(teams[0]!.teamId).toBe('7')
  })

  it('accepts a team map directly under data with no sport key', () => {
    const body = { data: { 'Boston Bruins': { G: [{ player: 'Jeremy Swayman' }] } } }
    const { teams } = normalizeRiDepthCharts(extractRiDepthChartTeamBlocks(body, 'NHL'))
    expect(teams.map((t) => t.team)).toEqual(['Boston Bruins'])
  })

  it('does not invent a team name from a numeric key', () => {
    const body = { data: { NHL: { '12': { G: [{ player: 'Jeremy Swayman' }] } } } }
    const blocks = extractRiDepthChartTeamBlocks(body, 'NHL') as Array<Record<string, unknown>>
    expect(blocks[0]!.team).toBeUndefined()
    expect(blocks[0]!.team_id).toBe('12')
  })
})

describe('describeDepthChartPayload', () => {
  it('reports key layout and kinds, never values', () => {
    const hint = describeDepthChartPayload(teamKeyed, 'NBA')
    expect(hint).toMatchObject({
      root: 'object',
      dataKeys: ['NBA'],
      sportKey: 'NBA: object',
      firstEntryKey: 'Atlanta Hawks',
      firstEntryKeys: ['PG', 'C'],
    })
    expect(JSON.stringify(hint)).not.toContain('Trae Young')
  })
})
