import { describe, expect, it } from 'vitest'

import { buildIdpValuations, parseIdpSlots } from '@/lib/idp-projections/idpValuation'

/** A pool of defenders whose projections descend by a known step, so ranks are checkable. */
function pool(group: string, count: number, top = 20, step = 0.5) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `${group}${i + 1}`,
    position: group,
    projectedPoints: top - i * step,
  }))
}

const DEFENDERS = [...pool('LB', 60), ...pool('DL', 60, 16), ...pool('DB', 60, 14)]

describe('parseIdpSlots', () => {
  it('collapses specific slots onto the group that actually fills them', () => {
    const s = parseIdpSlots(['QB', 'RB', 'WR', 'DE', 'DT', 'LB', 'LB', 'CB', 'S', 'IDP_FLEX', 'BN'])
    expect(s.dedicated).toEqual({ LB: 2, DL: 2, DB: 2 })
    expect(s.flex).toBe(1)
  })

  it('finds nothing in an offence-only league', () => {
    const s = parseIdpSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'])
    expect(s.dedicated).toEqual({ LB: 0, DL: 0, DB: 0 })
    expect(s.flex).toBe(0)
  })

  it('survives absent or malformed roster_positions rather than throwing', () => {
    expect(parseIdpSlots(null).flex).toBe(0)
    expect(parseIdpSlots(undefined).dedicated.LB).toBe(0)
    expect(parseIdpSlots(['', 'not_a_slot']).dedicated.DB).toBe(0)
  })
})

describe('buildIdpValuations — refusals', () => {
  it('refuses a league that starts no defenders', () => {
    const out = buildIdpValuations({
      players: DEFENDERS,
      rosterSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'],
      numTeams: 12,
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('not_an_idp_league')
  })

  it('refuses without a team count, because replacement level needs one', () => {
    const out = buildIdpValuations({ players: DEFENDERS, rosterSlots: ['LB'], numTeams: 0 })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('no_team_count')
  })

  it('ignores unprojected defenders rather than ranking them last', () => {
    /*
     * Ranking an unprojected player at the bottom prices him as the worst defender in the
     * league on the strength of a data gap. He is absent from the pool instead.
     */
    const out = buildIdpValuations({
      players: [...pool('LB', 40), { playerId: 'ghost', position: 'LB', projectedPoints: null }],
      rosterSlots: ['LB', 'LB', 'LB'],
      numTeams: 12,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.players.some((p) => p.playerId === 'ghost')).toBe(false)
    expect(out.replacement.LB.pool).toBe(40)
  })
})

describe('buildIdpValuations — replacement level is a property of the league', () => {
  it('prices the same linebacker differently in a 3-LB and a 6-LB league', () => {
    /*
     * THE CASE THE WHOLE MODULE EXISTS FOR. LB18 in a league starting three linebackers has
     * dozens of equivalents on waivers. In one starting six he is a locked starter with
     * nothing behind him, and his value over replacement rises accordingly.
     */
    const shallow = buildIdpValuations({
      players: DEFENDERS,
      rosterSlots: ['LB', 'LB', 'LB'],
      numTeams: 12,
    })
    const deep = buildIdpValuations({
      players: DEFENDERS,
      rosterSlots: ['LB', 'LB', 'LB', 'LB', 'LB', 'LB'],
      numTeams: 12,
    })
    expect(shallow.ok && deep.ok).toBe(true)
    if (!shallow.ok || !deep.ok) return

    // 3 LB x 12 teams = 36 starters; 6 x 12 = 72, but only 60 LBs are projected.
    expect(shallow.replacement.LB.startersLeagueWide).toBe(36)
    expect(deep.replacement.LB.startersLeagueWide).toBe(60)

    // Deeper requirement -> lower replacement bar -> the same player is worth more over it.
    expect(deep.replacement.LB.replacementPoints).toBeNull()
    expect(shallow.replacement.LB.replacementPoints).toBe(20 - 36 * 0.5)

    const lb18Shallow = shallow.players.find((p) => p.playerId === 'LB18')!
    expect(lb18Shallow.isStarter).toBe(true)
    expect(lb18Shallow.vorp).toBeCloseTo((20 - 17 * 0.5) - (20 - 36 * 0.5), 5)
  })

  it('says so when the pool runs out instead of inventing a replacement level', () => {
    const out = buildIdpValuations({
      players: pool('LB', 20),
      rosterSlots: ['LB', 'LB', 'LB'],
      numTeams: 12,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // 36 slots, 20 projected linebackers — every one starts and nobody is left over.
    expect(out.replacement.LB.replacementPoints).toBeNull()
    expect(out.players.every((p) => p.vorp === null)).toBe(true)
    expect(out.notes.some((n) => n.includes('no replacement'))).toBe(true)
  })

  it('never reports a replaceable player as worth exactly zero when the level is unknown', () => {
    const out = buildIdpValuations({ players: pool('DB', 5), rosterSlots: ['DB'], numTeams: 12 })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // Null and 0 are different claims; only null is true here.
    expect(out.players.map((p) => p.vorp)).not.toContain(0)
    expect(out.players.every((p) => p.vorp === null)).toBe(true)
  })
})

describe('buildIdpValuations — flex slots are earned, not assumed', () => {
  it('hands flex slots to whichever group is actually projected highest', () => {
    /*
     * `lib/vorp-engine.ts` splits flex with hardcoded shares (RB 40 / WR 40 / TE 20). Here the
     * split is an OUTPUT: LBs are the top-projected group in this pool, so they absorb the
     * flex slots, and nobody had to assert a percentage.
     */
    const out = buildIdpValuations({
      players: DEFENDERS,
      rosterSlots: ['LB', 'DL', 'DB', 'IDP_FLEX', 'IDP_FLEX'],
      numTeams: 10,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.slots).toEqual({ dedicated: { LB: 1, DL: 1, DB: 1 }, flex: 2 })
    // 10 dedicated each, plus 20 flex slots. LB tops the board (20.0 vs 16.0 vs 14.0).
    expect(out.replacement.LB.startersLeagueWide).toBeGreaterThan(10)
    expect(out.replacement.LB.startersLeagueWide + out.replacement.DL.startersLeagueWide +
      out.replacement.DB.startersLeagueWide).toBe(50)
  })

  it('stops filling flex when the pool is exhausted rather than looping', () => {
    const out = buildIdpValuations({
      players: pool('LB', 4),
      rosterSlots: ['IDP_FLEX', 'IDP_FLEX'],
      numTeams: 12,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.replacement.LB.startersLeagueWide).toBe(4)
  })
})

describe('buildIdpValuations — the construction is labelled', () => {
  it('states that there is no market anchor behind the number', () => {
    const out = buildIdpValuations({
      players: DEFENDERS,
      rosterSlots: ['LB', 'LB', 'DL', 'DB'],
      numTeams: 12,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.notes.some((n) => n.includes('FantasyCalc does not price'))).toBe(true)
    expect(out.notes.some((n) => n.includes('starts 2 LB, 1 DL, 1 DB'))).toBe(true)
  })
})
