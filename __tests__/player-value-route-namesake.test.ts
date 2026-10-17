import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * /api/player-value bound a player with `sport: 'nfl'` (0 of 24,148 rows — all are 'NFL') and
 * `contains` + an unordered findFirst. Measured on production 2026-10-12: "Michael Carter" is RB 7607
 * (TEN) and CB 7835 (PHI), the corner also stored as "Michael Carter II" by two other feeds. The form
 * (DynastyTradeForm) posts the asset label, "Michael Carter (CB)".
 */

const playerFindMany = vi.fn()
const insightFindMany = vi.fn()
const chat = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/adp-data', () => ({ getPlayerADP: vi.fn(async () => null) }))
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: (...a: unknown[]) => chat(...a) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: { findMany: (...a: unknown[]) => playerFindMany(...a) },
    tradeLearningInsight: { findMany: (...a: unknown[]) => insightFindMany(...a) },
  },
}))

const at = new Date('2026-10-11T00:00:00Z')
const CARTER_ROWS = [
  { source: 'sleeper', sleeperId: '7607', name: 'Michael Carter', position: 'RB', team: 'Tennessee Titans', age: 27, status: 'Active', fetchedAt: at },
  { source: 'thesportsdb', sleeperId: '7607', name: 'Michael Carter', position: 'RB', team: 'Tennessee Titans', age: 27, status: 'Active', fetchedAt: at },
  { source: 'sleeper', sleeperId: '7835', name: 'Michael Carter', position: 'CB', team: 'Philadelphia Eagles', age: 27, status: 'Active', fetchedAt: at },
  // A different man whose name merely starts with the asked one: `contains` would have taken him.
  { source: 'sleeper', sleeperId: '9999', name: 'Michael Carterson', position: 'WR', team: 'Dallas Cowboys', age: 24, status: 'Active', fetchedAt: at },
]

async function route() {
  return import('@/app/api/player-value/route')
}

beforeEach(() => {
  playerFindMany.mockReset().mockResolvedValue(CARTER_ROWS)
  insightFindMany.mockReset().mockResolvedValue([
    { playerName: 'Michael Carter', position: 'RB', avgValueGiven: 900, avgValueReceived: 850, winRate: 0.5, marketTrend: 'down', sampleSize: 4 },
  ])
  chat.mockReset().mockResolvedValue({ ok: true, json: { value: 10 } })
})

describe('/api/player-value — a shared name is bound by position, never by row order', () => {
  it('reads the stored sport, NFL', async () => {
    const { GET } = await route()
    await GET(new Request('http://x/api/player-value?name=Michael%20Carter&position=CB'))
    expect(playerFindMany.mock.calls[0][0].where.sport).toBe('NFL')
  })

  it('GET binds the corner when asked for the corner — not the first row, the Titans back', async () => {
    const { GET } = await route()
    const res = await GET(new Request('http://x/api/player-value?name=Michael%20Carter&position=CB'))
    const body = await res.json()
    expect(body.source).toBe('database')
    expect(body.team).toBe('Philadelphia Eagles')
    expect(body.position).toBe('CB')
    // The insight row is the RB's; it must not ride along onto the corner.
    expect(body.tradeInsight).toBeNull()
  })

  it('GET refuses a shared name with no position rather than guessing', async () => {
    const { GET } = await route()
    const res = await GET(new Request('http://x/api/player-value?name=Michael%20Carter'))
    expect((await res.json()).source).toBe('not_found')
  })

  it('POST reads the position out of the form label and grounds on the right man', async () => {
    const { POST } = await route()
    await POST(
      new Request('http://x/api/player-value', {
        method: 'POST',
        body: JSON.stringify({ playerName: 'Michael Carter (RB)' }),
      }),
    )
    const prompt = chat.mock.calls[0][0].messages[1].content as string
    expect(prompt).toContain('DB Context: Michael Carter, RB, Tennessee Titans')
    expect(prompt).not.toContain('Philadelphia')
    expect(prompt).toContain('Trade History: 4 trades observed')
  })
})
