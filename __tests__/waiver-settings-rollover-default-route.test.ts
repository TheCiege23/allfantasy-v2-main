/** GET waiver settings sends the FAAB rollover default from the renew route's own classifier. */
import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ league: vi.fn(), roster: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: m.league }, roster: { findFirst: m.roster } } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: vi.fn().mockResolvedValue({ faabRolloverRule: null }), upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({ loadDailyTransactionPolicy: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: vi.fn().mockResolvedValue(null) }))

import { GET } from '@/app/api/waiver-wire/leagues/[leagueId]/settings/route'

const get = async () => (await GET({} as never, { params: Promise.resolve({ leagueId: 'L' }) })).json()

describe('faabRolloverDefault', () => {
  it('a keeper league not flagged isDynasty: carry over', async () => {
    m.league.mockResolvedValue({ id: 'L', userId: 'u1', sport: 'NFL', leagueVariant: 'keeper', isDynasty: false, settings: {} })
    expect((await get()).faabRolloverDefault).toBe('carry_over')
  })

  it('a redraft league: reset', async () => {
    m.league.mockResolvedValue({ id: 'L', userId: 'u1', sport: 'NFL', leagueVariant: 'redraft', isDynasty: false, settings: {} })
    expect((await get()).faabRolloverDefault).toBe('reset')
  })
})
