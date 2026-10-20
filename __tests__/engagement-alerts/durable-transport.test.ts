import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ upsert: vi.fn(), claim: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { notificationOutbox: { upsert: h.upsert, updateMany: h.claim, update: h.update } } }))
import { deliverDurably } from '@/lib/notifications/durableTransport'
const message = { userId: 'u1', channel: 'push' as const, eventType: 'game_scoring_play', title: 'Goal', body: 'Goal', eventKey: 'NHL:game:play1', metadata: { notificationCategory: 'performance_alerts' } }
beforeEach(() => { vi.resetAllMocks(); h.upsert.mockResolvedValue({}); h.claim.mockResolvedValue({ count: 1 }); h.update.mockResolvedValue({}) })
describe('durable notification handoff', () => {
  it('persists and claims before handing off, then marks sent', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    await deliverDurably(message, send)
    expect(h.upsert.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
    expect(h.claim.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0])
    expect(h.update.mock.calls[0][0].data.status).toBe('sent')
  })
  it('retains failures as pending for the relay', async () => {
    await deliverDurably(message, async () => { throw new Error('503') })
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', attemptCount: { increment: 1 } })
    expect(h.update.mock.calls[0][0].data.sendAfter).toBeInstanceOf(Date)
  })
  it('does not resend a row another sender already claimed or delivered', async () => {
    h.claim.mockResolvedValue({ count: 0 })
    const send = vi.fn()
    await deliverDurably(message, send)
    expect(send).not.toHaveBeenCalled()
  })
  it('keys each event, recipient and channel independently', async () => {
    const send = async () => {}
    await deliverDurably(message, send)
    await deliverDurably(message, send)
    await deliverDurably({ ...message, eventKey: 'NHL:game:play2' }, send)
    await deliverDurably({ ...message, userId: 'u2' }, send)
    await deliverDurably({ ...message, channel: 'email' }, send)
    const ids = h.upsert.mock.calls.map(c => c[0].where.id)
    expect(ids[0]).toBe(ids[1])
    expect(new Set(ids).size).toBe(4)
  })
  it('records no subscribed devices separately from a successful handoff', async () => {
    await deliverDurably(message, async () => 'unavailable' as const)
    expect(h.update.mock.calls[0][0].data.status).toBe('skipped')
  })
  it('does not claim success when persistence fails', async () => {
    h.upsert.mockRejectedValue(new Error('database unavailable'))
    const send = vi.fn()
    await expect(deliverDurably(message, send)).rejects.toThrow('database unavailable')
    expect(send).not.toHaveBeenCalled()
  })
})
