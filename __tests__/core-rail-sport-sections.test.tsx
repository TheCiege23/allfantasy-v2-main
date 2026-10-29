import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { leagueSportSections } from '@/lib/core-app/leagueSports'

// One router object -- see core-rail-active-league.test.tsx for why a fresh one per call hangs.
const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

function shell(leagues: Array<Record<string, unknown>>) {
  return (
    <AfCoreShell
      active="home"
      leagues={leagues as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

/** The rail in document order: a sport heading reads as `# NFL`, a league tile as its id. */
function railOrder(container: HTMLElement): string[] {
  const scroll = container.querySelector('#af-rail-scroll')!
  return Array.from(scroll.children).map((el) =>
    el.classList.contains('af-rail-sport')
      ? `# ${el.textContent}`
      : (el.getAttribute('href') ?? '').replace(/^.*league=/, ''),
  )
}

describe('leagueSportSections', () => {
  it('groups by sport in product order and keeps the input order inside each sport', () => {
    const rows = [
      { id: 'b', sport: 'NBA' },
      { id: 'z', sport: 'NFL' },
      { id: 'x', sport: null },
      { id: 'a', sport: 'NFL' },
      { id: 'h', sport: 'NHL' },
    ]
    expect(leagueSportSections(rows).map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ['NFL', ['z', 'a']],
      ['NBA', ['b']],
      ['NHL', ['h']],
      [null, ['x']],
    ])
  })
})

describe('the /core league rail', () => {
  it('splits into a section per sport, keeping the account order inside each one', () => {
    const { container } = render(
      shell([
        { id: 'nba1', name: 'Hoops', platform: 'sleeper', mark: 'H', sport: 'NBA' },
        { id: 'nfl2', name: 'Zebra NFL', platform: 'sleeper', mark: 'Z', sport: 'NFL' },
        { id: 'nhl1', name: 'Ice', platform: 'espn', mark: 'I', sport: 'NHL' },
        { id: 'nfl1', name: 'Alpha NFL', platform: 'sleeper', mark: 'A', sport: 'NFL' },
      ]),
    )
    expect(railOrder(container)).toEqual(['# NFL', 'nfl2', 'nfl1', '# NBA', 'nba1', '# NHL', 'nhl1'])
  })

  it('draws no headings when every league is the same sport', () => {
    const { container } = render(
      shell([
        { id: 'a', name: 'A', platform: 'sleeper', mark: 'A', sport: 'NFL' },
        { id: 'b', name: 'B', platform: 'sleeper', mark: 'B', sport: 'NFL' },
      ]),
    )
    expect(railOrder(container)).toEqual(['a', 'b'])
  })
})
