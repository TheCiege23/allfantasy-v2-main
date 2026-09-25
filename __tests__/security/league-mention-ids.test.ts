import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League chat stores WHO a message names as user ids — the column the hub's mentions list and the "@"
 * badge search with `has: userId`. It stored the typed usernames, so every mentions list came back
 * empty. Names resolve against the league's members only.
 */

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ members: [] as string[], users: [] as Array<{ id: string; username: string }>, fail: false }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({
  getLeagueMemberUserIds: async () => {
    if (h.fail) throw new Error('db down')
    return h.members
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: {
      findMany: async ({ where }: { where: { id: { in: string[] }; OR: Array<{ username: { equals: string } }> } }) => {
        const wanted = where.OR.map((o) => o.username.equals.toLowerCase())
        return h.users.filter((u) => where.id.in.includes(u.id) && wanted.includes(u.username.toLowerCase())).map((u) => ({ id: u.id }))
      },
    },
  },
}))

import { resolveLeagueMentionIds } from '@/lib/chat-core/resolveMentionTargets'

beforeEach(() => {
  h.fail = false
  h.members = ['sender', 'u-mike', 'u-dana']
  h.users = [
    { id: 'u-mike', username: 'Mike' },
    { id: 'u-dana', username: 'dana' },
    { id: 'u-stranger', username: 'zed' },
    { id: 'sender', username: 'sender' },
  ]
})

describe('resolveLeagueMentionIds', () => {
  it('ids of the named league members, case-insensitively, never the sender or a non-member', async () => {
    expect((await resolveLeagueMentionIds('L1', 'sender', ['mike', 'DANA', 'zed', 'sender'])).sort()).toEqual(['u-dana', 'u-mike'])
  })

  it('nothing named, nothing stored — and a failed lookup stores nothing instead of failing the send', async () => {
    expect(await resolveLeagueMentionIds('L1', 'sender', [])).toEqual([])
    h.fail = true
    expect(await resolveLeagueMentionIds('L1', 'sender', ['mike'])).toEqual([])
  })

  it('the league chat route stores the resolved ids, not the typed names, on both of its writes', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/league/chat/route.ts'), 'utf8')
    const writes = src.match(/^\s*mentionedUserIds: await resolveLeagueMentionIds\(leagueId, userId, \w+\.userMentions\),$/gm) ?? []
    expect(writes).toHaveLength(2)
    expect(src).not.toMatch(/^\s*mentionedUserIds: \w+\.userMentions,$/m)
  })
})
