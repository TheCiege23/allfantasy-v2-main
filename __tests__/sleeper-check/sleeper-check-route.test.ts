import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sleeper-check/sleeperCheck', () => ({ runSleeperCheck: run }))
// Telemetry is not under test; pass the handler through untouched.
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))

import { POST } from '@/app/api/sleeper-check/route'

let ipSeq = 0
function post(body: unknown, ip = `203.0.113.${++ipSeq % 250}`) {
  return POST(
    new Request('https://allfantasy.test/api/sleeper-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }) as any,
  )
}

const OK = { status: 'ok', username: 'guap', players: [], alerts: [], leagues: [] }

beforeEach(() => {
  run.mockReset()
  run.mockResolvedValue(OK)
})

describe('POST /api/sleeper-check', () => {
  it('runs the check and never lets a response be cached', async () => {
    const res = await post({ username: '@Guap' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, username: 'guap' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(run).toHaveBeenCalledWith('Guap')
  })

  it('refuses the honeypot and a too-fast form BEFORE any Sleeper read', async () => {
    expect((await post({ username: 'guap', website: 'http://spam' })).status).toBe(400)
    expect((await post({ username: 'guap', form_rendered_at: Date.now() })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a username that could reach a provider path', async () => {
    const res = await post({ username: '../league/123' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('INVALID_USERNAME')
    expect(run).not.toHaveBeenCalled()
  })

  it('maps not-found to 404 and an outage to 503 — never one for the other', async () => {
    run.mockResolvedValueOnce({ status: 'not_found' })
    expect((await post({ username: 'nobody' })).status).toBe(404)
    run.mockResolvedValueOnce({ status: 'unavailable' })
    expect((await post({ username: 'guap' })).status).toBe(503)
  })

  it('limits one connection, and stops before reading Sleeper once it is spent', async () => {
    const ip = '198.51.100.7'
    const statuses: number[] = []
    for (let i = 0; i < 14; i++) statuses.push((await post({ username: `user${i}` }, ip)).status)
    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true)
    expect(statuses.slice(12)).toEqual([429, 429])
    expect(run).toHaveBeenCalledTimes(12)
  })

  it('limits re-checking the same account from one connection', async () => {
    const ip = '198.51.100.8'
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await post({ username: 'same' }, ip)).status)
    expect(statuses).toEqual([200, 200, 200, 200, 429])
  })
})
