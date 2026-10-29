// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThreadPanel } from '@/components/core-app/comms/ThreadPanel'
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'recipient' } } }) }))
vi.mock('@/components/core-app/comms/RichMessage', () => ({ default: () => null }))
vi.mock('@/components/core-app/comms/SeenBy', () => ({ SeenBy: () => null }))
vi.mock('@/components/core-app/comms/MessageReactions', () => ({ MessageReactions: () => null }))
vi.mock('@/app/dashboard/components/chat/ChatComposer', () => ({ ChatComposer: () => <div>Composer</div> }))
vi.mock('@/lib/chat-core/notifyMentions', () => ({ notifyMentions: vi.fn() }))
vi.mock('@/components/core-app/comms/ThreadListRow', () => ({
 ThreadListRow: ({ thread, onOpen }: any) => <button onClick={onOpen}>{thread.title}</button>,
 formatLastActive: () => '',
}))
vi.mock('@/components/core-app/comms/ChatMessageList', () => ({
 ChatMessageList: ({ messages }: any) => <div>{messages.map((m: any) => <div key={m.id}>{m.body}</div>)}</div>,
}))
vi.mock('@/components/core-app/comms/TypingNote', () => ({ TypingNote: () => null }))
vi.mock('@/components/core-app/comms/HuddleSheets', () => ({ HuddleMembersSheet: () => null, HuddleOptionsSheet: () => null }))
vi.mock('@/components/core-app/comms/ChatSearch', () => ({ ChatSearch: () => null }))
vi.mock('@/components/core-app/comms/PeoplePicker', () => ({ PeoplePicker: () => null }))
vi.mock('@/components/core-app/comms/useTypingSignal', () => ({ useTypingSignal: () => undefined }))
vi.mock('@/components/core-app/comms/chatFailure', () => ({ chatFailure: () => 'Could not load messages.' }))
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data })
beforeEach(() => {
 vi.useFakeTimers()
 Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
 Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe.each(['dm', 'group'] as const)('%s recipient delivery', kind => {
 it('discovers a new conversation while the recipient keeps the list open', async () => {
  let arrived = false
  const thread = { id: 'new-room', title: 'New conversation', threadType: kind, memberCount: 2 }
  const fetchMock = vi.fn(async () => reply({ threads: arrived ? [thread] : [] }))
  vi.stubGlobal('fetch', fetchMock)
  await act(async () => { render(<ThreadPanel kind={kind} privacy="Members only" />) })
  expect(screen.queryByText('New conversation')).toBeNull()
  arrived = true
  await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
  expect(screen.getByText('New conversation')).toBeTruthy()
  expect(fetchMock).toHaveBeenLastCalledWith('/api/shared/chat/threads', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
 })
 it('receives new messages without reopening and retains history on a failed poll', async () => {
  let bodies = ['First message'], failed = false
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
   if (url === '/api/shared/chat/threads') return reply({ threads: [{ id: 'room', title: 'Open conversation', threadType: kind, memberCount: 2 }] })
   if (url.endsWith('/messages')) return reply(failed ? { error: 'Temporary connection failure' } : { messages: bodies.map((body, i) => ({ id: String(i), body, senderUserId: 'sender', senderName: 'Sender', createdAt: '2026-10-20T22:31:14Z' })) }, !failed)
   return reply({})
  }))
  await act(async () => { render(<ThreadPanel kind={kind} privacy="Members only" />) })
  await act(async () => { fireEvent.click(screen.getByText('Open conversation')) })
  expect(screen.getByText('First message')).toBeTruthy()
  bodies.push('Reply from another user')
  await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
  expect(screen.getByText('Reply from another user')).toBeTruthy()
  failed = true
  await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
  expect(screen.getByText('First message')).toBeTruthy()
  expect(screen.queryByText('No messages yet.')).toBeNull()
  failed = false
  bodies.push('Recovered message')
  await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
  expect(screen.getByText('Recovered message')).toBeTruthy()
 })
})

