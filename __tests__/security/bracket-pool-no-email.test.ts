import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bracket pools never show a member's email. Pool chat selected `email` on every author, reply
 * author and reactor and returned it to every member; standings used the email as the owner's
 * name when there was no display name — and the standings route has no session check, so that
 * reached anyone with the pool's id. Names are display name, then username, then "Manager".
 */

const EMAIL = 'someone.private@example.test'

const h = vi.hoisted(() => ({
  memberFindUnique: vi.fn(),
  messageFindMany: vi.fn(),
  messageFindUnique: vi.fn(),
  reactionFindUnique: vi.fn(),
  reactionCreate: vi.fn(),
  leagueFindUnique: vi.fn(),
  entryFindMany: vi.fn(),
  pickGroupBy: vi.fn(),
  nodeFindFirst: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    bracketLeagueMember: { findUnique: h.memberFindUnique },
    bracketLeagueMessage: { findMany: h.messageFindMany, findUnique: h.messageFindUnique },
    bracketMessageReaction: { findUnique: h.reactionFindUnique, create: h.reactionCreate },
    bracketLeague: { findUnique: h.leagueFindUnique },
    bracketEntry: { findMany: h.entryFindMany },
    bracketPick: { groupBy: h.pickGroupBy },
    bracketNode: { findFirst: h.nodeFindFirst },
    sportsGame: { findUnique: vi.fn() },
  },
}))

import { GET as chatGET } from '@/app/api/bracket/leagues/[leagueId]/chat/route'
import { POST as reactPOST } from '@/app/api/bracket/leagues/[leagueId]/chat/react/route'
import { GET as standingsGET } from '@/app/api/bracket/leagues/[leagueId]/standings/route'

const params = { params: { leagueId: 'pool1' } }

/** Every `select` object anywhere inside a Prisma args tree. */
function selects(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (o.select && typeof o.select === 'object') out.push(o.select as Record<string, unknown>)
    for (const v of Object.values(o)) selects(v, out)
  }
  return out
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.memberFindUnique.mockResolvedValue({ id: 'm' })
})

describe('pool chat', () => {
  it('🛑 never selects an email for authors, reply authors or reactors', async () => {
    h.messageFindMany.mockResolvedValue([])
    const req = { nextUrl: new URL('http://localhost/api/bracket/leagues/pool1/chat') }
    await chatGET(req as never, params)
    const all = selects(h.messageFindMany.mock.calls[0][0])
    expect(all.length).toBeGreaterThanOrEqual(3)
    for (const s of all) expect(s).not.toHaveProperty('email')
    expect(all.filter((s) => 'username' in s).length).toBeGreaterThanOrEqual(3)
  })

  it('🛑 a new reaction is returned without the reactor\'s email', async () => {
    h.messageFindUnique.mockResolvedValue({ leagueId: 'pool1' })
    h.reactionFindUnique.mockResolvedValue(null)
    h.reactionCreate.mockResolvedValue({ id: 'r1', emoji: '🔥', user: { id: 'me', displayName: null, username: 'kai' } })
    const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ messageId: 'msg1', emoji: '🔥' }) })
    const res = await reactPOST(req as never, params)
    expect(res.status).toBe(200)
    for (const s of selects(h.reactionCreate.mock.calls[0][0])) expect(s).not.toHaveProperty('email')
  })
})

describe('pool standings', () => {
  it('🛑 an owner with no display name is their username, then "Manager" — never their email', async () => {
    h.leagueFindUnique.mockResolvedValue({ scoringRules: {}, tournamentId: 't1' })
    const at = new Date('2026-09-01T00:00:00Z')
    h.entryFindMany.mockResolvedValue([
      { id: 'e1', name: 'A', createdAt: at, tiebreakerPoints: null, user: { displayName: 'Casey', username: 'casey', email: EMAIL } },
      { id: 'e2', name: 'B', createdAt: at, tiebreakerPoints: null, user: { displayName: null, username: 'kai', email: EMAIL } },
      { id: 'e3', name: 'C', createdAt: at, tiebreakerPoints: null, user: { displayName: null, username: null, email: EMAIL } },
    ])
    h.pickGroupBy.mockResolvedValue([])
    h.nodeFindFirst.mockResolvedValue(null)

    const res = await standingsGET(new Request('http://localhost/x'), params)
    const body = await res.json()
    const text = JSON.stringify(body)
    expect(text).not.toContain(EMAIL)
    expect(text).toContain('"ownerName":"Casey"')
    expect(text).toContain('"ownerName":"kai"')
    expect(text).toContain('"ownerName":"Manager"')
    for (const s of selects(h.entryFindMany.mock.calls[0][0])) expect(s).not.toHaveProperty('email')
  })
})
