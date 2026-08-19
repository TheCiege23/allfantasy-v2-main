import { describe, it, expect } from 'vitest'
import { computeDeterministicConfigVersion, resolveEngineVersionHash, TRADE_MODEL_VERSION } from '@/lib/replay-framework/versioning'

describe('resolveEngineVersionHash', () => {
  it('prefers BUILD_SHA first, matching the existing af-debug/sha route precedence', () => {
    expect(
      resolveEngineVersionHash({
        BUILD_SHA: 'from-build-sha',
        RAILWAY_GIT_COMMIT_SHA: 'from-railway',
        VERCEL_GIT_COMMIT_SHA: 'from-vercel',
      } as NodeJS.ProcessEnv),
    ).toBe('from-build-sha')
  })

  it('falls back through RAILWAY -> VERCEL -> NEXT_PUBLIC_BUILD_SHA', () => {
    expect(resolveEngineVersionHash({ RAILWAY_GIT_COMMIT_SHA: 'from-railway' } as NodeJS.ProcessEnv)).toBe('from-railway')
    expect(resolveEngineVersionHash({ VERCEL_GIT_COMMIT_SHA: 'from-vercel' } as NodeJS.ProcessEnv)).toBe('from-vercel')
    expect(resolveEngineVersionHash({ NEXT_PUBLIC_BUILD_SHA: 'from-next-public' } as NodeJS.ProcessEnv)).toBe('from-next-public')
  })

  it('falls back to "dev" when nothing is set (local development)', () => {
    expect(resolveEngineVersionHash({} as NodeJS.ProcessEnv)).toBe('dev')
  })
})

describe('computeDeterministicConfigVersion', () => {
  it('produces a stable, distinguishable string per calibratedB0 value', () => {
    expect(computeDeterministicConfigVersion(-1.1)).toBe('b0:-1.1000')
    expect(computeDeterministicConfigVersion(-1.3)).toBe('b0:-1.3000')
    expect(computeDeterministicConfigVersion(-1.1)).toBe(computeDeterministicConfigVersion(-1.1))
  })
})

describe('TRADE_MODEL_VERSION', () => {
  it('is a stable, human-readable constant', () => {
    expect(TRADE_MODEL_VERSION).toBe('trade-engine-deterministic-v1')
  })
})
