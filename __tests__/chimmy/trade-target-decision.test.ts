import { describe, expect, it } from 'vitest'

import {
  decideTradeTarget,
  renderTradeTargetVerdict,
  type TradeTargetFacts,
} from '@/lib/chimmy/tradeTargetDecision'

/**
 * "Should I trade for X?" — the rules, one at a time. Every fact is handed in, so each test moves
 * exactly one of them and pins which rule decided.
 */

function facts(over: Partial<TradeTargetFacts> = {}): TradeTargetFacts {
  return {
    leagueName: 'Draft Junkies',
    target: { name: 'Rashee Rice', position: 'WR', value: 3421, trend30Day: -436, age: 26 },
    mode: 'dynasty',
    you: {
      stance: 'contender',
      record: { wins: 3, losses: 1, ties: 0 },
      rank: 2,
      teamCount: 12,
      needs: [],
      surpluses: ['RB'],
    },
    partner: { teamName: 'Rival', stance: 'rebuilder' },
    lineup: {
      status: 'priced',
      week: 3,
      targetPoints: 15,
      addGain: 8.5,
      netGain: 8,
      netBlocked: null,
      replaces: 'Kyren Williams',
    },
    offer: {
      give: [{ name: 'Jaylen Waddle', position: 'WR', value: 3300 }],
      giveTotal: 3300,
      receiveTotal: 3421,
      fairness: 'balanced',
    },
    grade: { verdict: 'accept', acceptance: 0.62 },
    noTrades: null,
    ...over,
  }
}

const priced = (over: Partial<Extract<TradeTargetFacts['lineup'], { status: 'priced' }>>): TradeTargetFacts['lineup'] => ({
  status: 'priced',
  week: 3,
  targetPoints: 15,
  addGain: 8.5,
  netGain: 8,
  netBlocked: null,
  replaces: 'Kyren Williams',
  ...over,
})

describe('yes — he starts, you are contending, and the price works', () => {
  it('says yes, and why, in the words the user asked for', () => {
    const v = decideTradeTarget(facts())
    expect(v.verdict).toBe('yes')
    expect(v.headline).toBe('Yes, trade for Rashee Rice')
    expect(v.because).toMatch(/would start for you \(\+8\.5 points in week 3\)/)
    expect(v.because).toMatch(/contending at 3-1, 2nd of 12/)
    expect(v.openWith).toBe('Jaylen Waddle')
  })

  it('lists the facts it read: lineup, record, price, market, his team', () => {
    const v = decideTradeTarget(facts())
    const text = v.reasons.join('\n')
    expect(text).toMatch(/Lineup: Rashee Rice \(15\.0 projected\) would start for you over Kyren Williams — \+8\.5 points in week 3 under Draft Junkies' scoring/)
    expect(text).toMatch(/After sending the package below, your lineup moves \+8\.0/)
    expect(text).toMatch(/Your team: 3-1, 2nd of 12 — contending/)
    expect(text).toMatch(/Price: about Jaylen Waddle \(3,300\) for his 3,421 — a fair deal\. The trade engine calls it a good offer, about 62% they accept/)
    expect(text).toMatch(/Market: Dynasty value 3,421, down 436 over 30 days, age 26/)
    expect(text).toMatch(/His team: Rival is rebuilding — a team likely to sell a veteran/)
  })

  it('a need is enough when the lineup cannot be priced', () => {
    const v = decideTradeTarget(
      facts({
        lineup: { status: 'unavailable', detail: 'this league has no scoring rules on file' },
        you: { ...facts().you, needs: ['WR'] },
      }),
    )
    expect(v.verdict).toBe('yes')
    expect(v.because).toMatch(/WR is a hole on your roster/)
    expect(v.reasons.join('\n')).toMatch(/Lineup: not computed — this league has no scoring rules on file/)
  })

  it('a dynasty team buys a young player who does not start yet', () => {
    const v = decideTradeTarget(
      facts({
        target: { name: 'Rome Odunze', position: 'WR', value: 4000, trend30Day: -50, age: 23 },
        lineup: priced({ addGain: 0, netGain: -2, replaces: null }),
        you: { ...facts().you, stance: 'middle' },
      }),
    )
    expect(v.verdict).toBe('yes')
    expect(v.because).toMatch(/23 and young enough to hold value/)
  })
})

describe('no — each rule, on its own', () => {
  it('a league that does not allow trades', () => {
    const v = decideTradeTarget(facts({ noTrades: { waiverNote: 'No trades in this league. Bid $40 if he hits waivers.' } }))
    expect(v.verdict).toBe('no')
    expect(v.because).toBe('this league does not allow trades')
    expect(v.reasons[0]).toBe('Waivers: No trades in this league. Bid $40 if he hits waivers.')
    // No package is offered for a trade that cannot be sent.
    expect(v.reasons.join('\n')).not.toMatch(/Price:/)
    expect(v.openWith).toBeNull()
  })

  it('a player the market does not price — no "for his 0" package', () => {
    const v = decideTradeTarget(
      facts({
        target: { ...facts().target, value: null },
        offer: { give: [{ name: 'Chig Okonkwo', position: 'TE', value: 85 }], giveTotal: 85, receiveTotal: 0, fairness: 'low confidence' },
        grade: { verdict: 'accept', acceptance: 0.66 },
      }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/the market has no value for him in this league's format/)
    const text = v.reasons.join('\n')
    expect(text).toMatch(/Price: the market has no value for Rashee Rice in this league's format, so no package can be priced/)
    expect(text).not.toMatch(/for his 0/)
    expect(text).not.toMatch(/trade engine calls it/)
    expect(v.openWith).toBeNull()
  })

  it('a market value of exactly zero is treated the same way', () => {
    const v = decideTradeTarget(facts({ target: { ...facts().target, value: 0 } }))
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/no fair price/)
  })

  it('no package your roster can make', () => {
    const v = decideTradeTarget(facts({ offer: null, grade: null }))
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/nothing on your roster lines up with his value/)
  })

  it('he would not start for you', () => {
    const v = decideTradeTarget(facts({ mode: 'redraft', lineup: priced({ addGain: 0, netGain: -7, replaces: null }) }))
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/would not start for you/)
    expect(v.reasons[0]).toMatch(/would not crack your week 3 lineup under Draft Junkies' scoring/)
  })

  it('an older dynasty player who would not start is still a no', () => {
    const v = decideTradeTarget(
      facts({ target: { ...facts().target, age: 29, trend30Day: -100 }, lineup: priced({ addGain: -1 }) }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/would not start for you/)
  })

  it('a rebuilding team in redraft', () => {
    const v = decideTradeTarget(
      facts({ mode: 'redraft', you: { ...facts().you, stance: 'rebuilder', record: { wins: 1, losses: 3, ties: 0 }, rank: 11 } }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/you are rebuilding at 1-3, 11th of 12, and a redraft season spent buying help is a season already gone/)
  })

  it('a rebuilding dynasty team and a veteran who is not rising', () => {
    const v = decideTradeTarget(
      facts({ target: { ...facts().target, age: 29, trend30Day: -100 }, you: { ...facts().you, stance: 'rebuilder' } }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/not young or rising enough/)
  })

  it('the engine grades the package against you', () => {
    const v = decideTradeTarget(facts({ grade: { verdict: 'reject', acceptance: 0.3 } }))
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/the package it would take \(Jaylen Waddle\) costs more than he is worth to you/)
  })

  it('a lopsided overpay', () => {
    const v = decideTradeTarget(
      facts({ offer: { ...facts().offer!, giveTotal: 5200, fairness: 'lopsided' }, grade: null }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/overpay — about 5,200 for his 3,421/)
  })

  it('a lopsided deal in YOUR favour is not an overpay', () => {
    const v = decideTradeTarget(
      facts({ offer: { ...facts().offer!, giveTotal: 2000, fairness: 'lopsided' }, grade: null }),
    )
    expect(v.verdict).toBe('yes')
  })

  it('a contender whose lineup gets worse after paying', () => {
    const v = decideTradeTarget(facts({ lineup: priced({ netGain: -3.5 }) }))
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/leaves your lineup -3\.5 worse this week/)
  })

  it('a middling dynasty team may take a small lineup hit for a better asset', () => {
    const v = decideTradeTarget(facts({ lineup: priced({ netGain: -3.5 }), you: { ...facts().you, stance: 'middle' } }))
    expect(v.verdict).toBe('yes')
  })

  it('no lineup effect known, no need, not a dynasty future: no', () => {
    const v = decideTradeTarget(
      facts({
        mode: 'redraft',
        lineup: { status: 'unavailable', detail: 'no weekly projection feed is on file' },
      }),
    )
    expect(v.verdict).toBe('no')
    expect(v.because).toMatch(/his effect on your lineup could not be computed/)
  })
})

/*
 * 🛑 ONE GAME IS NOT A SEASON. Measured on production 2026-09-17 in the owner's Draft Junkies
 * league: "No, don't trade for Rashee Rice, because you are rebuilding at 0-1, 12th of 12" — while
 * Rice would have started for +7.2 at a fair price. The engine's stance is win percentage alone.
 */
describe('early in the season, the record decides nothing', () => {
  const draftJunkies = (over: Partial<TradeTargetFacts> = {}) =>
    facts({
      leagueName: 'Draft Junkies $20 Dynasty',
      target: { name: 'Rashee Rice', position: 'WR', value: 3446, trend30Day: -411, age: 26 },
      you: { stance: 'rebuilder', record: { wins: 0, losses: 1, ties: 0 }, rank: 12, teamCount: 12, needs: [], surpluses: ['WR'] },
      partner: { teamName: 'Puka Troopers', stance: 'contender' },
      lineup: priced({ week: 3, targetPoints: 16.7, addGain: 7.2, netGain: 4.3, replaces: 'Quentin Johnston' }),
      offer: { give: [{ name: 'Kyren Williams', position: 'RB', value: 3562 }], giveTotal: 3562, receiveTotal: 3446, fairness: 'balanced' },
      grade: { verdict: 'accept', acceptance: 0.56 },
      ...over,
    })

  it('the production case: 0-1 is not "rebuilding", and the answer is a yes', () => {
    const v = decideTradeTarget(draftJunkies())
    expect(v.verdict).toBe('yes')
    expect(v.because).toBe('he would start for you (+7.2 points in week 3), at a price your roster can pay')
    expect(v.openWith).toBe('Kyren Williams')
    const text = v.reasons.join('\n')
    expect(text).toMatch(/Your team: 0-1, 12th of 12 — too early in the season to call you a contender or a rebuilder\./)
    expect(text).toMatch(/His team: Puka Troopers — too early in the season to tell whether they are buying or selling\./)
    expect(text).not.toMatch(/rebuilding|contending/)
  })

  it('a 1-0 start is not "contending" either', () => {
    const v = decideTradeTarget(draftJunkies({ you: { ...draftJunkies().you, stance: 'contender', record: { wins: 1, losses: 0, ties: 0 }, rank: 1 } }))
    expect(v.because).not.toMatch(/contending/)
  })

  it('three games still decide nothing; the fourth does', () => {
    const at = (wins: number, losses: number) =>
      decideTradeTarget(draftJunkies({ you: { ...draftJunkies().you, stance: 'rebuilder', record: { wins, losses, ties: 0 } } }))
    expect(at(0, 3).verdict).toBe('yes')
    const four = at(0, 4)
    expect(four.verdict).toBe('no')
    expect(four.because).toMatch(/you are rebuilding at 0-4, 12th of 12/)
  })

  it('an early-season lineup hit does not trip the contender rule', () => {
    const v = decideTradeTarget(
      draftJunkies({
        you: { ...draftJunkies().you, stance: 'contender', record: { wins: 1, losses: 0, ties: 0 } },
        lineup: priced({ week: 3, targetPoints: 16.7, addGain: 7.2, netGain: -1.5 }),
      }),
    )
    expect(v.verdict).toBe('yes')
  })
})

describe('what the answer says about what it could not see', () => {
  it('no games played: the record is not used as a reason', () => {
    const v = decideTradeTarget(facts({ you: { ...facts().you, record: { wins: 0, losses: 0, ties: 0 } } }))
    expect(v.reasons.join('\n')).toMatch(/no games played yet/)
    expect(v.because).not.toMatch(/0-0/)
  })

  it('a package the engine did not grade in time is said, not filled in', () => {
    const v = decideTradeTarget(facts({ grade: null }))
    expect(v.basis.join(' ')).toMatch(/did not grade the package in time/)
    expect(v.reasons.join('\n')).not.toMatch(/trade engine calls it/)
  })

  it('a package that could not be priced for the lineup says why', () => {
    const v = decideTradeTarget(facts({ lineup: priced({ netGain: null, netBlocked: '1 traded player(s) have no projection' }) }))
    expect(v.reasons[0]).toMatch(/could not be priced: 1 traded player\(s\) have no projection/)
  })
})

describe('renderTradeTargetVerdict', () => {
  it('leads with the call, then the reasons, the opening offer and the basis', () => {
    const text = renderTradeTargetVerdict(decideTradeTarget(facts()))
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^Yes, trade for Rashee Rice, because he would start for you/)
    expect(lines[0]).toMatch(/\.$/)
    expect(text).toMatch(/\n• Lineup: /)
    expect(text).toMatch(/\nOpen with: Jaylen Waddle\./)
    expect(text).toMatch(/\nBased on: Week 3 projections scored under Draft Junkies' own rules\./)
  })

  it('a no has no opening offer', () => {
    const text = renderTradeTargetVerdict(decideTradeTarget(facts({ grade: { verdict: 'reject', acceptance: null } })))
    expect(text).toMatch(/^No, don't trade for Rashee Rice, because /)
    expect(text).not.toMatch(/Open with:/)
  })
})

/*
 * The trade block (2026-09-17). Only what managers marked in AllFantasy is visible — Sleeper does
 * not share its own — so "not listed" is said as "may still be available", never as "not available".
 */
describe('the trade block', () => {
  const SLEEPER_NOTE = "Sleeper doesn't share its trade block with outside apps, so this only includes players managers put on the block in AllFantasy."
  const block = (over: Partial<NonNullable<TradeTargetFacts['block']>> = {}): TradeTargetFacts['block'] => ({
    supported: true,
    listed: false,
    teamName: null,
    since: null,
    note: SLEEPER_NOTE,
    ...over,
  })

  it('a listed player: the reason names the team and the date, and the yes says so', () => {
    const v = decideTradeTarget(facts({ block: block({ listed: true, teamName: 'Rival', since: '2026-09-15T12:00:00.000Z' }) }))
    expect(v.reasons).toContain('Trade block: Rival has him on the block in AllFantasy (listed 2026-09-15).')
    expect(v.verdict).toBe('yes')
    expect(v.because).toMatch(/at a price your roster can pay, and his team has him on the trade block$/)
  })

  it('🛑 not listed is "may still be available", never "not available"', () => {
    const v = decideTradeTarget(facts({ block: block() }))
    const line = v.reasons.find((r) => r.startsWith('Trade block:'))
    expect(line).toBe(
      "Trade block: he isn't marked on the block in AllFantasy, and Sleeper doesn't share its own block, so he may still be available.",
    )
    expect(v.because).not.toMatch(/trade block/)
  })

  it('an unsupported platform gives its own note as the reason', () => {
    const note = "ESPN doesn't share its trade block with AllFantasy, and marking players here is only available for Sleeper leagues so far."
    const v = decideTradeTarget(facts({ block: block({ supported: false, note }) }))
    expect(v.reasons).toContain(`Trade block: ${note}`)
  })

  it('a listing with no team or date still reads', () => {
    const v = decideTradeTarget(facts({ block: block({ listed: true }) }))
    expect(v.reasons).toContain('Trade block: his team has him on the block in AllFantasy.')
  })

  it('a listing does not turn a no into a yes', () => {
    const v = decideTradeTarget(
      facts({ block: block({ listed: true, teamName: 'Rival' }), grade: { verdict: 'reject', acceptance: 0.2 } }),
    )
    expect(v.verdict).toBe('no')
    expect(v.reasons).toContain('Trade block: Rival has him on the block in AllFantasy.')
  })

  it('no block facts: no block line, as before', () => {
    expect(decideTradeTarget(facts()).reasons.some((r) => r.startsWith('Trade block:'))).toBe(false)
    expect(decideTradeTarget(facts({ block: null })).reasons.some((r) => r.startsWith('Trade block:'))).toBe(false)
  })

  it('the block line comes after his team, and renders with the rest', () => {
    const v = decideTradeTarget(facts({ block: block({ listed: true, teamName: 'Rival' }) }))
    const his = v.reasons.findIndex((r) => r.startsWith('His team:'))
    const tb = v.reasons.findIndex((r) => r.startsWith('Trade block:'))
    expect(tb).toBe(his + 1)
    expect(renderTradeTargetVerdict(v)).toContain('Trade block: Rival has him on the block in AllFantasy.')
  })
})
