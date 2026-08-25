import { describe, expect, it } from 'vitest'

import {
  assessLeagueScale,
  replaceableThreshold,
  toBaselinePick,
} from '@/lib/trade-intel/leagueScale'
import { projectPickSlot } from '@/lib/trade-intel/pickOutlook'
import {
  assessConcentration,
  assessDeadline,
  assessRosterCrunch,
  assessUnpriced,
} from '@/lib/trade-intel/rosterShape'

/**
 * Every stored price in this product is a TWELVE-TEAM price — all four
 * FantasyCalc combinations are numTeams=12 and only numQbs varies. In a 32-team
 * IDP league that assumption breaks in both directions at once, and these pin
 * the corrections.
 */

/** A KBFL-shaped lineup: offence plus a full defensive side. */
const DEEP_IDP = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF',
  'DL', 'DL', 'LB', 'LB', 'LB', 'DB', 'DB', 'IDP_FLEX',
  'BN', 'BN', 'BN', 'IR',
]

describe('toBaselinePick: a 1st is a position in a queue, not a quantity of talent', () => {
  it('⚠ a late 1st in a 32-team league is a THIRD rounder in the prices we hold', () => {
    /*
     * The single largest pricing error in a big league. 1.28 of a 32-team draft
     * is the 28th player off the board. Priced off a 12-team chart as "a 1st" it
     * is worth several times what it should be, and every deal shipping picks
     * into a deep league is quietly lopsided.
     */
    const p = toBaselinePick({ round: 1, slot: 28, teamCount: 32 })
    expect(p.overall).toBe(28)
    expect(p.baselineRound).toBe(3)
    expect(p.baselineSlot).toBe(4)
    expect(p.basis).toContain('28th player off the board')
  })

  it('⚠ cuts the other way too — this is not a way of talking picks down', () => {
    // An 8-team league's 2.02 is the 10th player taken: a 12-team 1.10, worth
    // MORE than its round implies.
    const p = toBaselinePick({ round: 2, slot: 2, teamCount: 8 })
    expect(p.overall).toBe(10)
    expect(p.baselineRound).toBe(1)
    expect(p.baselineSlot).toBe(10)
  })

  it('leaves a 12-team pick exactly alone and says nothing', () => {
    const p = toBaselinePick({ round: 2, slot: 5, teamCount: 12 })
    expect(p.unchanged).toBe(true)
    expect(p.baselineRound).toBe(2)
    expect(p.baselineSlot).toBe(5)
    expect(p.basis).toBeNull()
  })
})

describe('assessLeagueScale', () => {
  it('⚠ names the positions the market feed cannot price at all', () => {
    /*
     * FantasyCalc prices offence and picks. In an IDP league most of the
     * defensive lineup is valued at null, and a grade built on the half we can
     * see still comes back looking like a grade.
     */
    const s = assessLeagueScale({ teamCount: 32, starters: DEEP_IDP })!
    expect(s.unpricedPositions).toEqual(expect.arrayContaining(['DL', 'LB', 'DB', 'K', 'DEF']))
    expect(s.unpricedSlots).toBeGreaterThan(6)
    expect(s.notes.join(' ')).toContain('does not price')
  })

  it('counts league-wide demand, which is what makes replacement collapse', () => {
    const s = assessLeagueScale({ teamCount: 32, starters: DEEP_IDP })!
    expect(s.startingSlots).toBe(17)
    expect(s.leagueWideSlots).toBe(32 * 17)
    expect(s.scrutiny).toBe('very-deep')
  })

  it('a normal league is standard and says nothing about size', () => {
    const s = assessLeagueScale({
      teamCount: 12,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
    })!
    expect(s.scrutiny).toBe('standard')
    expect(s.notes.join(' ')).not.toContain('12-team price')
  })

  it('withholds entirely rather than guessing at a lineup it cannot read', () => {
    expect(assessLeagueScale({ teamCount: 32, starters: null })).toBeNull()
    expect(assessLeagueScale({ teamCount: 1, starters: ['QB'] })).toBeNull()
  })
})

describe('replaceableThreshold: "plenty" scales with the league', () => {
  it('⚠ four spare kickers is plenty in 12 teams and thin across 32', () => {
    expect(replaceableThreshold(12)).toBe(4)
    expect(replaceableThreshold(32)).toBe(11)
  })

  it('asks whether ONE manager can get one, not whether all of them could', () => {
    // A third of the league, not all of it — simultaneous demand is not the
    // question a manager is asking.
    expect(replaceableThreshold(30)).toBeLessThan(30)
  })
})

describe('assessRosterCrunch: a 3-for-1 that forces two drops is not a 3-for-1', () => {
  it('⚠ counts the drops a deep league makes permanent', () => {
    const c = assessRosterCrunch({ rosterSize: 25, held: 25, incoming: 3, outgoing: 1 })
    expect(c.forcedDrops).toBe(2)
    expect(c.basis).toContain('drop 2')
  })

  it('says nothing when there is room', () => {
    expect(assessRosterCrunch({ rosterSize: 30, held: 20, incoming: 3, outgoing: 1 }).basis).toBeNull()
  })

  it('does not invent a limit the league never stated', () => {
    const c = assessRosterCrunch({ rosterSize: null, held: 40, incoming: 5, outgoing: 0 })
    expect(c.forcedDrops).toBe(0)
    expect(c.basis).toBeNull()
  })
})

describe('assessDeadline: win-now help is worth what is left to use it on', () => {
  it('⚠ flags buying with three weeks left', () => {
    const d = assessDeadline({ currentWeek: 12, seasonWeeks: 14, deadlineWeek: null, futureLean: -1 })
    expect(d.weeksOfUse).toBe(3)
    expect(d.basis).toContain('worth less the later you buy it')
  })

  it('does not flag the same deal in week 3', () => {
    expect(
      assessDeadline({ currentWeek: 3, seasonWeeks: 14, deadlineWeek: null, futureLean: -1 }).basis,
    ).toBeNull()
  })

  it('warns when the deadline leaves no room to correct a mistake', () => {
    const d = assessDeadline({ currentWeek: 11, seasonWeeks: 14, deadlineWeek: 11, futureLean: 1 })
    expect(d.basis).toContain('last deal')
  })
})

describe('assessUnpriced: a verdict built on half the assets is not a verdict', () => {
  it('⚠ says WHICH side the hole is on', () => {
    /*
     * If the unpriced players are all coming to you, the deal looks worse than
     * it is. Reporting only a count would leave a manager guessing which way the
     * error runs.
     */
    const u = assessUnpriced({
      give: [{ name: 'A', marketValue: 5000 }],
      get: [
        { name: 'B', marketValue: null },
        { name: 'C', marketValue: null },
      ],
    })
    expect(u.basis).toContain('2 of the 2 players coming to you')
  })

  it('says nothing when everything is priced', () => {
    expect(
      assessUnpriced({
        give: [{ name: 'A', marketValue: 1 }],
        get: [{ name: 'B', marketValue: 2 }],
      }).basis,
    ).toBeNull()
  })
})

describe('assessConcentration: same total, different roster', () => {
  it('⚠ flags consolidation as a trade-off, not as a verdict', () => {
    const c = assessConcentration({
      rosterValues: [1000, 1000, 1000, 1000, 1000],
      incoming: [9000],
      outgoing: [1000, 1000],
    })
    expect(c.basis).toContain('concentrates your roster')
    expect(c.basis).toContain('one injury from nothing')
  })

  it('flags the reverse honestly, including the lower ceiling', () => {
    const c = assessConcentration({
      rosterValues: [9000, 500, 500, 500],
      incoming: [2000, 2000],
      outgoing: [9000],
    })
    expect(c.basis).toContain('spreads your roster out')
    expect(c.basis).toContain('lower ceiling')
  })

  it('⚠ skips unpriced players rather than counting them as zero', () => {
    // Treating a null as a zero would report every IDP roster as extremely
    // concentrated in its one priced running back.
    const c = assessConcentration({
      rosterValues: [1000, null, null, 1000, 1000],
      incoming: [1100],
      outgoing: [1000],
    })
    expect(c.topShare).toBeCloseTo(1 / 3, 5)
  })

  it('stays quiet on a roster too small to say anything about', () => {
    expect(assessConcentration({ rosterValues: [100, 200], incoming: [], outgoing: [] }).basis).toBeNull()
  })
})

describe('pickOutlook applies BOTH corrections in a deep league', () => {
  it('⚠ standing tells you where in the round; scale tells you what that is worth', () => {
    /*
     * Applying only the first still overvalues every pick in a 32-team league by
     * a multiple, because "1.24" is priced off a chart where round one ends at
     * twelve. A deep league needs both corrections or neither is enough.
     */
    const p = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: 4,
      teamCount: 32,
      senderName: 'Their team',
    })
    expect(p.baselineEquivalent).not.toBeNull()
    expect(p.baselineEquivalent!.round).toBeGreaterThan(1)
    expect(p.basis).toContain('12-team terms')
  })

  it('adds nothing in a 12-team league, where the two are the same', () => {
    const p = projectPickSlot({
      season: 2027,
      round: 1,
      currentSeason: 2026,
      senderRank: 4,
      teamCount: 12,
    })
    expect(p.baselineEquivalent).toBeNull()
    expect(p.basis).not.toContain('12-team terms')
  })
})

describe('the shallow end: 4 teams, huge rosters', () => {
  const FOUR_TEAM = ['QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF']

  it('⚠ a 4-team 2nd is picks 5-8 — still a first in the prices we hold', () => {
    /*
     * The manager's own framing, and the conversion already produces it: round
     * two of a four-team draft is the 5th through 8th player off the board,
     * which is a 12-team 1.05 through 1.08. A chart that reads "2nd-round pick"
     * and prices it as a second is wrong by an entire round.
     */
    expect(toBaselinePick({ round: 2, slot: 1, teamCount: 4 })).toMatchObject({
      overall: 5,
      baselineRound: 1,
      baselineSlot: 5,
    })
    expect(toBaselinePick({ round: 2, slot: 4, teamCount: 4 })).toMatchObject({
      overall: 8,
      baselineRound: 1,
      baselineSlot: 8,
    })
  })

  it('⚠ picks stay valuable far deeper than their round name suggests', () => {
    // A 4-team 5th is overall 17 — an early second. In a 12-team league a 5th is
    // overall 49+ and close to worthless. Same label, nothing like the same asset.
    const p = toBaselinePick({ round: 5, slot: 1, teamCount: 4 })
    expect(p.overall).toBe(17)
    expect(p.baselineRound).toBe(2)
  })

  it('classifies it shallow and says replacement is abundant', () => {
    const s = assessLeagueScale({ teamCount: 4, starters: FOUR_TEAM })!
    expect(s.scrutiny).toBe('shallow')
    const text = s.notes.join(' ')
    expect(text).toContain('Replacement is abundant')
    expect(text).toContain('worth far more here than their round name suggests')
  })

  it('⚠ the errors invert at this end — they do not disappear', () => {
    /*
     * Deep leagues overvalue picks and undervalue starters. Shallow leagues do
     * the exact opposite. A model that only knew about deep leagues would be
     * wrong in the other direction here and just as confidently.
     */
    const deep = assessLeagueScale({ teamCount: 32, starters: FOUR_TEAM })!
    const shallow = assessLeagueScale({ teamCount: 4, starters: FOUR_TEAM })!
    expect(deep.notes.join(' ')).toContain('worth less than its round suggests')
    expect(shallow.notes.join(' ')).toContain('worth far more here')
  })

  it('still flags the 12-team price caveat, because 4 is not 12 either', () => {
    const s = assessLeagueScale({ teamCount: 4, starters: FOUR_TEAM })!
    expect(s.notes.join(' ')).toContain('12-team price')
  })
})
