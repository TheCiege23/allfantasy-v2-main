/**
 * Commissioner review mode (design build-order step 6): six checks computed in code, a recommendation
 * that is advice only, and "not computed" — never "clear" — where the data does not exist.
 */
import { describe, expect, it } from 'vitest'

import {
  CLASS_GAP_LEVELS,
  buildTradeReview,
  recommendationFor,
  rebuildIsNormal,
  type ReviewCheck,
  type TradeReviewFacts,
} from '@/lib/decision-os/trade/tradeReview'
import { MANAGER_CLASS_BAND } from '@/lib/league-join/managerClass'

const NOW = '2026-11-12T12:00:00.000Z'
const missing = (reason: string) => ({ ok: false as const, reason })

/** A trade nothing is wrong with: every check has data, and every check is clear. */
function facts(over: Partial<TradeReviewFacts> = {}): TradeReviewFacts {
  return {
    sides: [{ name: 'Alpha' }, { name: 'Bravo' }],
    gapPct: { ok: true, value: 6 },
    lineup: {
      ok: true,
      value: [
        { startingBefore: 120, startingDelta: 2.5, receivedValue: 5000, receivedBenchValue: 1000, sentStarterNames: [] },
        { startingBefore: 115, startingDelta: -1.5, receivedValue: 4700, receivedBenchValue: 900, sentStarterNames: ['Star Runner'] },
      ],
    },
    history: { ok: true, value: [6] },
    inactiveDays: { ok: true, value: [2, 3] },
    playoffPct: { ok: true, value: [55, 40] },
    deadlineAt: { ok: true, value: '2026-11-26T18:00:00.000Z' },
    managerLevels: { ok: true, value: [8, 9] },
    now: NOW,
    ...over,
  }
}
const check = (f: TradeReviewFacts, code: ReviewCheck['code']) => buildTradeReview(f).checks.find((c) => c.code === code)!

describe('a clean trade', () => {
  it('seven checks, all clear, no flags, approve', () => {
    const r = buildTradeReview(facts())
    expect(r.checks.map((c) => c.code)).toEqual([
      'heavily_lopsided', 'tanking_signal', 'repeat_partners', 'inactive_manager', 'eliminated_team_dumping', 'deadline_rush', 'class_gap',
    ])
    expect(r.checks.every((c) => c.status === 'clear')).toBe(true)
    expect(r.flags).toEqual([])
    expect(r.recommendation).toBe('approve')
  })
})

describe('heavily lopsided (high)', () => {
  it('raises past 40% and names the side it favours', () => {
    const c = check(facts({ gapPct: { ok: true, value: -46 } }), 'heavily_lopsided')
    expect(c).toMatchObject({ status: 'raised', severity: 'high' })
    expect(c.explanation).toMatch(/Bravo receives 46% more league value/)
  })
  it('40% exactly is not past the line', () => {
    expect(check(facts({ gapPct: { ok: true, value: 40 } }), 'heavily_lopsided').status).toBe('clear')
  })
  it('an ungraded trade is not computed, with the grade’s own reason', () => {
    const c = check(facts({ gapPct: missing('Nobody Special could not be priced.') }), 'heavily_lopsided')
    expect(c).toMatchObject({ status: 'not_computed' })
    expect(c.explanation).toContain('Nobody Special')
  })
})

describe('tanking signal (high)', () => {
  const tank = { startingBefore: 120, startingDelta: -18, receivedValue: 3000, receivedBenchValue: 2400, sentStarterNames: ['Star Runner'] }
  it('raises on a 10%+ lineup drop while mostly bench value comes back', () => {
    const c = check(facts({ lineup: { ok: true, value: [tank, facts().lineup.ok ? (facts().lineup as { value: never[] }).value[1] : null] } }), 'tanking_signal')
    expect(c).toMatchObject({ status: 'raised', severity: 'high' })
    expect(c.explanation).toMatch(/Alpha's projected starting lineup falls 18\.0 points this week \(15% of it\), and 80% of the value it receives would not start/)
  })
  it('a big drop for STARTER value is not tanking', () => {
    const c = check(facts({ lineup: { ok: true, value: [{ ...tank, receivedBenchValue: 600 }, null] } }), 'tanking_signal')
    expect(c.status).not.toBe('raised')
  })
  it('bench value with a small drop is not tanking', () => {
    const c = check(facts({ lineup: { ok: true, value: [{ ...tank, startingDelta: -5 }, { ...tank, startingDelta: 3 }] } }), 'tanking_signal')
    expect(c.status).toBe('clear')
  })
  it('a side whose lineup could not be priced makes it not computed (unless the other side already raised it)', () => {
    expect(check(facts({ lineup: { ok: true, value: [{ ...tank, startingDelta: 2 }, null] } }), 'tanking_signal').status).toBe('not_computed')
    expect(check(facts({ lineup: { ok: true, value: [tank, null] } }), 'tanking_signal').status).toBe('raised')
  })
  it('no lineup at all is not computed, with the reason', () => {
    const c = check(facts({ lineup: missing('Lineup effect is only measured while a trade is still pending.') }), 'tanking_signal')
    expect(c).toMatchObject({ status: 'not_computed', explanation: 'Lineup effect is only measured while a trade is still pending.' })
  })
})

describe('repeat partners (medium)', () => {
  it('3+ trades this season, every one favouring the same team', () => {
    const c = check(facts({ history: { ok: true, value: [14, 22, 11] } }), 'repeat_partners')
    expect(c).toMatchObject({ status: 'raised', severity: 'medium' })
    expect(c.explanation).toMatch(/3 trades this season, and every one favours Alpha/)
    expect(check(facts({ history: { ok: true, value: [-30, -12, -15, -40] } }), 'repeat_partners').explanation).toMatch(/favours Bravo/)
  })
  it('an even trade in the run breaks "all leaning one way"', () => {
    expect(check(facts({ history: { ok: true, value: [14, 5, 11] } }), 'repeat_partners').status).toBe('clear')
  })
  it('fewer than three is clear', () => {
    expect(check(facts({ history: { ok: true, value: [40, 40] } }), 'repeat_partners').status).toBe('clear')
  })
  it('an ungradable trade in the run is not computed — never assumed to lean', () => {
    const c = check(facts({ history: { ok: true, value: [14, null, 11] } }), 'repeat_partners')
    expect(c).toMatchObject({ status: 'not_computed' })
    expect(c.explanation).toMatch(/1 of them could not be graded/)
  })
})

describe('inactive manager (medium)', () => {
  it('14+ days without a roster change raises', () => {
    const c = check(facts({ inactiveDays: { ok: true, value: [2, 19.6] } }), 'inactive_manager')
    expect(c).toMatchObject({ status: 'raised', severity: 'medium' })
    expect(c.explanation).toMatch(/Bravo's roster has not changed in 19 days/)
  })
  it('an unknown side is not computed, not clear', () => {
    expect(check(facts({ inactiveDays: { ok: true, value: [2, null] } }), 'inactive_manager').status).toBe('not_computed')
  })
  it('no activity data is not computed, with the reason', () => {
    expect(check(facts({ inactiveDays: missing('Manager activity is not tracked for redraft rosters yet.') }), 'inactive_manager').explanation).toMatch(/redraft/)
  })
})

describe('eliminated team dumping (medium)', () => {
  it('an eliminated team sending a starter to a contender raises', () => {
    const c = check(facts({ playoffPct: { ok: true, value: [72, 0.4] } }), 'eliminated_team_dumping')
    expect(c).toMatchObject({ status: 'raised', severity: 'medium' })
    expect(c.explanation).toMatch(/Bravo is out of the playoff race \(0\.4% odds\) and sends starters \(Star Runner\) to Alpha, a contender at 72%/)
  })
  it('eliminated but sending no starters is clear', () => {
    expect(check(facts({ playoffPct: { ok: true, value: [0.2, 72] } }), 'eliminated_team_dumping').status).toBe('clear')
  })
  it('eliminated to a NON-contender is clear', () => {
    expect(check(facts({ playoffPct: { ok: true, value: [30, 0.4] } }), 'eliminated_team_dumping').status).toBe('clear')
  })
  it('no forecast is not computed', () => {
    expect(check(facts({ playoffPct: missing('No season forecast has been run for this league.') }), 'eliminated_team_dumping').status).toBe('not_computed')
  })
})

describe('deadline rush (low)', () => {
  const soon = '2026-11-13T18:00:00.000Z' // 30 hours after NOW
  it('inside 48 hours with a gap over 25% raises', () => {
    const c = check(facts({ deadlineAt: { ok: true, value: soon }, gapPct: { ok: true, value: 31 } }), 'deadline_rush')
    expect(c).toMatchObject({ status: 'raised', severity: 'low' })
    expect(c.explanation).toMatch(/30 hours before the trade deadline with a 31% value gap/)
  })
  it('inside 48 hours with a small gap is clear; outside it is clear', () => {
    expect(check(facts({ deadlineAt: { ok: true, value: soon }, gapPct: { ok: true, value: 12 } }), 'deadline_rush').status).toBe('clear')
    expect(check(facts({ gapPct: { ok: true, value: 31 } }), 'deadline_rush').status).toBe('clear')
  })
  it('no deadline in the league is clear; no schedule is not computed', () => {
    expect(check(facts({ deadlineAt: { ok: true, value: null } }), 'deadline_rush').explanation).toMatch(/no trade deadline/)
    expect(check(facts({ deadlineAt: missing('The schedule for week 11 (the trade deadline) is not loaded, so the deadline has no time.') }), 'deadline_rush').status).toBe('not_computed')
  })
})

describe('recommendation — advice only', () => {
  const c = (severity: ReviewCheck['severity'], status: ReviewCheck['status']): ReviewCheck => ({ code: 'deadline_rush', severity, status, explanation: '' })
  it('any raised high → consider_veto; any raised medium → review_with_managers; else approve', () => {
    expect(recommendationFor([c('high', 'raised'), c('medium', 'raised')])).toBe('consider_veto')
    expect(recommendationFor([c('medium', 'raised'), c('low', 'raised')])).toBe('review_with_managers')
    expect(recommendationFor([c('low', 'raised')])).toBe('approve')
  })
  it('a check that could not run never moves the recommendation', () => {
    expect(recommendationFor([c('high', 'not_computed'), c('medium', 'not_computed')])).toBe('approve')
  })
  it('flags are exactly the raised checks', () => {
    const r = buildTradeReview(facts({ gapPct: { ok: true, value: 48 }, inactiveDays: { ok: true, value: [20, 1] } }))
    expect(r.flags.map((f) => `${f.code}:${f.severity}`)).toEqual(['heavily_lopsided:high', 'inactive_manager:medium'])
    expect(r.recommendation).toBe('consider_veto')
  })
})

describe('dynasty and keeper: a rebuild, not tanking (Guap, 2026-09-27)', () => {
  const tank = { startingBefore: 120, startingDelta: -18, receivedValue: 3000, receivedBenchValue: 2400, sentStarterNames: ['Star Runner'] }
  const sold = (leagueType: { type: string; label: string } | null) =>
    buildTradeReview(facts({ lineup: { ok: true, value: [tank, { ...tank, startingDelta: 4, receivedBenchValue: 0 }] }, leagueType }))

  it('the same measurement raises a MEDIUM rebuild note that asks for a word with the managers, not a veto', () => {
    const r = sold({ type: 'dynasty', label: 'Dynasty' })
    const c = r.checks[1]!
    expect(c).toMatchObject({ code: 'rebuild_signal', severity: 'medium', status: 'raised' })
    expect(c.explanation).toMatch(/^In a dynasty league this reads as a rebuild, which is normal — worth a word with both managers, not a veto\. Alpha's projected starting lineup falls 18\.0 points/)
    expect(r.recommendation).toBe('review_with_managers')
    expect(r.checks.map((x) => x.code)).not.toContain('tanking_signal')
  })

  it('in a one-season league it is still tanking, HIGH', () => {
    for (const lt of [null, { type: 'redraft', label: 'Redraft' }, { type: 'best_ball', label: 'Best Ball' }, { type: 'guillotine', label: 'Guillotine' }]) {
      const r = sold(lt)
      expect(r.checks[1]).toMatchObject({ code: 'tanking_signal', severity: 'high', status: 'raised' })
      expect(r.recommendation).toBe('consider_veto')
    }
  })

  it('every league type that carries rosters over reads it as a rebuild', () => {
    for (const type of ['dynasty', 'keeper', 'devy', 'c2c', 'dynasty_idp']) {
      expect(rebuildIsNormal(type), type).toBe(true)
      expect(sold({ type, label: type }).checks[1]!.code).toBe('rebuild_signal')
    }
    for (const type of ['redraft', 'best_ball', 'salary_cap', 'zombie', '', null]) expect(rebuildIsNormal(type), String(type)).toBe(false)
  })

  it('clear and not-computed carry the rebuild code too, so the six checks read consistently', () => {
    const d = { type: 'keeper', label: 'Keeper' }
    expect(buildTradeReview(facts({ leagueType: d })).checks[1]).toMatchObject({ code: 'rebuild_signal', status: 'clear' })
    expect(buildTradeReview(facts({ leagueType: d, lineup: missing('pending only') })).checks[1]).toMatchObject({ code: 'rebuild_signal', status: 'not_computed' })
  })
})

describe('class gap (2026-10-01)', () => {
  it('uses the same band as league joins', () => {
    expect(CLASS_GAP_LEVELS).toBe(MANAGER_CLASS_BAND)
  })

  it('raises when the managers are more than two levels apart and the value leans to the senior one', () => {
    // + gap means side A (Alpha) receives more; Alpha is Level 14, Bravo Level 6.
    const c = check(facts({ gapPct: { ok: true, value: 18 }, managerLevels: { ok: true, value: [14, 6] } }), 'class_gap')
    expect(c.status).toBe('raised')
    expect(c.severity).toBe('low')
    expect(c.explanation).toContain('Alpha (the more experienced manager) receives 18% more value')
    expect(c.explanation).toContain('8 levels apart')
  })

  it('is clear when the trade leans toward the newer manager, or the gap is inside the even band', () => {
    expect(check(facts({ gapPct: { ok: true, value: -18 }, managerLevels: { ok: true, value: [14, 6] } }), 'class_gap').status).toBe('clear')
    expect(check(facts({ gapPct: { ok: true, value: 9 }, managerLevels: { ok: true, value: [14, 6] } }), 'class_gap').status).toBe('clear')
  })

  it('is clear inside the band, whatever the gap', () => {
    expect(check(facts({ gapPct: { ok: true, value: 35 }, managerLevels: { ok: true, value: [10, 8] } }), 'class_gap').status).toBe('clear')
  })

  it('is not computed — never clear — without both levels, or without a grade', () => {
    expect(check(facts({ managerLevels: undefined }), 'class_gap').status).toBe('not_computed')
    expect(check(facts({ managerLevels: { ok: true, value: [12, null] } }), 'class_gap').status).toBe('not_computed')
    expect(check(facts({ managerLevels: missing('nope') }), 'class_gap').explanation).toBe('nope')
    expect(check(facts({ gapPct: missing('ungraded'), managerLevels: { ok: true, value: [14, 6] } }), 'class_gap').status).toBe('not_computed')
  })

  it('on its own never moves the recommendation off approve', () => {
    const r = buildTradeReview(facts({ gapPct: { ok: true, value: 18 }, managerLevels: { ok: true, value: [14, 6] } }))
    expect(r.flags.map((f) => f.code)).toEqual(['class_gap'])
    expect(r.recommendation).toBe('approve')
  })
})
