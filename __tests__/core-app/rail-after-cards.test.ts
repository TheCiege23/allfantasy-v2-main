/**
 * The rail's matchup read waits for the home's cards (lib/core-app/railAfterCards.ts, 2026-11-22): it opens when the
 * cards settle — fulfilled or rejected — and on its own after the maximum wait, so the rail is never left without
 * scores.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRailGate, openRailGate, RAIL_AFTER_CARDS_MAX_WAIT_MS } from '@/lib/core-app/railAfterCards'

afterEach(() => vi.useRealTimers())

const settledYet = async (p: Promise<void>) => {
  let done = false
  p.then(() => { done = true })
  await Promise.resolve(); await Promise.resolve()
  return done
}

describe('the rail waits for the home cards', () => {
  it('stays closed until the cards settle, then opens', async () => {
    const gate = createRailGate(60_000)
    let finish!: () => void
    gate.releaseAfter(new Promise<void>((r) => { finish = r }))
    expect(await settledYet(gate.opened)).toBe(false)
    finish()
    await gate.opened
  })

  it('opens when a card fails, too', async () => {
    const gate = createRailGate(60_000)
    gate.releaseAfter(Promise.reject(new Error('card failed')))
    await gate.opened
  })

  it('opens on its own after the maximum wait when the home never releases it', async () => {
    vi.useFakeTimers()
    const gate = createRailGate()
    expect(await settledYet(gate.opened)).toBe(false)
    await vi.advanceTimersByTimeAsync(RAIL_AFTER_CARDS_MAX_WAIT_MS)
    expect(await settledYet(gate.opened)).toBe(true)
  })

  it('an open gate is open from the start, and releasing it does nothing', async () => {
    const gate = openRailGate()
    gate.releaseAfter(Promise.resolve())
    expect(await settledYet(gate.opened)).toBe(true)
  })
})
