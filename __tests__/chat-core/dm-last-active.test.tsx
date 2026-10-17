/**
 * "Last active" on DMs — the owner asked for it and nothing showed one: chatPresence is league-only,
 * and neither the DM row nor the DM header carried any activity at all.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  groupByArgs: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: {
      findMany: async () => [
        {
          userId: 'me',
          lastReadAt: new Date('2026-10-10T12:00:00Z'),
          isMuted: false,
          thread: {
            id: 't1',
            threadType: 'dm',
            productType: 'shared',
            title: null,
            lastMessageAt: new Date('2026-10-10T11:59:00Z'),
            createdByUserId: 'me',
            _count: { members: 2 },
            messages: [],
            members: [
              { userId: 'me', lastReadAt: new Date('2026-10-10T12:00:00Z'), isBlocked: false, user: { id: 'me', username: 'me' } },
              { userId: 'sam', lastReadAt: new Date('2026-10-10T09:00:00Z'), isBlocked: false, user: { id: 'sam', username: 'sam', displayName: 'Sam' } },
            ],
          },
        },
      ],
      groupBy: async (args: unknown) => {
        db.groupByArgs.push(args)
        // Sam's latest open conversation anywhere — later than his stamp in THIS thread.
        return [{ userId: 'sam', _max: { lastReadAt: new Date('2026-10-10T11:58:00Z') } }]
      },
    },
    platformChatMessage: { count: async () => 0 },
  },
}))

import { formatLastActive, ThreadListRow } from '@/components/core-app/comms/ThreadListRow'
import { getPlatformChatThreads } from '@/lib/platform/chat-service'

const NOW = new Date('2026-10-10T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000

describe('formatLastActive', () => {
  it.each([
    [ago(30_000), 'Active now'],
    [ago(4 * MIN), 'Active now'],
    [ago(12 * MIN), 'Active 12m ago'],
    [ago(3 * 60 * MIN), 'Active 3h ago'],
    [ago(30 * 60 * MIN), 'Active yesterday'],
    [ago(4 * 24 * 60 * MIN), 'Active 4d ago'],
  ])('%s -> %s', (iso, expected) => {
    expect(formatLastActive(iso, NOW)).toBe(expected)
  })

  it('says nothing past a week, or with no stamp — a stale "last seen" is noise', () => {
    expect(formatLastActive(ago(9 * 24 * 60 * MIN), NOW)).toBeNull()
    expect(formatLastActive(null, NOW)).toBeNull()
    expect(formatLastActive('garbage', NOW)).toBeNull()
  })
})

describe('DM row', () => {
  const thread = (ctx: Record<string, unknown>) => ({
    id: 't1',
    threadType: 'dm',
    title: 'Sam',
    lastMessageAt: ago(MIN),
    unreadCount: 0,
    memberCount: 2,
    context: { members: [{ id: 'sam', name: 'Sam', avatarUrl: null }], ...ctx },
  })

  it('shows a presence dot only while they are active now', () => {
    const on = render(<ThreadListRow thread={thread({ otherLastActiveAt: ago(MIN) })} now={NOW} onOpen={() => {}} />)
    expect(on.container.querySelector('.af-cm-dmrow-presence')).not.toBeNull()
    expect(on.container.textContent).toContain('(active now)')
    on.unmount()
    const off = render(<ThreadListRow thread={thread({ otherLastActiveAt: ago(40 * MIN) })} now={NOW} onOpen={() => {}} />)
    expect(off.container.querySelector('.af-cm-dmrow-presence')).toBeNull()
  })

  it('marks a muted conversation instead of ignoring the flag it was always given', () => {
    const { container } = render(<ThreadListRow thread={thread({ isMuted: true })} now={NOW} onOpen={() => {}} />)
    expect(container.querySelector('.af-cm-dmrow-muted')).not.toBeNull()
    expect(container.querySelector('[data-muted="true"]')).not.toBeNull()
  })
})

describe('the thread list carries it', () => {
  it('reads each DM partner’s latest open conversation in ONE grouped query', async () => {
    const threads = await getPlatformChatThreads('me')
    expect(threads[0]!.context?.otherLastActiveAt).toBe('2026-10-10T11:58:00.000Z')
    expect(db.groupByArgs).toHaveLength(1)
    expect(db.groupByArgs[0]).toMatchObject({ by: ['userId'], where: { userId: { in: ['sam'] } } })
  })
})
