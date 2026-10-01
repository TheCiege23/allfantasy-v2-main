// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { railwayBuild, NEXT_BUILD_ARGS } = require('../../scripts/next-build.cjs') as {
  railwayBuild: (deps: Record<string, unknown>) => number
  NEXT_BUILD_ARGS: string[]
}

/*
 * scripts/next-build.cjs turns the webpack cache back on for Railway builds. Its
 * one promise: the worst case is today's build (cache OFF) plus lost time — never
 * a cache published from a build that did not pass the layout CSS gate.
 */

function harness(o: { builds?: number[]; gates?: boolean[]; warm?: boolean; skipCache?: boolean; skipGate?: boolean } = {}) {
  const builds = [...(o.builds ?? [0])]
  const gates = [...(o.gates ?? [true])]
  const calls: string[] = []
  const deps = {
    cacheDir: '/tmp/private',
    skipCache: !!o.skipCache,
    skipGate: !!o.skipGate,
    log: () => {},
    seed: vi.fn(() => {
      calls.push('seed')
      return o.warm ?? true
    }),
    build: vi.fn((env: { AF_WEBPACK_CACHE_DIR: string }) => {
      calls.push(env.AF_WEBPACK_CACHE_DIR ? 'build:cache' : 'build:nocache')
      return builds.shift() ?? 0
    }),
    gate: vi.fn(() => {
      calls.push('gate')
      const ok = gates.shift() ?? true
      return { ok, problems: ok ? [] : ['x'] }
    }),
    publish: vi.fn(() => calls.push('publish')),
    discardShared: vi.fn(() => calls.push('discard')),
    cleanup: vi.fn(() => calls.push('cleanup')),
  }
  return { deps, calls, run: () => railwayBuild(deps) }
}

describe('Railway build orchestration', () => {
  it('cached build that passes the gate publishes its cache', () => {
    const h = harness()
    expect(h.run()).toBe(0)
    expect(h.calls).toEqual(['seed', 'build:cache', 'gate', 'publish', 'cleanup'])
  })

  it('a cached build that FAILS the gate is never published: shared cache discarded, rebuilt with the cache off', () => {
    const h = harness({ gates: [false, true] })
    expect(h.run()).toBe(0)
    expect(h.calls).toEqual(['seed', 'build:cache', 'gate', 'discard', 'build:nocache', 'gate', 'cleanup'])
    expect(h.deps.publish).not.toHaveBeenCalled()
  })

  it('a cached build that crashes (compile error / OOM) falls back to the cache-off build', () => {
    const h = harness({ builds: [137, 0] })
    expect(h.run()).toBe(0)
    expect(h.calls).toEqual(['seed', 'build:cache', 'discard', 'build:nocache', 'gate', 'cleanup'])
    expect(h.deps.publish).not.toHaveBeenCalled()
  })

  it('fails the deploy when even the cache-off build ships no layout CSS', () => {
    const h = harness({ gates: [false, false] })
    expect(h.run()).toBe(1)
  })

  it('propagates the cache-off build exit status when it also fails', () => {
    const h = harness({ builds: [1, 2] })
    expect(h.run()).toBe(2)
  })

  it('AF_WEBPACK_CACHE=0 runs only the cache-off build: no seed, no publish', () => {
    const h = harness({ skipCache: true })
    expect(h.run()).toBe(0)
    expect(h.calls).toEqual(['build:nocache', 'gate', 'cleanup'])
  })

  it('AF_SKIP_LAYOUT_CSS_GATE=1 skips the gate', () => {
    const h = harness({ skipGate: true })
    expect(h.run()).toBe(0)
    expect(h.deps.gate).not.toHaveBeenCalled()
  })

  it('cleans up the private cache even when a build throws', () => {
    const h = harness()
    h.deps.build.mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })
    expect(() => h.run()).toThrow('spawn failed')
    expect(h.deps.cleanup).toHaveBeenCalledTimes(1)
  })

  it('off Railway, the command is byte-identical to the pre-2026-10-01 `build` script', () => {
    expect(['node', ...NEXT_BUILD_ARGS].join(' ')).toBe(
      'node --max-old-space-size=20480 --require ./scripts/win-exfat-readlink-shim.cjs node_modules/next/dist/bin/next build',
    )
  })
})

describe('next.config.js webpack cache branch', () => {
  const saved = { ...process.env }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  afterEach(() => {
    process.env = { ...saved }
    Object.defineProperty(process, 'platform', platform)
  })

  function run(env: Record<string, string>, onPlatform = 'linux') {
    Object.defineProperty(process, 'platform', { value: onPlatform })
    for (const k of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_GIT_COMMIT_SHA', 'AF_WEBPACK_CACHE_DIR', 'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN']) {
      delete process.env[k]
    }
    Object.assign(process.env, env)
    const cfg = require('../../next.config.js') as { webpack: (c: Record<string, unknown>, o: Record<string, unknown>) => Record<string, unknown> }
    const config = {
      resolve: {},
      plugins: [],
      cache: { type: 'filesystem', cacheDirectory: '/app/.next-coldtest-0826/cache/webpack', name: 'server-production' },
      snapshot: { managedPaths: ['/app/node_modules/'] },
    }
    return cfg.webpack(config, { isServer: true, dev: false }) as {
      cache: false | { cacheDirectory: string; name: string }
      snapshot: Record<string, unknown>
    }
  }

  it('Railway + wrapper: keeps Next\'s filesystem cache, points it at the private dir, hashes content', () => {
    const out = run({ RAILWAY_ENVIRONMENT: 'production', AF_WEBPACK_CACHE_DIR: '/tmp/af-webpack-cache-1' })
    expect(out.cache).toMatchObject({ cacheDirectory: '/tmp/af-webpack-cache-1', name: 'server-production' })
    expect(out.snapshot).toMatchObject({ module: { hash: true }, managedPaths: ['/app/node_modules/'] })
  })

  it('Railway without the wrapper (or its fallback): cache OFF, as before', () => {
    expect(run({ RAILWAY_ENVIRONMENT: 'production' }).cache).toBe(false)
  })

  it('Linux CI: cache OFF, as before — even if the variable leaks in', () => {
    expect(run({ AF_WEBPACK_CACHE_DIR: '/tmp/x' }).cache).toBe(false)
  })
})
