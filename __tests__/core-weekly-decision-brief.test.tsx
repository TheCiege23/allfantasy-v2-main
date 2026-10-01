import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeeklyRoutineData } from '@/lib/core-app/weeklyRoutine'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'en' }),
}))

import { YourWeekRoutine } from '@/components/core-app/screens/YourWeekRoutine'

const routine: WeeklyRoutineData = {
  today: 'lineups',
  todayLabel: 'Thursday',
  steps: [
    { key: 'results', day: 'Tue', title: 'Results review', href: '/core/week', today: false, state: 'done', summary: 'Scored' },
    { key: 'waivers', day: 'Wed', title: 'Waivers', href: '/core/waivers', today: false, state: 'open', summary: 'No adds yet' },
    { key: 'lineups', day: 'Thu', title: 'Lineup check', href: '/core/my-team', today: true, state: 'open', summary: 'One starter may not play' },
    { key: 'gameday', day: 'Sun', title: 'Game day', href: '/core/matchup', today: false, state: 'unknown', summary: null },
    { key: 'recap', day: 'Mon', title: 'Recap', href: '/core/week', today: false, state: 'unknown', summary: null },
  ],
  recap: null,
  awards: [],
  upsets: [],
}

describe('weekly decision brief', () => {
  it('shows open decisions first with direct actions and alert controls', () => {
    render(<YourWeekRoutine data={routine} />)
    const brief = screen.getByRole('generic', { name: 'Your next decisions' })
    const reviews = within(brief).getAllByRole('link', { name: /Review/ })
    expect(reviews.map((link) => link.getAttribute('href'))).toEqual(['/core/waivers', '/core/my-team', '/core/matchup'])
    expect(within(brief).getByRole('link', { name: 'Control alerts' })).toHaveAttribute('href', '/alerts/settings')
  })
})
