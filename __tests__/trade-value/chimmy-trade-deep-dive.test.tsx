/**
 * The Chimmy trade analyzer — the Trade Value tool's "Ask Chimmy" deep dive — shows THE grade
 * (2026-09-27). It used to `alert()` the raw model JSON, led by a verdict and a 0-100 confidence Chimmy
 * made up, beside a payload that already carried the one grade nobody told the model to use.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { chimmyTradeDeepDiveFrom } from '@/lib/trade-value-console/chimmyDeepDive'
import { ChimmyTradeDeepDivePanel } from '@/components/ai-tools/modals/ChimmyTradeDeepDivePanel'
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

describe('ChimmyTradeDeepDivePanel', () => {
  const deepDive = chimmyTradeDeepDiveFrom({ explanation: 'Why the letter.', worstCase: 'He gets hurt.' })!

  it('leads with the one grade — both letters, the label and the league values — then Chimmy', () => {
    render(
      <ChimmyTradeDeepDivePanel
        grade={{ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 6000, getValue: 5400 }}
        deepDive={deepDive}
      />,
    )
    expect(screen.getByTestId('chimmy-deep-dive-grade').textContent).toBe(
      'Your grade D · Their grade B — Slightly favors opponentYou get 5,400 for 6,000 in league value',
    )
    expect(screen.getByTestId('chimmy-trade-deep-dive').textContent).toContain('Why the letter.')
  })

  it('a withheld grade says so and why, with no letter', () => {
    render(<ChimmyTradeDeepDivePanel grade={{ graded: false, reason: '1 asset has no value here.' }} deepDive={deepDive} />)
    expect(screen.getByTestId('chimmy-deep-dive-withheld').textContent).toBe('Not graded: 1 asset has no value here.')
    expect(screen.queryByTestId('chimmy-deep-dive-grade')).toBeNull()
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

  it('🛑 the modal renders the panel with the analysis grade, and no longer alerts raw JSON', () => {
    const modal = code('components/ai-tools/modals/TradeValueModal.tsx')
    expect(modal).not.toMatch(/alert\(JSON\.stringify\(j\.chimmy/)
    expect(modal).toMatch(/<ChimmyTradeDeepDivePanel grade=\{proposalGrade\} deepDive=\{deepDive\} \/>/)
  })
})
