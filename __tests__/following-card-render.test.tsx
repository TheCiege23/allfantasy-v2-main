import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FollowingCard } from '@/components/core-app/screens/FollowingCard'
import type { FollowingCardData, FollowingRow } from '@/lib/core-app/followingCard'

/*
 * The home "Following" card as rendered (2026-09-14). Hidden when follows are unavailable,
 * a blank status is never "healthy", and a stale feed is explained rather than left blank.
 */

const row = (over: Partial<FollowingRow> = {}): FollowingRow => ({
  sport: 'NFL',
  playerKey: '9221',
  sleeperId: '9221',
  externalId: null,
  name: 'Jahmyr Gibbs',
  position: 'RB',
  team: 'DET',
  status: null,
  next: null,
  ...over,
})

const data = (over: Partial<FollowingCardData> = {}): FollowingCardData => ({
  rows: [row()],
  total: 1,
  statusCoverage: 'ok',
  ...over,
})

describe('FollowingCard', () => {
  it('🛑 renders NOTHING when follows are unavailable', () => {
    const { container } = render(<FollowingCard data={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('an empty list invites a follow from the player card', () => {
    render(<FollowingCard data={data({ rows: [], total: 0 })} />)
    expect(screen.getByText(/Tap ☆ on any player card to follow him/)).toBeTruthy()
  })

  it('each row opens the player card and shows status + next game', () => {
    const { container } = render(
      <FollowingCard data={data({ rows: [row({ status: 'OUT', next: 'vs KC · Sun' })] })} />,
    )
    expect(screen.getByRole('button', { name: 'Jahmyr Gibbs' })).toBeTruthy()
    const chip = container.querySelector('.af3a-follow-status')
    expect(chip?.textContent).toBe('OUT')
    expect(chip?.getAttribute('data-status')).toBe('out')
    expect(screen.getByText('vs KC · Sun')).toBeTruthy()
  })

  it('🛑 no status means no chip — never "Active" or "Healthy"', () => {
    const { container } = render(<FollowingCard data={data()} />)
    expect(container.querySelector('.af3a-follow-status')).toBeNull()
    expect(screen.queryByText(/active|healthy/i)).toBeNull()
  })

  it('🛑 a feed that cannot answer is explained', () => {
    render(<FollowingCard data={data({ statusCoverage: 'unavailable' })} />)
    expect(screen.getByText(/injury feed can’t answer right now/)).toBeTruthy()
  })

  it('counts follows beyond the shown rows', () => {
    render(<FollowingCard data={data({ total: 9 })} />)
    expect(screen.getByText('+8 more you follow.')).toBeTruthy()
  })
})
