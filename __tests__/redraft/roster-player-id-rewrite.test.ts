/**
 * Roster blobs follow their repaired scoring rows. Shapes are the real production rows from native
 * NFL league 4a1853d7 (2026-10-19), where the scoring row had been repaired and the blob had not.
 */
import { describe, expect, it } from 'vitest'

import { proposeRosterIdPropagation, rewriteRosterPlayerIds, rosterPlayerIds } from '@/lib/league-runtime/rosterPlayerIdRewrite'

const blob = (id: string, name: string, team: string, position = 'WR') => ({
  devy: [], taxi: [], reserve: [],
  players: [id],
  starters: [id],
  draftPicks: [{ team, byeWeek: null, playerId: id, position, playerName: name }],
})

describe('proposeRosterIdPropagation', () => {
  it.each([
    ['8563', 'Marvin Harrison Jr.', 'ARI', '11628'],
    ['6572', 'James Cook III', 'BUF', '8138'],
    ['name:Brian Thomas Jr.:WR:JAX', 'Brian Thomas Jr.', 'JAX', '11631'],
  ])('maps the stale blob id %s to the scoring row id', (stale, name, team, live) => {
    const mapping = proposeRosterIdPropagation(blob(stale, name, team), [{ playerId: live, playerName: name }])
    expect([...mapping]).toEqual([[stale, live]])
  })

  it('leaves an agreeing roster alone', () => {
    const mapping = proposeRosterIdPropagation(blob('7564', "Ja'Marr Chase", 'CIN'), [{ playerId: '7564', playerName: "Ja'Marr Chase" }])
    expect(mapping.size).toBe(0)
  })

  it('refuses when two scoring rows share the name', () => {
    const mapping = proposeRosterIdPropagation(blob('1', 'Josh Allen', 'BUF', 'QB'), [
      { playerId: '4984', playerName: 'Josh Allen' },
      { playerId: '9999', playerName: 'Josh Allen' },
    ])
    expect(mapping.size).toBe(0)
  })

  it('refuses when the names differ', () => {
    const mapping = proposeRosterIdPropagation(blob('8563', 'Marvin Harrison Jr.', 'ARI'), [{ playerId: '11628', playerName: 'Someone Else' }])
    expect(mapping.size).toBe(0)
  })
})

describe('rewriteRosterPlayerIds', () => {
  it('rewrites every list, lineup section and draft pick, and nothing else', () => {
    const data = {
      ...blob('8563', 'Marvin Harrison Jr.', 'ARI'),
      lineup_sections: { starters: [{ id: '8563', slot: 'WR' }], bench: ['42'] },
      faab: 100,
    }
    const out = rewriteRosterPlayerIds(data, new Map([['8563', '11628']])) as typeof data
    expect(out.players).toEqual(['11628'])
    expect(out.starters).toEqual(['11628'])
    expect(out.draftPicks[0]!.playerId).toBe('11628')
    expect(out.lineup_sections.starters[0]).toEqual({ id: '11628', slot: 'WR' })
    expect(out.lineup_sections.bench).toEqual(['42'])
    expect(out.faab).toBe(100)
    expect(rosterPlayerIds(out).has('8563')).toBe(false)
    // The input is not mutated.
    expect(data.players).toEqual(['8563'])
  })
})
