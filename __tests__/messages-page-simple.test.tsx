import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /messages on a phone (2026-11-25, the simplify pass), and the notification deep link it fixed.
 */
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/messages',
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }) }))
vi.mock('@/components/chimmy', () => ({ ChimmyChatShell: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', async (original) => {
  const actual = await original<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue, useOptionalLanguage: () => actual.defaultLanguageValue }
})

import MessagesContent from '@/app/messages/MessagesContent'
import { MessageInteractionRenderer } from '@/lib/social-chat'

const THREADS = [
  { id: 't1', threadType: 'dm', productType: 'shared', title: 'GridironGuru', lastMessageAt: new Date().toISOString(), unreadCount: 0, memberCount: 2 },
]
const MESSAGES = [
  { id: 'm1', threadId: 't1', senderUserId: 'u2', senderName: 'GridironGuru', messageType: 'text', body: 'Want to talk a Bijan deal?', createdAt: new Date().toISOString() },
]

beforeEach(() => {
  nav.params = new URLSearchParams()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const body = u === '/api/shared/chat/threads' ? { threads: THREADS } : u.includes('/messages?') ? { messages: MESSAGES } : {}
    // Slow the thread list down so the selection check runs before it arrives, as on a real phone.
    if (u === '/api/shared/chat/threads') await new Promise((r) => setTimeout(r, 30))
    return { ok: true, status: 200, json: async () => body }
  }))
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function code(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('/messages', () => {
  it('a notification link (?thread=) opens that conversation, not the inbox', async () => {
    nav.params = new URLSearchParams('thread=t1')
    render(<MessagesContent />)
    expect(await screen.findByText('Want to talk a Bijan deal?')).toBeTruthy()
    // Still selected once the list has loaded: the Back arrow belongs to an open conversation.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy())
  })

  it('on a phone, an open conversation hides the tabs and puts the tools under the message box', async () => {
    nav.params = new URLSearchParams('thread=t1')
    render(<MessagesContent />)
    await screen.findByText('Want to talk a Bijan deal?')
    expect(screen.getByTestId('messages-tabs').className).toMatch(/(^|\s)hidden md:block(\s|$)/)
    const tools = screen.getByTestId('messages-composer-tools').className
    expect(tools).toMatch(/(^|\s)order-last(\s|$)/)
    expect(tools).toMatch(/(^|\s)w-full(\s|$)/)
  })

  it('quick reactions and Pin sit behind one "Add reaction" button per message', () => {
    render(<MessageInteractionRenderer message={MESSAGES[0] as never} threadId="t1" currentUserId="u1" />)
    expect(screen.queryByRole('button', { name: 'React 👍' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    expect(screen.getByRole('button', { name: 'React 👍' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy()
  })

  it('the page heading is plain, with no intro card', () => {
    expect(code('app/messages/page.tsx')).not.toMatch(/Unified inbox for DMs/)
  })
})
