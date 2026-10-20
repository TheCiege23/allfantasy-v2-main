// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { runLayoutCssGate } = require('../scripts/lib/bounded-layout-css-gate.cjs')

describe('bounded layout CSS validation', () => {
  it('retains the CSS validator and requires its successful exit', () => {
    const spawn = vi.fn((_executable: string, _args: string[], _options: object) => ({ status: 0 }))
    expect(runLayoutCssGate('/build/.next', { spawn, log: () => {} }).ok).toBe(true)
    expect(spawn.mock.calls[0][1]).toEqual([expect.stringMatching(/layout-css-gate\.cjs$/), '/build/.next'])
    expect(spawn.mock.calls[0][2]).toMatchObject({ timeout: 120000, killSignal: 'SIGKILL' })
    for (const result of [{ status: 1 }, { status: null, signal: 'SIGKILL' }, { status: 0, error: { code: 'ETIMEDOUT' } }]) {
      expect(runLayoutCssGate('/build/.next', { spawn: () => result, log: () => {} }).ok).toBe(false)
    }
  })
  it('terminates a genuinely stalled validation process and fails closed', () => {
    const start = Date.now()
    const result = runLayoutCssGate('/unused', {
      timeoutMs: 250,
      log: () => {},
      spawn: (executable: string, _args: string[], options: object) => spawnSync(executable,
        ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)'], options),
    })
    expect(result.ok).toBe(false)
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
