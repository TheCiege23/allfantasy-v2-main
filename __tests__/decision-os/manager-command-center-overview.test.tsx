import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import ManagerCommandCenterOverview from '@/components/decision-os/ManagerCommandCenterOverview'

describe('ManagerCommandCenterOverview', () => {
  it('renders all 4 real stat values', () => {
    render(
      <ManagerCommandCenterOverview
        totalLeagues={5}
        trackedLeagueCount={4}
        leaguesNeedingAttentionCount={2}
        draftsApproachingCount={1}
      />,
    )
    const el = screen.getByTestId('manager-command-center-overview')
    expect(el).toHaveTextContent('5')
    expect(el).toHaveTextContent('4')
    expect(el).toHaveTextContent('2')
    expect(el).toHaveTextContent('1')
    expect(el).toHaveTextContent('Total leagues')
    expect(el).toHaveTextContent('Need attention')
  })
})
