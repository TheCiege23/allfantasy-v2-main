import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The drawer's Block says "X is blocked." only on a 2xx. The route used to answer
 * `status: 'ok'` even when the block row failed to write, so the UI would have told someone they
 * were safe while nothing had changed.
 */

const h = vi.hoisted(() => ({
  addBlock: vi.fn(),
  blockUserInSharedThreads: vi.fn(),
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'me' }) }))
vi.mock('@/lib/moderation', () => ({ addBlock: h.addBlock }))
vi.mock('@/lib/platform/chat-service', () => ({ blockUserInSharedThreads: h.blockUserInSharedThreads }))

import { POST } from '@/app/api/shared/chat/block/route'

function req(body: unknown) {
  return new Request('http://localhost/api/shared/chat/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  h.addBlock.mockReset()
  h.blockUserInSharedThreads.mockReset()
  h.blockUserInSharedThreads.mockResolvedValue(1)
})

describe('POST /api/shared/chat/block', () => {
  it('answers ok once the block is written', async () => {
    h.addBlock.mockResolvedValue(true)
    const res = await POST(req({ blockedUserId: 'troll' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', affectedThreads: 1 })
    expect(h.addBlock).toHaveBeenCalledWith('me', 'troll')
  })

  it('🛑 is NOT ok when the block could not be written', async () => {
    h.addBlock.mockResolvedValue(false)
    const res = await POST(req({ blockedUserId: 'troll' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.status).toBeUndefined()
    expect(body.error).toBe('Could not block that person. Try again.')
  })
})
