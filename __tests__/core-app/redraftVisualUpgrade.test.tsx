// @vitest-environment jsdom
/**
 * Redraft core screens after the 2026-11-24 visual audit (DB-free harness at /e2e/redraft-core/*):
 * 1. Home listed the standings twice — the redraft deck's 12-row playoff race, then a 6-row table — each with
 *    its own "Full standings".
 * 2. Draft HQ, with no draft AllFantasy runs, said so in the header and again in a "Prepared queue" row.
 * 3. Live scores said "N of your starters are playing" in the headline and again in the strip under it.
 * 4. A completed trade printed its two values three times: on each side's grade line and in the summary; a
 *    trade idea's date read "2026-10-30".
 * 5. Home on a desktop: a gap under "Last week's recap" beside the tall race, "Points for" alone on a row
 *    below, and a "Moves" cell that only repeated the bottom nav.
 * Harness gaps fixed with them: the week board carried no sport (NFL read "Period 9"), every Home game carried
 * the viewer's own 64%, and Standings' fixture said "your last two" beside "all 3".
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { YourWeekLeague } from '@/components/core-app/screens/YourWeekLeague'
import { Trades } from '@/components/core-app/screens/Trades'
import { LiveNowStrip } from '@/components/core-app/screens/LiveNowStrip'
import { homeFixture } from '@/app/e2e/redraft-core/home/fixture'
import { draftHqFixture } from '@/app/e2e/redraft-core/b5/fixtures'
import { weekBoardFixture } from '@/app/e2e/redraft-core/myteam/fixtures'
import { tradesFixture } from '@/app/e2e/redraft-core/trades/fixtures'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function home() {
  const { data } = homeFixture('NFL', { identity: true })
  return render(<LeagueHome data={data} otherLeagueIssueCount={0} identityInShell />)
}

describe('1. Home: the standings once', () => {
  it('the playoff race is the table; no second standings block', () => {
    const { container } = home()
    expect(screen.getByTestId('redraft-playoff-race')).toBeTruthy()
    expect(screen.queryByTestId('league-home-standings-all')).toBeNull()
    expect(container.textContent?.match(/Full standings/g)?.length).toBe(1)
  })
})

describe('2. Draft HQ: no queue row without a draft to queue for', () => {
  it('says "no upcoming draft" once', () => {
    const { container } = render(<DraftHq data={draftHqFixture('NFL', 'sleeper')} edge={null} edgeAccess={null} />)
    expect(container.textContent?.match(/no upcoming draft is scheduled/gi)?.length).toBe(1)
    expect(container.textContent).not.toMatch(/Prepared queue|a prepared queue belongs/i)
  })
})

describe('3. Live scores: the starters count once', () => {
  it('the strip drops its starters line when the headline says it', () => {
    const strip = { chips: [], live: 2, final: 2, upcoming: 1, startersLive: 2 } as never
    const { container, rerender } = render(<LiveNowStrip strip={strip} now={Date.now()} sportLabel="NFL" hasRosterData startersInHeadline liveOnly={false} onLiveOnly={() => {}} />)
    expect(container.querySelector('.af-live-now-starters')).toBeNull()
    rerender(<LiveNowStrip strip={strip} now={Date.now()} sportLabel="NFL" hasRosterData liveOnly={false} onLiveOnly={() => {}} />)
    expect(container.querySelector('.af-live-now-starters')).toBeTruthy()
    expect(read('components/core-app/screens/LiveScores.tsx')).toMatch(/startersInHeadline=\{moment\.kind === 'live'\}/)
  })
})

describe('4. Trades: values once, dates in words', () => {
  it('a completed trade says its two values once; an idea reads "Oct 30"', () => {
    const { container } = render(<Trades data={tradesFixture('2026-11-25T00:00:00Z')} hidePending />)
    const t = container.textContent ?? ''
    expect(t.match(/6,820/g)?.length).toBe(1)
    expect(t).not.toMatch(/\b2026-10-30\b/)
    expect(t).toMatch(/Oct 30/)
  })
})

describe('5. Home on a desktop: no gap, nothing alone, no nav repeated', () => {
  it('the tiles sit in the deck beside the race, and the week card is the lineup check alone', () => {
    const { container } = home()
    const under = screen.getByTestId('redraft-deck-under')
    expect(under.querySelector('[data-testid="league-home-kpis"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="league-home-kpis"]')).toHaveLength(1)
    expect(container.querySelector('.af-lh-week-summary-grid')?.getAttribute('data-cells')).toBe('1')
    expect(container.querySelector('.af-lh-week-summary-moves')).toBeNull()
    expect(read('components/core-app/af-league-home-redraft.css')).toMatch(/\.af-lh-rd-grid\[data-has-race\]>\.af-lh-rd-under\{grid-column:1;grid-row:3/)
  })
})

describe('Harness gaps', () => {
  it('an NFL week board says "Week", not "Period"', () => {
    const { container } = render(<YourWeekLeague board={weekBoardFixture('NFL')} allWeeksHref="/core/week" lineups={null} />)
    expect(container.textContent).not.toMatch(/Period \d/)
    expect(container.textContent).toMatch(/Week \d/)
  })
  it('each Home game has its own odds, and the Standings fixture agrees with three games left', () => {
    const { data } = homeFixture('NFL', { identity: true })
    const odds = new Set((data as unknown as { scoreboard?: { available: boolean; data: { games: { winProbability: number | null }[] } } }).scoreboard?.data?.games?.map((g) => g.winProbability) ?? [])
    expect(odds.size).toBeGreaterThan(1)
    expect(read('app/e2e/redraft-core/standings/fixtures.ts')).not.toMatch(/your last two/)
  })
})
