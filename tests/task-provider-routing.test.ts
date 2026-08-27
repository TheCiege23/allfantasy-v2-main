import { describe, it, expect } from 'vitest'
import {
  resolveProviderForFeature,
  parseTaskProviderOverrides,
  isTaskRoutingEnabled,
} from '@/lib/ai/taskProviderRouting'
import { applyPreferredProvider, type ProviderName } from '@/lib/ai/providerRouter'

const env = (over: Record<string, string | undefined> = {}) =>
  ({ ...over } as unknown as NodeJS.ProcessEnv)

describe('resolveProviderForFeature — cost shape', () => {
  it('sends bulk/derived features to the cheap provider', () => {
    for (const f of ['power_rankings', 'at_risk', 'pool_swing', 'champion_risk'] as const) {
      expect(resolveProviderForFeature(f, env())?.provider, f).toBe('deepseek')
    }
  })

  it('sends time-sensitive features to the provider with live X access', () => {
    expect(resolveProviderForFeature('injury_report', env())?.provider).toBe('xai')
    expect(resolveProviderForFeature('waiver_wire', env())?.provider).toBe('xai')
  })

  it('sends user-facing prose to the voice provider', () => {
    for (const f of ['pool_chat', 'private_ai', 'trade_eval', 'recap'] as const) {
      expect(resolveProviderForFeature(f, env())?.provider, f).toBe('anthropic')
    }
  })
})

describe('resolveProviderForFeature — no-opinion cases', () => {
  it('returns null for an unmapped feature so the plain chain is used', () => {
    expect(resolveProviderForFeature('some_future_feature', env())).toBeNull()
  })

  it('returns null for missing feature', () => {
    expect(resolveProviderForFeature(undefined, env())).toBeNull()
    expect(resolveProviderForFeature(null, env())).toBeNull()
  })

  it('returns null everywhere when routing is disabled', () => {
    const off = env({ AI_TASK_ROUTING_ENABLED: 'false' })
    expect(resolveProviderForFeature('pool_chat', off)).toBeNull()
    expect(isTaskRoutingEnabled(off)).toBe(false)
  })

  it('is enabled by default when the flag is unset', () => {
    expect(isTaskRoutingEnabled(env())).toBe(true)
  })
})

describe('AI_TASK_PROVIDER_OVERRIDES', () => {
  it('overrides a built-in mapping', () => {
    const e = env({ AI_TASK_PROVIDER_OVERRIDES: 'pool_chat:deepseek' })
    expect(resolveProviderForFeature('pool_chat', e)?.provider).toBe('deepseek')
  })

  it('parses multiple pairs and tolerates whitespace', () => {
    const e = env({ AI_TASK_PROVIDER_OVERRIDES: ' pool_chat : deepseek , recap:xai ' })
    expect(parseTaskProviderOverrides(e)).toEqual({ pool_chat: 'deepseek', recap: 'xai' })
  })

  it('skips malformed pairs rather than throwing', () => {
    const e = env({ AI_TASK_PROVIDER_OVERRIDES: 'pool_chat:notaprovider,junk,recap:xai' })
    expect(parseTaskProviderOverrides(e)).toEqual({ recap: 'xai' })
  })

  it('falls back to the built-in map for an invalid override', () => {
    const e = env({ AI_TASK_PROVIDER_OVERRIDES: 'pool_chat:notaprovider' })
    expect(resolveProviderForFeature('pool_chat', e)?.provider).toBe('anthropic')
  })
})

describe('applyPreferredProvider — chain reordering', () => {
  const chain: ProviderName[] = ['deepseek', 'anthropic', 'xai']

  it('moves the preferred provider to the front', () => {
    expect(applyPreferredProvider(chain, 'anthropic')).toEqual(['anthropic', 'deepseek', 'xai'])
  })

  it('preserves the relative order of the remaining fallbacks', () => {
    expect(applyPreferredProvider(chain, 'xai')).toEqual(['xai', 'deepseek', 'anthropic'])
  })

  it('never drops a provider from the chain', () => {
    for (const p of chain) {
      expect(applyPreferredProvider(chain, p).slice().sort()).toEqual(chain.slice().sort())
    }
  })

  it('is a no-op when no preference is given', () => {
    expect(applyPreferredProvider(chain, null)).toEqual(chain)
    expect(applyPreferredProvider(chain, undefined)).toEqual(chain)
  })

  it('IGNORES a provider that is not in the configured chain', () => {
    // AI_PROVIDER_ORDER is the allowlist. A provider removed for a dead key
    // must not be resurrected by a stale task mapping.
    expect(applyPreferredProvider(chain, 'openai')).toEqual(chain)
  })
})
