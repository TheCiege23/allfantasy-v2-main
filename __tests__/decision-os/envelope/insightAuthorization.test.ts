import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The `getInsightBundle` authorization hole, and the guard that closes it.
 *
 * 🛑 WHAT THIS WAS. `app/api/chat/chimmy/route.ts` called
 * `getInsightBundle(leagueId, …)` behind the guard `leagueId && insightType`,
 * where `leagueId` is `formData.get('leagueId')` — a client claim.
 * `lib/ai-simulation-integration/AIInsightRouter.ts` declares that function with
 * NO `userId` parameter and the file contains zero occurrences of one, so it
 * read matchup predictions, playoff odds, warehouse summaries and a league
 * settings summary for whatever id it was handed, and the result was placed in
 * the prompt.
 *
 * The earlier refusal did not cover it: `requiresLeagueGrounding` forces
 * grounding for `insightType` of trade / waiver / dynasty, and `InsightType` has
 * six values. `matchup`, `playoff` and `draft` fell through.
 *
 * ⚠ THESE ARE STRUCTURAL ASSERTIONS ON THE ROUTE SOURCE, AND THAT IS STATED
 * RATHER THAN IMPLIED. Entering the real 3,100-line handler needs auth, an AI
 * provider and a dozen other mocks; standing all that up would test the mocks.
 * The executable proof that an unauthorized id yields no league lives in
 * `contextResolution.test.ts`, which drives the real boundary. What is checked
 * here is the one thing that file cannot see: which variable this call site
 * reads.
 */

const ROUTE = path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts')
const INSIGHT_ROUTER = path.join(
  process.cwd(),
  'lib',
  'ai-simulation-integration',
  'AIInsightRouter.ts'
)

describe('getInsightBundle reads the authorized snapshot, not the request field', () => {
  const src = readFileSync(ROUTE, 'utf8')

  it('the call site exists (positive control — a rename must not pass as agreement)', () => {
    expect(src).toContain('getInsightBundle(')
  })

  it('is guarded on leagueSnapshot, not on the raw leagueId', () => {
    const at = src.indexOf('getInsightBundle(')
    const window = src.slice(Math.max(0, at - 400), at + 200)
    expect(window).toContain('leagueSnapshot && insightType')
    expect(window).not.toContain('leagueId && insightType')
  })

  it('passes the snapshot id, so the id it receives is one membership proved', () => {
    const at = src.indexOf('getInsightBundle(')
    expect(src.slice(at, at + 120)).toContain('leagueSnapshot.id')
  })

  it('🛑 AND THE UNDERLYING FUNCTION STILL TAKES NO userId — which is why the call site is the gate', () => {
    /*
     * If this ever gains its own authorization, the guard above becomes belt and
     * braces rather than the only thing standing there. Until then this test is
     * the record of why the call site carries the whole weight.
     */
    const router = readFileSync(INSIGHT_ROUTER, 'utf8')
    const signature = router.slice(
      router.indexOf('export async function getInsightBundle'),
      router.indexOf('export async function getInsightBundle') + 260
    )
    expect(signature).not.toContain('userId')
  })
})

describe('the three insight types that fell through the earlier guard', () => {
  const src = readFileSync(ROUTE, 'utf8')

  it('requiresLeagueGrounding still covers only trade, waiver and dynasty', () => {
    /*
     * Pinned so that if someone widens it, this test goes red and the comment
     * above stops being true — at which point both should be updated together.
     */
    const at = src.indexOf('function requiresLeagueGrounding')
    const body = src.slice(at, at + 2000)
    expect(body).toContain("args.insightType === 'trade'")
    expect(body).toContain("args.insightType === 'waiver'")
    expect(body).toContain("args.insightType === 'dynasty'")
    expect(body).not.toContain("args.insightType === 'playoff'")
    expect(body).not.toContain("args.insightType === 'matchup'")
  })

  it('InsightType really does have six values, three of them uncovered', () => {
    const types = readFileSync(
      path.join(process.cwd(), 'lib', 'ai-simulation-integration', 'types.ts'),
      'utf8'
    )
    const block = types.slice(types.indexOf('export type InsightType'), types.indexOf('export const'))
    for (const t of ['matchup', 'playoff', 'dynasty', 'trade', 'waiver', 'draft']) {
      expect(block, t).toContain(`'${t}'`)
    }
  })
})
