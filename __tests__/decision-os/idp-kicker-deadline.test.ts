/**
 * IDP and kicker values reach Chimmy (2026-11-16, re-score item 8) without risking the packet. The chat route now
 * asks for the slice on every turn; the slice is a serialized hop after the context engine, and the route throws
 * the WHOLE packet away past its 3s ceiling — so the hop is bounded by the packet's clock and reports a gap when
 * it cannot finish, instead of costing every other slice in the turn.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { IDP_KICKER_DEADLINE_MS, withSliceDeadline, type GroundedSlice } from '@/lib/decision-os/grounding/packet'
import type { ValueLookup } from '@/lib/decision-os/value/contract'

const present = { present: true, value: [{ playerName: 'Fred Warner' }], asOf: null, servedFrom: 'store', confidence: null, conclusive: { ok: true }, gap: null } as unknown as GroundedSlice<ValueLookup[]>

describe('withSliceDeadline', () => {
  it('passes the slice through when it finishes in time', async () => {
    expect(await withSliceDeadline(1000, Promise.resolve(present))).toBe(present)
  })

  it('reports a gap — not a hang, not a throw — when the slice is late', async () => {
    vi.useFakeTimers()
    const out = withSliceDeadline(50, new Promise<GroundedSlice<ValueLookup[]>>(() => {}))
    vi.advanceTimersByTime(60)
    const r = await out
    vi.useRealTimers()
    expect(r.present).toBe(false)
    expect(r.gap).toMatchObject({ reason: 'not_computed', detail: 'IDP and kicker values did not finish in time for this answer.' })
  })

  it('does not even wait when the packet is already out of time', async () => {
    const r = await withSliceDeadline(0, new Promise<GroundedSlice<ValueLookup[]>>(() => {}))
    expect(r.present).toBe(false)
  })

  it('a failing read becomes the same gap, never a packet failure', async () => {
    const r = await withSliceDeadline(1000, Promise.reject(new Error('db down')))
    expect(r.present).toBe(false)
  })

  it('calls onLate when — and only when — the deadline wins (the late-slice log, 2026-11-23)', async () => {
    const onLate = vi.fn()
    await withSliceDeadline(1000, Promise.resolve(present), undefined, onLate)
    await withSliceDeadline(1000, Promise.reject(new Error('db down')), undefined, onLate)
    expect(onLate).not.toHaveBeenCalled()
    await withSliceDeadline(0, new Promise<GroundedSlice<ValueLookup[]>>(() => {}), undefined, onLate)
    expect(onLate).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    const out = withSliceDeadline(50, new Promise<GroundedSlice<ValueLookup[]>>(() => {}), undefined, onLate)
    vi.advanceTimersByTime(60)
    await out
    vi.useRealTimers()
    expect(onLate).toHaveBeenCalledTimes(2)
  })

  it('the deadline sits under the chat route’s 3,000 ms packet ceiling', () => {
    expect(IDP_KICKER_DEADLINE_MS).toBeLessThan(3000)
  })
})

describe('the chat route asks for IDP and kicker values', () => {
  const route = readFileSync(resolve(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')
  const packet = readFileSync(resolve(process.cwd(), 'lib/decision-os/grounding/packet.ts'), 'utf8')

  it('requests the slice in the packet `want`', () => {
    expect(route).toMatch(/^\s*idpKicker: true,/m)
  })

  it('and the packet runs it through the deadline', () => {
    expect(packet).toMatch(/withSliceDeadline\(remainingMs, loadIdpKickerValueSlice\(/)
  })

  it('positive control: the request pattern does not match a commented-out line', () => {
    expect(/^\s*idpKicker: true,/m.test('            // idpKicker: true,')).toBe(false)
  })
})
