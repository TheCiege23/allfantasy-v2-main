import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CATCHUP_HOURS, CATCHUP_MINUTE, catchupOnce, decideCatchup } from '../../scripts/worker-release-catchup.mjs'

/*
 * 🛑 On 2026-11-24 GitHub created none of the three worker-release schedules, so the worker stayed on
 * the previous night's code all day. The allfantasy-cron service dispatches the workflow instead.
 */
const at = (iso: string) => new Date(iso)
const run = (status: string, conclusion: string | null, created_at: string) => ({ status, conclusion, created_at })
const yesterdayEvening = run('completed', 'success', '2026-11-23T23:17:31Z')

describe('deciding a catch-up', () => {
  it('dispatches at 13:50 when no attempt ran this morning (the 2026-11-24 case)', () => {
    expect(decideCatchup(at('2026-11-24T13:50:05Z'), [yesterdayEvening]).dispatch).toBe(true)
  })

  it('does nothing outside its three minutes', () => {
    expect(decideCatchup(at('2026-11-24T13:49:00Z'), [yesterdayEvening]).dispatch).toBe(false)
    expect(decideCatchup(at('2026-11-24T16:50:00Z'), [yesterdayEvening]).dispatch).toBe(false)
    expect(decideCatchup(at('2026-11-24T12:50:00Z'), [yesterdayEvening]).dispatch).toBe(false)
  })

  it('stands down when GitHub\'s own attempt already succeeded this morning', () => {
    const r = decideCatchup(at('2026-11-24T14:50:00Z'), [run('completed', 'success', '2026-11-24T13:21:40Z'), yesterdayEvening])
    expect(r.dispatch).toBe(false)
    expect(r.line).toMatch(/already succeeded at 13:21/)
  })

  it('a self-cancelled attempt is not a success', () => {
    const runs = [run('completed', 'cancelled', '2026-11-24T13:21:00Z'), yesterdayEvening]
    expect(decideCatchup(at('2026-11-24T13:50:00Z'), runs).dispatch).toBe(true)
  })

  it('does not race a run that is queued or running', () => {
    const r = decideCatchup(at('2026-11-24T13:50:00Z'), [run('queued', null, '2026-11-24T13:49:00Z'), yesterdayEvening])
    expect(r.dispatch).toBe(false)
    expect(r.line).toMatch(/already queued/)
  })

  it('fires at most three times a day, each inside the quiet window', () => {
    expect(CATCHUP_HOURS).toHaveLength(3)
    for (const h of CATCHUP_HOURS) {
      expect(decideCatchup(at(`2026-11-24T${String(h).padStart(2, '0')}:${CATCHUP_MINUTE}:00Z`), []).dispatch).toBe(true)
    }
  })
})

describe('one tick', () => {
  const env = { WORKER_RELEASE_GH_TOKEN: 'test-token-not-real' }

  it('is disabled without a token and calls nothing', async () => {
    const request = vi.fn()
    const log = vi.fn()
    const r = await catchupOnce({ now: at('2026-11-24T13:50:00Z'), env: {}, request, log })
    expect(r.dispatched).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('makes no API call outside its minutes', async () => {
    const request = vi.fn()
    await catchupOnce({ now: at('2026-11-24T13:51:00Z'), env, request, log: vi.fn() })
    expect(request).not.toHaveBeenCalled()
  })

  it('dispatches with catchup=true from main, and never logs the token', async () => {
    const request = vi.fn(async (_t: string, method: string) => (method === 'GET' ? { workflow_runs: [yesterdayEvening] } : null))
    const log = vi.fn()
    const r = await catchupOnce({ now: at('2026-11-24T13:50:00Z'), env, request, log })
    expect(r.dispatched).toBe(true)
    expect(request).toHaveBeenLastCalledWith(
      'test-token-not-real',
      'POST',
      '/repos/TheCiege23/allfantasy-v2-main/actions/workflows/worker-release.yml/dispatches',
      { ref: 'main', inputs: { catchup: 'true' } },
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-token-not-real')
  })

  it('swallows an API failure instead of crashing the scheduler', async () => {
    const request = vi.fn(async () => {
      throw new Error('GET /repos/x -> HTTP 502')
    })
    const log = vi.fn()
    const r = await catchupOnce({ now: at('2026-11-24T13:50:00Z'), env, request, log })
    expect(r.dispatched).toBe(false)
    expect(String(log.mock.calls.at(-1))).toMatch(/failed: .*502/)
  })
})

describe('the workflow treats a catch-up as a scheduled attempt', () => {
  const yml = readFileSync(join(process.cwd(), '.github/workflows/worker-release.yml'), 'utf8')

  it('runs the window check for a catch-up, and skips the manual cooldown', () => {
    expect(yml).toMatch(/if: github\.event_name == 'schedule' \|\| inputs\.catchup == true/)
    expect(yml).toMatch(/inputs\.dry_run != true && inputs\.catchup != true/)
    expect(yml).toMatch(/^\s+catchup:\s*$/m)
  })
})
