/**
 * My Leagues board restyle (2026-11-05): the eyebrow over the title sums the account from the
 * server's counts and the sport tabs — and leaves a zero part out rather than printing "0 need you".
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MyLeaguesV4 } from '@/components/core-app/screens/MyLeaguesV4'
import type { MyLeaguesLeague } from '@/lib/core-app/myLeagues'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))

function league(id: string, sport: string | null): MyLeaguesLeague {
  return {
    id,
    name: `League ${id}`,
    platform: 'sleeper',
    sport,
    tier: 'quiet',
    isDynasty: false,
    isCommissioner: false,
    reason: null,
    href: `/core?league=${id}`,
  } as MyLeaguesLeague
}

const COUNTS = { live: 0, history: 0, all: 0, needs: 0, playing: 0, quiet: 0, commissioner: 0, drafting: 0, dynasty: 0 }

function renderList(leagues: MyLeaguesLeague[], over: Partial<typeof COUNTS> = {}) {
  return render(
    <MyLeaguesV4
      leagues={leagues}
      history={[]}
      counts={{ ...COUNTS, live: leagues.length, all: leagues.length, quiet: leagues.length, ...over }}
      platforms={['sleeper']}
      coverage={[]}
      notice={null}
      importHref="/import"
    />,
  )
}

describe('My Leagues eyebrow', () => {
  it('sums leagues, sports, the ones that need you and the ones you run', () => {
    renderList([league('a', 'NFL'), league('b', 'NBA'), league('c', 'NFL')], { needs: 2, commissioner: 1 })
    expect(screen.getByTestId('my-leagues-eyebrow').textContent).toBe('3 leagues · 2 sports · 2 need you · 1 you run')
  })

  it('leaves zero parts and a single sport out', () => {
    renderList([league('a', 'NFL')])
    expect(screen.getByTestId('my-leagues-eyebrow').textContent).toBe('1 league')
  })
})
