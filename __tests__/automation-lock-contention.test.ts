import { describe, expect, it, vi } from 'vitest'
import { acquireAutomationLock } from '@/lib/automation/locks'

describe('Postgres automation lease contention', () => {
  it.each(['P2002', 'P2025'])('classifies competing lease mutation %s as busy', async code => {
    const db = { $transaction: vi.fn().mockRejectedValue(Object.assign(new Error('concurrent lease mutation'), { code })) }
    expect(await acquireAutomationLock('draft:test:pick', { owner: 'request', ttlMs: 5000 }, db as never)).toEqual({ ok: false, reason: 'Lock held (postgres)' })
  })
  it('preserves the infrastructure error path for a real connection failure', async () => {
    const db = { $transaction: vi.fn().mockRejectedValue(Object.assign(new Error('connection unavailable'), { code: 'P1001' })) }
    expect(await acquireAutomationLock('draft:test:pick', { owner: 'request', ttlMs: 5000 }, db as never)).toEqual({ ok: false, reason: 'Postgres lock error: connection unavailable' })
  })
})
