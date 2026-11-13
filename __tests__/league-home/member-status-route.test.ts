import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ league: null as unknown, session: null as unknown }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: async () => ({ ok: true }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => h.league },
    draftSession: { findFirst: async () => h.session },
  },
}))

import { GET } from '@/app/api/leagues/[leagueId]/member-status/route'

const future = new Date(Date.now() + 3 * 86_400_000)
const base = (over: Record<string, unknown> = {}) => ({
  season: 2026,
  isDynasty: false,
  leagueSettings: { draftDateUtc: future },
  teams: [
    { id: 'mine', claimedByUserId: 'me' },
    { id: 'theirs', claimedByUserId: 'them' },
  ],
  settings: {
    dues_tracker: { amount: 50, dueDate: '2026-09-01', paymentLinks: [{ kind: 'venmo', url: 'https://venmo.com/u/Bank' }], entries: [{ teamId: 'theirs', paid: true }] },
  },
  ...over,
})
const call = async () => (await GET({} as never, { params: Promise.resolve({ leagueId: 'L1' }) })).json()

beforeEach(() => {
  h.league = base()
  h.session = null
})

describe('member status — what this member needs to know', () => {
  it('the draft time before it starts, and what I owe with the league’s own links', async () => {
    const s = await call()
    expect(s.draft).toEqual({ at: future.toISOString(), calendarHref: '/api/leagues/L1/draft/calendar' })
    expect(s.dues).toEqual({ amount: '$50.00', dueDate: '2026-09-01', links: [{ kind: 'venmo', url: 'https://venmo.com/u/Bank' }], reported: false })
  })

  it('nothing about dues once I am paid, and no draft once it has started', async () => {
    h.league = base({ settings: { dues_tracker: { amount: 50, entries: [{ teamId: 'mine', paid: true }] } } })
    h.session = { status: 'in_progress' }
    expect(await call()).toEqual({ draft: null, dues: null })
  })

  it('a league that does not track dues asks nothing of me', async () => {
    h.league = base({ settings: {} })
    expect((await call()).dues).toBeNull()
  })
})
