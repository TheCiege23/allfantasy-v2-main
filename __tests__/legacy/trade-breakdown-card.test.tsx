// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'

import TradeBreakdownSides from '@/components/legacy/TradeBreakdownSides'
import { tradeAssetLabel, tradeHubBreakdown } from '@/lib/legacy/tradeBreakdown'

/*
 * THE /af-legacy "TRADE BREAKDOWN" CARD LISTS THE ASSETS OF THE REQUEST THAT PRODUCED THE RESULT.
 *
 * Until 2026-09-30 it listed the dead inline evaluator's text boxes (`inlineSideA` / `inlineSideB`),
 * which nothing ever filled, so a Trade Hub result showed its total values beside two empty lists.
 * The Trade Hub now captures the lists when it sends the request (`tradeHubBreakdown`), in the same
 * orientation as the analyzer's `sideAValue` (what the user GETS) — see lib/legacy/tradeHubDirection.ts.
 */

afterEach(cleanup)

// What the page's `buildSide` makes of: Josh Allen + $25 FAAB from the user's own team (Team A),
// Puka Nacua + the 2027 1st (.04) from the partner (Team B).
const MINE_SIDE = [
  { type: 'player', player: { id: '4984', name: 'Josh Allen', pos: 'QB', team: 'BUF' } },
  { type: 'faab', faab: { amount: 25 } },
]
const PARTNER_SIDE = [
  { type: 'player', player: { id: '9493', name: 'Puka Nacua', pos: 'WR', team: 'LAR' } },
  { type: 'pick', pick: { year: 2027, round: 1, pickNumber: 4, originalOwner: '2' } },
]

describe('tradeAssetLabel', () => {
  it('labels the assets the Trade Hub actually builds — picks by `year`, FAAB by `faab.amount`', () => {
    expect(tradeAssetLabel(MINE_SIDE[0])).toBe('Josh Allen')
    expect(tradeAssetLabel(PARTNER_SIDE[1])).toBe('2027 1st.04')
    expect(tradeAssetLabel({ type: 'pick', pick: { year: 2028, round: 3 } })).toBe('2028 3rd')
    expect(tradeAssetLabel(MINE_SIDE[1])).toBe('$25 FAAB')
  })

  it('still reads the older `pick.season` / top-level `amount` spellings', () => {
    expect(tradeAssetLabel({ pick: { season: 2027, round: 2 } })).toBe('2027 2nd')
    expect(tradeAssetLabel({ amount: 10 })).toBe('$10 FAAB')
  })

  it('an unrecognised asset is named as such, not dropped', () => {
    expect(tradeAssetLabel({ type: 'pick', pick: { round: 1 } })).toBe('Unknown asset')
    expect(tradeAssetLabel(null)).toBe('Unknown asset')
  })
})

describe('tradeHubBreakdown — the card’s lists point the same way as its values', () => {
  it('You Get = the partner’s picks (assetsA), You Give = the user’s own (assetsB)', () => {
    expect(tradeHubBreakdown({ mine: MINE_SIDE, partner: PARTNER_SIDE })).toEqual({
      youGet: ['Puka Nacua', '2027 1st.04'],
      youGive: ['Josh Allen', '$25 FAAB'],
    })
  })
})

describe('TradeBreakdownSides — renders a Trade Hub result', () => {
  it('lists the request’s assets under the right heading, beside the right value', () => {
    const { getByTestId } = render(
      <TradeBreakdownSides
        breakdown={tradeHubBreakdown({ mine: MINE_SIDE, partner: PARTNER_SIDE })}
        youGetValue={8200}
        youGiveValue={7900}
      />,
    )
    const get = within(getByTestId('trade-breakdown-you-get'))
    const give = within(getByTestId('trade-breakdown-you-give'))
    expect(get.getByText('You Get')).toBeTruthy()
    expect(get.getByText('Puka Nacua')).toBeTruthy()
    expect(get.getByText('2027 1st.04')).toBeTruthy()
    expect(get.getByText('8200')).toBeTruthy()
    expect(get.queryByText('Josh Allen')).toBeNull()
    expect(give.getByText('You Give')).toBeTruthy()
    expect(give.getByText('Josh Allen')).toBeTruthy()
    expect(give.getByText('$25 FAAB')).toBeTruthy()
    expect(give.getByText('7900')).toBeTruthy()
    expect(give.queryByText('Puka Nacua')).toBeNull()
  })

  it('a result with no breakdown renders two empty lists, not a crash', () => {
    const { getByTestId } = render(<TradeBreakdownSides breakdown={undefined} />)
    expect(getByTestId('trade-breakdown-you-get').querySelectorAll('span.rounded-lg').length).toBe(0)
    expect(getByTestId('trade-breakdown-you-give').querySelectorAll('span.rounded-lg').length).toBe(0)
  })
})

/** Source with comments stripped, so a comment recording the change is not read as code. */
const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** `generateTradeHubReport`'s body, from its declaration to its closing brace at component depth. */
const tradeHubReport = (page: string) => {
  const start = page.indexOf('const generateTradeHubReport = async () => {')
  return start < 0 ? '' : page.slice(start, page.indexOf('\n  }\n', start) + 4)
}
/** The Trade Hub's `setInlineTradeResult({ … })` call, whole. */
const RESULT_SET = /setInlineTradeResult\(\{[\s\S]*?\}\)\n/
const BREAKDOWN_FROM_REQUEST = /breakdown: tradeHubBreakdown\(\{ mine: sideA, partner: sideB \}\)/
const CARD_READS_RESULT = /<TradeBreakdownSides\s+breakdown=\{inlineTradeResult\.breakdown\}\s+youGetValue=\{inlineTradeResult\.sideAValue\}\s+youGiveValue=\{inlineTradeResult\.sideBValue\}\s*\/>/

describe('the page wires the card to the request', () => {
  const page = code('app/af-legacy/page.tsx')

  it('the Trade Hub stores the breakdown of the request it sent, with its result', () => {
    const set = tradeHubReport(page).match(RESULT_SET)?.[0] ?? ''
    expect(set).toMatch(BREAKDOWN_FROM_REQUEST)
  })

  it('the card reads that breakdown and nothing else', () => {
    expect(page).toMatch(CARD_READS_RESULT)
    expect(page).not.toMatch(/\binlineSide[AB]\b/)
  })

  it('positive controls: the shapes match the code they replaced', () => {
    const oldSet = [
      '  const generateTradeHubReport = async () => {',
      '      setInlineTradeResult({ ...data, confidenceRisk, offseasonContext: offseasonCtx2 })',
      '  }',
      '',
    ].join('\n')
    expect(tradeHubReport(oldSet).match(RESULT_SET)?.[0]).toBeTruthy()
    expect(tradeHubReport(oldSet).match(RESULT_SET)?.[0]).not.toMatch(BREAKDOWN_FROM_REQUEST)
    expect(/\binlineSide[AB]\b/.test("{inlineSideA.split(',').filter(Boolean).map((item: string, idx: number) => (")).toBe(true)
  })
})
