import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { MyTeamData } from '@/lib/core-app/myTeam'

function data(over: Partial<MyTeamData>, team: Partial<{ record: string; recordKnown: boolean; rank: number | null }> = {}): MyTeamData {
  return {
    league: { id: 'kbfl', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
    team: {
      available: true,
      data: { teamName: 'BroVengers', ownerName: 'me', managerAvatarUrl: null, record: '9-5', recordKnown: true, rank: 3, pointsFor: 0, pointsAgainst: 0, teamCount: 32, ...team },
    },
    starters: { available: false, reason: 'n/a' },
    bench: { available: false, reason: 'n/a' },
    ir: { available: false, reason: 'n/a' },
    taxi: { available: false, reason: 'n/a' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    ...over,
  } as unknown as MyTeamData
}

const hrefs = (c: HTMLElement) => [...c.querySelectorAll('.af-mt-off-actions a')].map((a) => a.getAttribute('href'))

describe('My Team between seasons', () => {
  it('season complete in dynasty: final standing, rookie draft and trade center first', () => {
    const { container } = render(<MyTeam data={data({ completed: true })} />)
    expect(container.querySelector('.af-mt-off')?.getAttribute('data-phase')).toBe('complete')
    expect(container.querySelector('h1')?.textContent).toBe('Season complete')
    expect(container.querySelector('.af-mt-off-team')?.textContent).toContain('9-5 · finished 3rd of 32')
    expect(hrefs(container)).toEqual(['/core/draft-hq?league=kbfl', '/core/trades?league=kbfl', '/core?league=kbfl'])
    // No weekly lineup machinery when there is no week.
    expect(container.querySelector('.af-mt-lock, .af-mt-check, .af-mt-matchup')).toBeNull()
  })

  it('pre-draft: Draft HQ first, and no standing built from import order', () => {
    const { container } = render(<MyTeam data={data({ preDraft: true }, { recordKnown: false, record: 'No game…', rank: 7 })} />)
    expect(container.querySelector('h1')?.textContent).toBe('Draft pending')
    expect(container.querySelector('.af-mt-off-team')?.textContent).not.toContain('7')
    expect(hrefs(container)[0]).toBe('/core/draft-hq?league=kbfl')
  })

  it('eliminated in a redraft league: just the league overview, as the primary action', () => {
    const { container } = render(
      <MyTeam data={data({ eliminated: true, league: { id: 'g1', name: 'Chop', platform: 'sleeper', format: 'redraft', sourceLink: null } as MyTeamData['league'] })} />,
    )
    expect(container.querySelector('h1')?.textContent).toBe('Team eliminated')
    const links = [...container.querySelectorAll('.af-mt-off-actions a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/core?league=g1'])
    expect(links[0].className).toBe('af-btn')
    // Eliminated is not a final standing; the record stands alone.
    expect(container.querySelector('.af-mt-off-team')?.textContent).not.toContain('finished')
  })

  it('shows the between-seasons cards from data the loader already holds', () => {
    const { container } = render(
      <MyTeam
        data={data({
          completed: true,
          dynasty: {
            picks: { available: true, coverage: 'complete', bySeason: [{ season: 2027, picks: [{ season: 2027, round: 1, label: '1st', fromTeamName: null }] }] },
            ages: { available: false, reason: 'no ages on file for your starters' },
          },
          teamActivity: { items: [], feedNewest: null },
        })}
      />,
    )
    expect(container.querySelector('.af-mt-dynasty')?.textContent).toContain('2027')
    expect(container.querySelector('.af-mt-moves')).not.toBeNull()
  })
})
