import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Where `/api/chat/chimmy` reads the league's trade block for its answer (2026-09-17), asserted
 * against the route source — the approach `trade-target-route-wiring.test.ts` uses, because the
 * properties that matter (which league id, which questions) are invisible to a unit test and a
 * refactor breaks them silently.
 */
const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'), 'utf8')

const CALL_AT = ROUTE.indexOf('await buildTradeBlockContext(')
const PLAN_AT = ROUTE.indexOf('const intent = classifyPecrIntent(planInput.message)')
const PECR_AT = ROUTE.indexOf('const pecrResult = await runPECR')

/* The route's own regex, taken from its source so the test exercises exactly what ships. */
function tradeBlockWords(): RegExp {
  const m = ROUTE.match(/const TRADE_BLOCK_WORDS = \/(.+)\/([a-z]*)\r?\n/)
  if (!m) throw new Error('route no longer declares TRADE_BLOCK_WORDS')
  return new RegExp(m[1], m[2])
}

describe('the trade block in the chat route', () => {
  it('is read once, inside the PECR plan', () => {
    expect(CALL_AT).toBeGreaterThan(-1)
    expect(ROUTE.indexOf('await buildTradeBlockContext(', CALL_AT + 1)).toBe(-1)
    expect(PLAN_AT).toBeGreaterThan(-1)
    expect(CALL_AT).toBeGreaterThan(PLAN_AT)
    expect(PECR_AT < 0 || CALL_AT > PECR_AT).toBe(true)
  })

  it('🛑 reads the MEMBERSHIP-PROVEN league, never the raw request field', () => {
    const call = ROUTE.slice(CALL_AT, ROUTE.indexOf(')', CALL_AT) + 1)
    expect(call).toBe('await buildTradeBlockContext(leagueSnapshot.id)')
  })

  it('only for a trade question or one that names the block, and a failure never breaks the answer', () => {
    const before = ROUTE.slice(ROUTE.lastIndexOf('try {', CALL_AT), CALL_AT)
    expect(before).toMatch(/if \(intent === 'trade' \|\| TRADE_BLOCK_WORDS\.test\(planInput\.message\)\) \{/)
    const after = ROUTE.slice(CALL_AT, ROUTE.indexOf('} catch', CALL_AT) + 30)
    expect(after).toMatch(/\} catch \{ \/\* non-fatal \*\/ \}/)
  })

  it.each([
    'who is on the trade block?',
    'is anyone trading block players this week',
    'Is Rashee Rice on the block',
    'which of my guys are trade bait',
    'TRADE BLOCK',
  ])('names the block: %s', (q) => {
    expect(tradeBlockWords().test(q)).toBe(true)
  })

  it.each(['start Blocker or not', 'blocked shot leaders', 'who should I start this week', 'tradeblocker'])(
    'does not fire on: %s',
    (q) => {
      expect(tradeBlockWords().test(q)).toBe(false)
    },
  )
})
