import React from 'react'
import { cleanup, render, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { readReactions } from '@/lib/chat-core/messageReactions'
import { readSurvivorHostCard } from '@/lib/core-app/survivorChatCard'
import { survivorChatMessages } from '@/lib/core-app/messages/survivorChat'
import { missingMessages } from '@/lib/i18n/messages'
import { mirrorSurvivorChatMessageToLeagueChat } from '@/lib/survivor/survivorChatBridge'

/*
 * Survivor host lines in league chat render as island cards. A row is one when it carries BOTH
 * server-owned keys the bridge writes: `chimmy: true` and `survivorChat`. Style only.
 */

afterEach(() => cleanup())

const T = (min: number) => new Date(Date.UTC(2026, 9, 31, 20, min)).toISOString()
const msg = (over: Partial<ChatListMessage> & { id: string }): ChatListMessage => ({
  authorId: 'sam',
  authorName: 'Sam',
  avatarUrl: null,
  body: 'hello',
  createdAt: T(0),
  parentMessageId: null,
  metadata: null,
  messageType: 'text',
  ...over,
})

/** What the bridge stores for a host announcement, as the read path returns it (author swapped to Chimmy). */
const hostLine = (over: Partial<ChatListMessage> = {}) =>
  msg({
    id: 'survivor-chat:e1',
    authorId: null,
    authorName: 'Chimmy',
    body: 'The tribes have merged. Welcome to Solana.',
    messageType: 'system',
    metadata: { chimmy: true, survivorChat: { messageId: 'e1', channelId: 'c1', channelType: 'league', contentType: 'host_announcement' } },
    ...over,
  })

function renderList(messages: ChatListMessage[]) {
  return render(
    <ChatMessageList
      messages={messages}
      viewerId="commish"
      label="League chat"
      reactionsFor={(m) => readReactions(m.metadata, 'commish')}
      onToggleReaction={vi.fn()}
      onReply={vi.fn()}
      renderRich={() => null}
      nameForUserId={() => null}
      onEdit={vi.fn(async () => undefined)}
      onDelete={vi.fn(async () => undefined)}
    />,
  )
}
const row = (container: HTMLElement, id: string) => container.querySelector(`[data-message-id="${id}"]`) as HTMLElement

describe('readSurvivorHostCard', () => {
  it('needs both server-owned keys', () => {
    expect(readSurvivorHostCard({ chimmy: true, survivorChat: { contentType: 'host_announcement' } })).toEqual({ castawayName: null, contentType: 'host_announcement' })
    // A human castaway's mirrored message: survivorChat, no Chimmy marker.
    expect(readSurvivorHostCard({ survivorChat: { contentType: 'text' } })).toBeNull()
    // An ordinary Chimmy post (weekly awards) is not a Survivor host line.
    expect(readSurvivorHostCard({ chimmy: true, chimmyMoment: { kind: 'weekly_awards' } })).toBeNull()
    expect(readSurvivorHostCard(null)).toBeNull()
    expect(readSurvivorHostCard({ chimmy: true, survivorChat: 'nope' })).toBeNull()
  })

  it('names the castaway Chimmy speaks for, trimmed and capped', () => {
    expect(readSurvivorHostCard({ chimmy: true, survivorChat: { castawayName: '  Rafa  ' } })).toEqual({ castawayName: 'Rafa', contentType: 'text' })
    expect(readSurvivorHostCard({ chimmy: true, survivorChat: { castawayName: 'x'.repeat(90) } })?.castawayName).toHaveLength(60)
    expect(readSurvivorHostCard({ chimmy: true, survivorChat: { castawayName: '   ' } })?.castawayName).toBeNull()
  })
})

describe('Survivor host island card in league chat', () => {
  it('draws the torch avatar and a HOST byline, not the plain Chimmy badge', () => {
    const { container } = renderList([hostLine()])
    const r = row(container, 'survivor-chat:e1')
    expect(r.getAttribute('data-survivor-host')).toBe('true')
    expect(r.getAttribute('data-survivor-content')).toBe('host_announcement')
    expect(r.getAttribute('data-chimmy')).toBe('true')
    expect(within(r).getByTestId('survivor-host-avatar')).toBeTruthy()
    expect(within(r).queryByTestId('chimmy-avatar')).toBeNull()
    expect(within(r).queryByTestId('chimmy-badge')).toBeNull()
    const byline = within(r).getByTestId('survivor-host-byline')
    expect(byline.textContent).toBe('HostChimmy')
    expect(within(r).getByRole('article').getAttribute('aria-label')).toMatch(/^Chimmy,/)
    expect(within(r).getByText('The tribes have merged. Welcome to Solana.')).toBeTruthy()
  })

  it('names the castaway seat on a castaway line', () => {
    const { container } = renderList([
      hostLine({ id: 'survivor-chat:e2', metadata: { chimmy: true, survivorChat: { channelType: 'tribe', contentType: 'text', castawayName: 'Rafa' } } }),
    ])
    const r = row(container, 'survivor-chat:e2')
    expect(within(r).getByTestId('survivor-host-byline').textContent).toBe('CastawayRafa')
    expect(within(r).getByRole('article').getAttribute('aria-label')).toMatch(/^Rafa,/)
  })

  it('leaves a human castaway, a spoofed name and an ordinary Chimmy post alone', () => {
    const { container } = renderList([
      msg({ id: 'human', authorId: 'ana', authorName: 'Ana', metadata: { survivorChat: { channelType: 'tribe', contentType: 'text' } } }),
      msg({ id: 'spoof', authorId: 'bo', authorName: 'Chimmy', metadata: { survivorChat: { contentType: 'host_announcement' } } }),
      msg({ id: 'awards', authorId: null, authorName: 'Chimmy', metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' } } }),
    ])
    for (const id of ['human', 'spoof', 'awards']) {
      expect(row(container, id).getAttribute('data-survivor-host')).toBeNull()
      expect(within(row(container, id)).queryByTestId('survivor-host-byline')).toBeNull()
    }
    expect(within(row(container, 'awards')).getByTestId('chimmy-badge')).toBeTruthy()
  })

  it('has its copy in Spanish', () => {
    expect(missingMessages(survivorChatMessages, 'es')).toEqual([])
  })

  it('styles the card in the island theme file, outside any @media block', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-survivor-theme.css'), 'utf8')
    const at = css.indexOf(".af-core .af-cm-row[data-survivor-host='true'] .af-cm-bubble {")
    expect(at).toBeGreaterThan(0)
    const before = css.slice(0, at)
    expect((before.match(/{/g) ?? []).length).toBe((before.match(/}/g) ?? []).length)
  })
})

describe('the bridge forwards the castaway name, and only for a castaway line', () => {
  function fakeDb() {
    return {
      survivorChatChannel: { findUnique: vi.fn(async () => ({ tribeId: 'tribe-a' })) },
      league: { findUnique: vi.fn(async () => ({ userId: 'owner-1' })) },
      leagueChatMessage: { create: vi.fn(async () => ({ id: 'x' })) },
    }
  }
  const base = { id: 'e9', leagueId: 'l1', channelId: 'c1', channelType: 'tribe', senderUserId: 'survivor-host-chimmy', senderIsHost: true, content: 'We stick together.', contentType: 'text' }
  const survivorMeta = (db: ReturnType<typeof fakeDb>) =>
    (db.leagueChatMessage.create.mock.calls[0] as unknown as [{ data: { metadata: { survivorChat: Record<string, unknown> } } }])[0].data.metadata.survivorChat

  it('a castaway line (host, not a system message) carries castawayName', async () => {
    const db = fakeDb()
    await mirrorSurvivorChatMessageToLeagueChat(db as never, { ...base, senderName: ' Rafa ', isSystemMessage: false })
    expect(survivorMeta(db).castawayName).toBe('Rafa')
  })

  it('a host announcement does not', async () => {
    const db = fakeDb()
    await mirrorSurvivorChatMessageToLeagueChat(db as never, { ...base, senderName: 'Chimmy', isSystemMessage: true })
    expect(survivorMeta(db)).not.toHaveProperty('castawayName')
  })

  it('a human castaway does not either', async () => {
    const db = fakeDb()
    await mirrorSurvivorChatMessageToLeagueChat(db as never, { ...base, senderUserId: 'u-ana', senderIsHost: false, senderName: 'Ana', isSystemMessage: false })
    expect(survivorMeta(db)).not.toHaveProperty('castawayName')
  })
})
