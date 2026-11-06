/**
 * One header, not two (2026-11-06). The workspace banner (NativeLeagueWorkspace, shown on every tab) already carries
 * the league's name, sport, season, the Guilly chip and the team count. The Guilly hub's own hero repeated all of
 * it — the name a second time in display type, then NFL · 2026 · Guilly · 12 teams as chips — so the first two
 * screens of the tab said the same thing twice. The hero now says what only it can: this week's verdict, and which
 * week of the chop season this is. On a phone the repeated block is gone and the countdown carries the week.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen, within, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import { GuillotineSpecialtyHome } from '@/components/guillotine/GuillotineSpecialtyHome'

afterEach(cleanup)

const NAME = 'Last Team Standing'
const tiers = [
  { rosterId: 'r01', displayName: 'Blitz Brigade', tier: 'safe', pointsFromChopZone: 22.2 },
  { rosterId: 'r07', displayName: 'Gridiron Ghosts', tier: 'danger', pointsFromChopZone: 5.3 },
  { rosterId: 'r09', displayName: 'Two-Minute Drill', tier: 'chop_zone', pointsFromChopZone: 0 },
]
const home = {
  season: 2026,
  scores: { r01: 96.2, r07: 79.3, r09: 74 },
  teamCount: 12,
  aliveCount: 9,
  chopped: [{ rosterId: 'r10', name: 'Taco Tuesday FC', week: 3, points: 93.9 }],
  nextChopAt: new Date(Date.now() + 86_400_000).toISOString(),
  chopLabel: 'Tue 9:00 AM ET',
  nextWaiversAt: null,
  waiverLabel: null,
  lastChop: null,
}
const config = { tiebreakerOrder: ['season_points'], teamsPerChop: 1, dangerMarginPoints: 12, eliminationEndWeek: 11 }

function mount(myRosterId: string | null, extra: Record<string, unknown> = {}) {
  render(
    <GuillotineSpecialtyHome
      leagueId="L"
      sport="nfl"
      leagueName={NAME}
      summary={{ weekOrPeriod: 4, dangerTiers: tiers, myRosterId, myEscapes: [], config, home, ...extra } as never}
    />,
  )
}

/** Everything the workspace banner already says about the league. */
const IDENTITY = [NAME, 'NFL', '2026', '12 teams', '9 alive']

describe('the Guilly hero does not repeat the workspace banner', () => {
  it('desktop hero: no league name, no sport/season/Guilly/team-count chips', () => {
    mount('r07')
    const hero = screen.getByTestId('specialty-hero')
    for (const s of IDENTITY) expect(hero.textContent, `hero repeats "${s}"`).not.toContain(s)
    expect(within(hero).queryByText('Guilly')).toBeNull()
  })

  it('desktop hero leads with this week: the verdict as its title, the week of the chop season under it', () => {
    mount('r07')
    const hero = screen.getByTestId('specialty-hero')
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe('5.3 over the cut')
    expect(within(hero).getByTestId('specialty-headline').textContent).toBe('Week 4 of 11')
  })

  it('phone: no second title block; the countdown names the week', () => {
    mount('r07')
    const phone = screen.getByTestId('guillotine-phone-home')
    for (const s of IDENTITY) expect(phone.textContent, `phone hub repeats "${s}"`).not.toContain(s)
    expect(within(phone).queryByRole('heading', { level: 2, name: NAME })).toBeNull()
    expect(within(phone).getByText(/Week 4 of 11 · Chop locks in/i)).toBeTruthy()
  })

  it('a viewer with no roster sees the week as the title, not the league name', () => {
    mount(null)
    const hero = screen.getByTestId('specialty-hero')
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe('Week 4 of 11')
    expect(within(hero).queryByTestId('specialty-headline')).toBeNull()
  })

  it('a chopped viewer is told so in the title', () => {
    mount('r10', { home: { ...home, chopped: [{ rosterId: 'r10', name: 'Taco Tuesday FC', week: 3, points: 93.9 }] } })
    expect(within(screen.getByTestId('specialty-hero')).getByRole('heading', { level: 1 }).textContent).toBe('Chopped in week 3')
  })

  it('without a configured last week, the week stands alone', () => {
    mount('r07', { config: { ...config, eliminationEndWeek: null } })
    expect(within(screen.getByTestId('specialty-hero')).getByTestId('specialty-headline').textContent).toBe('Week 4')
  })
})
