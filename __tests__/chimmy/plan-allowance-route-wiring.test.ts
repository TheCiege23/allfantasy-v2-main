import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where the AF Pro allowance sits in `/api/chat/chimmy`, pinned by ORDER in the source — the same
 * technique `chimmy-tool-loop-route-wiring.test.ts` uses, because the route is a 4,000-line handler
 * no unit test can drive end to end. Each assertion is a rule about money:
 *
 *   - a covered subscriber is never shown a token price or asked to consent;
 *   - an answer that is free for everyone never uses an included answer;
 *   - an included answer and a token charge never both happen for one turn;
 *   - a turn nobody answered gives its included answer back.
 */

const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')
/* Statements, not prose: comments in this route name the functions they explain. */
const at = (re: RegExp) => {
  const m = re.exec(ROUTE)
  return m ? m.index : -1
}

describe('the AF Pro allowance in /api/chat/chimmy', () => {
  it('skips the token preflight when the plan covers the turn', () => {
    expect(ROUTE).toMatch(/const planCovers = Boolean\(planState && planState\.remaining > 0\)[\s\S]{0,400}?\n\s*if \(!planCovers\) \{\s*\n\s*const blocked = await runTokenGate\(exhaustedPlanMeta\)/)
  })

  it('takes the allowance only AFTER the free undecided-trade return', () => {
    const freeReturn = at(/^\s*if \(tradeTargetResult\?\.status === 'unresolved'\) \{/m)
    const take = at(/^\s*planIncluded = await takeChimmyPlanAllowance\(/m)
    expect(freeReturn).toBeGreaterThan(-1)
    expect(take).toBeGreaterThan(freeReturn)
  })

  it('never charges tokens for a turn the plan included', () => {
    expect(ROUTE).toMatch(/^\s*if \(!planIncluded && !tokenPreviewFailed\) \{\s*\n\s*try \{\s*\n\s*const ledger = await spendService\.spendTokensForRule\(/m)
  })

  it('falls back to the token preflight when the last included answer went elsewhere', () => {
    expect(ROUTE).toMatch(/planIncluded = await takeChimmyPlanAllowance\(\{ userId, state: planState \}\)\s*\n\s*if \(!planIncluded\) \{\s*\n\s*const blocked = await runTokenGate\(exhaustedPlanMeta\)/)
  })

  it('gives the included answer back when nothing was delivered, and when the request throws', () => {
    expect(ROUTE).toMatch(/if \(!delivery\.delivered && planIncluded && userId\) \{\s*\n\s*const released = await releaseChimmyPlanAllowance\(\{ userId \}\)/)
    expect(ROUTE).toContain('planMeta = released && planMeta')
    expect(ROUTE).toMatch(/\} catch \(error\) \{\s*\n\s*if \(planIncluded && userId\) await releaseChimmyPlanAllowance\(\{ userId \}\)/)
  })

  it('covers the live-search answer too, taken only once a sourced answer exists', () => {
    const searched = at(/^\s*const searched = await answerSportsQuestionFromSearch\(/m)
    const take = at(/^\s*\? await takeChimmyPlanAllowance\(\{ userId, state: searchPlan \}\)/m)
    expect(searched).toBeGreaterThan(-1)
    expect(take).toBeGreaterThan(searched)
    expect(ROUTE).toMatch(/const ledger = searchIncluded \|\| !mayCharge\s*\n\s*\? null/)
  })

  /*
   * The out-of-tokens card offers AF Pro only to an account without it. The refusals are where it
   * learns which: without the plan on them, a subscriber whose day is used is sold the plan they have.
   */
  it('tells the consent and out-of-tokens refusals whether the caller holds the plan', () => {
    expect(ROUTE).toMatch(/code: 'token_confirmation_required',\s*\n\s*preview: tokenPreview,\s*\n\s*planAllowance: plan,/)
    expect(ROUTE).toMatch(/code: 'insufficient_token_balance',[\s\S]{0,200}?planAllowance: planMeta,\s*\n\s*\},\s*\n\s*\{ status: 402 \}/)
    expect(ROUTE).toMatch(/const exhaustedPlanMeta: ChimmyPlanAllowanceMeta \| null = planState\s*\n\s*\? planAllowanceMeta\(\{ \.\.\.planState, used: planState\.limit, remaining: 0 \}, false\)/)
  })

  it('reports the allowance on every paid answer shape', () => {
    expect(ROUTE.match(/\.\.\.\(planMeta \? \{ planAllowance: planMeta \} : \{\}\)/g)?.length).toBe(4)
    expect(ROUTE).toMatch(/\.\.\.\(searchPlanMeta \? \{ planAllowance: searchPlanMeta \} : \{\}\)/)
  })

  /* A free lookup must not pay for an entitlement query. */
  it('reads the plan lazily', () => {
    expect(ROUTE).toMatch(/let planAllowanceRead: Promise<ChimmyPlanAllowanceState \| null> \| null = null/)
    expect(ROUTE).toMatch(/\(planAllowanceRead \?\?= userId/)
  })
})
