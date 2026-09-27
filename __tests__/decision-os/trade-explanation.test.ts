/**
 * The AI explanation layer (design build-order step 4): packet, validator, template and the one
 * model call. No real model is called — the router is injected.
 *
 * The golden receipts follow the design's golden-trade table, minus the commissioner cases (step 6).
 * They are synthetic: the design's frozen fixture from a real league does not exist yet.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: vi.fn(async () => { throw new Error('default router must not be used in tests') }) }))

import type { TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluateTrade'
import {
  allowedNumbers,
  buildExplanationPacket,
  resolvePacketPath,
  verdictForLetter,
  type ExplanationPacket,
} from '@/lib/decision-os/trade/explanationPacket'
import { explainTrade, parseVerdictJson, type ExplainTradeDeps } from '@/lib/decision-os/trade/explainTrade'
import { templateVerdict } from '@/lib/decision-os/trade/templateVerdict'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { TeamBenefit, BenefitSide } from '@/lib/decision-os/trade/teamBenefit'
import type { TradeVerdict } from '@/lib/decision-os/trade/tradeVerdict'
import { validateVerdict } from '@/lib/decision-os/trade/validateVerdict'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASIS = 'Redraft · 1QB · 12 teams · PPR'

function graded(give: Array<[string, number]>, get: Array<[string, number]>): TradeGradeView {
  const lines: TradeGradeLine[] = [
    ...give.map(([name, v]) => ({ side: 'give' as const, name, marketValue: v, leagueValue: v })),
    ...get.map(([name, v]) => ({ side: 'get' as const, name, marketValue: v, leagueValue: v })),
  ]
  const sum = (xs: Array<[string, number]>) => xs.reduce((s, [, v]) => s + v, 0)
  return gradeTrade({
    giveValue: sum(give),
    getValue: sum(get),
    giveMarket: sum(give),
    getMarket: sum(get),
    unpriced: 0,
    giveCount: give.length,
    getCount: get.length,
    basis: BASIS,
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines,
    moves: [],
  })
}

function receipt(grade: TradeGradeView, over: Partial<TradeEvaluationReceipt> = {}): TradeEvaluationReceipt {
  return {
    receiptId: 'rcpt_golden',
    persisted: true,
    persistError: null,
    modelVersion: 'trade-eval-v1',
    surface: 'test',
    evaluatedAt: '2026-10-01T12:00:00.000Z',
    inputHash: 'h',
    leagueId: 'lg_1',
    userId: 'u_1',
    grade,
    partnerGrade: grade,
    assets: grade.graded
      ? grade.lines.map((l) => ({ side: l.side, name: l.name, kind: 'player' as const, marketValue: l.marketValue, leagueValue: l.leagueValue, source: 'fantasycalc', adjustments: [] }))
      : [],
    unpriceable: [],
    canonical: null,
    canonicalError: null,
    stored: null,
    teamBenefit: null,
    teamBenefitRefusal: null,
    designShadow: null,
    ...over,
  }
}

function canonicalWithLineup(deltaA: number, before = 118.4): TradeEvaluationReceipt['canonical'] {
  const impact = (delta: number) => ({
    unit: 'league_points_week' as const,
    week: 6,
    startingPointsBefore: before,
    startingPointsAfter: Math.round((before + delta) * 10) / 10,
    startingPointsDelta: delta,
    blockedReason: null,
    unpricedExcluded: 0,
    depth: [],
    replacement: [],
  })
  const participant = (rosterId: string, delta: number) => ({
    rosterId,
    action: 'accept' as const,
    recommendation: 'x',
    fairnessScore: 50,
    confidenceScore: 80,
    coverageStatus: 'complete' as const,
    coveragePct: 100,
    rosterImpact: impact(delta),
    memoVersion: null,
  })
  return { proposerRosterId: 'r1', receiverRosterId: 'r2', participants: [participant('r1', deltaA), participant('r2', -deltaA)] }
}

function side(over: Partial<BenefitSide> = {}): BenefitSide {
  return { teamId: 'r1', receives: [], packageReceived: 50, forcedDrops: [], lineupDeltaPerWeek: 0, lineupBeforePerWeek: 120, grade: 'C', ...over }
}

function benefit(a: Partial<BenefitSide>, b: Partial<BenefitSide>): TeamBenefit {
  return {
    model: 'team-benefit-v1-uncalibrated',
    horizon: { currentWeek: 6, finalWeek: 17, playoffStartWeek: 15, weeks: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], playoffWeeks: [15, 16, 17], approximation: 'One per-game rate is used for every remaining week.' },
    sides: [side({ teamId: 'r1', ...a }), side({ teamId: 'r2', ...b })],
    gapPct: 31,
    fairnessLabel: 'lopsided',
    notes: [],
  }
}

const asset = (name: string, position: string, extra: Partial<BenefitSide['receives'][number]> = {}) => ({
  playerId: name.toLowerCase().replace(/\s/g, '_'),
  name,
  position,
  value: 60,
  vorp: 12,
  rosPoints: 142.5,
  marketValue: 5000,
  injuryStatus: null,
  byeInPlayoffs: false,
  ...extra,
})

const GOLDEN: Record<string, TradeEvaluationReceipt> = {
  'star RB for a bench WR (heavily lopsided)': receipt(graded([['Star Runner', 8000]], [['Bench Wideout', 1500]]), {
    canonical: canonicalWithLineup(-11.6),
  }),
  'even swap, same position': receipt(graded([['Wide One', 5000]], [['Wide Two', 5100]])),
  '2-for-1 consolidation with a forced drop': receipt(graded([['Depth Back', 3000], ['Flex Wideout', 2500]], [['Elite Receiver', 6000]]), {
    canonical: canonicalWithLineup(4.2),
    teamBenefit: benefit(
      { lineupDeltaPerWeek: 4.2, receives: [asset('Elite Receiver', 'WR')] },
      { lineupDeltaPerWeek: -4.2, receives: [asset('Depth Back', 'RB'), asset('Flex Wideout', 'WR')], forcedDrops: [{ playerId: 'k1', name: 'Spare Kicker', value: 3 }] },
    ),
  }),
  'star who is Out for 3 weeks': receipt(graded([['Steady Back', 5200]], [['Hurt Star', 6100]]), {
    teamBenefit: benefit({ lineupDeltaPerWeek: 1.8, receives: [asset('Hurt Star', 'RB', { injuryStatus: 'Out' })] }, { lineupDeltaPerWeek: -1.8, receives: [asset('Steady Back', 'RB')] }),
  }),
  'player on bye in the fantasy semifinal': receipt(graded([['Tight End One', 3000]], [['Tight End Two', 3100]]), {
    teamBenefit: benefit({ lineupDeltaPerWeek: 0.4, receives: [asset('Tight End Two', 'TE', { byeInPlayoffs: true })] }, { receives: [asset('Tight End One', 'TE')] }),
  }),
  'fair on paper but fills a hole': receipt(graded([['Spare Receiver', 4000]], [['Starting Tight End', 5400]]), {
    canonical: canonicalWithLineup(7.5),
  }),
  'unpriceable player in the trade': receipt({ graded: false, reason: 'Nobody Special could not be priced in this league.', basis: BASIS }, {
    unpriceable: ['Nobody Special'],
  }),
}

// ─── The packet ──────────────────────────────────────────────────────────────

describe('explanation packet', () => {
  it('fixes the verdict from the letter: A/B accept, C fair_either_way, D counter, F decline', () => {
    expect(['A', 'B', 'C', 'D', 'F'].map((l) => verdictForLetter(l as never))).toEqual([
      'accept', 'accept', 'fair_either_way', 'counter', 'decline',
    ])
  })

  it('copies the ONE grade — both letters, from the receipt', () => {
    const p = buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!)
    expect(p.fixed.grades).toEqual({ teamA: 'F', teamB: 'A' })
    expect(p.fixed.verdict).toBe('decline')
    expect(p.counter.allowed).toBe(true)
    const even = buildExplanationPacket(GOLDEN['even swap, same position']!)
    expect(even.fixed).toMatchObject({ grades: { teamA: 'C', teamB: 'C' }, verdict: 'fair_either_way' })
    expect(even.counter.allowed).toBe(false)
  })

  it("carries the shadow model's facts but NONE of its judgements", () => {
    // Its gap, fairness label and 60/40 letter can disagree with the grade a manager sees.
    const json = JSON.stringify(buildExplanationPacket(GOLDEN['2-for-1 consolidation with a forced drop']!))
    for (const judgement of ['fairnessLabel', 'lopsided', 'designLetter', 'packageReceived', '"gapPct":31', 'uncalibrated']) {
      expect(json).not.toContain(judgement)
    }
    expect(json).toContain('Spare Kicker')
  })

  it('names the risks the data shows: forced drop, injury, playoff bye, unpriced asset', () => {
    expect(buildExplanationPacket(GOLDEN['2-for-1 consolidation with a forced drop']!).riskCandidates.join('|')).toMatch(/forced drop: Team B must drop Spare Kicker/)
    expect(buildExplanationPacket(GOLDEN['star who is Out for 3 weeks']!).riskCandidates.join('|')).toMatch(/injury: Team A receives Hurt Star, listed Out/)
    expect(buildExplanationPacket(GOLDEN['player on bye in the fantasy semifinal']!).riskCandidates.join('|')).toMatch(/playoff bye: Tight End Two/)
    expect(buildExplanationPacket(GOLDEN['unpriceable player in the trade']!).riskCandidates.join('|')).toMatch(/Nobody Special/)
  })

  it('always has a risk to name, even when the data shows none', () => {
    expect(buildExplanationPacket(GOLDEN['even swap, same position']!).riskCandidates).toHaveLength(1)
  })

  it('confidence: an injured star is not "high"; a withheld grade is "low"', () => {
    expect(buildExplanationPacket(GOLDEN['star who is Out for 3 weeks']!).fixed.confidence).toBe('medium')
    expect(buildExplanationPacket(GOLDEN['unpriceable player in the trade']!).fixed.confidence).toBe('low')
    expect(buildExplanationPacket(GOLDEN['fair on paper but fills a hole']!).fixed.confidence).toBe('high')
  })

  it('resolves citation paths, and an invented one is undefined', () => {
    const p = buildExplanationPacket(GOLDEN['2-for-1 consolidation with a forced drop']!)
    expect(resolvePacketPath(p, 'assets.teamASends[1].leagueValue')).toBe(2500)
    expect(resolvePacketPath(p, 'seasonOutlook.teamB.forcedDrops[0].name')).toBe('Spare Kicker')
    expect(resolvePacketPath(p, 'values.teamAReceives')).toBe(6000)
    expect(resolvePacketPath(p, 'values.fairnessScore')).toBeUndefined()
    expect(resolvePacketPath(p, 'assets.teamASends[9].leagueValue')).toBeUndefined()
  })

  it('counter assets include the named roster players', () => {
    const p = buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!, { rosterNames: { teamB: ['Bench Tight End'] } })
    expect(p.counter.assetNames).toEqual(expect.arrayContaining(['Star Runner', 'Bench Wideout', 'Bench Tight End']))
  })

  it('allowed numbers skip the receipt id', () => {
    const p = buildExplanationPacket(receipt(graded([['A', 1000]], [['B', 1000]]), { receiptId: 'rcpt_987654' }))
    expect(allowedNumbers(p)).not.toContain(987654)
  })
})

// ─── Template ────────────────────────────────────────────────────────────────

describe('template verdict', () => {
  it.each(Object.keys(GOLDEN))('passes the SAME validator as the model: %s', (name) => {
    const p = buildExplanationPacket(GOLDEN[name]!)
    const v = templateVerdict(p)
    const checked = validateVerdict(v, p)
    expect(checked.ok ? [] : checked.violations).toEqual([])
  })

  it('leads with lineup impact when there is any', () => {
    const v = templateVerdict(buildExplanationPacket(GOLDEN['fair on paper but fills a hole']!))
    expect(v.reasons[0]!.evidence).toEqual(['lineup.teamA.startingPointsDelta'])
    expect(v.reasons[0]!.text).toMatch(/rises by 7\.5 points in week 6/)
    expect(v.grades).toEqual([{ teamId: 'teamA', grade: 'A' }, { teamId: 'teamB', grade: 'F' }])
  })

  it('a withheld grade gets no letter, no verdict, and the missing asset by name', () => {
    const v = templateVerdict(buildExplanationPacket(GOLDEN['unpriceable player in the trade']!))
    expect(v.verdict).toBeNull()
    expect(v.grades).toEqual([])
    expect(JSON.stringify(v)).toContain('Nobody Special')
  })
})

// ─── Validator: every rule, each shown to fail ───────────────────────────────

describe('validateVerdict', () => {
  const p = buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!, { rosterNames: { teamB: ['Bench Tight End'] } })
  const good = (): TradeVerdict => JSON.parse(JSON.stringify(templateVerdict(p)))
  const violationsOf = (v: unknown, packet: ExplanationPacket = p) => {
    const r = validateVerdict(v, packet)
    return r.ok ? [] : r.violations
  }

  it('the baseline answer passes (so every failure below is the mutation)', () => {
    expect(violationsOf(good())).toEqual([])
  })

  it('rejects a changed grade', () => {
    const v = good()
    v.grades[0]!.grade = 'D'
    expect(violationsOf(v).join()).toMatch(/grades must be exactly/)
  })

  it('rejects a changed verdict', () => {
    expect(violationsOf({ ...good(), verdict: 'counter' }).join()).toMatch(/verdict must be "decline"/)
  })

  it('rejects a changed confidence', () => {
    expect(violationsOf({ ...good(), confidence: p.fixed.confidence === 'high' ? 'low' : 'high' }).join()).toMatch(/confidence must be/)
  })

  it('rejects an unknown key (strict schema)', () => {
    expect(violationsOf({ ...good(), fairnessScore: 12 }).join()).toMatch(/schema/)
  })

  it('rejects a number the packet does not hold, and accepts a rounded one', () => {
    const v = good()
    v.reasons[1] = { text: 'Star Runner projects 23 points a week.', evidence: ['assets.teamASends[0].leagueValue'] }
    expect(violationsOf(v).join()).toMatch(/number 23 is not in the packet/)
    v.reasons[1] = { text: 'Team A sends 8,000 and its lineup falls by 12 points.', evidence: ['values.teamASends'] }
    expect(violationsOf(v)).toEqual([]) // 8,000 exact; 12 is -11.6 rounded
  })

  it('rejects an evidence path that is not in the packet, and a reason with none', () => {
    const v = good()
    v.reasons[1]!.evidence = ['values.winProbability']
    expect(violationsOf(v).join()).toMatch(/"values.winProbability" is not in the packet/)
    v.reasons[1]!.evidence = []
    expect(violationsOf(v).join()).toMatch(/cites no evidence/)
  })

  it('rejects fewer than 2 or more than 4 reasons', () => {
    const v = good()
    expect(violationsOf({ ...v, reasons: v.reasons.slice(0, 1) }).join()).toMatch(/need 2 to 4/)
    expect(violationsOf({ ...v, reasons: [...v.reasons, ...v.reasons, ...v.reasons] }).join()).toMatch(/need 2 to 4/)
  })

  it('rejects an answer that does not lead with lineup impact when there is some', () => {
    const v = good()
    v.reasons.reverse()
    expect(violationsOf(v).join()).toMatch(/must lead with Team A's lineup impact/)
  })

  it('rejects an answer with no risk', () => {
    expect(violationsOf({ ...good(), risks: [] }).join()).toMatch(/at least one/)
  })

  it('allows a counter at a 10%+ gap with rostered assets only', () => {
    expect(violationsOf({ ...good(), counter: { add: ['Bench Tight End'], remove: [], why: 'It closes some of the gap.' } })).toEqual([])
    expect(violationsOf({ ...good(), counter: { add: ['Somebody Else'], remove: [], why: 'x' } }).join()).toMatch(/"Somebody Else" is not an asset/)
  })

  it('rejects a counter when the gap is under 10%', () => {
    const even = buildExplanationPacket(GOLDEN['even swap, same position']!)
    const v = { ...templateVerdict(even), counter: { add: ['Wide One'], remove: [], why: 'x' } }
    expect(violationsOf(v, even).join()).toMatch(/counter: not allowed/)
  })

  it.each(['This is a lock for Team A.', 'The odds favour Team B.', 'A guaranteed win.', 'Easy bet to take.', 'Free money here.'])(
    'rejects betting/certainty language: %s',
    (headline) => {
      expect(violationsOf({ ...good(), headline }).join()).toMatch(/betting\/certainty language/)
    },
  )

  it('does not mistake a name for betting language', () => {
    expect(violationsOf({ ...good(), headline: 'Team A sends Tyler Lockett-style depth; decline.' })).toEqual([])
  })

  it('rejects a headline over 280 characters', () => {
    expect(violationsOf({ ...good(), headline: 'x'.repeat(281) }).join()).toMatch(/limit is 280/)
  })

  it('rejects a letter grade in the text that the engine did not give', () => {
    expect(violationsOf({ ...good(), headline: 'Team A deserves a grade of B here.' }).join()).toMatch(/states a grade of B/)
    expect(violationsOf({ ...good(), headline: 'Team A takes an F grade on this one.' })).toEqual([])
  })
})

// ─── The one model call ──────────────────────────────────────────────────────

describe('explainTrade', () => {
  const lopsided = GOLDEN['star RB for a bench WR (heavily lopsided)']!
  const answer = (v: TradeVerdict) => ({ ok: true as const, text: JSON.stringify(v), model: 'm', provider: 'anthropic' as const, tokensUsed: 1 })
  const deps = (route: ExplainTradeDeps['route'], over: Partial<ExplainTradeDeps> = {}): Partial<ExplainTradeDeps> => ({
    route,
    spendEnabled: () => true,
    preferredProvider: () => 'anthropic',
    ...over,
  })

  it('a withheld grade makes NO call and answers with the template', async () => {
    const route = vi.fn()
    const out = await explainTrade({ receipt: GOLDEN['unpriceable player in the trade']! }, deps(route))
    expect(route).not.toHaveBeenCalled()
    expect(out).toMatchObject({ source: 'template', templateReason: 'withheld', attempts: 0 })
  })

  it('spend off makes NO call and says so', async () => {
    const route = vi.fn()
    const out = await explainTrade({ receipt: lopsided }, deps(route, { spendEnabled: () => false }))
    expect(route).not.toHaveBeenCalled()
    expect(out).toMatchObject({ source: 'template', templateReason: 'spend_disabled', attempts: 0 })
  })

  it("uses a valid answer on the first try, routed on trade_eval's provider, with the packet and no tools", async () => {
    const good = templateVerdict(buildExplanationPacket(lopsided))
    const route = vi.fn(async () => answer({ ...good, headline: 'Decline: Team A gives up far more league value than it gets.' }))
    const out = await explainTrade({ receipt: lopsided }, deps(route))
    expect(out).toMatchObject({ source: 'ai', attempts: 1, provider: 'anthropic', receiptId: 'rcpt_golden' })
    expect(out.verdict.headline).toMatch(/^Decline:/)
    const args = route.mock.calls[0]![0]
    expect(args.preferredProvider).toBe('anthropic')
    expect(args).not.toHaveProperty('tools')
    expect(args.messages).toHaveLength(2)
    expect(args.messages[1]!.content).toContain('"receiptId":"rcpt_golden"')
  })

  it('retries ONCE with the violations, in ONE user message that still carries the packet', async () => {
    const good = templateVerdict(buildExplanationPacket(lopsided))
    const route = vi
      .fn()
      .mockResolvedValueOnce(answer({ ...good, verdict: 'accept' }))
      .mockResolvedValueOnce(answer(good))
    const out = await explainTrade({ receipt: lopsided }, deps(route))
    expect(out).toMatchObject({ source: 'ai', attempts: 2 })
    const retry = route.mock.calls[1]![0]
    // The Anthropic adapter only sends the LAST user message — so it must hold everything.
    expect(retry.messages).toHaveLength(2)
    expect(retry.messages[1].content).toContain('"receiptId":"rcpt_golden"')
    expect(retry.messages[1].content).toContain('verdict must be "decline"')
  })

  it('falls back to the template after two invalid answers', async () => {
    const good = templateVerdict(buildExplanationPacket(lopsided))
    const route = vi.fn(async () => answer({ ...good, headline: 'A lock: Team A loses 99 points.' }))
    const out = await explainTrade({ receipt: lopsided }, deps(route))
    expect(route).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ source: 'template', templateReason: 'invalid_output', attempts: 2 })
    expect(out.violations.join()).toMatch(/99/)
    expect(validateVerdict(out.verdict, buildExplanationPacket(lopsided)).ok).toBe(true)
  })

  it('falls back when every provider fails, or the router throws', async () => {
    expect(await explainTrade({ receipt: lopsided }, deps(vi.fn(async () => ({ ok: false as const }))))).toMatchObject({ source: 'template', templateReason: 'provider_failed', attempts: 1 })
    expect(await explainTrade({ receipt: lopsided }, deps(vi.fn(() => { throw new Error('boom') })))).toMatchObject({ source: 'template', templateReason: 'provider_failed' })
  })

  it('reads JSON inside a code fence, and rejects prose', () => {
    expect(parseVerdictJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseVerdictJson('I think this trade is fair.')).toBeNull()
  })
})

// ─── Commissioner review mode (design step 6) ────────────────────────────────

describe('commissioner mode — the AI explains the code-computed review and changes nothing', () => {
  const review = {
    model: 'trade-review-v1' as const,
    recommendation: 'consider_veto' as const,
    flags: [{ code: 'heavily_lopsided' as const, severity: 'high' as const, explanation: 'Team B receives 81% more league value.' }],
    checks: [
      { code: 'heavily_lopsided' as const, severity: 'high' as const, status: 'raised' as const, explanation: 'Team B receives 81% more league value.' },
      { code: 'eliminated_team_dumping' as const, severity: 'medium' as const, status: 'not_computed' as const, explanation: 'No season forecast has been run for this league.' },
    ],
  }
  const p = buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!, { commissionerReview: review })
  const violationsOf = (v: unknown, packet: ExplanationPacket = p) => {
    const r = validateVerdict(v, packet)
    return r.ok ? [] : r.violations
  }

  it('the packet carries the review fixed, and names what could not be checked', () => {
    expect(p.commissioner).toEqual({
      recommendation: 'consider_veto',
      flags: [{ code: 'heavily_lopsided', severity: 'high', explanation: 'Team B receives 81% more league value.' }],
      notComputed: [{ code: 'eliminated_team_dumping', reason: 'No season forecast has been run for this league.' }],
    })
    expect(buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!).commissioner).toBeNull()
  })

  it('the template copies the review and passes the same validator', () => {
    const v = templateVerdict(p)
    expect(v.commissioner).toMatchObject({ recommendation: 'consider_veto', flags: [{ code: 'heavily_lopsided', severity: 'high' }] })
    expect(v.commissioner?.noteToLeague).toMatch(/heavily lopsided/)
    expect(violationsOf(v)).toEqual([])
  })

  it('rejects an answer that drops, softens or adds to the review', () => {
    const good = templateVerdict(p)
    expect(violationsOf({ ...good, commissioner: undefined }).join()).toMatch(/commissioner: required/)
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, recommendation: 'approve' } }).join()).toMatch(/recommendation must be "consider_veto"/)
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, flags: [] } }).join()).toMatch(/commissioner\.flags must be exactly/)
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, flags: [...good.commissioner!.flags, { code: 'tanking_signal', severity: 'high' }] } }).join()).toMatch(/commissioner\.flags/)
  })

  it('holds the note to the same rules: packet numbers only, no betting language', () => {
    const good = templateVerdict(p)
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, noteToLeague: 'Team B gains 95% here.' } }).join()).toMatch(/number 95 is not in the packet/)
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, noteToLeague: 'Team B gains 81% here.' } })).toEqual([])
    expect(violationsOf({ ...good, commissioner: { ...good.commissioner!, noteToLeague: 'This is a lock to be vetoed.' } }).join()).toMatch(/betting/)
  })

  it('the note advises: it never announces the outcome or accuses anyone', () => {
    const good = templateVerdict(p)
    const note = (noteToLeague: string) => violationsOf({ ...good, commissioner: { ...good.commissioner!, noteToLeague } }).join()
    for (const bad of [
      'This trade will be vetoed.',
      'The deal is going to be reversed by the commissioner.',
      'This looks like collusion between the two teams.',
      'Bravo is colluding with Alpha.',
      'Someone is cheating here.',
    ]) {
      expect(note(bad), bad).toMatch(/advises only/)
    }
    // Naming the recommendation is the point, and is allowed.
    expect(note('The commissioner may want to consider a veto after talking to both managers.')).toBe('')
    expect(note(good.commissioner!.noteToLeague!)).toBe('')
  })

  it('a manager’s explanation may not carry a commissioner block', () => {
    const manager = buildExplanationPacket(GOLDEN['star RB for a bench WR (heavily lopsided)']!)
    const v = { ...templateVerdict(manager), commissioner: { recommendation: 'approve', flags: [] } }
    expect(violationsOf(v, manager).join()).toMatch(/commissioner: not allowed/)
  })
})
