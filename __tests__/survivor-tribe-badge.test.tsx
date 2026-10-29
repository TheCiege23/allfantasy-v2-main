import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DraftTeamStrip } from '@/components/app/draft-room/DraftTeamStrip'
import { SurvivorTribeBadge } from '@/components/league/survivor/SurvivorTribeBadge'

describe('Survivor tribe badges in the draft room', () => {
  it('the team strip shows a seat\'s tribe when the snapshot carries one', () => {
    render(
      <DraftTeamStrip
        teamCount={2}
        slotOrder={[
          { slot: 1, rosterId: 'r1', displayName: 'Ana', tribe: { id: 't0', name: 'Tribe Wolves', colorHex: '#ff0000', markUrl: 'https://blob/w.png', crestUrl: null } },
          { slot: 2, rosterId: 'r2', displayName: 'Ben' },
        ]}
      />,
    )
    const badges = screen.getAllByTestId('survivor-tribe-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('Tribe Wolves')
    expect(badges[0].querySelector('img')?.getAttribute('src')).toBe('https://blob/w.png')
    expect(badges[0].style.color).toBe('rgb(255, 0, 0)')
  })

  it('falls back to a colour dot and the accent colour without a mark or a colour', () => {
    render(<SurvivorTribeBadge tribe={{ name: 'Hawks', colorHex: null, markUrl: null }} />)
    const badge = screen.getByTestId('survivor-tribe-badge')
    expect(badge.querySelector('img')).toBeNull()
    expect(badge).toHaveTextContent('Hawks')
  })
})
