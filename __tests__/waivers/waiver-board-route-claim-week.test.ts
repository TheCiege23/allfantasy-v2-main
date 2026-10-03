// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/idp/players?view=waiver-board — the claim week decided at the route.
 *
 * Two callers, two questions. The league Waivers screen asks "who should I claim", which after the
 * week is mostly played is NEXT week. My Team's Lineup check passes `unavailable` (this week's OUT
 * and bye starters) to ask "who fills THIS week's hole" — that must stay on the week being played.
 */

const h = vi.hoisted(() => ({ load: vi.fn(async () => ({ state: 'ok' })), resolve: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/waivers/waiverBoard', () => ({ loadWaiverBoard: h.load }))
vi.mock('@/lib/core-app/waiverClaimWeek', () => ({ resolveWaiverClaimWeek: h.resolve }))

import { GET } from '@/app/api/idp/players/route'

const get = (qs: string) => GET({ nextUrl: new URL(`http://x/api/idp/players?${qs}`) } as never)

beforeEach(() => {
  h.load.mockClear()
  h.resolve.mockReset()
  h.resolve.mockResolvedValue({ season: '2026', week: 5, basis: 'next', currentWeek: 4 })
})

describe('waiver-board view: which week the board is asked to price', () => {
  it('the league Waivers screen gets next week once that is the claim week', async () => {
    await get('leagueId=L1&view=waiver-board&limit=10')
    expect(h.load.mock.calls[0]?.[0]).toMatchObject({ leagueId: 'L1', claimWeek: { season: '2026', week: 5 } })
  })

  it('stays on the week being played when the claim week is the current one', async () => {
    h.resolve.mockResolvedValue({ season: '2026', week: 4, basis: 'current', currentWeek: 4 })
    await get('leagueId=L1&view=waiver-board')
    expect(h.load.mock.calls[0]?.[0]).toMatchObject({ claimWeek: null })
  })

  it('My Team’s "who fills THIS week’s hole" (unavailable) never moves to next week', async () => {
    await get('leagueId=L1&view=waiver-board&unavailable=4984,6794')
    expect(h.load.mock.calls[0]?.[0]).toMatchObject({ unavailable: ['4984', '6794'], claimWeek: null })
    expect(h.resolve).not.toHaveBeenCalled()
  })
})
