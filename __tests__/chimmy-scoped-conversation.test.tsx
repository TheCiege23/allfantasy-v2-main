import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useScopedConversation } from '@/components/core-app/comms/useScopedConversation'

beforeEach(() => sessionStorage.clear())

it('keeps a delayed answer in its originating league', () => {
  const { result, rerender } = renderHook(({ scope }) => useScopedConversation('user-a', scope), { initialProps: { scope: 'league-a' } })
  const answerA = result.current.setTurns
  act(() => result.current.setDraft('My league A question'))
  rerender({ scope: 'league-b' })
  act(() => answerA([{ id: '1', role: 'chimmy', text: 'Answer for A' }]))
  expect(result.current.turns).toEqual([])
  expect(result.current.draft).toBe('')
  rerender({ scope: 'league-a' })
  expect(result.current.turns[0].text).toBe('Answer for A')
  expect(result.current.draft).toBe('My league A question')
})

it('does not overwrite another account storage on account switching', () => {
  const key = 'af:comms:conversations:user-b'
  sessionStorage.setItem(key, JSON.stringify({ league: { turns: [], draft: 'B private draft' } }))
  const { result, rerender } = renderHook(({ owner }) => useScopedConversation(owner, 'league'), { initialProps: { owner: 'user-a' } })
  act(() => result.current.setDraft('A private draft'))
  rerender({ owner: 'user-b' })
  expect(result.current.draft).toBe('B private draft')
  expect(sessionStorage.getItem(key)).not.toContain('A private draft')
})
