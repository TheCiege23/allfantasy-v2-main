/**
 * The Trade Center's share card: the input is bounded, totals are honest about unpriced assets, and
 * the route refuses before drawing anything for a signed-out user, a bad body or a league they are
 * not in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, findFirst } = vi.hoisted(() => ({ getServerSession: vi.fn(), findFirst: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst } } }))
vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    constructor(public node: unknown) {}
  },
}))

import { ProposalCardInput, sideTotal } from '@/lib/share/proposalCard'
import { POST } from '@/app/api/share/proposal-card/route'

const CARD = {
  leagueId: 'L1',
  myLabel: 'TheCiege26',
  theirLabel: 'Champ DeThroner',
  give: [{ name: 'Braelon Allen', value: 1501 }],
  get: [{ name: '2028 2nd', value: 1186 }],
  myLetter: 'D',
  theirLetter: 'B',
  score: 31,
  verdict: 'Slightly favors opponent',
}

const post = (body: unknown) =>
  POST(new Request('http://x/api/share/proposal-card', { method: 'POST', body: JSON.stringify(body) }) as never)

/** Every text node in the drawn tree, so the test reads what the card says. */
function texts(node: unknown): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(texts)
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (typeof el.type === 'function') return texts((el.type as (p: unknown) => unknown)(el.props))
  return texts(el.props?.children)
}

describe('proposal card input', () => {
  it('accepts the Trade Center card and bounds every field', () => {
    expect(ProposalCardInput.safeParse(CARD).success).toBe(true)
    expect(ProposalCardInput.safeParse({ ...CARD, verdict: 'x'.repeat(61) }).success).toBe(false)
    expect(ProposalCardInput.safeParse({ ...CARD, give: Array(9).fill(CARD.give[0]) }).success).toBe(false)
    expect(ProposalCardInput.safeParse({ ...CARD, myLetter: 'Z' }).success).toBe(false)
    expect(ProposalCardInput.safeParse({ ...CARD, score: 101 }).success).toBe(false)
    expect(ProposalCardInput.safeParse({ ...CARD, basis: 'Dynasty · Superflex', asOf: '2026-10-03T10:00:00.000Z', uncertainty: 'Some assets unpriced' }).success).toBe(true)
    expect(ProposalCardInput.safeParse({ ...CARD, asOf: 'yesterday' }).success).toBe(false)
  })

  it('a side with an unpriced asset has no total, not a smaller one', () => {
    expect(sideTotal([{ name: 'A', value: 100 }, { name: 'B', value: 50 }])).toBe(150)
    expect(sideTotal([{ name: 'A', value: 100 }, { name: 'B', value: null }])).toBeNull()
  })
})

describe('POST /api/share/proposal-card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: `u-${Math.random()}` } })
    findFirst.mockResolvedValue({ name: 'AFC Dreaming!' })
  })

  it('draws Spanish image text without translating manager or player identities', async () => {
    const result=await post({...CARD,language:'es',basis:'Dynasty · Superflex',uncertainty:'Some assets unpriced'})
    const words=texts((result as unknown as {node:unknown}).node).join(' | ')
    expect(words).toContain('ANÁLISIS DEL INTERCAMBIO')
    expect(words).toContain('RECIBE')
    expect(words).toContain('Intercambio propuesto')
    expect(words).toContain('Dinastía · Superflex')
    expect(words).toContain('Braelon Allen')
    expect(words).toContain('TheCiege26')
    expect(words).not.toContain('TRADE CHECK')
  })

  it('401 signed out, 400 on a bad body, 404 for a league the user is not in', async () => {
    getServerSession.mockResolvedValueOnce(null)
    expect((await post(CARD)).status).toBe(401)
    expect((await post({ ...CARD, give: [] })).status).toBe(400)
    findFirst.mockResolvedValueOnce(null)
    expect((await post(CARD)).status).toBe(404)
  })

  it('draws the card for a member: league name from the database, each side under what it gets', async () => {
    const res = await post(CARD)
    expect(res.status).toBe(200)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'L1' }) }))
    const words = texts((res as unknown as { node: unknown }).node).join(' | ')
    expect(words).toContain('AFC Dreaming!')
    expect(words).toContain('Slightly favors opponent')
    expect(words).toContain('not a result')
    // The viewer's column lists what they GET; the partner's what the viewer GIVES.
    expect(words.indexOf('TheCiege26')).toBeLessThan(words.indexOf('2028 2nd'))
    expect(words.indexOf('Champ DeThroner')).toBeLessThan(words.indexOf('Braelon Allen'))
  })
})
