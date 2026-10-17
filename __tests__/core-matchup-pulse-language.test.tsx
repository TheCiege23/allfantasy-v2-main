import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MatchupPulse } from '@/lib/core-app/matchupPulse'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: 'es' }),
}))

import { MatchupPulseBoard } from '@/components/core-app/MatchupPulseBoard'

describe('Spanish cross-league matchup board', () => {
  it('explains an unranked team and retains the route to all leagues', () => {
    const pulse = {
      leading: [], trailing: [], considered: 1, ranked: 0, basis: null, allFinal: false,
      notRanked: { noSchedule: 1, noOpponent: 0, unpriceable: 0, uncomparable: 0, unidentifiedRoster: 0 },
    } as MatchupPulse

    render(<MatchupPulseBoard pulse={pulse} allHref="/core/matchup?all=1" totalLeagues={1} />)
    expect(screen.getByRole('heading', { name: 'Tu situación' })).toBeTruthy()
    expect(screen.getByText('Sin clasificar: 1 sin calendario.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver 1 liga →' })).toHaveAttribute('href', '/core/matchup?all=1')
  })
})
