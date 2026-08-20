import { describe, it, expect } from 'vitest'
import {
  resolveAiAuthority,
  isExplanationOnly,
  authoringDecisionTypes,
} from '@/lib/decision-os/three-brain/phase4/aiAuthorityPolicy'

/** Every decision in the Registry today. If a new one is added there, it must appear here too —
 *  and it must resolve to `explanation_only` unless it is genuinely narrative. */
const REGISTERED_DECISIONS = [
  'manager.lineup.set',
  'manager.waiver.claim',
  'manager.trade.evaluate',
  'commissioner.league.health',
] as const

describe('AI authority policy — fail-closed by construction', () => {
  it('gives an UNLISTED decision type explanation-only', () => {
    // The case that matters: someone adds a decision and forgets this file.
    expect(resolveAiAuthority('manager.trade.execute')).toBe('explanation_only')
    expect(resolveAiAuthority('some.future.decision')).toBe('explanation_only')
    expect(resolveAiAuthority('')).toBe('explanation_only')
  })

  it('gives null/undefined explanation-only rather than throwing', () => {
    expect(resolveAiAuthority(null)).toBe('explanation_only')
    expect(resolveAiAuthority(undefined)).toBe('explanation_only')
  })

  it.each(REGISTERED_DECISIONS)('%s is explanation-only', (decision) => {
    expect(resolveAiAuthority(decision)).toBe('explanation_only')
    expect(isExplanationOnly(decision)).toBe(true)
  })

  it('lets narrative output be AI-authored', () => {
    expect(resolveAiAuthority('league.recap.weekly')).toBe('may_author')
    expect(resolveAiAuthority('league.storyline')).toBe('may_author')
    expect(isExplanationOnly('league.storyline')).toBe(false)
  })
})

describe('AI authority policy — the invariant that must never regress', () => {
  it('NO registered decision has authoring rights', () => {
    // This is the load-bearing assertion. A recommendation that moves a roster or spends a budget
    // must stay reproducible and defensible; the moment a model can author it, it is neither.
    const authoring = authoringDecisionTypes()
    for (const decision of REGISTERED_DECISIONS) {
      expect(`${decision}:${authoring.includes(decision)}`).toBe(`${decision}:false`)
    }
  })

  it('nothing in the authoring list looks consequential', () => {
    // A cheap semantic tripwire: authoring is for narrative. Any id naming an action on a roster,
    // a budget or a trade does not belong here, whatever it is called.
    const forbidden = /\b(trade|waiver|lineup|claim|roster|faab|budget|set|execute|process|settle)\b/i
    for (const id of authoringDecisionTypes()) {
      expect(`${id}:${forbidden.test(id)}`).toBe(`${id}:false`)
    }
  })

  it('positive control — the tripwire really does catch a consequential id', () => {
    const forbidden = /\b(trade|waiver|lineup|claim|roster|faab|budget|set|execute|process|settle)\b/i
    expect(forbidden.test('manager.trade.evaluate')).toBe(true)
    expect(forbidden.test('league.storyline')).toBe(false)
  })
})
