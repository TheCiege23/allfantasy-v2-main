import { describe, expect, it } from 'vitest'
import { compoundDecision, splitDecisionClauses, unansweredClausesNote } from '@/lib/chimmy/decisionClauses'

describe('compoundDecision', () => {
  it.each([
    [
      "Should I start Ja'Marr Chase or Justin Jefferson, and should I trade Travis Kelce for Brock Bowers?",
      "Should I start Ja'Marr Chase or Justin Jefferson",
      [{ clause: 'should I trade Travis Kelce for Brock Bowers?', kind: 'trade' }],
    ],
    [
      'Should I trade Kyren Williams for Garrett Wilson? Also should I add Jaylen Warren and drop Tyjae Spears?',
      'Should I trade Kyren Williams for Garrett Wilson?',
      [{ clause: 'Also should I add Jaylen Warren and drop Tyjae Spears?', kind: 'waiver' }],
    ],
    [
      'Should I trade Kyren Williams for Garrett Wilson. Who should I start at flex?',
      'Should I trade Kyren Williams for Garrett Wilson.',
      [{ clause: 'Who should I start at flex?', kind: 'lineup' }],
    ],
    [
      "Grade this trade: Kelce for Bowers; should I start Ja'Marr Chase or Justin Jefferson?",
      'Grade this trade: Kelce for Bowers;',
      [{ clause: "should I start Ja'Marr Chase or Justin Jefferson?", kind: 'lineup' }],
    ],
  ])('splits %s', (question, primary, others) => {
    expect(compoundDecision(question)).toEqual({ primary, others })
  })

  it.each([
    // "and" joining players, not questions.
    "Should I trade Travis Kelce and Brock Bowers for Ja'Marr Chase?",
    'Should I add Jaylen Warren and drop Tyjae Spears?',
    // One lineup decision with two verbs.
    "Should I start Ja'Marr Chase and bench Travis Kelce?",
    // Periods inside names.
    'Should I trade Amon-Ra St. Brown for Puka Nacua?',
    'Should I trade Tyrone Tracy Jr. and a 2027 1st for Puka Nacua?',
    // A follow-up that is not itself a decision.
    'Should I accept this trade? What about for the playoffs?',
    'Thanks! Should I start Chase or Jefferson?',
    // Not a decision at all.
    'How does waiver priority work? What is FAAB?',
  ])('does not split %s', (question) => {
    expect(compoundDecision(question)).toBeNull()
  })

  it('keeps every clause, decision or not, in order', () => {
    expect(splitDecisionClauses('Thanks! Should I start Chase or Jefferson? And who should I pick up?')).toEqual([
      'Thanks!', 'Should I start Chase or Jefferson?', 'And who should I pick up?',
    ])
  })
})

describe('unansweredClausesNote', () => {
  it('quotes each unanswered question without its joining word', () => {
    expect(unansweredClausesNote([{ clause: 'Also should I add Warren?', kind: 'waiver' }, { clause: 'and who should I start?', kind: 'lineup' }]))
      .toBe('You also asked "should I add Warren?" and "who should I start?". That was not answered here: ask it on its own so it gets its own league check.')
  })
})
