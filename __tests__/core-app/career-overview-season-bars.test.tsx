// @vitest-environment jsdom
/**
 * The Career overview carries "Season by season" (board: Career, 2026-11) between the best seasons
 * and the live half — and only the overview: the Seasons tab is already the same years as a table.
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
import { row } from './careerFixtures'

const rows: CareerRow[] = [
  row({ season: 2022, wins: 7, losses: 7 }),
  row({ season: 2023, wins: 10, losses: 4, madePlayoffs: true, isChampion: true }),
  row({ season: 2024, wins: 6, losses: 8, leagueName: 'Sunday Night Redraft' }),
]

const screenFor = (view: CareerScreenData['view']): CareerScreenData => ({
  view,
  data: buildCareerData({
    identity: { handle: 'guap', avatarUrl: null, xpTotal: 12_000 },
    rows,
    platforms: ['sleeper'],
    rosterless: 0,
  }),
  awards: [],
  trades: [],
  profile: { builtAt: null, origin: 'built' },
  timeline: null,
  records: null,
  peers: null,
  coverage: null,
})

afterEach(cleanup)

describe('Career overview — Season by season', () => {
  it('renders the bars inside the desktop overview, one per finished season, the title year starred', () => {
    render(<Career screen={screenFor('overview')} />)
    const bars = document.querySelector(".af-c13[data-view='overview'] .af-crs")
    expect(bars).not.toBeNull()
    const cols = Array.from(bars!.querySelectorAll('.af-crs-col')) as HTMLElement[]
    expect(cols.map((c) => c.dataset.season)).toEqual(['2022', '2023', '2024'])
    expect(cols.map((c) => c.dataset.titles ?? null)).toEqual([null, '1', null])
  })

  it('is not repeated on the Seasons tab', () => {
    render(<Career screen={screenFor('seasons')} />)
    expect(document.querySelector('.af-crs')).toBeNull()
  })
})
