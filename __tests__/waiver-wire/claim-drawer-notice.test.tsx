/** The claim sheet says why it is a claim, and when it settles (owner report, 2026-11-28). */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'

afterEach(cleanup)
const props = {
  open: true, onClose: () => {}, player: { id: 'p1', name: 'Bam Adebayo', position: 'C', team: 'MIA' }, faabMode: true, faabRemaining: 86,
  onSubmit: async () => {}, rosterPlayerIds: ['r1'],
}

describe('WaiverClaimDrawer', () => {
  it('shows the notice and when the claim processes', () => {
    render(<WaiverClaimDrawer {...props} notice="His game has started. Claim him instead." nextRunLabel="Sat 8:00 AM EST" />)
    expect(screen.getByTestId('waiver-claim-notice').textContent).toBe('His game has started. Claim him instead.')
    expect(screen.getByTestId('waiver-claim-next-run').textContent).toBe('Processes Sat 8:00 AM EST')
  })

  it('an instant add has no run time to show', () => {
    render(<WaiverClaimDrawer {...props} immediate faabMode={false} nextRunLabel="Sat 8:00 AM EST" />)
    expect(screen.queryByTestId('waiver-claim-next-run')).toBeNull()
    expect(screen.queryByTestId('waiver-claim-notice')).toBeNull()
  })
})
