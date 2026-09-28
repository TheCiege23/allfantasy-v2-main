import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { readReactions } from '@/lib/chat-core/messageReactions'

/*
 * Chimmy's badge in the league conversation (the list LeagueConversation, the drawer and the draft
 * room all render through). The badge and the sparkle avatar come from the SERVER-OWNED marker only;
 * a member called "Chimmy" gets neither.
 */

const T = (min: number) => new Date(Date.UTC(2026, 8, 25, 14, min)).toISOString()
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

const chimmyAwards = (over: Partial<ChatListMessage> = {}) =>
  msg({
    id: 'awards',
    authorId: null,
    authorName: 'Chimmy',
    body: '📺 Week 3 recap — Iron Horse (2026)\n🚀 Boom of the week: Alex, 162.4',
    messageType: 'system',
    metadata: { isSystem: true, chimmy: true, chimmyMoment: { v: 1, kind: 'weekly_awards' } },
    ...over,
  })

function renderList(messages: ChatListMessage[], over: Partial<React.ComponentProps<typeof ChatMessageList>> = {}) {
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
      {...over}
    />,
  )
}

const row = (container: HTMLElement, id: string) => container.querySelector(`[data-message-id="${id}"]`) as HTMLElement

describe('Chimmy in the league conversation', () => {
  it('draws Chimmy’s sparkle avatar, the "Chimmy" badge and what the moment was', () => {
    const { container } = renderList([chimmyAwards()])
    const r = row(container, 'awards')
    expect(r.getAttribute('data-chimmy')).toBe('true')
    expect(within(r).getByTestId('chimmy-avatar')).toBeTruthy()
    expect(within(r).getByTestId('chimmy-badge').textContent).toBe('Chimmy')
    expect(within(r).getByText('Weekly awards')).toBeTruthy()
    expect(within(r).getByRole('article').getAttribute('aria-label')).toMatch(/^Chimmy,/)
  })

  it('labels a trade take as one', () => {
    const { container } = renderList([
      chimmyAwards({ id: 'take', metadata: { chimmy: true, chimmyMoment: { v: 1, kind: 'trade' } } }),
    ])
    expect(within(row(container, 'take')).getByText('Trade take')).toBeTruthy()
  })

  it('🛑 a member NAMED "Chimmy", even with a Discord name of Chimmy, gets no badge and no sparkle', () => {
    const { container } = renderList([
      msg({ id: 'fake', authorId: 'member-1', authorName: 'Chimmy', metadata: { discordAuthorName: 'Chimmy' } }),
    ])
    const r = row(container, 'fake')
    expect(r.getAttribute('data-chimmy')).toBeNull()
    expect(within(r).queryByTestId('chimmy-badge')).toBeNull()
    expect(within(r).queryByTestId('chimmy-avatar')).toBeNull()
    // Their own initials, as for anyone else.
    expect(within(r).getByText('C')).toBeTruthy()
  })

  it('🛑 is never the commissioner’s own message, even if the wire carried the owner’s id', () => {
    // The row is stored under the commissioner (a required FK). If an id ever leaked through, the
    // commissioner must still see it on Chimmy's side, with no Edit or Delete.
    const { container } = renderList([chimmyAwards({ authorId: 'commish' })])
    const r = row(container, 'awards')
    expect(r.getAttribute('data-mine')).toBe('false')
    fireEvent.keyDown(within(r).getByRole('article'), { key: 'Enter' })
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByText(/Edit/)).toBeNull()
    expect(within(sheet).queryByText(/^Delete$/)).toBeNull()
    // Reacting and replying to Chimmy is the point of posting in chat.
    expect(within(sheet).getByText('Reply')).toBeTruthy()
  })

  it('offers no Report or Block — there is no person to report', () => {
    const onReport = vi.fn(async () => undefined)
    const onBlock = vi.fn(async () => undefined)
    const { container } = renderList([chimmyAwards()], { onReport, onBlock })
    fireEvent.keyDown(within(row(container, 'awards')).getByRole('article'), { key: 'Enter' })
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).queryByText(/Report message/)).toBeNull()
    expect(within(sheet).queryByText(/Block/)).toBeNull()
  })

  it('leaves an ordinary message exactly as it was', () => {
    const { container } = renderList([msg({ id: 'a' })])
    const r = row(container, 'a')
    expect(r.getAttribute('data-chimmy')).toBeNull()
    expect(within(r).getByText('Sam')).toBeTruthy()
    expect(within(r).queryByTestId('chimmy-badge')).toBeNull()
  })
})
