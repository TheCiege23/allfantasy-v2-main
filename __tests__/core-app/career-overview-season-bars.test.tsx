// @vitest-environment jsdom
/**
 * "Season by season" (board: Career, 2026-11-05) left the overview on 2026-11-14: Career progression on
 * the same page draws the same win rate by year, and its Titles tab the rings, so the page said it
 * twice. The component stays (career-season-bars.test.tsx); nothing on Overview or Seasons renders it.
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
  it('is not on the desktop overview; the progression chart carries win rate by year', () => {
    render(<Career screen={screenFor('overview')} />)
    expect(document.querySelector(".af-c13[data-view='overview'] .af-crs")).toBeNull()
    expect(document.querySelector(".af-c13[data-view='overview']")?.textContent).toContain('Career progression')
  })

  it('is not on the Seasons tab either', () => {
    render(<Career screen={screenFor('seasons')} />)
    expect(document.querySelector('.af-crs')).toBeNull()
  })
})
