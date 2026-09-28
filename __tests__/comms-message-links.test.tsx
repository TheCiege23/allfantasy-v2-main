import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { readReactions } from '@/lib/chat-core/messageReactions'

/*
 * Links in league chat, DMs and huddles. All three draw their words through ChatMessageList, so
 * these render the list itself rather than a helper: what matters is the <a> a person can tap, and
 * that nothing else ever becomes one.
 */

function msg(body: string, over: Partial<ChatListMessage> = {}): ChatListMessage {
  return {
    id: 'm1',
    authorId: 'sam',
    authorName: 'Sam Darnold',
    avatarUrl: null,
    body,
    createdAt: new Date(Date.UTC(2026, 8, 25, 14, 0)).toISOString(),
    parentMessageId: null,
    metadata: null,
    messageType: 'text',
    ...over,
  }
}

function bubbleFor(body: string, over: Partial<ChatListMessage> = {}) {
  const { container } = render(
    <ChatMessageList
      messages={[msg(body, over)]}
      viewerId="me"
      label="League chat"
      reactionsFor={(m) => readReactions(m.metadata, 'me')}
      onToggleReaction={vi.fn()}
      onReply={vi.fn()}
      renderRich={() => null}
      nameForUserId={() => null}
    />,
  )
  return container.querySelector('.af-cm-bubble-text') as HTMLElement
}

describe('links in message text', () => {
  it('turns an https URL into a real <a> that opens safely in a new tab', () => {
    const p = bubbleFor('trade block is here https://allfantasy.test/trade/123 check it')
    const links = p.querySelectorAll('a')
    expect(links).toHaveLength(1)
    const a = links[0]!
    expect(a.getAttribute('href')).toBe('https://allfantasy.test/trade/123')
    expect(a.textContent).toBe('https://allfantasy.test/trade/123')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc')
    expect(p.textContent).toBe('trade block is here https://allfantasy.test/trade/123 check it')
  })

  it('links a bare www. address to https', () => {
    const a = bubbleFor('rankings at www.example.com/rb').querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://www.example.com/rb')
    expect(a.textContent).toBe('www.example.com/rb')
  })

  it('🛑 XSS: javascript:alert(1) stays text, and so do data: and other schemes', () => {
    for (const body of [
      'javascript:alert(1)',
      'click javascript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'JaVaScRiPt:alert(1)',
      'mailto:sam@example.com',
      'ftp://files.example.com/x',
      'javascript://www.evil.example/%0aalert(1)',
    ]) {
      const p = bubbleFor(body)
      expect(p.querySelector('a'), body).toBeNull()
      expect(p.textContent).toBe(body)
      cleanup()
    }
  })

  it('never renders message HTML — markup arrives as the characters it is', () => {
    const p = bubbleFor('<img src=x onerror=alert(1)> https://ok.example.com')
    expect(p.querySelector('img')).toBeNull()
    expect(p.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(p.querySelector('a')!.getAttribute('href')).toBe('https://ok.example.com/')
  })

  it('keeps a trailing period (and comma) out of the link', () => {
    const p = bubbleFor('Read this: https://example.com/news.')
    const a = p.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/news')
    expect(a.textContent).toBe('https://example.com/news')
    expect(p.textContent).toBe('Read this: https://example.com/news.')
    cleanup()
    expect(bubbleFor('www.a.com, www.b.com').querySelectorAll('a')[0]!.textContent).toBe('www.a.com')
  })

  it('trims an unbalanced ) but keeps a balanced one', () => {
    const wrapped = bubbleFor('(see https://example.com/x)')
    expect(wrapped.querySelector('a')!.textContent).toBe('https://example.com/x')
    expect(wrapped.textContent).toBe('(see https://example.com/x)')
    cleanup()
    const wiki = bubbleFor('https://en.wikipedia.org/wiki/Bo_(dog)')
    expect(wiki.querySelector('a')!.textContent).toBe('https://en.wikipedia.org/wiki/Bo_(dog)')
  })

  it('keeps an @mention next to a link working exactly as before', () => {
    const p = bubbleFor('@sam https://example.com/deal @jo_2')
    const mentions = Array.from(p.querySelectorAll('.af-cm-mention')).map((n) => n.textContent)
    expect(mentions).toEqual(['@sam', '@jo_2'])
    const a = p.querySelector('a')!
    expect(a.textContent).toBe('https://example.com/deal')
    expect(a.querySelector('.af-cm-mention')).toBeNull()
    expect(p.textContent).toBe('@sam https://example.com/deal @jo_2')
  })

  it('leaves plain text and plain mentions untouched', () => {
    expect(bubbleFor('no links here').innerHTML).toBe('no links here')
    cleanup()
    const p = bubbleFor('hey @sam')
    expect(p.querySelector('a')).toBeNull()
    expect(p.querySelector('.af-cm-mention')!.textContent).toBe('@sam')
  })

  it('does not link the tail of a word or a scheme with no host', () => {
    for (const body of ['xhttps://example.com', 'awww.example.com', 'https://', 'www.']) {
      expect(bubbleFor(body).querySelector('a'), body).toBeNull()
      cleanup()
    }
  })
})
