import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Where the Reverse controls live, and what they are gated on.
 *
 * ⚠ SOURCE-LEVEL, AND SAID SO. Mounting either host screen needs a dozen fetches and child panels mocked,
 * and a test that deep tends to pin the mocks rather than the screen. The dialog's behaviour, the client's
 * requests and the route's data are pinned behaviourally elsewhere (reverse-trade-dialog, trade-reversal-
 * client, trades-panel-executed-trades); this file pins only the wiring those tests cannot see — that each
 * screen renders the dialog, calls the RIGHT engine's helpers, and gates the control.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('reversal UI wiring', () => {
  it('the league Trades tab reverses GENERIC trades, commissioner-gated, never on a shadow league', () => {
    const src = read('app/league/[leagueId]/tabs/TradesTab.tsx')
    expect(src).toContain("from '@/components/league-trade/ReverseTradeDialog'")
    expect(src).toContain('previewGenericTradeReversal(league.id, reversing.id)')
    expect(src).toContain('requestGenericTradeReversal(league.id, reversing.id, reason)')
    // Never the native helpers on this screen — they post to a different engine's route.
    expect(src).not.toContain('NativeTradeReversal')

    const section = src.slice(src.indexOf('executed-trades-section') - 200)
    expect(section).toContain('!tradeShadowNotice')
    const reverseButton = src.indexOf('data-testid="executed-trade-reverse"')
    expect(src.lastIndexOf('t.viewerIsCommissioner ?', reverseButton)).toBeGreaterThan(-1)
  })

  it('the redraft Trade Center reverses NATIVE proposals, only when accepted, only for a commissioner', () => {
    const src = read('app/league/[leagueId]/tabs/redraft/TradeCenter.tsx')
    expect(src).toContain("from '@/components/league-trade/ReverseTradeDialog'")
    expect(src).toContain('previewNativeTradeReversal(p.id)')
    expect(src).toContain('requestNativeTradeReversal(p.id, reason)')
    expect(src).not.toContain('GenericTradeReversal')
    expect(src).toContain("p.status === 'accepted' && (isCommissioner || settingsCommissioner)")
    // The native engine cannot restore lock state; the commissioner is told before confirming.
    expect(src).toMatch(/come back unlocked/)
  })
})
