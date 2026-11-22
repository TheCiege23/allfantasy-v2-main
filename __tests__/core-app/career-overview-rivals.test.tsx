// @vitest-environment jsdom
/**
 * Career overview → "Your rivals": the three most-played opponents with your head-to-head record,
 * fed from the cached weekly record book, linking to the full ledger on the Records tab. Absent when
 * there is no rival on file (or the summary is not built), and never on another tab.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/core/career',
  useSearchParams: () => new URLSearchParams(),
}))

import { Career } from '@/components/core-app/screens/Career'
import { buildCareerData, type CareerRow } from '@/lib/core-app/careerModel'
import type { CareerScreenData } from '@/lib/core-app/careerScreen'
import type { CareerRival } from '@/lib/core-app/careerRecordBook'
import { row } from './careerFixtures'

const rows: CareerRow[] = [row({ season: 2023, wins: 10, losses: 4 }), row({ season: 2024, wins: 6, losses: 8 })]

const rival = (key: string, name: string, meetings: number, wins: number, losses: number, seasons: number[]): CareerRival => ({
  key, name, meetings, wins, losses, ties: 0, pointsFor: 0, pointsAgainst: 0, leagues: ['Dynasty Dragons'], seasons, lastSeason: seasons[seasons.length - 1],
})
const RIVALS = [
  rival('u:1', 'waiverwire', 9, 6, 3, [2021, 2022, 2024]),
  rival('u:2', 'tacotuesday', 7, 2, 5, [2023, 2024]),
  rival('u:3', 'hurtsdonut', 5, 2, 3, [2024]),
  rival('u:4', 'ceedeenuts', 4, 4, 0, [2024]),
]

const screenFor = (view: CareerScreenData['view'], rivals: CareerRival[] | null): CareerScreenData => ({
  view,
  data: buildCareerData({ identity: { handle: 'guap', avatarUrl: null, xpTotal: 1000 }, rows, platforms: ['sleeper'], rosterless: 0 }),
  awards: [],
  trades: [],
  profile: { builtAt: null, origin: 'built' },
  timeline: null,
  records: null,
  peers: null,
  coverage: null,
  rivals,
})

afterEach(cleanup)

describe('Career overview — Your rivals', () => {
  it('shows the three most-played opponents with record and seasons, and links to the ledger', () => {
    render(<Career screen={screenFor('overview', RIVALS)} />)
    const card = document.querySelector('[data-testid="career-rivals"]')!
    expect(card).not.toBeNull()
    const rows = Array.from(card.querySelectorAll('[data-testid="career-rival"]'))
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('waiverwire')
    expect(rows[0].textContent).toContain('9 games · 2021–2024')
    expect(rows[0].querySelector('.af-crr-rec')?.getAttribute('data-tone')).toBe('good')
    expect(rows[1].querySelector('.af-crr-rec')?.getAttribute('data-tone')).toBe('bad')
    expect(rows[2].textContent).toContain('5 games · 2024')
    expect(card.querySelector('a')?.getAttribute('href')).toContain('view=records')
  })

  it('is absent with no rival on file, and on other tabs', () => {
    render(<Career screen={screenFor('overview', null)} />)
    expect(document.querySelector('[data-testid="career-rivals"]')).toBeNull()
    cleanup()
    render(<Career screen={screenFor('seasons', RIVALS)} />)
    expect(document.querySelector('[data-testid="career-rivals"]')).toBeNull()
  })
})
