import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync('scripts/railway-pirate-rehearsal.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace(/export\s*\{\s*\};?/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const env = { RAILWAY_PROJECT_ID: '80e84d3b-778a-4fe6-be53-6c16068e8aa2', RAILWAY_ENVIRONMENT_ID: '686eb5e0-af93-4370-806a-af544049ea93',
  CRON_SECRET: 'test-token', PIRATE_REHEARSAL_TASK: 'capture', PIRATE_REHEARSAL_UNTIL: '2026-11-07T12:00:00Z' }
async function worker(overrides = {}, bodyFor: (url: string) => unknown = () => ({ ok: true, lineupCoverageCertified: true })) {
  const request = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodyFor(url) }))
  const output = vi.fn()
  const run = new AsyncFunction('globalThis', 'fetch', 'console', source)({ Bun: { env: { ...env, ...overrides } } }, request, { log: output })
  return { run, request, output }
}
afterEach(() => vi.useRealTimers())
describe('Railway rehearsal worker', () => {
  it('stops before any request after its expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08'))
    const result = await worker(); await result.run; expect(result.request).not.toHaveBeenCalled()
  })
  it('refuses the wrong Railway project without forwarding its secret', async () => {
    const result = await worker({ RAILWAY_PROJECT_ID: 'production' })
    await expect(result.run).rejects.toThrow('Isolated staging'); expect(result.request).not.toHaveBeenCalled()
  })
  it('keeps capture independent of feed and scoring latency', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29'))
    const result = await worker(); await result.run
    expect(result.request).toHaveBeenCalledTimes(1)
    expect(result.request.mock.calls[0][0]).toContain('?task=capture')
  })
  it('does not spend provider allowance after a failed scope gate', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29'))
    const result = await worker({ PIRATE_REHEARSAL_TASK: 'data' }, () => ({ ok: false }))
    await expect(result.run).rejects.toThrow('tasks failed'); expect(result.request).toHaveBeenCalledTimes(1)
  })
  it('checks every sport and fails on uncertified HTTP 200 injury coverage', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29'))
    const result = await worker({ PIRATE_REHEARSAL_TASK: 'data' }, url => ({ ok: true,
      lineupCoverageCertified: !url.includes('sport=NFL&notifications') }))
    await expect(result.run).rejects.toThrow('tasks failed')
    expect(result.request).toHaveBeenCalledTimes(7)
    for (const sport of ['NFL', 'NBA', 'MLB', 'NHL']) expect(result.request.mock.calls.some(([url]) => url.includes(`import-injuries?sport=${sport}&notifications=0`))).toBe(true)
    expect(JSON.stringify(result.output.mock.calls)).not.toContain('test-token')
  })
})
