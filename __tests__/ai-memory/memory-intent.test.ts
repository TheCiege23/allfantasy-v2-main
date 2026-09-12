import { describe, expect, it } from 'vitest'

import { classifyDirectionSignal, classifyTradeMention } from '@/lib/ai-memory/memoryIntent'

/*
 * Brief acceptance scenario 11: "A hypothetical trade does not persist as a completed trade
 * or change the user's confirmed goals."
 *
 * The memory parser could not distinguish telling from wondering. Any message containing
 * "trade" was filed into `past_trades` as history; any message containing "rebuild" set
 * teamArchetype outright. Both from one sentence, with no confirmation.
 */
describe('memory intent — brief scenario 11', () => {
  describe('a hypothetical trade is not trade history', () => {
    const hypotheticals = [
      'What if I traded Jefferson for Chase?',
      'Should I accept this trade?',
      'Would you decline that offer?',
      'Thinking about trading my 1st for Bijan',
      'Is this trade worth it?',
      'Hypothetically, if I traded Lamb, would my WRs hold up?',
      'Jefferson vs Chase — which side of that trade do I want?',
      /* Contains completed-looking words AND is a question. Exploration must win. */
      'Should I have accepted that trade last week?',
    ]
    for (const m of hypotheticals) {
      it(`does not record: "${m}"`, () => {
        expect(classifyTradeMention(m)).toBe('explored')
      })
    }

    /* The control: a real trade must still be recorded, or the fix has broken memory. */
    const completed = [
      'I just traded Jefferson for Chase',
      'I accepted the trade',
      'We agreed on the deal and I traded my 2nd',
      'I declined their offer',
    ]
    for (const m of completed) {
      it(`records: "${m}"`, () => {
        expect(classifyTradeMention(m)).toBe('completed')
      })
    }

    it('ignores messages with no trade vocabulary at all', () => {
      expect(classifyTradeMention('Who should I start at flex?')).toBe('none')
      expect(classifyTradeMention('')).toBe('none')
    })
  })

  describe('a question does not change a confirmed goal', () => {
    it('treats "should I rebuild?" as exploration, not direction', () => {
      const r = classifyDirectionSignal('Should I rebuild this year?')
      expect(r.direction).toBe('rebuilder')
      expect(r.stance).toBe('explored')
    })

    it('treats "what if I went all-in" as exploration', () => {
      expect(classifyDirectionSignal('What if I went all-in this season?').stance).toBe('explored')
    })

    /* The control: explicit direction MUST still be honoured — the brief says it overrides. */
    it('treats "I am rebuilding" as declared direction', () => {
      const r = classifyDirectionSignal("I'm rebuilding this year, so target youth")
      expect(r.direction).toBe('rebuilder')
      expect(r.stance).toBe('declared')
    })

    it('treats "we are going all-in" as declared direction', () => {
      const r = classifyDirectionSignal('We are going all-in for a playoff push')
      expect(r.direction).toBe('contender')
      expect(r.stance).toBe('declared')
    })

    it('reports no direction when the message has no signal', () => {
      expect(classifyDirectionSignal('What is my bench looking like?').direction).toBeNull()
    })
  })
})
