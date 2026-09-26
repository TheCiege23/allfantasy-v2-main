import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatComposer } from '../app/dashboard/components/chat/ChatComposer'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('../app/dashboard/components/chat/GifPicker', () => ({
  GifPicker: ({ onSelect }: any) => <button onClick={() => onSelect({ giphyId: 'test', url: 'https://example.com/test.gif', previewUrl: 'https://example.com/test.gif', title: 'Pending test GIF' })}>Choose test GIF</button>,
}))

it('does not carry selected media into another conversation', () => {
  const onSend = vi.fn()
  const { rerender } = render(<ChatComposer leagueId="a" threadId="first" chatType="dm" currentUserId="owner" onSend={onSend} />)
  fireEvent.click(screen.getByRole('button', { name: 'GIF', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose test GIF' }))
  expect(screen.getByText('Pending test GIF')).toBeInTheDocument()
  rerender(<ChatComposer leagueId="b" threadId="second" chatType="dm" currentUserId="owner" onSend={onSend} />)
  expect(screen.queryByText('Pending test GIF')).not.toBeInTheDocument()
  expect(onSend).not.toHaveBeenCalled()
})

it('does not restore old media into the new conversation after a delayed send failure', async () => {
  let reject!: (error: Error) => void
  const onSend = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  const { rerender } = render(<ChatComposer leagueId="a" threadId="first" chatType="dm" currentUserId="owner" onSend={onSend} />)
  fireEvent.click(screen.getByRole('button', { name: 'GIF', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Choose test GIF' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  rerender(<ChatComposer leagueId="b" threadId="second" chatType="dm" currentUserId="owner" onSend={onSend} />)
  await act(async () => { reject(new Error('offline')) })
  expect(screen.queryByText('Pending test GIF')).not.toBeInTheDocument()
})
