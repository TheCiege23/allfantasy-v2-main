import { describe, expect, it } from 'vitest'

import { planLineupMoves, type PlanPlayer, type PlanSlot } from '@/lib/chimmy/actions/lineupPlan'

/**
 * The pure planner behind "set my lineup". Every refusal here is a write that does NOT happen,
 * and every success is exactly the bytes the engine will be asked to save.
 */

const SLOTS: PlanSlot[] = [
  { index: 0, label: 'QB', allowedPositions: ['QB'] },
  { index: 1, label: 'RB1', allowedPositions: ['RB'] },
  { index: 2, label: 'RB2', allowedPositions: ['RB'] },
  { index: 3, label: 'WR1', allowedPositions: ['WR'] },
  { index: 4, label: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
]

const row = (id: string, position: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), position, ...extra })

function roster() {
  return {
    players: ['qb', 'rb1', 'rb2', 'wr1', 'rb3', 'wr2', 'rb4', 'ir1'],
    starters: ['qb', 'rb1', 'rb2', 'wr1', 'rb3'],
    custom_field: { keep: 'me' },
    lineup_sections: {
      starters: [row('qb', 'QB'), row('rb1', 'RB'), row('rb2', 'RB', { years_exp: 3 }), row('wr1', 'WR'), row('rb3', 'RB')],
      bench: [row('wr2', 'WR'), row('rb4', 'RB')],
      ir: [row('ir1', 'WR', { status: 'IR' })],
      taxi: [],
      devy: [],
    },
  }
}

const PLAYERS = new Map<string, PlanPlayer>(
  [
    ['qb', 'QB'],
    ['rb1', 'RB'],
    ['rb2', 'RB'],
    ['wr1', 'WR'],
    ['rb3', 'RB'],
    ['wr2', 'WR'],
    ['rb4', 'RB'],
    ['ir1', 'WR'],
  ].map(([id, pos]) => [id, { playerId: id, name: id.toUpperCase(), position: pos }]),
)

const plan = (moves: Array<{ playerId: string; to: 'starters' | 'bench' }>, pd: unknown = roster()) =>
  planLineupMoves({
    playerData: pd,
    rosterPlayerIds: (pd as { players: string[] }).players,
    slots: SLOTS,
    players: PLAYERS,
    moves,
    nowIso: '2026-09-25T12:00:00.000Z',
  })

describe('planLineupMoves', () => {
  it('drops the incoming player into the freed slot and keeps everyone else where they were', () => {
    const r = plan([
      { playerId: 'rb4', to: 'starters' },
      { playerId: 'rb2', to: 'bench' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.afterStarterIds).toEqual(['qb', 'rb1', 'rb4', 'wr1', 'rb3'])
    expect(r.moveIn).toEqual([{ playerId: 'rb4', slot: 'RB2' }])
    expect(r.moveOut).toEqual(['rb2'])
    const sections = r.nextPlayerData.lineup_sections as Record<string, Array<Record<string, unknown>>>
    expect(sections.bench.map((x) => x.id)).toEqual(['wr2', 'rb2'])
    /* The benched row keeps every field it had — a rebuild would have dropped years_exp. */
    expect(sections.bench[1]).toEqual(row('rb2', 'RB', { years_exp: 3 }))
    expect(r.nextPlayerData.starters).toEqual(['qb', 'rb1', 'rb4', 'wr1', 'rb3'])
  })

  it('touches nothing else in playerData', () => {
    const before = roster()
    const r = plan([{ playerId: 'rb4', to: 'starters' }, { playerId: 'rb2', to: 'bench' }], before)
    if (!r.ok) throw new Error(r.reason)
    const { lineup_sections: _a, starters: _b, lineup_updated_at: _c, ...rest } = r.nextPlayerData
    const { lineup_sections: _d, starters: _e, ...restBefore } = before
    expect(rest).toEqual(restBefore)
    const sections = r.nextPlayerData.lineup_sections as Record<string, unknown>
    expect(sections.ir).toEqual(before.lineup_sections.ir)
    /* and the input object is not mutated */
    expect(before.lineup_sections.starters.map((x) => x.id)).toEqual(['qb', 'rb1', 'rb2', 'wr1', 'rb3'])
  })

  it('re-seats the lineup when the incoming player does not fit the freed slot', () => {
    /* WR2 for RB2: the RB2 slot takes no WR, but moving RB3 out of FLEX into RB2 makes room. */
    const r = plan([
      { playerId: 'wr2', to: 'starters' },
      { playerId: 'rb2', to: 'bench' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(new Set(r.afterStarterIds)).toEqual(new Set(['qb', 'rb1', 'rb3', 'wr1', 'wr2']))
    expect(r.moveIn[0]!.slot).toBe('FLEX')
  })

  it('refuses when no legal arrangement exists', () => {
    const r = plan([
      { playerId: 'wr2', to: 'starters' },
      { playerId: 'qb', to: 'bench' },
    ])
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/no legal way|No starting slot/i) })
  })

  it('refuses to start a player on IR', () => {
    const r = plan([{ playerId: 'ir1', to: 'starters' }, { playerId: 'wr1', to: 'bench' }])
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/IR/) })
  })

  it('refuses to start more players than there are slots', () => {
    const r = plan([{ playerId: 'rb4', to: 'starters' }])
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/bench someone too/) })
  })

  it('refuses a player whose position it cannot confirm', () => {
    const players = new Map(PLAYERS)
    players.set('rb4', { playerId: 'rb4', name: 'RB4', position: null })
    const r = planLineupMoves({
      playerData: roster(),
      rosterPlayerIds: roster().players,
      slots: SLOTS,
      players,
      moves: [{ playerId: 'rb4', to: 'starters' }, { playerId: 'rb2', to: 'bench' }],
    })
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/can't confirm RB4's position/) })
  })

  it('refuses a roster whose saved lineup does not list every player', () => {
    const pd = roster()
    pd.players.push('ghost')
    const r = plan([{ playerId: 'rb4', to: 'starters' }, { playerId: 'rb2', to: 'bench' }], pd)
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/doesn't list every player/) })
  })

  it('refuses a roster with no saved lineup at all', () => {
    expect(plan([{ playerId: 'rb4', to: 'starters' }], { players: ['rb4'] })).toEqual({
      ok: false,
      reason: expect.stringMatching(/no saved lineup/),
    })
  })

  it('says so when nothing would change', () => {
    expect(plan([{ playerId: 'rb1', to: 'starters' }, { playerId: 'rb4', to: 'bench' }])).toEqual({
      ok: false,
      reason: expect.stringMatching(/already set that way/),
    })
  })

  it('refuses a player who is not on the roster', () => {
    expect(plan([{ playerId: 'stranger', to: 'starters' }])).toEqual({ ok: false, reason: expect.stringMatching(/not on your roster/) })
  })

  it('seats a multi-position player wherever any of his positions fits', () => {
    const slots: PlanSlot[] = [
      { index: 0, label: 'PG', allowedPositions: ['PG'] },
      { index: 1, label: 'SG', allowedPositions: ['SG'] },
    ]
    const players = new Map<string, PlanPlayer>([
      ['a', { playerId: 'a', name: 'A', position: 'PG' }],
      ['b', { playerId: 'b', name: 'B', position: 'SG' }],
      ['c', { playerId: 'c', name: 'C', position: 'PG/SG' }],
    ])
    const r = planLineupMoves({
      playerData: {
        players: ['a', 'b', 'c'],
        lineup_sections: { starters: [{ id: 'a' }, { id: 'b' }], bench: [{ id: 'c' }], ir: [], taxi: [], devy: [] },
      },
      rosterPlayerIds: ['a', 'b', 'c'],
      slots,
      players,
      moves: [{ playerId: 'c', to: 'starters' }, { playerId: 'b', to: 'bench' }],
    })
    expect(r.ok && r.moveIn).toEqual([{ playerId: 'c', slot: 'SG' }])
  })

  it('allows benching without a replacement and counts the empty slot', () => {
    const r = plan([{ playerId: 'rb3', to: 'bench' }])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.emptySlots).toBe(1)
  })
})
