// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const W_ROSTER = 'roster-w-91'
const W_USER = 'user-whisperer-91'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  zombieLeagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  resolveWhispererViewer: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { zombieLeague: { findUnique: hm.zombieLeagueFindUnique }, roster: { findFirst: hm.rosterFindFirst } },
}))
vi.mock('@/lib/prisma-json', () => ({ toPrismaJsonInput: (value: unknown) => value }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/whispererViewer', () => ({ resolveWhispererViewer: hm.resolveWhispererViewer }))

const HIDDEN = { canSee: false, identity: { rosterIds: new Set([W_ROSTER]), userIds: new Set([W_USER]) } }
const VISIBLE = { canSee: true, identity: HIDDEN.identity }

const TEAMS = [
  { id: 't-w', rosterId: W_ROSTER, status: 'Whisperer', isWhisperer: true, infectionCount: 2, ambushesRemaining: 2, items: [] },
  { id: 't-2', rosterId: 'roster-2', status: 'Zombie', isWhisperer: false, infectionCount: 0, killedByRosterId: W_ROSTER, killedByUserId: W_USER, items: [] },
]

async function get(query: string) {
  const { GET } = await import('@/app/api/zombie/status/route')
  const res = await GET(new Request(`http://localhost/api/zombie/status?leagueId=league-1${query}`))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/zombie/status — Whisperer secrecy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-member' } })
    hm.zombieLeagueFindUnique.mockResolvedValue({ teams: TEAMS })
    hm.resolveWhispererViewer.mockResolvedValue(HIDDEN)
  })

  it('does not mark the Whisperer team for a member of a secret league', async () => {
    const res = await get('')
    expect(res.status).toBe(200)
    expect(res.text).not.toMatch(/"status":"Whisperer"/)
    expect(res.text).not.toContain('"isWhisperer":true')
  })

  it('does not point an infected team back at the Whisperer', async () => {
    hm.rosterFindFirst.mockResolvedValue({ id: 'roster-2' })
    const res = await get('&userId=user-2')
    expect(res.text).not.toContain(W_USER)
    expect(res.text).not.toContain(W_ROSTER)
  })

  it('disguises the Whisperer team when it is fetched directly', async () => {
    hm.rosterFindFirst.mockResolvedValue({ id: W_ROSTER })
    const res = await get(`&userId=${W_USER}`)
    expect(res.body.team).toMatchObject({ status: 'Survivor', isWhisperer: false, ambushesRemaining: 0 })
  })

  it('shows the Whisperer to a viewer who may see it', async () => {
    hm.resolveWhispererViewer.mockResolvedValue(VISIBLE)
    const res = await get('')
    expect(res.text).toMatch(/"status":"Whisperer"/)
  })
})
