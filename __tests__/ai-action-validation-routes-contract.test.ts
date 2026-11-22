import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const rosterFindFirstMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findFirst: rosterFindFirstMock,
    },
  },
}))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(),
}))

vi.mock('@/lib/tournament-mode/safety', () => ({
  getTradeBlockReason: vi.fn(async () => null),
}))

vi.mock('@/lib/sport-scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sport-scope')>()
  return {
    ...actual,
    normalizeToSupportedSport: vi.fn(() => 'NFL'),
  }
})

vi.mock('@/lib/player-trend', () => ({
  recordTrendSignalsAndUpdate: vi.fn(async () => {}),
}))

describe('Chimmy action validation route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    rosterFindFirstMock.mockResolvedValue({ id: 'roster-1' })
  })

  it('returns 422 for lineup apply when Chimmy action lacks explicit confirmation', async () => {
    const { POST } = await import('@/app/api/leagues/roster/save/route')

    const req = new Request('http://localhost/api/leagues/roster/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        actionSource: 'ai',
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Chimmy action requires explicit user confirmation before execution.',
    })
  })

  it('returns 422 for waiver claim add when Chimmy action lacks explicit confirmation', async () => {
    const { POST } = await import('@/app/api/waiver-wire/leagues/[leagueId]/claims/route')

    const req = new Request('http://localhost/api/waiver-wire/leagues/league-1/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actionSource: 'ai',
        addPlayerId: 'player-1',
      }),
    })

    const res = await POST(req as any, { params: { leagueId: 'league-1' } } as any)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Chimmy action requires explicit user confirmation before execution.',
    })
  })

  it('returns 422 for trade propose save counteroffer when Chimmy action lacks explicit confirmation', async () => {
    const { POST } = await import('@/app/api/trade/propose/route')

    const req = new Request('http://localhost/api/trade/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        offerFrom: 1,
        offerTo: 2,
        adds: ['p1'],
        drops: ['p2'],
        actionSource: 'ai',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Chimmy action requires explicit user confirmation before execution.',
    })
  })

  it('returns 400 when validation action does not match requested action', async () => {
    const { POST } = await import('@/app/api/trade/propose/route')

    const req = new Request('http://localhost/api/trade/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        offerFrom: 1,
        offerTo: 2,
        adds: ['p1'],
        drops: ['p2'],
        actionSource: 'ai',
        validation: {
          confirmedByUser: true,
          action: 'apply_lineup',
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Chimmy action validation payload does not match requested action.',
    })
  })

  it('returns 400 when validation league does not match target league', async () => {
    const { POST } = await import('@/app/api/leagues/roster/save/route')

    const req = new Request('http://localhost/api/leagues/roster/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        actionSource: 'ai',
        validation: {
          confirmedByUser: true,
          action: 'apply_lineup',
          leagueId: 'league-2',
        },
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'Chimmy action validation league does not match target league.',
    })
  })
})
