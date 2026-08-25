import { describe, expect, it } from 'vitest'

import {
  byeCollisionDelta,
  computeRosterNeed,
  counterpartyPriceDelta,
  readSlotRequirements,
} from '@/lib/trade-intel/rosterNeed'

/**
 * The bug this module replaces is concrete and live:
 * `DraftAdvisorContextService.computeRosterNeeds` scores against a hardcoded
 * STANDARD_STARTS map, so in a superflex league it reports a team holding one
 * quarterback as having no quarterback need — the single most valuable fact in
 * that format, inverted.
 */

const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
const SUPERFLEX = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']

describe('readSlotRequirements: the league’s own lineup, never a default', () => {
  it('⚠ returns null rather than assuming a standard lineup', () => {
    // A guessed lineup produces confident needs for a league we cannot see.
    expect(readSlotRequirements(null)).toBeNull()
    expect(readSlotRequirements([])).toBeNull()
  })

  it('ignores bench, IR and taxi — they cannot generate a need', () => {
    const req = readSlotRequirements(['QB', 'BN', 'BN', 'IR', 'TAXI'])
    expect(req!.dedicated.get('QB')).toBe(1)
    expect(req!.dedicated.has('BN')).toBe(false)
    expect(req!.dedicated.has('IR')).toBe(false)
  })

  it('separates flex slots from dedicated ones, with what each accepts', () => {
    const req = readSlotRequirements(SUPERFLEX)!
    expect(req.dedicated.get('RB')).toBe(2)
    expect(req.flex.map((f) => f.slot).sort()).toEqual(['FLEX', 'SUPER_FLEX'])
    expect(req.flex.find((f) => f.slot === 'SUPER_FLEX')!.eligible).toContain('QB')
  })
})

describe('computeRosterNeed', () => {
  it('⚠ a one-QB roster in superflex has a real hole', () => {
    /*
     * THE BUG, DIRECTLY. Under a hardcoded one-QB ideal this team looks
     * complete. Under the league's own lineup it is short a startable
     * quarterback, which in superflex is the most expensive hole in fantasy.
     */
    const need = computeRosterNeed({
      requirements: readSlotRequirements(SUPERFLEX)!,
      rostered: ['QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    // The dedicated QB slot is filled; the SUPER_FLEX is not, because the only
    // spare bodies are RB and WR and they are consumed by FLEX first.
    expect(need.unfilledFlex).toBe(0)

    const thin = computeRosterNeed({
      requirements: readSlotRequirements(SUPERFLEX)!,
      rostered: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    })
    expect(thin.holes).toContain('RB')
    expect(thin.unfilledFlex).toBeGreaterThan(0)
  })

  it('⚠ depth at one position fills flex — it is not a need at another', () => {
    /*
     * Counting each empty flex slot as its own hole is how a team deep at wide
     * receiver gets told to trade for a running back it does not need.
     */
    const need = computeRosterNeed({
      requirements: readSlotRequirements(ONE_QB)!,
      rostered: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    expect(need.unfilledFlex).toBe(0)
    expect(need.holes).toEqual([])
  })

  it('counts a genuine shortfall at a dedicated slot', () => {
    const need = computeRosterNeed({
      requirements: readSlotRequirements(ONE_QB)!,
      rostered: ['QB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'],
    })
    const rb = need.byPosition.find((p) => p.position === 'RB')!
    expect(rb.required).toBe(2)
    expect(rb.have).toBe(1)
    expect(rb.deficit).toBe(1)
  })

  it('fills the narrowest flex slot first, so it is not stranded', () => {
    // One spare TE and one spare WR against REC_FLEX (WR/TE) and SUPER_FLEX
    // (anything). If SUPER_FLEX drew first it could take the TE and strand
    // REC_FLEX behind a position it cannot accept.
    const need = computeRosterNeed({
      requirements: readSlotRequirements(['QB', 'REC_FLEX', 'SUPER_FLEX'])!,
      rostered: ['QB', 'TE', 'RB'],
    })
    expect(need.unfilledFlex).toBe(0)
  })
})

describe('counterpartyPriceDelta: a preference, stated as one', () => {
  const need = computeRosterNeed({
    requirements: readSlotRequirements(ONE_QB)!,
    rostered: ['QB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'],
  })

  it('⚠ returns null when the need is unknown, not a neutral 1.0', () => {
    // 1.0 reads as "we checked and it makes no difference". Null is the truth.
    expect(counterpartyPriceDelta({ position: 'RB', need: null })).toBeNull()
    expect(counterpartyPriceDelta({ position: null, need })).toBeNull()
  })

  it('pays more at a position they cannot fill', () => {
    const d = counterpartyPriceDelta({ position: 'RB', need })!
    expect(d.factor).toBeGreaterThan(1)
    expect(d.basis).toContain('cannot fill')
  })

  it('pays slightly less where they are already deep', () => {
    const d = counterpartyPriceDelta({ position: 'WR', need })!
    expect(d.factor).toBeLessThan(1)
  })

  it('⚠ the premium is capped so it can never overturn a real value gap', () => {
    /*
     * Nothing in this repo measures what managers actually overpay for need. A
     * large multiplier would let the engine recommend giving up a materially
     * better player and present the preference as arithmetic. The band breaks
     * ties; it does not decide trades.
     */
    const desperate = computeRosterNeed({
      requirements: readSlotRequirements(['RB', 'RB', 'RB', 'RB', 'RB'])!,
      rostered: ['WR'],
    })
    const d = counterpartyPriceDelta({ position: 'RB', need: desperate })!
    expect(d.factor).toBeLessThanOrEqual(1.15)
  })
})

describe('byeCollisionDelta: the Josh Allen case', () => {
  const ONE_QB_REQ = readSlotRequirements(ONE_QB)!

  it('⚠ flags a deal that does not fix the bye hole it looks like it fixes', () => {
    /*
     * The manager's own example. You hold a quarterback off in week 10 and trade
     * for Josh Allen, who is also off in week 10. You are no worse off — but you
     * are no better off either, at the position you were trading to improve, and
     * you probably did not notice. No discount: two years of a player of that
     * calibre can be worth one unstartable Sunday, and that call is the
     * manager's. The sentence is the deliverable.
     */
    const d = byeCollisionDelta({
      requirements: ONE_QB_REQ,
      roster: [
        { position: 'QB', byeWeek: 10, id: 'qb1' },
        { position: 'RB', byeWeek: 5, id: 'rb1' },
      ],
      incoming: { position: 'QB', byeWeek: 10 },
    })!
    expect(d.unrelieved).toHaveLength(1)
    expect(d.unrelieved[0].week).toBe(10)
    expect(d.factor).toBe(1)
    expect(d.basis).toContain('does not fix')
  })

  it('⚠ catches the hole the OUTGOING side opens', () => {
    /*
     * A trade is not an acquisition. You send the QB2 who was covering week 10
     * and receive a quarterback who is also off in week 10 — a week that was
     * covered before the deal is empty after it. A model that only looked at the
     * incoming player would see two quarterbacks and call it fine.
     */
    const d = byeCollisionDelta({
      requirements: ONE_QB_REQ,
      roster: [
        { position: 'QB', byeWeek: 10, id: 'qb1' },
        { position: 'QB', byeWeek: 7, id: 'qb2' },
      ],
      incoming: { position: 'QB', byeWeek: 10 },
      outgoingIds: ['qb2'],
    })!
    expect(d.created).toHaveLength(1)
    expect(d.created[0].week).toBe(10)
    expect(d.factor).toBeLessThan(1)
    expect(d.basis).toContain('week 10 hole')
  })

  it('says nothing when the byes do not collide', () => {
    const d = byeCollisionDelta({
      requirements: ONE_QB_REQ,
      roster: [{ position: 'QB', byeWeek: 7, id: 'qb1' }],
      incoming: { position: 'QB', byeWeek: 10 },
    })!
    expect(d.created).toEqual([])
    expect(d.unrelieved).toEqual([])
    expect(d.factor).toBe(1)
  })

  it('⚠ an unknown bye is treated as available, never as a collision', () => {
    /*
     * Inventing a collision out of missing data is a false alarm, and false
     * alarms on a trade screen teach managers to ignore the real ones.
     */
    expect(
      byeCollisionDelta({
        requirements: ONE_QB_REQ,
        roster: [{ position: 'QB', byeWeek: null, id: 'qb1' }],
        incoming: { position: 'QB', byeWeek: null },
      }),
    ).toBeNull()

    const d = byeCollisionDelta({
      requirements: ONE_QB_REQ,
      roster: [{ position: 'QB', byeWeek: null, id: 'qb1' }],
      incoming: { position: 'QB', byeWeek: 10 },
    })!
    expect(d.created).toEqual([])
  })

  it('⚠ the discount is capped, so a bye can never sink a trade on its own', () => {
    // "It won't kill the trade but it should impact it" — the manager's rule.
    const d = byeCollisionDelta({
      requirements: readSlotRequirements(['QB', 'RB', 'RB', 'WR', 'WR'])!,
      roster: [
        { position: 'QB', byeWeek: 9, id: 'a' },
        { position: 'RB', byeWeek: 9, id: 'b' },
        { position: 'RB', byeWeek: 3, id: 'c' },
        { position: 'WR', byeWeek: 9, id: 'd' },
        { position: 'WR', byeWeek: 4, id: 'e' },
      ],
      incoming: { position: 'RB', byeWeek: 9 },
      outgoingIds: ['c'],
    })!
    expect(d.factor).toBeGreaterThanOrEqual(1 - 0.09)
  })

  it('⚠ a roster with no kicker at all is not a "bye" problem', () => {
    /*
     * A thin roster is short at that position EVERY week, which is a
     * roster-construction fact and not something this trade's bye weeks caused.
     * Reporting it here would fire the warning on every deal a thin roster ever
     * looked at — and a signal that fires constantly is one managers learn to
     * ignore, which costs them the week it was actually about.
     */
    const d = byeCollisionDelta({
      requirements: ONE_QB_REQ,
      roster: [{ position: 'QB', byeWeek: 7, id: 'qb1' }],
      incoming: { position: 'QB', byeWeek: 10 },
    })!
    expect(d.created).toEqual([])
    expect(d.unrelieved).toEqual([])
  })
})

describe('the injured-kicker case: identical rosters, different prices', () => {
  const K_LEAGUE = readSlotRequirements(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'])!
  const HEALTHY = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF']

  it('⚠ a kicker on IR does not fill the kicker slot', () => {
    /*
     * Counting bodies rather than AVAILABLE bodies reports the team whose only
     * kicker is on injured reserve as having no kicker need — the exact case
     * where the need is most real.
     */
    const healthy = computeRosterNeed({ requirements: K_LEAGUE, rostered: HEALTHY })
    expect(healthy.holes).toEqual([])

    const injured = computeRosterNeed({
      requirements: K_LEAGUE,
      rostered: [
        ...HEALTHY.filter((p) => p !== 'K'),
        { position: 'K', unavailable: true },
      ],
    })
    expect(injured.holes).toContain('K')
  })

  it('⚠ the SAME need is priced differently by what sits on waivers', () => {
    /*
     * The manager's own scenario. Two identical teams, identical scoring,
     * identical slots. One kicker is hurt. If a dozen kickers are unrostered
     * that manager has a waiver claim, not a problem. If the wire is empty a
     * trade is the only route, and the same kicker is worth far more to them.
     * The need is identical in both branches; only the alternative differs.
     */
    const need = computeRosterNeed({
      requirements: K_LEAGUE,
      rostered: [...HEALTHY.filter((p) => p !== 'K'), { position: 'K', unavailable: true }],
    })

    const plentiful = counterpartyPriceDelta({
      position: 'K',
      need,
      scarcity: { position: 'K', freeAgents: 14, scarcity: 0 },
    })!
    const barren = counterpartyPriceDelta({
      position: 'K',
      need,
      scarcity: { position: 'K', freeAgents: 0, scarcity: 1 },
    })!

    expect(barren.factor).toBeGreaterThan(plentiful.factor)
    expect(barren.basis).toContain('no K available on waivers')
    expect(plentiful.basis).toContain('claim away')
  })

  it('⚠ unknown scarcity uses the replaceable band, not the scarce one', () => {
    /*
     * We have not checked the wire, so we must not price as though it were
     * empty. Understating is the safe direction: it can leave a manager
     * slightly under-charged, where overstating invents leverage that does not
     * exist.
     */
    const need = computeRosterNeed({
      requirements: K_LEAGUE,
      rostered: [...HEALTHY.filter((p) => p !== 'K'), { position: 'K', unavailable: true }],
    })
    const unknown = counterpartyPriceDelta({ position: 'K', need })!
    expect(unknown.factor).toBeLessThanOrEqual(1.15)
  })

  it('a healthy roster gets no premium however barren the wire', () => {
    // Scarcity without a hole is not a need. A team with a working kicker does
    // not care that nobody else has one.
    const need = computeRosterNeed({ requirements: K_LEAGUE, rostered: HEALTHY })
    const d = counterpartyPriceDelta({
      position: 'K',
      need,
      scarcity: { position: 'K', freeAgents: 0, scarcity: 1 },
    })!
    expect(d.factor).toBe(1)
  })

  it('⚠ even a total-scarcity premium cannot manufacture a star', () => {
    // The premium multiplies the player's OWN value. Sixty percent of a kicker
    // is still a kicker: it reorders a close deal, it does not invent leverage.
    const need = computeRosterNeed({
      requirements: K_LEAGUE,
      rostered: [...HEALTHY.filter((p) => p !== 'K'), { position: 'K', unavailable: true }],
    })
    const d = counterpartyPriceDelta({
      position: 'K',
      need,
      scarcity: { position: 'K', freeAgents: 0, scarcity: 1 },
    })!
    expect(d.factor).toBeLessThanOrEqual(1.6)
  })
})
