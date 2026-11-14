import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderTimer } from '@/lib/core-app/renderTiming'

/**
 * `[render-timing]` is how a slow /core render names the read that made it slow. It must log
 * only slow renders, report each read's own duration even when reads overlap, and never fail
 * the render it is measuring.
 */

let clock = 0
beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createRenderTimer', () => {
  it('logs nothing for a fast render', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timer = createRenderTimer('league-home')
    clock = 900
    timer.done()
    expect(log).not.toHaveBeenCalled()
  })

  it('logs each overlapping read with its own duration once the render is slow', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timer = createRenderTimer('league-home')
    const trades = deferred<string>()
    const teams = deferred<string>()
    const tradesRead = timer.time('trades', trades.promise)
    const teamsRead = timer.time('teams', teams.promise)

    clock = 40
    teams.resolve('t')
    await teamsRead
    clock = 1900
    trades.resolve('x')
    await tradesRead
    timer.lap('render')
    clock = 2000
    timer.done({ platform: 'sleeper' })

    expect(log).toHaveBeenCalledTimes(1)
    const [tag, json] = log.mock.calls[0] as [string, string]
    expect(tag).toBe('[render-timing]')
    const payload = JSON.parse(json)
    expect(payload).toMatchObject({ scope: 'league-home', totalMs: 2000, platform: 'sleeper' })
    expect(payload.reads).toEqual({ teams: 40, trades: 1900 })
    expect(payload.laps).toEqual({ render: 1900 })
  })

  it('passes a rejection through untouched and still records the read', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timer = createRenderTimer('league-home', 0)
    const failing = Promise.reject(new Error('db down'))
    await expect(timer.time('teams', failing)).rejects.toThrow('db down')
    timer.done()
    expect(JSON.parse((log.mock.calls[0] as [string, string])[1]).reads).toHaveProperty('teams')
  })

  it('a logging failure never reaches the render', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('stdout closed')
    })
    const timer = createRenderTimer('league-home', 0)
    expect(() => timer.done()).not.toThrow()
  })
})
