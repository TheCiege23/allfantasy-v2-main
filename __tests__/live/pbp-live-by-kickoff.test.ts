// @vitest-environment node
/**
 * The play-by-play feed polls a game once it has kicked off, whatever the slower schedule sync has
 * stored as its status. 2026-10-25: PIT at NO (13:30 UTC) read "scheduled" until 16:17, so every
 * starter play from three quarters arrived in one burst at 16:18.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/live/bigPlayNotifier', () => ({ notifyBigPlays: vi.fn() }))
vi.mock('@/lib/idp/persistIdpLines', () => ({ persistIdpForGame: vi.fn(), gameWeekMeta: vi.fn() }))

import { isPollable } from '@/lib/live/playByPlayFeed'

const now = new Date('2026-10-25T14:30:00Z')
const game = (status: string | null, startTime: string | null) => ({ externalId: 'g1', status, startTime: startTime ? new Date(startTime) : null })

describe('which games the play-by-play feed reads', () => {
  it('a game past kickoff still stored as "scheduled" is read (the London game)', () => {
    expect(isPollable(game('scheduled', '2026-10-25T13:30:00Z'), now, new Set())).toBe(true)
    expect(isPollable(game(null, '2026-10-25T13:30:00Z'), now, new Set())).toBe(true)
  })
  it('a game not yet kicked off is not', () => {
    expect(isPollable(game('scheduled', '2026-10-25T17:00:00Z'), now, new Set())).toBe(false)
    expect(isPollable(game(null, null), now, new Set())).toBe(false)
  })
  it('in progress is read; final only while it still has a cursor', () => {
    expect(isPollable(game('In Progress', '2026-10-25T13:30:00Z'), now, new Set())).toBe(true)
    expect(isPollable(game('Final', '2026-10-25T13:30:00Z'), now, new Set())).toBe(false)
    expect(isPollable(game('Final', '2026-10-25T13:30:00Z'), now, new Set(['g1']))).toBe(true)
  })
  it('a postponed or cancelled game is not', () => {
    expect(isPollable(game('Postponed', '2026-10-25T13:30:00Z'), now, new Set())).toBe(false)
    expect(isPollable(game('Canceled', '2026-10-25T13:30:00Z'), now, new Set())).toBe(false)
  })
})
