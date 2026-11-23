import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { fantraxDraftFactMetadata } from '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'

/**
 * A Fantrax draft pick keeps the player as Fantrax named him. Staging 2026-11-19: 193 of one league's 1,224 picks
 * had no row in the player identity registry and read "Player 05rlf" in the draft archive, though the import had
 * the name in hand. Names here are invented.
 */
describe('fantraxDraftFactMetadata', () => {
  it('keeps the name in "First Last" order with the position and club', () => {
    expect(fantraxDraftFactMetadata({ playerName: 'Back, Rookie', position: 'RB', team: 'LV' })).toEqual({
      provider: 'fantrax',
      playerSnapshot: { name: 'Rookie Back', position: 'RB', team: 'LV' },
    })
    // Already "First Last": unchanged. A blank position or club is null, not an empty string.
    expect(fantraxDraftFactMetadata({ playerName: ' Rookie Back ', position: ' ', team: null })).toEqual({
      provider: 'fantrax',
      playerSnapshot: { name: 'Rookie Back', position: null, team: null },
    })
  })

  it('stores nothing when Fantrax gave no name, and never a draft id or roster the archive would key on', () => {
    expect(fantraxDraftFactMetadata({ playerName: null, position: 'RB', team: 'LV' })).toBeNull()
    expect(fantraxDraftFactMetadata({ playerName: '  ' })).toBeNull()
    const meta = fantraxDraftFactMetadata({ playerName: 'Rookie Back' }) as Record<string, unknown>
    expect(meta).not.toHaveProperty('sourceDraftId')
    expect(meta).not.toHaveProperty('selectionRosterId')
  })
})
