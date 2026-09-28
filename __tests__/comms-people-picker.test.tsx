import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * The DM / huddle people picker in the drawer: league-mates as you type, a tap to start a DM, chips
 * for a huddle, and an exact username for anyone outside your leagues — against the wire shapes of
 * `/api/shared/chat/league-mates`, `/dm/start` and `/threads`.
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

const MATES = [
  { id: 'jo', displayName: 'Jo Allen', username: 'jo', avatarUrl: 'https://cdn.test/jo.png', sharedLeagues: ['Dynasty Degens'] },
  { id: 'kai', displayName: 'Kai', username: 'kai', avatarUrl: null, sharedLeagues: ['Dynasty Degens', 'Redraft Rumble'] },
  { id: 'ben', displayName: 'Ben Bruiser', username: 'benb', avatarUrl: null, sharedLeagues: ['Redraft Rumble'] },
]

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

type Handler = (url: string, init?: RequestInit) => Response | undefined
let fetchMock: ReturnType<typeof vi.fn>
let override: Handler | null = null
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))
const bodyOf = (init: unknown) => JSON.parse(String((init as RequestInit).body))

const thread = (id: string, threadType: 'dm' | 'group', title: string) => ({
  id,
  threadType,
  title,
  lastMessageAt: new Date().toISOString(),
  unreadCount: 0,
  memberCount: threadType === 'dm' ? 2 : 3,
})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  override = null
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const o = override?.(u, init)
    if (o) return o
    if (u === '/api/shared/chat/threads' && (!init?.method || init.method === 'GET')) return json({ threads: [] })
    if (u.startsWith('/api/shared/chat/league-mates')) {
      const q = new URL(u, 'https://x.test').searchParams.get('q')?.toLowerCase() ?? ''
      return json({
        status: 'ok',
        mates: MATES.filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.username.includes(q)),
      })
    }
    if (u === '/api/shared/chat/dm/start' && init?.method === 'POST') {
      return json({ status: 'ok', thread: thread('dm-new', 'dm', 'Kai') })
    }
    if (u === '/api/shared/chat/threads' && init?.method === 'POST') {
      const b = bodyOf(init)
      return json({ status: 'ok', thread: thread(b.threadType === 'dm' ? 'dm-typed' : 'hud-new', b.threadType, 'New chat') })
    }
    if (u.includes('/messages')) return json({ messages: [] })
    if (u.includes('/read-receipts')) return json({ receipts: [] })
    if (u.includes('/typing')) return json({ typing: [] })
    return json({ status: 'ok' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

async function mount(kind: 'dm' | 'group') {
  render(<ThreadPanel kind={kind} privacy="Private." />)
  await screen.findByText(kind === 'dm' ? 'No DMs yet.' : 'No huddles yet.')
  return screen.getByRole('combobox')
}

async function openList(box: HTMLElement) {
  fireEvent.focus(box)
  return screen.findByRole('listbox')
}

describe('DM picker', () => {
  it('fetches nothing until the box is focused, then lists league-mates with avatar, name, @handle and the shared league', async () => {
    const box = await mount('dm')
    expect(calls((u) => u.startsWith('/api/shared/chat/league-mates'))).toHaveLength(0)
    expect(box.getAttribute('aria-expanded')).toBe('false')

    const list = await openList(box)
    expect(calls((u) => u === '/api/shared/chat/league-mates')).toHaveLength(1)
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(box.getAttribute('aria-controls')).toBe(list.id)
    const options = within(list).getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]!.textContent).toContain('Jo Allen')
    expect(options[0]!.textContent).toContain('@jo')
    expect(options[0]!.textContent).toContain('Dynasty Degens')
    expect(options[1]!.textContent).toContain('Dynasty Degens +1 more')
    expect(options[0]!.querySelector('img')!.getAttribute('src')).toBe('https://cdn.test/jo.png')
    expect(screen.getByText('Your league-mates')).toBeTruthy()
  })

  it('searches as you type', async () => {
    const box = await mount('dm')
    await openList(box)
    fireEvent.change(box, { target: { value: 'ben' } })
    await waitFor(() => expect(calls((u) => u === '/api/shared/chat/league-mates?q=ben')).toHaveLength(1))
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option').textContent).toContain('Ben Bruiser')
  })

  it('🛑 tapping a league-mate starts the DM through /dm/start and opens it', async () => {
    const box = await mount('dm')
    const list = await openList(box)
    fireEvent.click(within(list).getByRole('option', { name: /Kai/ }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/dm/start' && i?.method === 'POST')).toHaveLength(1))
    expect(bodyOf(calls((u) => u === '/api/shared/chat/dm/start')[0]![1])).toEqual({ username: 'kai' })
    // Not the typed-username route.
    expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(0)
    await waitFor(() => expect(calls((u) => u.startsWith('/api/shared/chat/threads/dm-new/messages'))).not.toHaveLength(0))
    expect(screen.getByRole('button', { name: /All DMs/ })).toBeTruthy()
  })

  it('keyboard: arrows move the highlight, Enter starts the DM, Escape closes the list', async () => {
    const box = await mount('dm')
    await openList(box)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const second = screen.getAllByRole('option')[1]!
    expect(box.getAttribute('aria-activedescendant')).toBe(second.id)
    expect(second.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id)
    fireEvent.keyDown(box, { key: 'ArrowUp' }) // wraps to the last
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2]!.id)

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box.getAttribute('aria-expanded')).toBe('false')

    fireEvent.keyDown(box, { key: 'ArrowDown' }) // reopens
    await screen.findByRole('listbox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls((u) => u === '/api/shared/chat/dm/start')).toHaveLength(1))
    expect(bodyOf(calls((u) => u === '/api/shared/chat/dm/start')[0]![1])).toEqual({ username: 'kai' })
  })

  it('🛑 an exact username still works for someone outside your leagues', async () => {
    const box = await mount('dm')
    await openList(box)
    fireEvent.change(box, { target: { value: '@outsider' } })
    expect(await screen.findByText(/Nobody in your leagues matches “outsider”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(1))
    expect(bodyOf(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')[0]![1])).toEqual({
      threadType: 'dm',
      usernames: ['outsider'],
    })
    expect(calls((u) => u === '/api/shared/chat/dm/start')).toHaveLength(0)
  })

  it('Enter with nothing highlighted sends what you TYPED — never the first suggestion', async () => {
    const box = await mount('dm')
    await openList(box)
    fireEvent.change(box, { target: { value: 'jo' } }) // "Jo Allen" is suggested…
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(1))
    expect(bodyOf(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')[0]![1]).usernames).toEqual(['jo'])
    expect(calls((u) => u === '/api/shared/chat/dm/start')).toHaveLength(0)
  })

  it('a blocked or failed start shows the server’s words under the box and opens nothing', async () => {
    override = (u, i) =>
      u === '/api/shared/chat/dm/start' && i?.method === 'POST'
        ? json({ error: "You can't start a conversation with this person." }, 403)
        : undefined
    const box = await mount('dm')
    const list = await openList(box)
    fireEvent.click(within(list).getByRole('option', { name: /Jo Allen/ }))
    expect((await screen.findByRole('alert')).textContent).toBe("You can't start a conversation with this person.")
    expect(screen.queryByRole('button', { name: /All DMs/ })).toBeNull()
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('says so when the league-mates list cannot load, and typing a username still works', async () => {
    override = (u) => (u.startsWith('/api/shared/chat/league-mates') ? json({ error: 'nope' }, 503) : undefined)
    const box = await mount('dm')
    fireEvent.focus(box)
    expect(await screen.findByText("Couldn't load your league-mates. You can still type a username.")).toBeTruthy()
    fireEvent.change(box, { target: { value: 'kai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(1))
  })
})

describe('huddle picker', () => {
  it('🛑 builds a multi-person huddle from picks and a typed username, with removable chips', async () => {
    const box = await mount('group')
    const list = await openList(box)
    expect(list.getAttribute('aria-multiselectable')).toBe('true')
    fireEvent.click(within(list).getByRole('option', { name: /Jo Allen/ }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Kai/ }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Ben Bruiser/ }))

    const chips = within(screen.getByRole('list', { name: 'People in this huddle' }))
    expect(
      chips.getAllByRole('listitem').map((li) => li.querySelector('.af-cm-pick-chip-name')!.textContent),
    ).toEqual(['Jo Allen', 'Kai', 'Ben Bruiser'])
    expect(screen.getByRole('option', { name: /Kai/ }).getAttribute('aria-selected')).toBe('true')

    // Removable: the × takes Ben back out.
    fireEvent.click(chips.getByRole('button', { name: 'Remove Ben Bruiser' }))
    expect(within(screen.getByRole('list', { name: 'People in this huddle' })).getAllByRole('listitem')).toHaveLength(2)

    // Someone outside your leagues, by exact username: Enter makes a chip.
    fireEvent.change(box, { target: { value: 'outsider' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove @outsider' })).toBeTruthy()
    expect((box as HTMLInputElement).value).toBe('')
    expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(1))
    expect(bodyOf(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')[0]![1])).toEqual({
      threadType: 'group',
      usernames: ['jo', 'kai', 'outsider'],
    })
    expect(calls((u) => u === '/api/shared/chat/dm/start')).toHaveLength(0)
    await waitFor(() => expect(calls((u) => u.startsWith('/api/shared/chat/threads/hud-new/messages'))).not.toHaveLength(0))
  })

  it('comma-separated usernames still work on their own', async () => {
    const box = await mount('group')
    fireEvent.change(box, { target: { value: 'kai, @jo ,zed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')).toHaveLength(1))
    expect(bodyOf(calls((u, i) => u === '/api/shared/chat/threads' && i?.method === 'POST')[0]![1]).usernames).toEqual(['kai', 'jo', 'zed'])
  })

  it('a league-mate first typed by handle is one chip, not two, and shows as picked', async () => {
    const box = await mount('group')
    await openList(box)
    fireEvent.change(box, { target: { value: '@KAI' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Remove @KAI' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(screen.getByRole('option', { name: /Kai/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /Kai/ })) // already in: this takes them out
    expect(screen.queryByRole('list', { name: 'People in this huddle' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Kai/ }))
    const chips = within(screen.getByRole('list', { name: 'People in this huddle' })).getAllByRole('listitem')
    expect(chips).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Remove Kai' })).toBeTruthy()
  })

  it('Backspace in an empty box takes the last chip off; tapping a picked mate again unpicks them', async () => {
    const box = await mount('group')
    const list = await openList(box)
    fireEvent.click(within(list).getByRole('option', { name: /Jo Allen/ }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Kai/ }))
    fireEvent.keyDown(box, { key: 'Backspace' })
    expect(screen.queryByRole('button', { name: 'Remove Kai' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Jo Allen' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Jo Allen/ }))
    expect(screen.queryByRole('list', { name: 'People in this huddle' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
