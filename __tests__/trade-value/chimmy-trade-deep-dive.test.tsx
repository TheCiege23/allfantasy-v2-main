/**
 * The Chimmy trade analyzer — the Trade Value tool's "Ask Chimmy" deep dive — shows THE grade
 * (2026-09-27). It used to `alert()` the raw model JSON, led by a verdict and a 0-100 confidence Chimmy
 * made up, beside a payload that already carried the one grade nobody told the model to use.
 *
 * 2026-10-06: the panel and the Trade Value modal that rendered it were deleted as unreachable
 * (nothing had mounted the AI tools grid since 2026-07-06), and their tests with them. What stays
 * here guards the route and the parser, which are still live.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chimmyTradeDeepDiveFrom } from '@/lib/trade-value-console/chimmyDeepDive'
import { CHIMMY_TRADE_SYSTEM_PROMPT } from '@/lib/trade-value-console/chimmy-prompt'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('chimmyTradeDeepDiveFrom', () => {
  it('🛑 drops a verdict, score or confidence the model sends anyway, and keeps the explanation', () => {
    const out = chimmyTradeDeepDiveFrom({
      verdict: 'Slight win for you',
      confidence: 82,
      score: 71,
      explanation: 'You send 6,000 and get 5,400 on this league’s values.',
      bestCase: 'Bijan breaks out.',
      rebalanceIdeas: ['Ask for their 2027 2nd', '', 7, 'b', 'c', 'd'],
      warnings: ['Injury data is a day old'],
    })
    expect(out).toEqual({
      explanation: 'You send 6,000 and get 5,400 on this league’s values.',
      bestCase: 'Bijan breaks out.',
      worstCase: null,
      rebalanceIdeas: ['Ask for their 2027 2nd', 'b', 'c', 'd'],
      alternateTargets: [],
      warnings: ['Injury data is a day old'],
      leagueNote: null,
    })
    expect(JSON.stringify(out)).not.toMatch(/verdict|confidence|score/i)
  })

  it('no explanation — or not an object — is nothing to show', () => {
    expect(chimmyTradeDeepDiveFrom({ verdict: 'Fair' })).toBeNull()
    expect(chimmyTradeDeepDiveFrom(null)).toBeNull()
    expect(chimmyTradeDeepDiveFrom(['explanation'])).toBeNull()
  })
})

describe('wiring', () => {
  it('the prompt makes the payload grade the verdict and asks for no verdict or confidence of its own', () => {
    expect(CHIMMY_TRADE_SYSTEM_PROMPT).toMatch(/"grade" is THE AllFantasy grade/)
    expect(CHIMMY_TRADE_SYSTEM_PROMPT).toMatch(/grade\.graded is false/)
    expect(CHIMMY_TRADE_SYSTEM_PROMPT).not.toMatch(/verdict \(short string\)|confidence \(0-100/)
  })

  it('the route returns only the explanation fields — never the raw completion', () => {
    const route = code('app/api/trade-value/chimmy/route.ts')
    expect(route).toMatch(/chimmyTradeDeepDiveFrom\(parseJsonContentFromChatCompletion\(result\.json\)\)/)
    expect(route).not.toMatch(/raw: result\.json/)
  })
})
