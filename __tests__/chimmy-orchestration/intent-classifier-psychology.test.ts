import { describe, expect, it } from 'vitest'

import { classifyChimmyIntent } from '@/lib/chimmy-orchestration/intent-classifier'

/**
 * The manager_psychology intent existed in the union and in the classifier, and
 * could not fire for the most obvious word someone would use for it.
 *
 * The pattern matched stems inside a group closed by \b — `\bpsycholog\b` cannot
 * match "psychology", because g and y are both word characters and there is no
 * boundary between them. Same for `manager\s*profil` against "manager profile".
 * It failed silently: the question fell through to `general` and got a plausible
 * answer, so nothing looked broken.
 */
describe('psychology questions reach the psychology intent', () => {
  const psychology = [
    'what is his draft psychology',
    'manager profile for roster 9',
    "what are this guy's tendencies",
    'he plays mind games',
    'his behavior in trades',
    'is there collusion in my league',
  ]

  for (const message of psychology) {
    it(`routes "${message}"`, () => {
      expect(classifyChimmyIntent(message).intent).toBe('manager_psychology')
    })
  }

  it('routes questions about a PERSON rather than an asset', () => {
    // These previously fell through to the generic draft/trade branches, which
    // answer about players when the question was about the manager.
    expect(classifyChimmyIntent('how does Stavros draft?').intent).toBe('manager_psychology')
    expect(classifyChimmyIntent('what kind of trader is TheCiege24').intent).toBe(
      'manager_psychology'
    )
  })
})

describe('widening psychology did not swallow the other intents', () => {
  const cases: Array<[string, string]> = [
    ['should I trade Puka for Nabers?', 'trade'],
    ['who should I start, Bijan or Gibbs?', 'start_sit'],
    ['best waiver adds this week', 'waiver'],
    ['draft strategy for superflex', 'draft'],
    ['what is Puka worth', 'player_value'],
    ['week 3 recap', 'story_recap'],
  ]

  for (const [message, intent] of cases) {
    it(`still routes "${message}" to ${intent}`, () => {
      expect(classifyChimmyIntent(message).intent).toBe(intent)
    })
  }
})
