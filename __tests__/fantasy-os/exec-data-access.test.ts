/**
 * Data-access boundary tests: the executive source must be env-gated and fail CLOSED — never fall back to
 * the application schema, never fabricate rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
// pg must never be constructed when the source is disabled.
const poolCtor = vi.fn()
vi.mock('pg', () => ({ Pool: class { constructor(cfg: unknown) { poolCtor(cfg) } query() { return Promise.resolve({ rows: [] }) } } }))

describe('exec-data access boundary (fail-closed)', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    poolCtor.mockClear()
    delete process.env.FANTASY_OS_EXEC_ENABLED
    delete process.env.FANTASY_OS_EXEC_DATABASE_URL
  })
  afterEach(() => {
    process.env = { ...OLD }
  })

  it('returns disabled + never constructs a pool when the flag is off', async () => {
    const { fetchExecSnapshot } = await import('@/lib/fantasy-os/exec-data/client')
    const res = await fetchExecSnapshot()
    expect(res.available).toBe(false)
    if (!res.available) expect(res.reason).toBe('disabled')
    expect(poolCtor).not.toHaveBeenCalled()
  })

  it('returns disabled when enabled but no URL is provided (no fallback to app DB)', async () => {
    process.env.FANTASY_OS_EXEC_ENABLED = 'true'
    const { fetchExecSnapshot } = await import('@/lib/fantasy-os/exec-data/client')
    const res = await fetchExecSnapshot()
    expect(res.available).toBe(false)
    if (!res.available) {
      expect(res.reason).toBe('disabled')
      expect(res.detail).toMatch(/DATABASE_URL/)
    }
    expect(poolCtor).not.toHaveBeenCalled()
  })
})
