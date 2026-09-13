import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Where each reversal route sends the league notice.
 *
 * ⚠ SOURCE-LEVEL, AND SAID SO. The native route's sequencing is also pinned behaviourally in
 * `trade-reversal-route-notice.test.ts`; the generic process route pulls in the certified-evidence guard
 * and has no route-level suite to extend, so for that route this file is the only check on placement.
 * It pins three things a refactor could quietly break: the notice sits AFTER the refusal return (so a
 * refused reversal announces nothing), BEFORE the success return (so it is actually reached), and behind
 * a `.catch` (so a notice failure cannot fail a reversal that already committed).
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

function assertPlacement(src: string, engine: 'generic' | 'native') {
  const notice = src.indexOf('await publishTradeReversalNotice({')
  const refusal = src.lastIndexOf("code: 'REVERSAL_BLOCKED'", notice)
  const success = src.indexOf('return NextResponse.json(result)', notice)
  expect(notice).toBeGreaterThan(-1)
  expect(refusal).toBeGreaterThan(-1)
  expect(refusal).toBeLessThan(notice)
  expect(success).toBeGreaterThan(notice)

  const call = src.slice(notice, success)
  expect(call).toContain(`engine: '${engine}'`)
  expect(call).toContain('noticeKey: result.noticeKey')
  expect(call).toContain('.catch(')
  // The reason must never be forwarded into a league-wide notice.
  expect(call).not.toContain('reason')
}

describe('reversal notice wiring', () => {
  it('generic process route', () => {
    assertPlacement(read('app/api/leagues/[leagueId]/trades/[tradeId]/process/route.ts'), 'generic')
  })

  it('native trade-votes route', () => {
    assertPlacement(read('app/api/redraft/trade-votes/route.ts'), 'native')
  })
})
