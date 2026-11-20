import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'
import { hasUnsavedWork } from '@/lib/core-app/unsavedWork'

/*
 * A waiver claim being composed (drop, bid, priority) holds the deploy reload: after a deploy the
 * page reloads when it goes into the background, and a reload throws the half-built claim away.
 */
const PLAYER = { id: 'p1', name: 'Jaylen Wright', position: 'RB', team: 'MIA' }
const props = { onClose: () => {}, faabMode: true, faabRemaining: 50, onSubmit: () => {}, rosterPlayerIds: ['x1'] }

afterEach(() => cleanup())

describe('WaiverClaimDrawer', () => {
  it('holds while open with a player, and releases when it closes', () => {
    const { rerender } = render(<WaiverClaimDrawer {...props} open player={PLAYER} />)
    expect(hasUnsavedWork()).toBe(true)
    rerender(<WaiverClaimDrawer {...props} open={false} player={PLAYER} />)
    expect(hasUnsavedWork()).toBe(false)
  })

  it('does not hold while closed', () => {
    render(<WaiverClaimDrawer {...props} open={false} player={null} />)
    expect(hasUnsavedWork()).toBe(false)
  })
})
