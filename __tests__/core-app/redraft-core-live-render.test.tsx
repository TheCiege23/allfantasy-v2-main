/**
 * Redraft Live scores (design board LiveScores): the "now" strip, the games strip and its "Live now"
 * filter, and your matchup as a scoreboard card — all read from data the screen already holds, and
 * inert outside the redraft shell stamp.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => '/core/live',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import { LiveMatchupStrip } from '@/components/core-app/screens/LiveMatchupStrip'
import { livePageFixture } from '@/app/e2e/redraft-core/matchup/fixtures'
import { liveGameAnchor, liveSlateStrip } from '@/lib/live/liveSlateStrip'
import type { LiveGameCard, LiveRosterTieIn } from '@/lib/live/liveScoresPage'
import type { MatchupStrip } from '@/lib/live/matchupStrip'

const CSS = readFileSync(resolve(__dirname, '../../components/core-app/af-core-redraft-live.css'), 'utf8')

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

const tieIn = (playerId: string, leagueId: string, isStarter: boolean): LiveRosterTieIn => ({
  leagueId, leagueName: leagueId, playerId, playerName: `P ${playerId}`, position: 'WR', imageUrl: null, isStarter, points: null,
})

describe('liveSlateStrip — counts and "yours" from the slate', () => {
  const games = livePageFixture('NFL').games
  it('counts games by stage, on gameStage’s rule', () => {
    const s = liveSlateStrip(games)
    expect(s.live).toBe(games.filter((g) => g.isLive).length)
    expect(s.final).toBe(games.filter((g) => !g.isLive && g.completed).length)
    expect(s.live + s.final + s.upcoming).toBe(games.length)
    expect(s.chips.map((c) => c.gameId)).toEqual(games.map((g) => g.gameId))
  })
  it('one starter per player across leagues; a bench tie-in is not "yours"', () => {
    const live: LiveGameCard = {
      ...games.find((g) => g.isLive)!,
      tieIns: [tieIn('a', 'L1', true), tieIn('a', 'L2', true), tieIn('b', 'L1', false), tieIn('c', 'L1', true)],
    }
    const s = liveSlateStrip([live])
    expect(s.chips[0].yours).toEqual(['P a', 'P c'])
    expect(s.startersLive).toBe(2)
  })
  it('starters in a game that has not started are not "playing"', () => {
    const upcoming: LiveGameCard = { ...games[0], isLive: false, completed: false, tieIns: [tieIn('a', 'L1', true)] }
    expect(liveSlateStrip([upcoming]).startersLive).toBe(0)
    expect(liveSlateStrip([upcoming]).chips[0].yours).toHaveLength(1)
  })
})

describe('Live scores — the now strip and the games strip', () => {
  it('renders the counts, and every chip links to a card or final row that exists', () => {
    const data = livePageFixture('NFL')
    const { container } = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const s = liveSlateStrip(data.games)
    expect(container.querySelector('.af-live-now-counts')?.textContent).toBe(`${s.live} live · ${s.final} final · ${s.upcoming} upcoming`)
    const chips = [...container.querySelectorAll('a.af-live-chip')]
    expect(chips).toHaveLength(data.games.length)
    for (const chip of chips) {
      const id = chip.getAttribute('href')!.slice(1)
      expect(container.querySelector(`#${id}`)).not.toBeNull()
    }
    expect(container.querySelector(`#${liveGameAnchor(data.games[0].gameId)}`)).not.toBeNull()
  })
  it('"Live now" narrows the slate to live games, and back', () => {
    const data = livePageFixture('NFL')
    const live = data.games.filter((g) => g.isLive).length
    const { container, getByRole } = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const before = container.querySelectorAll('.af-live-game, .af-live-final').length
    const filter = getByRole('button', { name: /Live now/ })
    fireEvent.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.af-live-game, .af-live-final').length).toBe(live)
    expect(container.querySelectorAll('.af-live-final')).toHaveLength(0)
    fireEvent.click(filter)
    expect(container.querySelectorAll('.af-live-game, .af-live-final').length).toBe(before)
  })
  it('"Live now" cannot be switched on when nothing is live', () => {
    const data = livePageFixture('NFL')
    data.games = data.games.map((g) => (g.isLive ? { ...g, isLive: false, completed: true } : g))
    const { getByRole, queryByTestId } = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    const filter = getByRole('button', { name: /Live now/ }) as HTMLButtonElement
    expect(filter.disabled).toBe(true)
    fireEvent.click(filter)
    expect(filter.getAttribute('aria-pressed')).toBe('false')
    expect(queryByTestId('live-only-empty')).toBeNull()
  })
  it('the starters figure needs roster data — none read, no "0 of your starters"', () => {
    const data = livePageFixture('NFL')
    data.hasRosterData = false
    const { container } = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    expect(container.querySelector('.af-live-now-starters')).toBeNull()
    expect(container.querySelector('.af-live-chip-yours')).toBeNull()
  })
  it('shown under the redraft stamp, hidden everywhere else', () => {
    const data = livePageFixture('NFL')
    const rd = render(<Shell redraft><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    expect(shown(rd.container.querySelector('.af-live-now-wrap'))).toBe(true)
    rd.unmount()
    const plain = render(<Shell redraft={false}><LiveScores data={data} selectedLeagueId="e2e-redraft-core" /></Shell>)
    expect(plain.container.querySelector('.af-live-now-wrap')).not.toBeNull()
    expect(shown(plain.container.querySelector('.af-live-now-wrap'))).toBe(false)
  })
})

describe('Live scores — your matchup as a scoreboard card', () => {
  const scored = (over: Partial<Extract<MatchupStrip, { kind: 'scored' }>> = {}): MatchupStrip => ({
    kind: 'scored', week: 9, isFinal: false,
    you: { name: 'Fourth & Forever', points: 84.6 }, opponent: { name: 'Gridiron Ghosts', points: 71.2 },
    margin: 13.4, pWin: 0.71, remaining: { you: { upcoming: 2, live: 2 }, opponent: { upcoming: 3, live: 1 } },
    ...over,
  })
  it('the win-chance bar is the model’s probability, and a LIVE chip while a starter is on the field', () => {
    const { getByTestId, container } = render(<Shell redraft><LiveMatchupStrip strip={scored()} leagueId="L" pollMs={60_000} /></Shell>)
    expect((getByTestId('live-matchup-wp').firstElementChild as HTMLElement).style.width).toBe('71%')
    expect(container.querySelector('.af-live-matchup-live')?.textContent).toBe('LIVE')
  })
  it('no bar without a probability, none on a final week, and no LIVE chip when nobody is playing', () => {
    const a = render(<Shell redraft><LiveMatchupStrip strip={scored({ pWin: null })} leagueId="L" pollMs={60_000} /></Shell>)
    expect(a.queryByTestId('live-matchup-wp')).toBeNull()
    a.unmount()
    const b = render(<Shell redraft><LiveMatchupStrip strip={scored({ isFinal: true })} leagueId="L" pollMs={60_000} /></Shell>)
    expect(b.queryByTestId('live-matchup-wp')).toBeNull()
    expect(b.container.querySelector('.af-live-matchup-live')).toBeNull()
    b.unmount()
    const c = render(<Shell redraft><LiveMatchupStrip strip={scored({ remaining: { you: { upcoming: 2, live: 0 }, opponent: null } })} leagueId="L" pollMs={60_000} /></Shell>)
    expect(c.container.querySelector('.af-live-matchup-live')).toBeNull()
  })
  it('the eyebrow and bar are hidden outside the redraft stamp', () => {
    const { container } = render(<Shell redraft={false}><LiveMatchupStrip strip={scored()} leagueId="L" pollMs={60_000} /></Shell>)
    expect(shown(container.querySelector('.af-live-matchup-eyebrow'))).toBe(false)
    expect(shown(container.querySelector('.af-live-matchup-wp'))).toBe(false)
  })
})

describe('af-core-redraft-live.css — gated on the shell stamp', () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  const HIDE_ONLY = ['.af-live-now-wrap', '.af-live-matchup-eyebrow', '.af-live-matchup-wp']
  it('every selector is under the stamp except the hide-only rule', () => {
    expect(selectors.length).toBeGreaterThan(30)
    expect(selectors.filter((s) => !s.startsWith('.af-core.af-shell[data-format=redraft]') && !HIDE_ONLY.includes(s))).toEqual([])
    expect(css).toMatch(/\.af-live-now-wrap,\s*\.af-live-matchup-eyebrow,\s*\.af-live-matchup-wp\{display:none\}/)
  })
  it('no hex, no rgba(), one top-level @media', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/rgba?\(/)
    expect([...css.matchAll(/@media/g)]).toHaveLength(1)
  })
})
