import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeagueWaitingForCommissionerCard } from '@/components/league/post-create-first-run/LeagueWaitingForCommissionerCard'

describe('LeagueWaitingForCommissionerCard', () => {
  it('returns null when lifecycle is not predraft', () => {
    render(
      <LeagueWaitingForCommissionerCard
        leagueId="x"
        lifecycleState="in_season"
        draftDateIso={null}
        managersJoined={0}
        managersCapacity={12}
        onOpenLeagueChat={() => {}}
      />,
    )
    expect(screen.queryByText(/setting up the league/i)).toBeNull()
  })

  it('renders for predraft lifecycle', () => {
    render(
      <LeagueWaitingForCommissionerCard
        leagueId="x"
        lifecycleState="pre_draft"
        draftDateIso={null}
        managersJoined={2}
        managersCapacity={12}
        onOpenLeagueChat={() => {}}
      />,
    )
    expect(screen.getByText(/setting up the league/i)).toBeTruthy()
  })
})
