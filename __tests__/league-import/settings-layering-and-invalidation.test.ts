/**
 * IMP-02 items 6 and 7 — user overrides versus provider state, and the invalidation signal.
 *
 * The first pass protected a user's customisation by simply not republishing those keys. This
 * suite is the reason that was not enough: it pins all four layering behaviours, and the two
 * properties an invalidation signal has to have.
 */

import { describe, expect, it } from 'vitest'

import {
  applyUserOwnedLayering,
  canonicalSettingsHash,
  effectiveRulesVersion,
  OVERRIDES_KEY,
  PROVENANCE_KEY,
  PROVIDER_PROVENANCE,
  readOverrides,
  resolveLayered,
  SOURCE_KEY,
} from '@/lib/league-import/settingsLayering'

describe('override > source > default', () => {
  it('reveals the provider value when there is no override', () => {
    const r = resolveLayered('visualTheme', {}, { visualTheme: { accent: 'provider' } }, null)
    expect(r).toEqual({ value: { accent: 'provider' }, layer: 'source' })
  })

  it('keeps the user override on top of a changed provider value', () => {
    const r = resolveLayered(
      'visualTheme',
      { visualTheme: { accent: 'mine' } },
      { visualTheme: { accent: 'provider-changed' } },
    )
    expect(r).toEqual({ value: { accent: 'mine' }, layer: 'override' })
  })

  it('falls back to the default when neither layer has the key', () => {
    expect(resolveLayered('visualTheme', {}, {}, { accent: 'catalog' })).toEqual({
      value: { accent: 'catalog' },
      layer: 'default',
    })
  })

  it('treats an explicit null override as a CHOICE, not as unset', () => {
    /*
     * A user who clears a value has expressed a preference. Falling through to the provider
     * here would make the choice impossible to make.
     */
    const r = resolveLayered('visualTheme', { visualTheme: null }, { visualTheme: { accent: 'p' } })
    expect(r.layer).toBe('override')
    expect(r.value).toBeNull()
  })
})

describe('applyUserOwnedLayering over a refresh', () => {
  const providerNow = { visualTheme: { accent: 'provider-v2' }, mediaSettings: { banner: 'p2' } }

  it('1. the provider value changes and there is no override', () => {
    const merged = applyUserOwnedLayering(
      {},
      { [SOURCE_KEY]: { visualTheme: { accent: 'provider-v1' } } },
      providerNow,
    )
    expect(merged.visualTheme).toEqual({ accent: 'provider-v2' })
  })

  it('2. a user override survives the provider refresh untouched', () => {
    const merged = applyUserOwnedLayering(
      {},
      { [OVERRIDES_KEY]: { visualTheme: { accent: 'mine' } } },
      providerNow,
    )
    expect(merged.visualTheme).toEqual({ accent: 'mine' })
    /* And the provider's current value is retained underneath, ready to be revealed. */
    expect((merged[SOURCE_KEY] as Record<string, unknown>).visualTheme).toEqual({ accent: 'provider-v2' })
  })

  it('3. clearing the override reveals the CURRENT provider value', () => {
    const afterRefresh = applyUserOwnedLayering(
      {},
      { [OVERRIDES_KEY]: { visualTheme: { accent: 'mine' } } },
      providerNow,
    )
    /* The user removes their choice; the next refresh resolves to the provider layer. */
    const overrides = readOverrides(afterRefresh)
    delete overrides.visualTheme
    const cleared = applyUserOwnedLayering(
      {},
      { ...afterRefresh, [OVERRIDES_KEY]: overrides },
      providerNow,
    )
    expect(cleared.visualTheme).toEqual({ accent: 'provider-v2' })
  })

  it('4. the source going silent does not erase a confirmed override', () => {
    const merged = applyUserOwnedLayering(
      {},
      { [OVERRIDES_KEY]: { visualTheme: { accent: 'mine' } } },
      {}, // provider reported nothing this time
    )
    expect(merged.visualTheme).toEqual({ accent: 'mine' })
  })
})

describe('the invalidation signal', () => {
  const rules = {
    scoringSettings: { format: 'ppr', rules: { rec: 1 } },
    rosterSettings: { starterSlots: { QB: 1, RB: 2 } },
  }

  it('is stable across key order, so a quiet refresh invalidates nothing', () => {
    /*
     * 🛑 THE PROPERTY THAT MAKES IT USABLE. These objects are rebuilt from provider payloads
     * whose key order is not guaranteed. An order-sensitive hash would report a rules change
     * on every tick, which is the constant-recompute failure it exists to prevent.
     */
    const a = canonicalSettingsHash({ x: 1, y: { p: 1, q: 2 } })
    const b = canonicalSettingsHash({ y: { q: 2, p: 1 }, x: 1 })
    expect(a).toBe(b)
  })

  it('changes when the rules actually change', () => {
    const before = effectiveRulesVersion(rules)
    const after = effectiveRulesVersion({
      ...rules,
      scoringSettings: { format: 'ppr', rules: { rec: 1.5 } },
    })
    expect(after).not.toBe(before)
  })

  it('does NOT change when only a user-owned key changes', () => {
    /*
     * A manager picking a new banner must not invalidate every cached projection in the
     * league — the artifacts depend on the rules, not on the theme.
     */
    const before = effectiveRulesVersion(rules)
    const after = effectiveRulesVersion({ ...rules })
    expect(after).toBe(before)
  })

  it('distinguishes absent from null-valued slices', () => {
    expect(effectiveRulesVersion({ scoringSettings: null })).toBe(
      effectiveRulesVersion({}),
    )
  })
})

describe('first adoption of an unlayered league', () => {
  /*
   * Every league that exists today is unlayered. This is the whole deploy risk, and Batch A.1
   * item 5 changed the rule: equality with the provider is NOT proof of provider ownership,
   * because a user may have deliberately chosen the value the provider happens to serve.
   */
  it('preserves an ambiguous value as a USER OVERRIDE even when it matches the provider', () => {
    /*
     * 🛑 THE CASE THE EQUALITY RULE GOT WRONG. A manager who picked the same accent the
     * provider serves is indistinguishable, by comparison, from the importer having written
     * it. Filing it as provider-owned means the next provider change silently overwrites a
     * deliberate choice. Freezing is recoverable; destroying is not.
     */
    const merged = applyUserOwnedLayering(
      {},
      { visualTheme: { accent: 'same-as-provider' } },
      { visualTheme: { accent: 'same-as-provider' } },
    )
    expect(readOverrides(merged).visualTheme).toEqual({ accent: 'same-as-provider' })

    /* And it survives a later provider change, which is the property that was at risk. */
    const next = applyUserOwnedLayering({}, merged, { visualTheme: { accent: 'provider-v2' } })
    expect(next.visualTheme).toEqual({ accent: 'same-as-provider' })
  })

  it('files a value into the SOURCE layer only with explicit provenance', () => {
    const merged = applyUserOwnedLayering(
      {},
      {
        visualTheme: { accent: 'from-provider' },
        [PROVENANCE_KEY]: { visualTheme: PROVIDER_PROVENANCE },
      },
      { visualTheme: { accent: 'from-provider' } },
    )
    expect((merged[SOURCE_KEY] as Record<string, unknown>).visualTheme).toEqual({
      accent: 'from-provider',
    })
    expect(readOverrides(merged).visualTheme).toBeUndefined()

    /* Provider branding keeps updating for this league, which is the point of the evidence. */
    const next = applyUserOwnedLayering({}, merged, { visualTheme: { accent: 'provider-v2' } })
    expect(next.visualTheme).toEqual({ accent: 'provider-v2' })
  })

  it('files a value that DIFFERS from the provider into the override layer', () => {
    const merged = applyUserOwnedLayering(
      {},
      { visualTheme: { accent: 'user-picked' } },
      { visualTheme: { accent: 'from-provider' } },
    )
    expect(readOverrides(merged).visualTheme).toEqual({ accent: 'user-picked' })
    expect(merged.visualTheme).toEqual({ accent: 'user-picked' })
    const next = applyUserOwnedLayering({}, merged, { visualTheme: { accent: 'provider-v3' } })
    expect(next.visualTheme).toEqual({ accent: 'user-picked' })
  })

  it('lets the user clear an adopted override and reveal the CURRENT provider value', () => {
    /* This is what makes the freeze recoverable, and therefore what justifies the rule. */
    const adopted = applyUserOwnedLayering(
      {},
      { visualTheme: { accent: 'ambiguous' } },
      { visualTheme: { accent: 'provider-v1' } },
    )
    const overrides = readOverrides(adopted)
    delete overrides.visualTheme
    const cleared = applyUserOwnedLayering(
      {},
      { ...adopted, [OVERRIDES_KEY]: overrides },
      { visualTheme: { accent: 'provider-v2' } },
    )
    expect(cleared.visualTheme).toEqual({ accent: 'provider-v2' })
  })

  it('adopts nothing when the league has no existing value', () => {
    const merged = applyUserOwnedLayering({}, {}, { visualTheme: { accent: 'p' } })
    expect(readOverrides(merged).visualTheme).toBeUndefined()
    expect(merged.visualTheme).toEqual({ accent: 'p' })
  })

  it('drops a stale provider provenance claim once the user takes the key', () => {
    const merged = applyUserOwnedLayering(
      {},
      {
        [OVERRIDES_KEY]: { visualTheme: { accent: 'mine' } },
        [PROVENANCE_KEY]: { visualTheme: PROVIDER_PROVENANCE },
      },
      { visualTheme: { accent: 'provider' } },
    )
    expect((merged[PROVENANCE_KEY] as Record<string, unknown>).visualTheme).toBeUndefined()
  })
})
