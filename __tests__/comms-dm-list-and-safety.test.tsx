import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * The DM and huddle list rows, Report and Block from the message actions sheet, and the huddle
 * header's Members / Add people / Rename / Leave — against the wire shapes the existing routes
 * return. Every failure path asserts the UI says so and never claims success.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import ThreadPanel from '@/components/core-app/comms/ThreadPanel'
import { formatThreadTime, threadRowPreview } from '@/components/core-app/comms/ThreadListRow'

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

type Handler = (url: string, init?: RequestInit) => Response | undefined
let fetchMock: ReturnType<typeof vi.fn>
let override: Handler | null = null
let leftHuddle = false
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

const DM = {
  id: 't1',
  threadType: 'dm',
  title: 'Jordan Love',
  lastMessageAt: ago(5),
  unreadCount: 3,
  memberCount: 2,
  context: {
    lastMessagePreview: 'sup',
    lastMessageMine: true,
    lastMessageCreatedAt: ago(5),
    members: [{ id: 'jordan', name: 'Jordan Love', avatarUrl: 'https://cdn.test/j.png' }],
  },
}
const QUIET_DM = {
  id: 't2',
  threadType: 'dm',
  title: 'Kai',
  lastMessageAt: ago(60 * 3),
  unreadCount: 0,
  memberCount: 2,
  context: {
    lastMessagePreview: 'Photo',
    lastMessageMine: false,
    lastMessageCreatedAt: ago(60 * 3),
    members: [{ id: 'kai', name: 'Kai', avatarUrl: null }],
  },
}
const HUDDLE = {
  id: 'h1',
  threadType: 'group',
  title: 'Waiver wire',
  lastMessageAt: ago(0),
  unreadCount: 0,
  memberCount: 4,
  context: {
    lastMessagePreview: 'GIF',
    lastMessageMine: false,
    lastMessageCreatedAt: ago(0),
    members: [
      { id: 'kai', name: 'Kai', avatarUrl: null },
      { id: 'jo', name: 'Jo Allen', avatarUrl: 'https://cdn.test/jo.png' },
      { id: 'ben', name: 'Ben', avatarUrl: null },
    ],
  },
}

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  override = null
  leftHuddle = false
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const o = override?.(u, init)
    if (o) return o
    if (u === '/api/shared/chat/threads') {
      return json({ threads: [DM, QUIET_DM, ...(leftHuddle ? [] : [HUDDLE])] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return json({
        messages: [
          { id: 'd1', senderUserId: 'jordan', senderName: 'Jordan Love', senderUsername: 'jlove', body: 'u up', createdAt: ago(9), messageType: 'text' },
          { id: 'd2', senderUserId: 'me', senderName: 'Me', body: 'sup', createdAt: ago(5), messageType: 'text' },
        ],
      })
    }
    if (u.startsWith('/api/shared/chat/threads/h1/messages')) {
      return json({
        messages: [{ id: 'h-1', senderUserId: 'kai', senderName: 'Kai', body: 'claiming the kicker', createdAt: ago(1), messageType: 'text' }],
      })
    }
    if (u === '/api/shared/chat/threads/h1/members' && (!init || !init.method || init.method === 'GET')) {
      return json({
        members: [
          { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null },
          { id: 'kai', username: 'kai', displayName: null, avatarUrl: null },
          { id: 'jo', username: 'jo', displayName: 'Jo Allen', avatarUrl: 'https://cdn.test/jo.png' },
        ],
      })
    }
    if (u.includes('/read-receipts')) return json({ receipts: [] })
    if (u.includes('/typing')) return json({ typing: [] })
    return json({ status: 'ok' })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function renderList(kind: 'dm' | 'group' = 'dm') {
  render(<ThreadPanel kind={kind} privacy="private" />)
  return kind === 'dm' ? screen.findByRole('button', { name: /Jordan Love/ }) : screen.findByRole('button', { name: /Waiver wire/ })
}

describe('list rows', () => {
  it('shows the other person’s avatar, "You:" on your own last message, a short time and the unread count', async () => {
    const row = await renderList('dm')
    expect(row.querySelector('.af-cm-dmrow-av img')!.getAttribute('src')).toBe('https://cdn.test/j.png')
    expect(within(row).getByText('You: sup')).toBeTruthy()
    expect(within(row).getByText('5m')).toBeTruthy()
    expect(row.getAttribute('data-unread')).toBe('true')
    expect(row.querySelector('.af-cm-threadrow-unread')!.textContent).toBe('3 unread')
  })

  it('a read row is not bold and carries no count; media previews say what they are', async () => {
    await renderList('dm')
    const quiet = screen.getByRole('button', { name: /Kai/ })
    expect(quiet.getAttribute('data-unread')).toBeNull()
    expect(quiet.querySelector('.af-cm-threadrow-unread')).toBeNull()
    expect(within(quiet).getByText('Photo')).toBeTruthy()
    expect(within(quiet).getByText('3h')).toBeTruthy()
  })

  it('falls back to initials with no image, and when the image fails to load', async () => {
    const row = await renderList('dm')
    const quiet = screen.getByRole('button', { name: /Kai/ })
    expect(quiet.querySelector('.af-cm-dmrow-initials')!.textContent).toBe('K')
    fireEvent.error(row.querySelector('.af-cm-dmrow-av img')!)
    expect(row.querySelector('.af-cm-dmrow-av img')).toBeNull()
    expect(row.querySelector('.af-cm-dmrow-initials')!.textContent).toBe('JL')
  })

  it('stacks up to three faces for a huddle', async () => {
    const row = await renderList('group')
    expect(row.querySelector('.af-cm-dmrow-avs')!.getAttribute('data-count')).toBe('3')
    expect(row.querySelectorAll('.af-cm-dmrow-av')).toHaveLength(3)
    expect(within(row).getByText('GIF')).toBeTruthy()
    expect(within(row).getByText('now')).toBeTruthy()
  })

  it('formats time as now / 5m / 3h / Tue / Sep 12', () => {
    const now = new Date(2026, 8, 25, 15, 0) // Fri Sep 25 2026, local time
    const at = (d: Date) => d.toISOString()
    expect(formatThreadTime(at(new Date(2026, 8, 25, 14, 59, 40)), now)).toBe('now')
    expect(formatThreadTime(at(new Date(2026, 8, 25, 15, 0, 30)), now)).toBe('now') // clock skew
    expect(formatThreadTime(at(new Date(2026, 8, 25, 14, 55)), now)).toBe('5m')
    expect(formatThreadTime(at(new Date(2026, 8, 25, 12, 0)), now)).toBe('3h')
    expect(formatThreadTime(at(new Date(2026, 8, 22, 9, 0)), now)).toBe('Tue')
    expect(formatThreadTime(at(new Date(2026, 8, 12, 9, 0)), now)).toBe('Sep 12')
    expect(formatThreadTime(at(new Date(2025, 8, 12, 9, 0)), now)).toBe('Sep 12, 2025')
    expect(formatThreadTime(null, now)).toBe('')
  })

  it('previews "You: " only on your own message, and says so when there is nothing yet', () => {
    expect(threadRowPreview({ lastMessagePreview: 'hey', lastMessageMine: true })).toBe('You: hey')
    expect(threadRowPreview({ lastMessagePreview: 'hey', lastMessageMine: false })).toBe('hey')
    expect(threadRowPreview({ lastMessagePreview: null })).toBe('No messages yet')
  })
})

async function openDmSheetOn(text: string) {
  fireEvent.click(await renderList('dm'))
  const bubble = (await screen.findByText(text)).closest('[role="article"]') as HTMLElement
  fireEvent.keyDown(bubble, { key: 'Enter' })
  return within(screen.getByRole('dialog'))
}

describe('Report and Block in the message actions', () => {
  it('are offered on somebody else’s message and not on your own', async () => {
    let sheet = await openDmSheetOn('u up')
    expect(sheet.getByRole('button', { name: /Report message/ })).toBeTruthy()
    expect(sheet.getByRole('button', { name: /Block Jordan Love/ })).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Close' }))

    fireEvent.keyDown(screen.getByText('sup', { selector: '.af-cm-bubble-text' }).closest('[role="article"]')!, { key: 'Enter' })
    sheet = within(screen.getByRole('dialog'))
    expect(sheet.queryByRole('button', { name: /Report/ })).toBeNull()
    expect(sheet.queryByRole('button', { name: /Block/ })).toBeNull()
  })

  it('Report confirms with an optional reason, posts to the existing route and thanks you', async () => {
    const sheet = await openDmSheetOn('u up')
    fireEvent.click(sheet.getByRole('button', { name: /Report message/ }))
    fireEvent.change(sheet.getByRole('combobox'), { target: { value: 'harassment' } })
    fireEvent.click(sheet.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByText('Thanks — we’ll take a look.')).toBeTruthy()
    const [, init] = calls((u, i) => u === '/api/shared/chat/report/message' && i?.method === 'POST')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ messageId: 'd1', threadId: 't1', reason: 'harassment' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('🛑 a failed report says so plainly and never thanks you', async () => {
    override = (u) => (u === '/api/shared/chat/report/message' ? json({ error: 'Could not submit report' }, 400) : undefined)
    const sheet = await openDmSheetOn('u up')
    fireEvent.click(sheet.getByRole('button', { name: /Report message/ }))
    fireEvent.click(sheet.getByRole('button', { name: 'Send report' }))
    expect(await sheet.findByRole('alert')).toHaveProperty('textContent', 'Report not sent: Could not submit report.')
    expect(screen.queryByText('Thanks — we’ll take a look.')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Block confirms, posts, and their messages leave the open thread at once', async () => {
    const sheet = await openDmSheetOn('u up')
    fireEvent.click(sheet.getByRole('button', { name: /Block Jordan Love/ }))
    expect(sheet.getByText('You won’t see their messages, and they can’t DM you.')).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Block' }))
    await waitFor(() => expect(screen.queryByText('u up')).toBeNull())
    const [, init] = calls((u, i) => u === '/api/shared/chat/block' && i?.method === 'POST')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ blockedUserId: 'jordan' })
    expect(screen.getByText('sup', { selector: '.af-cm-bubble-text' })).toBeTruthy()
    expect(await screen.findByText('Jordan Love is blocked.')).toBeTruthy()
  })

  it('🛑 a failed block says so, keeps their messages, and never claims it worked', async () => {
    override = (u) => (u === '/api/shared/chat/block' ? json({ error: 'Could not block that person. Try again.' }, 500) : undefined)
    const sheet = await openDmSheetOn('u up')
    fireEvent.click(sheet.getByRole('button', { name: /Block Jordan Love/ }))
    fireEvent.click(sheet.getByRole('button', { name: 'Block' }))
    expect((await sheet.findByRole('alert')).textContent).toBe('Not blocked: Could not block that person. Try again.')
    expect(screen.getByText('u up', { selector: '.af-cm-bubble-text' })).toBeTruthy()
    expect(screen.queryByText(/is blocked\./)).toBeNull()
  })
})

async function openHuddle() {
  fireEvent.click(await renderList('group'))
  await screen.findByText('claiming the kicker')
}

describe('huddle header: members, add people, rename, leave', () => {
  it('lists members with avatar and name from the header', async () => {
    await openHuddle()
    fireEvent.click(screen.getByRole('button', { name: 'Huddle members' }))
    const sheet = within(await screen.findByRole('dialog', { name: /Members of Waiver wire/ }))
    expect(await sheet.findByText('Jo Allen')).toBeTruthy()
    expect(sheet.getByText('kai')).toBeTruthy()
    expect(sheet.getByText('3 members')).toBeTruthy()
    expect(sheet.getByText('(you)')).toBeTruthy()
    expect(document.querySelector('.af-cm-members img')!.getAttribute('src')).toBe('https://cdn.test/jo.png')
  })

  it('Leave confirms, calls /leave, and returns to a list without that huddle', async () => {
    await openHuddle()
    fireEvent.click(screen.getByRole('button', { name: 'Huddle options' }))
    let sheet = within(screen.getByRole('dialog'))
    fireEvent.click(sheet.getByRole('button', { name: /Leave huddle/ }))
    sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('Leave Waiver wire?')).toBeTruthy()
    leftHuddle = true
    fireEvent.click(sheet.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads/h1/leave' && i?.method === 'POST')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('claiming the kicker')).toBeNull())
    expect(screen.queryByRole('button', { name: /Waiver wire/ })).toBeNull()
    expect(screen.getByPlaceholderText('Add names or @usernames')).toBeTruthy()
  })

  it('🛑 a failed leave keeps you in the huddle and says why', async () => {
    override = (u) => (u === '/api/shared/chat/threads/h1/leave' ? json({ error: 'Unable to leave' }, 400) : undefined)
    await openHuddle()
    fireEvent.click(screen.getByRole('button', { name: 'Huddle options' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Leave huddle/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Still in the huddle: Unable to leave.')
    expect(screen.getByText('claiming the kicker')).toBeTruthy()
  })

  it('Rename PATCHes the thread and the header takes the new name', async () => {
    await openHuddle()
    fireEvent.click(screen.getByRole('button', { name: 'Huddle options' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Rename huddle/ }))
    const sheet = within(screen.getByRole('dialog'))
    fireEvent.change(sheet.getByRole('textbox'), { target: { value: 'Kicker cartel' } })
    fireEvent.click(sheet.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const [, init] = calls((u, i) => u === '/api/shared/chat/threads/h1' && i?.method === 'PATCH')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ title: 'Kicker cartel' })
    expect(document.querySelector('.af-cm-threadtitle')!.textContent).toContain('Kicker cartel')
  })

  it('Add people POSTs usernames to /members and shows the new list', async () => {
    override = (u, i) =>
      u === '/api/shared/chat/threads/h1/members' && i?.method === 'POST'
        ? json({ members: [{ id: 'me', username: 'me', displayName: 'Me' }, { id: 'sam', username: 'sam', displayName: 'Sam D' }] })
        : undefined
    await openHuddle()
    fireEvent.click(screen.getByRole('button', { name: 'Huddle options' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Add people/ }))
    const sheet = within(screen.getByRole('dialog'))
    fireEvent.change(sheet.getByRole('textbox'), { target: { value: '@sam, ' } })
    fireEvent.click(sheet.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Sam D')).toBeTruthy()
    const [, init] = calls((u, i) => u === '/api/shared/chat/threads/h1/members' && i?.method === 'POST')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ usernames: ['sam'] })
  })

  it('a DM has no huddle controls', async () => {
    fireEvent.click(await renderList('dm'))
    await screen.findByText('u up')
    expect(screen.queryByRole('button', { name: 'Huddle options' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Huddle members' })).toBeNull()
  })
})
