/**
 * Redraft batch B3: the real /core Matchup and Live scores screens, rendered inside a /core shell root
 * carrying (or not carrying) the redraft stamp, with the batch stylesheet loaded into the document — so
 * the gates are read from COMPUTED style, the way a browser applies them, not from the CSS source.
 *
 * What is pinned:
 *   - redraft only: the three new elements (final "F" marker, its key entry, the bar's LIVE word) show
 *     under `data-format="redraft"` and nowhere else;
 *   - the win probability is drawn on a live or upcoming week when provided, and NOT on a final week;
 *   - each game card carries its stage, and no bar ever reads a period zero.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => '/core/live',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import Matchup from '@/components/core-app/screens/Matchup'
import { LiveScores } from '@/components/core-app/screens/LiveScores'
import { livePageFixture, matchupFixture, FIXTURE_SPORTS } from '@/app/e2e/redraft-core/matchup/fixtures'
import type { LiveGameCard } from '@/lib/live/liveScoresPage'

const CSS = readFileSync(resolve(__dirname, '../../components/core-app/af-core-redraft-matchup.css'), 'utf8')

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
})
afterEach(cleanup)

function Shell({ redraft, children }: { redraft: boolean; children: React.ReactNode }) {
  return (
    <div className="af-core af-shell" data-format={redraft ? 'redraft' : undefined} data-sport={redraft ? 'nfl' : undefined}>
      {children}
    </div>
  )
}
const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none'

describe('Matchup — redraft score bug gates', () => {
  it('a final week: the win probability is withdrawn under redraft, kept elsewhere (no other league changes)', () => {
    const { container, unmount } = render(<Shell redraft><Matchup data={matchupFixture('NFL', 'final')} /></Shell>)
    expect(container.querySelector('.af-mu')?.getAttribute('data-week')).toBe('final')
    expect(container.querySelector('.af-mu-wp')).not.toBeNull()
    expect(shown(container.querySelector('.af-mu-wp'))).toBe(false)
    expect(shown(container.querySelector('.af-mu-centre-value'))).toBe(false)
    // The result chip stays: on a final week it IS the result.
    expect(shown(container.querySelector('.af-mu-margin'))).toBe(true)
    unmount()

    const plain = render(<Shell redraft={false}><Matchup data={matchupFixture('NFL', 'final')} /></Shell>)
    expect(shown(plain.container.querySelector('.af-mu-wp'))).toBe(true)
  })

  it.each(['live', 'upcoming'] as const)('a %s week draws the win probability it was given', (state) => {
    const { container } = render(<Shell redraft><Matchup data={matchupFixture('NFL', state)} /></Shell>)
    expect(container.querySelector('.af-mu')?.getAttribute('data-week')).toBe(state)
    expect(shown(container.querySelector('.af-mu-wp'))).toBe(true)
    expect(shown(container.querySelector('.af-mu-centre-value'))).toBe(true)
  })

  it('no win probability provided: nothing is drawn in its place but the existing dash', () => {
    const data = { ...matchupFixture('NFL', 'live'), winProbability: { available: false as const, reason: 'n/a' } }
    const { container } = render(<Shell redraft><Matchup data={data} /></Shell>)
    expect(container.querySelector('.af-mu-wp')).toBeNull()
    expect(container.querySelector('.af-mu-centre-value')).toBeNull()
  })

  it('the final-game marker: one per finished starter on a live board, visible only under redraft', () => {
    const data = matchupFixture('NBA', 'live')
    const finished = data.lineups.available
      ? data.lineups.data.flatMap((s) => [s.you, s.opponent]).filter((c) => c?.gameState === 'final').length
      : 0
    expect(finished).toBeGreaterThan(0)
    const rd = render(<Shell redraft><Matchup data={data} /></Shell>)
    const marks = [...rd.container.querySelectorAll('.af-mu-board .af-mu-rd-final')]
    expect(marks).toHaveLength(finished)
    expect(marks.every(shown)).toBe(true)
    expect(shown(rd.container.querySelector('.af-mu-rd-only'))).toBe(true)
    // Each finished half also carries its state for the row tint.
    expect(rd.container.querySelectorAll('.af-mu-half[data-gs="final"]')).toHaveLength(finished)
    rd.unmount()

    const plain = render(<Shell redraft={false}><Matchup data={data} /></Shell>)
    expect([...plain.container.querySelectorAll('.af-mu-rd-final')].some(shown)).toBe(false)
    expect(shown(plain.container.querySelector('.af-mu-rd-only'))).toBe(false)
  })

  it('before kickoff there is no marker at all', () => {
    const { container } = render(<Shell redraft><Matchup data={matchupFixture('NFL', 'upcoming')} /></Shell>)
    expect(container.querySelectorAll('.af-mu-rd-final')).toHaveLength(0)
    expect(container.querySelectorAll('.af-mu-half[data-gs]')).toHaveLength(0)
  })
})

describe('Live scores — a score bug per game', () => {
  it.each(FIXTURE_SPORTS)('%s: every card carries its stage and no bar reads a period zero', (sport) => {
    const page = livePageFixture(sport)
    const { container } = render(<Shell redraft><LiveScores data={page} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const cards = [...container.querySelectorAll('.af-live-slate > .af-live-game')]
    expect(cards.length).toBe(page.games.filter((g) => !g.completed).length)
    for (const c of cards) expect(['live', 'upcoming']).toContain(c.getAttribute('data-state'))
    for (const h of container.querySelectorAll('.af-live-game-head')) expect(h.textContent).not.toMatch(/\b(Q|P)0\b/)
  })

  it('NHL fourth period reads OT on the bar', () => {
    const { container } = render(<Shell redraft><LiveScores data={livePageFixture('NHL')} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const heads = [...container.querySelectorAll('.af-live-game[data-state="live"] .af-live-clock')].map((h) => h.textContent)
    expect(heads.some((t) => /OT · 3:10/.test(t ?? ''))).toBe(true)
    expect(heads.some((t) => /P4/.test(t ?? ''))).toBe(false)
  })

  it('a period-zero clock is never printed — the bar says LIVE (redraft) / Live (elsewhere)', () => {
    const base = livePageFixture('NFL')
    const zero: LiveGameCard = { ...base.games[0], clockLabel: 'Q0 · 15:00', statusDetail: 'Q0' }
    const data = { ...base, games: [zero] }
    const rd = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const clock = rd.container.querySelector('.af-live-game .af-live-clock')!
    expect(clock.textContent).not.toMatch(/Q0/)
    expect(shown(clock.querySelector('.af-live-bug-word'))).toBe(true)
    // The fallback "Live" is hidden under redraft so the bar does not read "LIVE Live".
    expect(shown(clock.querySelector('[data-fallback]'))).toBe(false)
    rd.unmount()

    const plain = render(<Shell redraft={false}><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const pclock = plain.container.querySelector('.af-live-game .af-live-clock')!
    expect(shown(pclock.querySelector('.af-live-bug-word'))).toBe(false)
    expect(shown(pclock.querySelector('[data-fallback]'))).toBe(true)
  })

  it('the LIVE word is redraft-only', () => {
    const plain = render(<Shell redraft={false}><LiveScores data={livePageFixture('NBA')} selectedLeagueId="e2e-redraft-core" /></Shell>)
    expect([...plain.container.querySelectorAll('.af-live-bug-word')].some(shown)).toBe(false)
    plain.unmount()
    const rd = render(<Shell redraft><LiveScores data={livePageFixture('NBA')} selectedLeagueId="e2e-redraft-core" /></Shell>)
    expect([...rd.container.querySelectorAll('.af-live-bug-word')].every(shown)).toBe(true)
  })
})
