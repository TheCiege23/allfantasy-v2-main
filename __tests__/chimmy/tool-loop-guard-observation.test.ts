// @vitest-environment node
/**
 * The hallucination guard on the tool-loop path, observe-only. HailShiva, production 2026-10-06:
 * "Your card's 51.9% does not match this … the 65% is what the simulator returned to me just now."
 * The tools returned 65.12 / 76.4 / 55.55; the 51.9% came from an earlier message in the thread.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { observeToolLoopAnswer } from '@/lib/chimmy/toolLoopGuardObservation'
import { CHIMMY_AI_EVENT_NAMES } from '@/lib/chimmy-chat/analytics-events'

const evidence = 'Season Outlook · HailShiva: playoffPct 65.12 (range 61–78), byePct 14.2. Week 5 vs Rittnasty: ifWin 76.4, ifLose 55.55.'
const question = "Using this league's current weekly blueprint and available playoff model, explain my playoff path this period."

describe('tool-loop guard observation', () => {
  it('separates a number from an earlier message from mere rounding of tool values', () => {
    const out = observeToolLoopAnswer({ evidence, promptLines: [], question, hasLeagueContext: true,
      answer: "Your card's 51.9% does not match this. Current estimate: 65%. Win → 76%, lose → 56%." })
    expect(out.wouldAction).toBe('replace')
    expect(out.unmatched).toEqual(['51.9%'])
    expect(out.roundedMatches).toBe(3)
  })

  it('passes an answer whose figures are the tool values', () => {
    const out = observeToolLoopAnswer({ evidence, promptLines: [], question, hasLeagueContext: true,
      answer: 'Your playoff odds are 65.12: 76.4 with a win, 55.55 with a loss.' })
    expect(out).toMatchObject({ wouldAction: 'pass', hardIssues: 0, unmatched: [], roundedMatches: 0 })
  })

  it('shows why it observes: the exact-token guard flags even an exact tool value written with "%"', () => {
    const out = observeToolLoopAnswer({ evidence, promptLines: [], question, hasLeagueContext: true,
      answer: 'Your playoff odds are 65.12%: 76.4 with a win, 55.55 with a loss.' })
    expect(out).toMatchObject({ wouldAction: 'annotate', hardIssues: 1, unmatched: [], roundedMatches: 1 })
  })

  it('counts prompt lines and the current question as grounding, but has no input for earlier turns', () => {
    const out = observeToolLoopAnswer({ evidence: '', promptLines: ['Today is 2026-10-06.', null], question: 'Is 31.5 enough?', hasLeagueContext: true,
      answer: 'On 2026-10-06, 31.5 should be enough.' })
    expect(out.wouldAction).toBe('pass')
    expect(observeToolLoopAnswer.length).toBe(1)
  })

  it('is recorded under its own event name, never the KPI that counts guarded failures', () => {
    expect(CHIMMY_AI_EVENT_NAMES).toContain('guard_observed')
    const route = readFileSync('app/api/chat/chimmy/route.ts', 'utf8').replace(/\r\n/g, '\n')
    const at = route.indexOf('observeToolLoopAnswer({')
    expect(at).toBeGreaterThan(route.indexOf('enforceTradeLetters({'))
    expect(at).toBeLessThan(route.indexOf("source: 'chimmy_tool_loop'"))
    expect(route.slice(at, at + 1200)).toContain("event_name: 'guard_observed'")
    // Observe-only: the observation never assigns the answer.
    expect(route.slice(at, at + 1200)).not.toMatch(/loop\s*=|loop\.text\s*=/)
  })
})
