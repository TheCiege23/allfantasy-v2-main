/**
 * "Message" a team's manager from a league screen (2026-11-27).
 *
 *   lib/chat-core/leagueManagerContacts.ts       which account runs each team, by every team id
 *   app/api/leagues/[leagueId]/manager-contacts  members only
 *   MessageManagerButton / openDirectMessage     the drawer when the page has one, else /messages
 *   ThreadPanel startDmWith                      the picker's own start, once per tap
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const db = vi.hoisted(() => ({
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
const blocked = vi.hoisted(() => ({ ids: new Set<string>() }))
const auth = vi.hoisted(() => ({ userId: 'me' as string | null, member: true }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/moderation/BlockUserService', () => ({
  getBlockedEitherWayUserIds: vi.fn(async () => blocked.ids),
  BlockListUnavailableError: class BlockListUnavailableError extends Error {},
}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: vi.fn(async () => ({ appUserId: auth.userId, legacyUsername: null })) }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => (auth.member ? { isMember: true } : null)) }))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import { listLeagueManagerContacts } from '@/lib/chat-core/leagueManagerContacts'
import { GET } from '@/app/api/leagues/[leagueId]/manager-contacts/route'
import { COMMS_DOCK_ATTR, COMMS_OPEN_EVENT, openDirectMessage, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'
import { MessageManagerButton, resetManagerContactsCache, useLeagueManagerContacts } from '@/components/league/native/screens/MessageManagerButton'
import ThreadPanel from '@/components/core-app/comms/ThreadPanel'

const USERS = [
  { id: 'u-alex', username: 'alex', displayName: 'Alex', avatarUrl: null },
  { id: 'u-bo', username: 'bo', displayName: '', avatarUrl: 'https://cdn.test/bo.png' },
  { id: 'u-cy', username: 'cy', displayName: 'Cy', avatarUrl: null },
  { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null },
]

beforeEach(() => {
  blocked.ids = new Set()
  auth.userId = 'me'
  auth.member = true
  db.leagueTeam.findMany.mockResolvedValue([{ id: 'team-a', claimedByUserId: 'u-alex' }])
  db.roster.findMany.mockResolvedValue([
    // A second team run by Bo: managerUserId names him, platformUserId is just the row's key.
    { id: 'roster-b', platformUserId: 'key-2', managerUserId: 'u-bo' },
    // An imported team: platformUserId is the platform's id, which is nobody here.
    { id: 'roster-x', platformUserId: '738291', managerUserId: null },
    { id: 'roster-me', platformUserId: 'me', managerUserId: null },
  ])
  db.redraftRoster.findMany.mockResolvedValue([{ id: 'season-c', ownerId: 'u-cy' }])
  db.appUser.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    USERS.filter((u) => where.id.in.includes(u.id)),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute(COMMS_DOCK_ATTR)
  resetManagerContactsCache()
})

describe('listLeagueManagerContacts', () => {
  it('keys every team id to its manager, each by its own owner column', async () => {
    const c = await listLeagueManagerContacts('L1', 'me')
    expect(c['team-a']).toEqual({ username: 'alex', displayName: 'Alex', avatarUrl: null })
    expect(c['roster-b']).toEqual({ username: 'bo', displayName: 'bo', avatarUrl: 'https://cdn.test/bo.png' })
    expect(c['season-c']?.username).toBe('cy')
    // A platform id finds no account, and the viewer is never offered himself.
    expect(c['roster-x']).toBeUndefined()
    expect(c['roster-me']).toBeUndefined()
  })

  it('leaves out anyone blocked either way, and never reads email', async () => {
    blocked.ids = new Set(['u-cy'])
    const c = await listLeagueManagerContacts('L1', 'me')
    expect(c['season-c']).toBeUndefined()
    const select = db.appUser.findMany.mock.calls.at(-1)![0].select
    expect(Object.keys(select).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'username'])
    expect(db.appUser.findMany.mock.calls.at(-1)![0].where.id.in).not.toContain('u-cy')
  })
})

describe('GET /api/leagues/[leagueId]/manager-contacts', () => {
  const call = () => GET(new Request('http://x/api/leagues/L1/manager-contacts'), { params: Promise.resolve({ leagueId: 'L1' }) })

  it('answers members with the contacts', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(Object.keys((await res.json()).contacts).sort()).toEqual(['roster-b', 'season-c', 'team-a'])
  })

  it('refuses the signed-out and non-members', async () => {
    db.appUser.findMany.mockClear()
    auth.userId = null
    expect((await call()).status).toBe(401)
    auth.userId = 'me'
    auth.member = false
    expect((await call()).status).toBe(403)
    expect(db.appUser.findMany).not.toHaveBeenCalledWith(expect.anything())
  })
})

describe('openDirectMessage', () => {
  it('opens the drawer on the DMs tab when the page has one', () => {
    document.documentElement.setAttribute(COMMS_DOCK_ATTR, '')
    const seen: CommsOpenDetail[] = []
    const on = (e: Event) => seen.push((e as CustomEvent<CommsOpenDetail>).detail)
    window.addEventListener(COMMS_OPEN_EVENT, on)
    openDirectMessage('@alex')
    window.removeEventListener(COMMS_OPEN_EVENT, on)
    expect(seen).toEqual([{ tab: 'dms', dmWith: { username: 'alex' } }])
  })

  it('goes to the messages page when it has none', () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } })
    try {
      openDirectMessage('alex')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
    expect(assign).toHaveBeenCalledWith('/messages?start=alex')
  })
})

describe('MessageManagerButton', () => {
  function Row({ teamId }: { teamId: string }) {
    const contactFor = useLeagueManagerContacts('L1')
    return (
      <div data-testid={`row-${teamId}`}>
        <MessageManagerButton contact={contactFor(teamId)} />
      </div>
    )
  }

  it('shows only where the team has a manager to message, reads the league once, and opens the DM', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ contacts: { 'team-a': { username: 'alex', displayName: 'Alex', avatarUrl: null } } })))
    vi.stubGlobal('fetch', fetchMock)
    document.documentElement.setAttribute(COMMS_DOCK_ATTR, '')
    render(
      <>
        <Row teamId="team-a" />
        <Row teamId="team-z" />
      </>,
    )
    const btn = await screen.findByRole('button', { name: 'Message Alex' })
    expect(screen.getByTestId('row-team-z').querySelector('button')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const seen: CommsOpenDetail[] = []
    const on = (e: Event) => seen.push((e as CustomEvent<CommsOpenDetail>).detail)
    window.addEventListener(COMMS_OPEN_EVENT, on)
    fireEvent.click(btn)
    window.removeEventListener(COMMS_OPEN_EVENT, on)
    expect(seen[0]?.dmWith).toEqual({ username: 'alex' })
  })
})

describe('ThreadPanel startDmWith', () => {
  it("starts (or reopens) the conversation with the picker's own call, once", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/shared/chat/dm/start')) {
        return new Response(JSON.stringify({ status: 'ok', thread: { id: 't-alex', threadType: 'dm', title: 'Alex', memberCount: 2, unreadCount: 0, lastMessageAt: null, context: { members: [] } } }))
      }
      void init
      return new Response(JSON.stringify({ status: 'ok', threads: [], messages: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const handled = vi.fn()
    const { rerender } = render(<ThreadPanel kind="dm" privacy="" startDmWith="alex" onStartDmHandled={handled} />)
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/dm/start'))).toBe(true))
    const start = fetchMock.mock.calls.filter(([u]) => String(u).includes('/dm/start'))
    expect(start).toHaveLength(1)
    expect(JSON.parse(String((start[0][1] as RequestInit).body))).toEqual({ username: 'alex' })
    expect(handled).toHaveBeenCalledTimes(1)

    // The drawer clears the request once handled; nothing starts again.
    rerender(<ThreadPanel kind="dm" privacy="" startDmWith={null} onStartDmHandled={handled} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/dm/start'))).toHaveLength(1)
  })
})
