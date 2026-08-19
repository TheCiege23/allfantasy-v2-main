import { describe, it, expect, vi } from 'vitest'
import { InProcessEventBus, normalizeDomainEvent, type DomainEvent } from '@/lib/events'

function evt(type: string): DomainEvent {
  return normalizeDomainEvent({ type, payload: {}, metadata: { source: 'test' } })
}

describe('InProcessEventBus', () => {
  it('delivers to exact-type subscribers only', async () => {
    const bus = new InProcessEventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe('competition.matchup.finalized', a)
    bus.subscribe('competition.score.updated', b)
    await bus.publish(evt('competition.matchup.finalized'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('supports wildcard prefix and global "*" patterns', async () => {
    const bus = new InProcessEventBus()
    const prefix = vi.fn()
    const all = vi.fn()
    bus.subscribe('competition.*', prefix)
    bus.subscribe('*', all)
    await bus.publish(evt('competition.matchup.finalized'))
    await bus.publish(evt('lifecycle.season.activated'))
    expect(prefix).toHaveBeenCalledTimes(1) // only the competition.* one
    expect(all).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe stops delivery', async () => {
    const bus = new InProcessEventBus()
    const h = vi.fn()
    const off = bus.subscribe('a.*', h)
    await bus.publish(evt('a.b'))
    off()
    await bus.publish(evt('a.b'))
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('isolates subscriber failures (one bad handler does not block others or throw)', async () => {
    const bus = new InProcessEventBus()
    const good = vi.fn()
    bus.subscribe('*', () => {
      throw new Error('boom')
    })
    bus.subscribe('*', good)
    await expect(bus.publish(evt('a.b'))).resolves.toBeUndefined()
    expect(good).toHaveBeenCalledTimes(1)
  })
})
