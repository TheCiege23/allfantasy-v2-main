// @vitest-environment node
/**
 * LIVE EVAL — opt-in, spends real tokens. Asks demo Chimmy the evaluative questions a tester asks,
 * through the REAL provider router, against the synthetic fixture league (no database, no real
 * names), and checks that every FIRST reply carries its reasoning rather than a bare name.
 *
 *   DEMO_CHIMMY_LIVE_EVAL=1 npx vitest run __tests__/demo-league/demo-chimmy-live-eval.test.ts
 *
 * Needs AI_FEATURES_ENABLED=true and at least one provider key in the environment. Set
 * DEMO_CHIMMY_EVAL_OUT=<file.json> to keep the answers. Skipped (not failed) otherwise, so a plain
 * `npm test` never calls a model.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EVALUATIVE_QUESTIONS, demoChimmyFixtureView, firstReplyHasReasoning } from './fixtures/demoChimmyLeague'

const LIVE = process.env.DEMO_CHIMMY_LIVE_EVAL === '1'

describe.skipIf(!LIVE)('demo Chimmy live eval — the first reply explains why', () => {
  const view = demoChimmyFixtureView()
  const results: Array<{ question: string; answer: string; truncated: boolean; check: string }> = []

  it.each(EVALUATIVE_QUESTIONS)('"%s"', async (question) => {
    const { askDemoChimmy } = await import('@/lib/demo-league/chimmy')
    const out = await askDemoChimmy(view, question, { starterValues: null })
    expect(out.ok, 'the model call failed — see the [demo-chimmy] log line for the reason').toBe(true)
    if (!out.ok) return
    const check = firstReplyHasReasoning(out.answer, view)
    results.push({ question, answer: out.answer, truncated: out.truncated, check: check.why })
    if (process.env.DEMO_CHIMMY_EVAL_OUT) fs.writeFileSync(process.env.DEMO_CHIMMY_EVAL_OUT, JSON.stringify(results, null, 2))
    expect(out.truncated, out.answer).toBe(false)
    expect(check.ok, `${check.why}\n---\n${out.answer}`).toBe(true)
    if (/best team/i.test(question)) {
      // The insight the tester only got on a follow-up: the 5-1 leader is not the top scorer.
      expect(out.answer, out.answer).toMatch(/Turbo Tacos/)
    }
  }, 90_000)
})
