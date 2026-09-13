// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  zombieLeagueFindUnique: vi.fn(),
  resolveLeagueAccess: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: hm.zombieLeagueFindUnique } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/whispererEngine', () => ({ applyAmbush: vi.fn(), selectWhisperer: vi.fn() }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: hm.resolveLeagueAccess }))

const WHISPERER_NAME = 'Quiet Menace'

const RECORD = {
  userId: 'user-whisperer',
  displayName: WHISPERER_NAME,
  ambushesRemaining: 2,
  wasDefeated: false,
  // The column default: every record says revealed, whatever the league is configured as.
  isPubliclyRevealed: true,
}

function leagueRow(overrides: Record<string, unknown> = {}) {
  return {
    whispererIsPublic: false,
    whispererRecord: RECORD,
    league: { userId: 'user-commissioner' },
    ...overrides,
  }
}

async function getAs(userId: string) {
  hm.getServerSession.mockResolvedValue({ user: { id: userId } })
  const { GET } = await import('@/app/api/zombie/whisperer/route')
  const res = await GET(new Request('http://localhost/api/zombie/whisperer?leagueId=league-1'))
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) }
}

describe('GET /api/zombie/whisperer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.zombieLeagueFindUnique.mockResolvedValue(leagueRow())
    hm.resolveLeagueAccess.mockResolvedValue({ isMember: true, isCommissioner: false })
  })

  it('hides the Whisperer from a member of a secret league even though the record says revealed', async () => {
    const res = await getAs('user-member')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ whisperer: { message: 'Whisperer identity hidden this season.' } })
    expect(res.text).not.toContain(WHISPERER_NAME)
  })

  it('names the Whisperer to a member of a public league', async () => {
    hm.zombieLeagueFindUnique.mockResolvedValue(leagueRow({ whispererIsPublic: true }))
    const res = await getAs('user-member')
    expect(res.body.whisperer).toMatchObject({ displayName: WHISPERER_NAME })
  })

  it('still gives the head commissioner the full record', async () => {
    const res = await getAs('user-commissioner')
    expect(res.body.whisperer).toMatchObject({ userId: 'user-whisperer', displayName: WHISPERER_NAME })
  })

  it('lets the Whisperer see their own record in a secret league', async () => {
    const res = await getAs('user-whisperer')
    expect(res.body.whisperer).toMatchObject({ displayName: WHISPERER_NAME })
  })

  it('refuses a signed-in user who is not in the league, before reading it', async () => {
    hm.resolveLeagueAccess.mockResolvedValue(null)
    const res = await getAs('user-outsider')
    expect(res.status).toBe(403)
    expect(res.text).not.toContain(WHISPERER_NAME)
    expect(hm.zombieLeagueFindUnique).not.toHaveBeenCalled()
  })
})
