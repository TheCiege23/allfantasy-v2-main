// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** /help (components/support/HelpCenter.tsx): signed out it asks for a sign-in; signed in it sends and opens. */

import { HelpCenter } from '@/components/support/HelpCenter'

afterEach(() => cleanup())

describe('the help page', () => {
  it('offers the Discord #support channel, signed in or out, as a new tab', () => {
    // The never-expiring invite into #support (lib/support/discordSupportCore.ts), owner's call 2026-11-26.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ threads: [] }), { status: 200 })))
    for (const signedIn of [false, true]) {
      render(<HelpCenter signedIn={signedIn} />)
      const link = screen.getByTestId('help-discord-link') as HTMLAnchorElement
      expect(link.href).toBe('https://discord.gg/rkxqXNCKkE')
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
      expect(screen.getByTestId('help-discord').textContent).toContain('the channel is public')
      cleanup()
    }
    vi.unstubAllGlobals()
  })

  it('signed out: asks them to sign in, with the email as a fallback', () => {
    render(<HelpCenter signedIn={false} />)
    expect(screen.getByTestId('help-signed-out').textContent).toContain('support@allfantasy.ai')
    expect(screen.queryByTestId('help-new-message')).toBeNull()
  })

  it('signed in: pick a topic, write, send — and the conversation opens', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (init?.method === 'POST') return new Response(JSON.stringify({ threadId: 'thread-9-abcdefgh' }), { status: 201 })
      if (url.endsWith('/api/support/threads')) return new Response(JSON.stringify({ threads: [{ id: 'thread-9-abcdefgh', title: 'Something is broken: Blank page', status: 'needs_reply', lastMessageAt: '' }] }))
      return new Response(JSON.stringify({ thread: { id: 'thread-9-abcdefgh', title: 'Something is broken: Blank page', status: 'needs_reply', lastMessageAt: '', messages: [{ id: 'm1', from: 'member', event: 'opened', body: 'Blank page', createdAt: '', authorName: 'Ann' }] } }))
    }))
    render(<HelpCenter signedIn />)
    fireEvent.change(screen.getByLabelText('What is this about?'), { target: { value: 'bug' } })
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Blank page' } })
    fireEvent.click(screen.getByTestId('help-send'))
    await waitFor(() => expect(screen.getByTestId('help-thread').textContent).toContain('Blank page'))
    const sent = calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({ topic: 'bug', message: 'Blank page' })
    vi.unstubAllGlobals()
  })
})
