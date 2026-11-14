import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * Waivers, said once (2026-11-14).
 *
 * - The intro under the headline is gone; the headline says it.
 * - "Worth adding" lost "Why it matters"; its GAIN column says what the list is ranked by.
 * - On /core, Waiver intelligence drops the budget subtitle (the FAAB tile says it) and the reasons
 *   under every player (the row, its tags and "How this room bids" say them). The Decide deck keeps both.
 * - The claims footnote under the Claim button is gone; the button and the banner say where claims go.
 * - Competitive edge: one line per manager, not four sentences that each ended "more than your $40".
 */

const lang = vi.hoisted(() => ({ value: 'en' as 'es' | 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.value, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

const intel = vi.hoisted(() => ({
  data: {
    supported: true,
    intel: {
      budget: 1000,
      myRemaining: 449,
      history: { claims: 48, medianBid: 75, p75Bid: 156, topBid: 900, recent: [] },
      targets: [
        {
          playerId: 'h',
          name: 'Tank Bigsby',
          position: 'RB',
          team: 'PHI',
          marketValue: 80,
          fillsSlots: [],
          suggestedBid: 374,
          reasoning: ['market value 80 (redraft chart)', "this league's winning bids: median $75, p75 $156 — calibrate against the room"],
        },
      ],
      formulaNotes: ['No suggestion is more than 60% of the budget.'],
      missing: [],
    },
  } as unknown,
}))
vi.mock('@/components/decide/useWaiverIntel', () => ({ useWaiverIntel: () => ({ data: intel.data, loading: false }) }))

import { WaiverIntel } from '@/components/decide/WaiverIntel'
import { WaiverCompetitiveEdge } from '@/components/core-app/screens/WaiverCompetitiveEdge'
import { buildWaiverEdge } from '@/lib/competitive-edge/waiverEdge'
import { rivalPieces } from '@/lib/core-app/waiversGuide'
import { waiversGuideMessages } from '@/lib/core-app/messages/waiversGuide'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

afterEach(() => {
  cleanup()
  lang.value = 'en'
})

const CLAIMS = [
  { teamExternalId: '2', position: 'RB', bid: 18, atIso: '2026-09-01T00:00:00.000Z' },
  { teamExternalId: '2', position: 'RB', bid: 4, atIso: '2026-09-02T00:00:00.000Z' },
  { teamExternalId: '2', position: 'WR', bid: 0, atIso: '2026-09-03T00:00:00.000Z' },
  { teamExternalId: '3', position: 'TE', bid: 0, atIso: '2026-09-04T00:00:00.000Z' },
  { teamExternalId: '3', position: 'QB', bid: 0, atIso: '2026-09-05T00:00:00.000Z' },
  { teamExternalId: '3', position: 'K', bid: 0, atIso: '2026-09-06T00:00:00.000Z' },
]
const MANAGERS = [
  { teamExternalId: '1', name: 'Viewer', faabRemaining: 40 },
  { teamExternalId: '2', name: 'Tasha', faabRemaining: 72 },
  { teamExternalId: '3', name: 'Dee', faabRemaining: 40 },
  { teamExternalId: '4', name: 'Mike', faabRemaining: 12 },
]
const edgeOf = (usesFaab: boolean) =>
  buildWaiverEdge({ season: 2026, usesFaab, claims: CLAIMS as never, managers: MANAGERS, viewerTeamExternalId: '1', asOf: '2026-09-25T12:44:20.000Z', stale: false })
const lines = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="waiver-edge-rival-line"]')].map((el) => el.textContent)

describe('rivalPieces', () => {
  it('folds the $0 count into the claims piece and keeps the order the facts came in', () => {
    expect(
      rivalPieces([
        { parts: { kind: 'faab_left', left: 72 } },
        { parts: { kind: 'claims', claims: 3, spent: 22 } },
        { parts: { kind: 'biggest_bid', bid: 18, position: 'RB' } },
        { parts: { kind: 'zero_bids', zero: 1, claims: 3 } },
        { parts: { kind: 'position', position: 'RB', count: 2 } },
      ]),
    ).toEqual([
      { kind: 'left', amount: 72 },
      { kind: 'claims', claims: 3, zero: 1, spent: 22 },
      { kind: 'biggest', bid: 18, position: 'RB' },
      { kind: 'position', position: 'RB', count: 2 },
    ])
  })

  it('a fact it does not know, or one with no parts, is skipped — the screen then falls back to the sentences', () => {
    expect(rivalPieces([{ parts: { kind: 'something_new' } }, { parts: null }, {}])).toEqual([])
    expect(rivalPieces([{ parts: { kind: 'no_claims' } }])).toEqual([{ kind: 'noClaims' }])
  })
})

describe('the line wording', () => {
  it('English: spent and $0 together, all-$0 said once, plurals', () => {
    const en = waiversGuideMessages.en
    expect(en.rivalClaims(3, 1, '$22')).toBe('3 claims, $22 spent, 1 at $0')
    expect(en.rivalClaims(3, 3, null)).toBe('3 claims, all at $0')
    expect(en.rivalClaims(1, 0, '$5')).toBe('1 claim, $5 spent')
    expect(en.rivalBiggest('$18', null)).toBe('biggest bid $18')
    expect(en.rivalPosition(2, 'RB')).toBe('2 RBs')
    expect(en.rivalPosition(1, 'RB')).toBe('1 RB')
  })

  it('Spanish never says «waiver», and every key has its pair', () => {
    const es = waiversGuideMessages.es
    expect(Object.keys(es).sort()).toEqual(Object.keys(waiversGuideMessages.en).sort())
    const said = [es.rivalLeft('$72'), es.rivalNoClaims, es.rivalClaims(3, 1, '$22'), es.rivalClaims(3, 3, null), es.rivalBiggest('$18', 'RB'), es.rivalPosition(2, 'RB')]
    for (const s of said) expect(s.toLowerCase()).not.toContain('waiver')
    expect(es.rivalClaims(3, 3, null)).toBe('3 reclamos, todos a $0')
  })
})

describe('Competitive edge: one line per manager', () => {
  it('English, a FAAB league', () => {
    const { container } = render(<WaiverCompetitiveEdge access={null} edge={{ available: true, data: edgeOf(true) }} />)
    expect(lines(container)).toEqual([
      '$72 left · 3 claims, $22 spent, 1 at $0 · biggest bid $18 (RB) · 2 RBs',
      '$40 left · 3 claims, all at $0',
      '$12 left · no claims won',
    ])
    // The comparison with yours is the league line's job, said once.
    expect(container.textContent?.match(/your \$40/g)?.length).toBe(1)
    expect(container.querySelector('.af-wv-edge-facts')).toBeNull()
  })

  it('under 3 claims there is no "$0 bids" fact, so a $0 total is still said', () => {
    const edge = buildWaiverEdge({
      season: 2026,
      usesFaab: true,
      claims: [CLAIMS[3], CLAIMS[4]] as never,
      managers: MANAGERS,
      viewerTeamExternalId: '1',
      asOf: '2026-09-25T12:44:20.000Z',
      stale: false,
    })
    const { container } = render(<WaiverCompetitiveEdge access={null} edge={{ available: true, data: edge }} />)
    expect(lines(container)).toContain('$40 left · 2 claims, $0 spent')
  })

  it('Spanish, a rolling-priority league', () => {
    lang.value = 'es'
    const { container } = render(<WaiverCompetitiveEdge access={null} edge={{ available: true, data: edgeOf(false) }} />)
    expect(lines(container)).toEqual(['3 reclamos', '3 reclamos · 2 RB', 'ningún reclamo ganado'])
  })
})

describe('Waiver intelligence on /core says each thing once', () => {
  it('/core: no budget subtitle, no reasons under the player', () => {
    const { container } = render(<WaiverIntel leagueId="lg1" surface="core" />)
    expect(screen.getByText('Tank Bigsby')).toBeTruthy()
    expect(container.querySelector('.bdx-sub')).toBeNull()
    expect(container.querySelectorAll('.bdx-reason')).toHaveLength(0)
    expect(container.textContent).not.toContain('calibrate against the room')
  })

  it('CONTROL: the Decide deck still shows both', () => {
    const { container } = render(<WaiverIntel leagueId="lg1" />)
    expect(container.querySelector('.bdx-sub')?.textContent).toMatch(/budget/)
    expect(container.querySelectorAll('.bdx-reason').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('calibrate against the room')
  })
})

describe('the Waivers screen and its board', () => {
  it('no intro under the headline, no claims footnote', () => {
    const screenSrc = src('components/core-app/screens/Waivers.tsx')
    expect(screenSrc).not.toMatch(/sub=\{guide\.intro\(/)
    expect(screenSrc).not.toContain('className="af-wv-footnote"')
    // Its comment quotes the removed line, so look for the call that rendered it, not the words.
    expect(screenSrc).not.toMatch(/copy\('Claims (are made on your platform|for this league are made here)/)
    expect(screenSrc).not.toContain('m.claimsMadeOn(')
  })

  it('"Worth adding" has no "Why it matters"', () => {
    const board = src('components/core-app/WaiverLineupBoard.tsx')
    expect(board).not.toContain('className="af-wvg-teach"')
    expect(board).not.toContain('guide.boardTeach')
  })
})
