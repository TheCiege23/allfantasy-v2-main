import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const posts: Array<{ leagueId: string; userId: string; text: string; options: Record<string, unknown> }> = []
  const ids = new Set<string>()
  return {
    posts, ids,
    tlp: { findMany: vi.fn() },
    chat: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (ids.has(where.id) ? { id: where.id } : null)) },
    membership: vi.fn(),
    put: vi.fn(async (key: string) => key),
    configured: vi.fn(() => true),
    loadTrophy: vi.fn(),
    create: vi.fn(async (leagueId: string, userId: string, text: string, options: Record<string, unknown>) => {
      const id = String(options.idempotencyKey)
      if (ids.has(id)) return null
      ids.add(id); posts.push({ leagueId, userId, text, options }); return { id }
    }),
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentLeagueParticipant: m.tlp, leagueChatMessage: m.chat } }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: (...a: unknown[]) => m.membership(...a) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: (...a: [string, string, string, Record<string, unknown>]) => m.create(...a) }))
vi.mock('@/lib/chat-core/privateStorage', () => ({ privateChatStorageConfigured: () => m.configured(), putPrivateChatFile: (k: string) => m.put(k) }))
vi.mock('@/lib/tournament/divisions/lifecycle', () => ({ loadTrophy: (...a: unknown[]) => m.loadTrophy(...a) }))

import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { computeDivision, defaultFormatSettings } from '@/lib/tournament/divisions/engine'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'
import { canPostShareCard, postShareCardToLeagueChat, ShareToChatError } from '@/lib/tournament/divisions/shareToChat'

const settings = defaultFormatSettings('NFL')
const { teams, identity } = sampleDivisionsField()
const view = buildHubView({ tournament: { id: 't1', name: 'Gold Cup', sport: 'NFL', status: 'live', season: 2026 }, settings, identity, teams })
const entry = computeDivision(teams.filter(t => t.divisionIndex === 0), settings).ranked[0]!.id
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

beforeEach(() => {
  m.posts.length = 0; m.ids.clear(); vi.clearAllMocks()
  m.loadTrophy.mockResolvedValue(view)
  m.configured.mockReturnValue(true)
  m.tlp.findMany.mockResolvedValue([{ league: { leagueId: 'L7', name: 'North Gold' } }])
  m.membership.mockImplementation(async (leagueId: string, userId: string) => ({ ok: leagueId === 'L7' && userId === 'u1' }))
})

describe('post the share card to league chat', () => {
  it('writes one message, with the card image, caption and link, to the poster’s own league', async () => {
    const r = await postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: entry, image: png() })
    expect(r).toMatchObject({ leagueId: 'L7', leagueName: 'North Gold', image: true })
    expect(m.posts).toHaveLength(1)
    const post = m.posts[0]!
    expect(post.leagueId).toBe('L7')
    expect(post.userId).toBe('u1')
    expect(post.text).toContain('Gold Cup')
    expect(post.text).toContain(`/tournament-trophy/t1?entry=${entry}`)
    expect(m.put.mock.calls[0]![0]).toMatch(/^chat\/L7\/image\/[0-9a-f-]+\.png$/)
    expect(post.options.imageUrl).toMatch(/^\/api\/chat\/upload\?path=chat%2FL7%2Fimage%2F/)
    expect(post.options.metadata).toMatchObject({ attachments: [{ type: 'image', url: post.options.imageUrl }], tournamentShare: { tournamentId: 't1', entryId: entry } })
    expect(m.tlp.findMany.mock.calls[0]![0].where).toEqual({ userId: 'u1', league: { tournamentId: 't1', leagueId: { not: null } } })
  })

  it('posts once per moment: a repeat is refused before anything is stored', async () => {
    await postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: entry, image: png() })
    m.put.mockClear()
    await expect(postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: entry, image: png() })).rejects.toMatchObject({ status: 409 })
    expect(m.put).not.toHaveBeenCalled()
    expect(m.posts).toHaveLength(1)
  })

  it('refuses someone with no league in this tournament', async () => {
    m.tlp.findMany.mockResolvedValue([])
    const err = await postShareCardToLeagueChat({ userId: 'u2', tournamentId: 't1', entryId: entry, image: png() }).catch(e => e)
    expect(err).toBeInstanceOf(ShareToChatError)
    expect(err.status).toBe(403)
    expect(m.posts).toHaveLength(0)
    expect(m.put).not.toHaveBeenCalled()
    expect(await canPostShareCard('t1', 'u2')).toBe(false)
  })

  it('refuses an entrant who is no longer a member of the league', async () => {
    const err = await postShareCardToLeagueChat({ userId: 'u3', tournamentId: 't1', entryId: entry, image: null }).catch(e => e)
    expect(err.status).toBe(403)
    expect(m.posts).toHaveLength(0)
    expect(await canPostShareCard('t1', 'u1')).toBe(true)
    expect(await canPostShareCard('t1', null)).toBe(false)
  })

  it('refuses a team that is not in the tournament and a non-PNG image', async () => {
    await expect(postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: 'nobody', image: null })).rejects.toMatchObject({ status: 404 })
    await expect(postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: entry, image: new Blob(['x'], { type: 'text/html' }) })).rejects.toMatchObject({ status: 400 })
    expect(m.posts).toHaveLength(0)
  })

  it('without chat storage the caption and link still post, with no image', async () => {
    m.configured.mockReturnValue(false)
    const r = await postShareCardToLeagueChat({ userId: 'u1', tournamentId: 't1', entryId: entry, image: png() })
    expect(r.image).toBe(false)
    expect(m.posts[0]!.options.imageUrl).toBeNull()
  })
})
