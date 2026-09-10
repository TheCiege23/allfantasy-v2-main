import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_COEFFICIENTS,
  luckAdjustedWinRate,
  observeWindow,
  resolveCompetitiveWindow,
  settleWindow,
  WINDOW_PERSISTENCE_WEEKS,
  type TeamWindowFacts,
  type DynastyWindowFacts,
  type WindowState,
} from '@/lib/decision-os/value-v2/window'

const base: DynastyWindowFacts = {
  format: 'dynasty' as const,
  teamId: 't1',
  leagueId: 'l1',
  season: 2026,
  week: 10,
  wins: 5,
  losses: 5,
  ties: 0,
  luckWins: 0,
  playoffProbability: 0.5,
  rosterStrength3Year: 0.5,
  futurePickCapital: null,
  pickTreatment: 'included-in-roster-strength',
  unavailableShare: 0,
  injuryTreatment: 'excluded',
}

/*
 * ⚠ TYPED AS THE DYNASTY MEMBER, NOT THE UNION. `Partial<TeamWindowFacts>` over a discriminated
 * union accepts fields from EITHER arm, which would let a redraft key be spread into a dynasty
 * fixture and typecheck — the exact mixing the split exists to prevent.
 */
const facts = (over: Partial<DynastyWindowFacts> = {}): DynastyWindowFacts => ({ ...base, ...over })

describe('resolveCompetitiveWindow refuses rather than defaulting', () => {
  it('returns null instead of the legacy fall-through to Competitive', () => {
    const r = resolveCompetitiveWindow(facts({ playoffProbability: null }))
    expect(r.status).toBeNull()
    expect(r.nowScore).toBeNull()
    expect(r.gaps).toContain('playoff_probability_missing')
  })

  it('names every missing input separately', () => {
    const r = resolveCompetitiveWindow(facts({
      luckWins: null, playoffProbability: null, rosterStrength3Year: null,
      unavailableShare: null,
    }))
    expect(r.status).toBeNull()
    expect(r.gaps).toEqual(expect.arrayContaining([
      'record_or_schedule_luck_missing',
      'playoff_probability_missing',
      'roster_strength_3y_missing',
      'injury_share_missing',
    ]))
  })

  it('refuses an out-of-range probability instead of clamping it', () => {
    expect(resolveCompetitiveWindow(facts({ playoffProbability: 1.4 })).status).toBeNull()
    expect(resolveCompetitiveWindow(facts({ rosterStrength3Year: -0.1 })).status).toBeNull()
  })

  it('refuses a team with no games played', () => {
    const r = resolveCompetitiveWindow(facts({ wins: 0, losses: 0, ties: 0 }))
    expect(r.status).toBeNull()
    expect(r.gaps).toContain('record_or_schedule_luck_missing')
  })

  it('refuses coefficients whose blends do not sum to one', () => {
    const r = resolveCompetitiveWindow(facts(), { ...DEFAULT_WINDOW_COEFFICIENTS, nowRecord: 0.9 })
    expect(r.status).toBeNull()
    expect(r.gaps).toEqual(['window_coefficients_invalid'])
  })

  it('resolves fully when every input is present', () => {
    const r = resolveCompetitiveWindow(facts())
    expect(r.status).toBe('competitive')
    expect(r.gaps).toEqual([])
    expect(r.coefficients.calibration).toBe('uncalibrated-structural')
  })
})

describe('schedule luck separates a lucky record from a good team', () => {
  it('gives a lucky 7-3 and an unlucky 3-7 the same earned rate and window', () => {
    const lucky = facts({ wins: 7, losses: 3, luckWins: 2 })
    const unlucky = facts({ wins: 3, losses: 7, luckWins: -2 })
    expect(luckAdjustedWinRate(lucky)).toBeCloseTo(0.5, 10)
    expect(luckAdjustedWinRate(unlucky)).toBeCloseTo(0.5, 10)
    const a = resolveCompetitiveWindow(lucky)
    const b = resolveCompetitiveWindow(unlucky)
    expect(a.nowScore).toBeCloseTo(b.nowScore!, 10)
    expect(a.status).toBe(b.status)
  })

  it('does not treat the raw record as the earned record', () => {
    const raw = facts({ wins: 7, losses: 3, luckWins: 0 })
    const lucky = facts({ wins: 7, losses: 3, luckWins: 2 })
    expect(luckAdjustedWinRate(raw)).toBeCloseTo(0.7, 10)
    expect(luckAdjustedWinRate(lucky)).toBeCloseTo(0.5, 10)
  })

  it('clamps an impossible earned rate into the unit interval', () => {
    expect(luckAdjustedWinRate(facts({ wins: 10, losses: 0, luckWins: -5 }))).toBe(1)
    expect(luckAdjustedWinRate(facts({ wins: 0, losses: 10, luckWins: 5 }))).toBe(0)
  })

  it('counts a tie as half a win', () => {
    expect(luckAdjustedWinRate(facts({ wins: 4, losses: 4, ties: 2, luckWins: 0 }))).toBeCloseTo(0.5, 10)
  })
})

describe('injury treatment cannot double-count an absence', () => {
  it('leaves the score untouched when the forecast already priced injuries', () => {
    const included = resolveCompetitiveWindow(facts({ unavailableShare: 0.4, injuryTreatment: 'included-in-playoff-probability' }))
    const healthy = resolveCompetitiveWindow(facts({ unavailableShare: 0, injuryTreatment: 'included-in-playoff-probability' }))
    expect(included.nowScore).toBeCloseTo(healthy.nowScore!, 10)
  })

  it('discounts only the forward term when the forecast excluded them', () => {
    const injured = resolveCompetitiveWindow(facts({ unavailableShare: 0.4, injuryTreatment: 'excluded' }))
    const healthy = resolveCompetitiveWindow(facts({ unavailableShare: 0, injuryTreatment: 'excluded' }))
    expect(injured.nowScore!).toBeLessThan(healthy.nowScore!)
    // The historical record term is untouched: only the playoff half moves.
    const c = DEFAULT_WINDOW_COEFFICIENTS
    expect(healthy.nowScore! - injured.nowScore!).toBeCloseTo(c.nowPlayoffProbability * 0.5 * 0.4, 10)
  })
})

describe('future pick capital cannot be counted twice', () => {
  it('refuses picks supplied alongside a strength figure that already contains them', () => {
    // DynastyProjectionSnapshot.projectedStrength3Years is produced by
    // estimateLongTermStrength(rosterValue, pickValue, ctx) — picks are in it.
    const r = resolveCompetitiveWindow(facts({ futurePickCapital: 0.9 }))
    expect(r.status).toBeNull()
    expect(r.gaps).toContain('future_pick_capital_double_counted')
  })

  it('uses roster strength alone as the future score on that path', () => {
    expect(resolveCompetitiveWindow(facts({ rosterStrength3Year: 0.73 })).futureScore).toBeCloseTo(0.73, 10)
  })

  it('blends both only when the caller declares a pick-free strength figure', () => {
    const r = resolveCompetitiveWindow(facts({
      pickTreatment: 'separate', rosterStrength3Year: 0.8, futurePickCapital: 0.4,
    }))
    const c = DEFAULT_WINDOW_COEFFICIENTS
    expect(r.futureScore).toBeCloseTo(c.futureRosterStrength * 0.8 + c.futurePickCapital * 0.4, 10)
  })

  it('requires the pick figure once the caller declares it separate', () => {
    const r = resolveCompetitiveWindow(facts({ pickTreatment: 'separate' }))
    expect(r.status).toBeNull()
    expect(r.gaps).toContain('future_pick_capital_missing')
  })
})

describe('classification bands', () => {
  const strong = { wins: 9, losses: 1, luckWins: 0, playoffProbability: 0.95 }

  it('requires both halves to be strong for contender', () => {
    expect(resolveCompetitiveWindow(facts({ ...strong, rosterStrength3Year: 0.9 })).status).toBe('contender')
    expect(resolveCompetitiveWindow(facts({ ...strong, rosterStrength3Year: 0.2 })).status).toBe('declining')
  })

  it('classifies a weak now and weak future as rebuilding', () => {
    expect(resolveCompetitiveWindow(facts({
      wins: 1, losses: 9, luckWins: 0, playoffProbability: 0.02,
      rosterStrength3Year: 0.2,
    })).status).toBe('rebuilding')
  })

  it('classifies a weak now with a strong future as rising', () => {
    expect(resolveCompetitiveWindow(facts({
      wins: 3, losses: 7, luckWins: 0, playoffProbability: 0.15,
      rosterStrength3Year: 0.8,
    })).status).toBe('rising')
  })

  it('improving every input cannot leave a team rebuilding', () => {
    const bad = facts({ wins: 1, losses: 9, luckWins: 0, playoffProbability: 0.02, rosterStrength3Year: 0.2 })
    expect(resolveCompetitiveWindow(bad).status).toBe('rebuilding')
    const better = { ...bad, wins: 8, losses: 2, playoffProbability: 0.9, rosterStrength3Year: 0.9 }
    expect(resolveCompetitiveWindow(better).status).not.toBe('rebuilding')
  })

  it('is monotonic: raising future strength never lowers the future score', () => {
    let previous = -Infinity
    for (const s of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const score = resolveCompetitiveWindow(facts({ rosterStrength3Year: s })).futureScore!
      expect(score).toBeGreaterThanOrEqual(previous)
      previous = score
    }
  })

  it('is monotonic: raising the earned record never lowers the present score', () => {
    let previous = -Infinity
    for (const w of [0, 2, 4, 6, 8, 10]) {
      const score = resolveCompetitiveWindow(facts({ wins: w, losses: 10 - w, luckWins: 0 })).nowScore!
      expect(score).toBeGreaterThanOrEqual(previous)
      previous = score
    }
  })
})

const seeded = (over: Partial<WindowState> = {}): WindowState => ({
  active: 'contender', activeScore: 0.8, revision: 1, pending: null, ...over,
})

const rebuildish = facts({
  wins: 1, losses: 9, luckWins: 0, playoffProbability: 0.02,
  rosterStrength3Year: 0.2,
})

describe('hysteresis', () => {
  it('does not flip on one bad week', () => {
    const s = observeWindow(seeded(), { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    expect(s.pending?.observations).toBe(1)
    expect(settleWindow(s).active).toBe('contender')
    expect(settleWindow(s).revision).toBe(1)
  })

  it('flips only after three consecutive observed weeks', () => {
    let s = seeded()
    for (const week of [11, 12, 13]) {
      s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week })
      if (week < 13) expect(settleWindow(s).active).toBe('contender')
    }
    expect(s.pending?.observations).toBe(WINDOW_PERSISTENCE_WEEKS)
    const settled = settleWindow(s)
    expect(settled.active).toBe('rebuilding')
    expect(settled.revision).toBe(2)
    expect(settled.pending).toBeNull()
    expect(settled.activeScore).toBeCloseTo(resolveCompetitiveWindow(rebuildish).nowScore!, 10)
  })

  it('three unlucky losses do not move the window at all', () => {
    // The team keeps outscoring the league; the schedule is what beat it, so the
    // earned record never drops and no rebuild observation is ever produced.
    let s = seeded({ active: 'contender', activeScore: 0.8 })
    for (const week of [11, 12, 13]) {
      const unlucky = facts({ wins: 7, losses: 3 + (week - 10), luckWins: -(week - 10), playoffProbability: 0.9, rosterStrength3Year: 0.85 })
      const r = resolveCompetitiveWindow(unlucky)
      expect(r.status).toBe('contender')
      s = observeWindow(s, { resolution: r, week })
    }
    expect(s.pending).toBeNull()
    expect(settleWindow(s).active).toBe('contender')
    expect(settleWindow(s).revision).toBe(1)
  })

  it('resets the run when a week breaks the sequence', () => {
    let s = seeded()
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 13 })
    expect(s.pending?.observations).toBe(1)
    expect(s.pending?.firstWeek).toBe(13)
    expect(settleWindow(s).active).toBe('contender')
  })

  it('clears the proposal when the team returns to its active window', () => {
    let s = seeded()
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    expect(s.pending).not.toBeNull()
    const contender = facts({ wins: 9, losses: 1, luckWins: 0, playoffProbability: 0.95, rosterStrength3Year: 0.9 })
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(contender), week: 12 })
    expect(s.pending).toBeNull()
  })

  it('cannot advance persistence by replaying an earlier week', () => {
    let s = seeded()
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 10 })
    expect(s.pending?.observations).toBe(1)
  })

  it('treats an unresolved week as no evidence, not as stability', () => {
    let s = seeded()
    s = observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 11 })
    const unresolved = resolveCompetitiveWindow(facts({ playoffProbability: null }))
    const after = observeWindow(s, { resolution: unresolved, week: 12 })
    expect(after.pending?.observations).toBe(1)
    expect(after.pending?.lastWeek).toBe(11)
  })

  it('rejects a non-integer or zero week', () => {
    const s = seeded()
    expect(observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 0 })).toEqual(s)
    expect(observeWindow(s, { resolution: resolveCompetitiveWindow(rebuildish), week: 1.5 })).toEqual(s)
  })

  it('holds a boundary crossing inside the deadband', () => {
    // A window whose present strength has barely moved cannot propose a new one.
    const drifted = resolveCompetitiveWindow(facts({ wins: 5, losses: 5, luckWins: 0, playoffProbability: 0.5, rosterStrength3Year: 0.9 }))
    expect(drifted.status).toBe('rising')
    const s = observeWindow(seeded({ active: 'competitive', activeScore: drifted.nowScore! - 0.01 }), { resolution: drifted, week: 11 })
    expect(s.pending).toBeNull()
  })

  it('accepts the same crossing once the present strength has materially moved', () => {
    const drifted = resolveCompetitiveWindow(facts({ wins: 5, losses: 5, luckWins: 0, playoffProbability: 0.5, rosterStrength3Year: 0.9 }))
    const s = observeWindow(seeded({ active: 'competitive', activeScore: drifted.nowScore! - 0.2 }), { resolution: drifted, week: 11 })
    expect(s.pending?.status).toBe('rising')
  })
})
