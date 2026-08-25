import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import React from 'react'

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const SRC = readFileSync(
  resolve(process.cwd(), 'components/core-app/screens/TradeCenter.tsx'),
  'utf8',
)
const PAGE = readFileSync(resolve(process.cwd(), 'app/core/[[...screen]]/page.tsx'), 'utf8')

const LEAGUE = { id: 'l1', name: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 }

function text(ui: React.ReactElement): string {
  return (render(ui).container.textContent ?? '').replace(/\s+/g, ' ')
}

describe('Trade Center renders and is reachable', () => {
  it('shows the league context and the full asset vocabulary', () => {
    const t = text(<TradeCenter league={LEAGUE} />)
    expect(t).toContain('Trade Center')
    expect(t).toContain('Last League Left')
    /* The legend documents every asset class regardless of this deal's contents. */
    expect(t).toContain('Idol · Survivor')
    expect(t).toContain('Weapon · Zombie')
    expect(t).toContain('Serum · Zombie')
  })

  it('⚠ is wired into /core/trades and does not replace the history', () => {
    /*
     * Additive rather than a swap — nothing that already works is lost while the
     * new surface settles.
     */
    expect(PAGE).toContain('<TradeCenter')
    expect(PAGE).toContain('<Trades data={trades} />')
  })

  it('⚠ posts to the EXISTING analyze route, not a new one', () => {
    // The repo sits at the platform's route ceiling and a page is not worth one.
    expect(SRC).toContain("'/api/trade-value/analyze'")
    expect(SRC).toContain('NO NEW API ROUTE')
  })

  it('says the deadline when the league has one', () => {
    expect(text(<TradeCenter league={LEAGUE} deadlineLabel="Deadline · week 11" />)).toContain(
      'Deadline · week 11',
    )
  })
})

describe('⚠ the honesty rules the design called load-bearing', () => {
  it('renders an unpriced asset as an em dash, never a zero', () => {
    /*
     * A defender the market feed cannot price is not worthless. money() returns
     * an em dash for null and totalOf skips unpriced lines rather than counting
     * them as zero.
     */
    expect(SRC).toContain('AN UNPRICED ASSET IS AN EM DASH, NEVER A ZERO')
    expect(SRC).toContain('Sum that ignores unpriced lines')
  })

  it('⚠ suppresses the verdict when the format blocks the deal', () => {
    /*
     * A score beneath a "this cannot happen" banner still gets read as a score.
     * The blocked banner leads and the verdict does not render at all.
     */
    expect(SRC).toContain('THE VERDICT IS SUPPRESSED WHEN THE FORMAT BLOCKS')
    expect(SRC).toContain('result && !blocked')
  })

  it('⚠ never lets a score stand alone when there is no signal', () => {
    /*
     * gradeScale.ts warns that C spans a wide band, so a trade we know nothing
     * about lands mid-C and looks identical to a genuinely even one.
     */
    expect(SRC).toContain('no signal, not that the trade is fair')
  })

  it('⚠ keeps the note groups visually separate from the verdict', () => {
    // That separation is product logic, not decoration — the design brief said
    // so and so does the engine.
    expect(SRC).toContain('Additive context. Never merged with the verdict')
  })
})

describe('⚠ what was deliberately NOT built', () => {
  it('does not fake multi-team or cross-platform', () => {
    /*
     * Neither has backing schema. 3+ teams needs the two-sided input shape
     * replaced AND a real answer for how fairness generalises past two sides; a
     * linked deal needs a LinkedTradeProposal with a status machine, because no
     * platform can enforce the other leg. Rendering either would be a UI
     * promising a transaction the system cannot make.
     */
    expect(SRC).toContain('MULTI-TEAM AND CROSS-PLATFORM ARE NOT BUILT')
    /*
     * Checked by IMPLEMENTATION, not vocabulary — the header names what those
     * states would require, which is the point of documenting the gap. What must
     * be absent is the machinery: no leg grouping, no third team.
     */
    expect(SRC).not.toContain('legId')
    expect(SRC).not.toContain('legGroups')
  })

  it('does not reimplement the preview-state switcher', () => {
    /*
     * The design ships a five-way toggle so a reviewer can see every layout. In
     * production those are situations the page falls into on its own.
     */
    expect(SRC).toContain('THE THREE STATES ARE ORGANIC, NOT A PREVIEW SWITCHER')
  })
})
