// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * The /core home, simplified (2026-11-24). Users called the pages crowded; on a phone the home was
 * ~6,460px tall. What it now does, pinned here:
 *  - "Why it matters" lines are closed until tapped (decisions, season, leagues you run, waiver times);
 *  - the decision tiers keep their title and drop the hint sentence under it;
 *  - the inactive-manager ladder on the home is one closed row with its counts;
 *  - the waiver calendar and the league formats are closed reference cards.
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: ReactNode; prefetch?: unknown }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/partner-codes/PartnerCodeNudge', () => ({ PartnerCodeNudge: () => null }))

import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import { HomeCommishCard } from '@/components/core-app/home/HomeCommishCard'
import { HomeSeasonPulse } from '@/components/core-app/home/HomeSeasonPulse'
import { HomePlatformCalendar } from '@/components/core-app/home/HomePlatformCalendar'
import { HomeFormatGuide } from '@/components/core-app/home/HomeFormatGuide'
import { buildInactiveLadder } from '@/lib/core-app/commissioner/inactiveLadder'

afterEach(cleanup)

const NOW = '2026-11-12T21:00:00.000Z'
const whyFolds = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-testid="home-why"]'))

describe('decisions', () => {
  const stale: CoreIssue = {
    id: 's1',
    severity: 'warn',
    glyph: '!',
    title: 'League data out of date — Sample ESPN League',
    meta: 'ESPN › Sync · last read 3d ago',
    leagueId: 'L1',
    leagueName: 'Sample ESPN League',
    platform: 'espn',
    deadline: null,
    action: null,
    parts: { kind: 'stale', leagueName: 'Sample ESPN League', platform: 'ESPN', lastReadAgo: '3d ago', actionPlatform: null },
  }

  it('teaches behind a closed "Why it matters", and opens on tap', () => {
    render(<DecisionQueue issues={[stale]} scopeLabel="All leagues" scopeKey="t" nowIso={NOW} showCount={false} />)
    const [why] = whyFolds()
    expect(why).toBeDefined()
    expect(why!.open).toBe(false)
    expect(why!.querySelector('summary')!.textContent).toBe('Why it matters')
    fireEvent.click(why!.querySelector('summary')!)
    expect(why!.open).toBe(true)
  })

  it('a tier keeps its title and drops the hint sentence under it', () => {
    render(<DecisionQueue issues={[stale]} scopeLabel="All leagues" scopeKey="t" nowIso={NOW} showCount={false} />)
    const head = document.querySelector('.af-decision-tierhead')!
    expect(head.querySelectorAll('span')).toHaveLength(0)
    expect(head.querySelector('b')!.textContent).toBeTruthy()
  })
})

describe('leagues you run', () => {
  const ladder = buildInactiveLadder(
    [
      {
        leagueId: 'c1',
        leagueName: 'Sample League',
        hubHref: '#',
        replaceHref: '#',
        managers: [
          { name: 'Manager A', status: 'inactive', lastActionAt: null },
          { name: 'Manager B', status: 'inactive', lastActionAt: new Date(Date.parse(NOW) - 16 * 86_400_000).toISOString() },
        ],
      },
    ],
    new Date(NOW),
  )

  it('the ladder is one closed row with its counts; its rows are inside it', () => {
    render(<HomeCommishCard runCount={3} stats={[]} risks={[]} partial={false} ladder={ladder} />)
    const fold = screen.getByTestId('home-ladder-fold') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector(':scope > summary')!.textContent).toMatch(/^Inactive managers.*to replace/)
    expect(fold.querySelectorAll('.af-ladder-list > li').length).toBe(ladder.length)
    // The list's own heading is not drawn twice.
    expect(fold.querySelector('.af-ladder-head')).toBeNull()
    expect(whyFolds()[0]!.open).toBe(false)
  })

  it('"everyone is active" is still said in the open — there is nothing to fold', () => {
    render(<HomeCommishCard runCount={3} stats={[]} risks={[]} partial={false} ladder={[]} />)
    expect(screen.queryByTestId('home-ladder-fold')).toBeNull()
    expect(document.querySelector('.af-ladder-none')).not.toBeNull()
  })
})

describe('season, waiver times and formats', () => {
  it('the season card teaches behind a closed fold', () => {
    render(
      <HomeSeasonPulse
        pulse={{ ranked: 1, unranked: 0, topHalf: 1, bubble: 0, bottomHalf: 0, firstPlace: 1, wins: 8, losses: 1, ties: 0, best: [], worst: [] }}
      />,
    )
    expect(whyFolds()).toHaveLength(1)
    expect(whyFolds()[0]!.open).toBe(false)
  })

  it('the waiver calendar and the formats guide are closed cards that keep their titles', () => {
    render(
      <>
        <HomePlatformCalendar rows={[]} nextKickoffIso={null} />
        <HomeFormatGuide formats={[{ key: 'dynasty', count: 4 }]} />
      </>,
    )
    for (const id of ['home-calendar-fold', 'home-formats-fold']) {
      const fold = screen.getByTestId(id) as HTMLDetailsElement
      expect(fold.open, id).toBe(false)
      expect(fold.querySelector(':scope > summary h2')!.textContent).toBeTruthy()
    }
  })
})
