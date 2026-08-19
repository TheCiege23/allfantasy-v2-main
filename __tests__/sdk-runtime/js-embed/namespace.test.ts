import { afterEach, describe, expect, it } from 'vitest'
import { AllFantasy, attachAllFantasyGlobal, SDK_JS_EMBED_VERSION } from '../../../sdk-runtime/js-embed/src/namespace'
import { createAllFantasyWidget } from '../../../sdk-runtime/js-embed/src/createWidget'

describe('AllFantasy namespace object', () => {
  it('exposes createWidget and VERSION only', () => {
    expect(Object.keys(AllFantasy).sort()).toEqual(['VERSION', 'createWidget'])
    expect(AllFantasy.createWidget).toBe(createAllFantasyWidget)
    expect(AllFantasy.VERSION).toBe(SDK_JS_EMBED_VERSION)
  })
})

describe('attachAllFantasyGlobal', () => {
  it('sets exactly one property on the target — nothing else', () => {
    const target: Record<string, unknown> = {}
    attachAllFantasyGlobal(target)
    expect(Object.keys(target)).toEqual(['AllFantasy'])
    expect(target.AllFantasy).toBe(AllFantasy)
  })

  it('does not mutate a pre-existing unrelated property on the target', () => {
    const target: Record<string, unknown> = { somethingElse: 42 }
    attachAllFantasyGlobal(target)
    expect(target.somethingElse).toBe(42)
    expect(Object.keys(target).sort()).toEqual(['AllFantasy', 'somethingElse'])
  })

  it('is idempotent — attaching twice yields the same reference', () => {
    const target: Record<string, unknown> = {}
    attachAllFantasyGlobal(target)
    const first = target.AllFantasy
    attachAllFantasyGlobal(target)
    expect(target.AllFantasy).toBe(first)
  })

  it('defaults to globalThis when no target is supplied, and pollutes nothing beyond it', () => {
    const before = Object.keys(globalThis as unknown as Record<string, unknown>)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).AllFantasy
    attachAllFantasyGlobal()
    const after = Object.keys(globalThis as unknown as Record<string, unknown>)
    const added = after.filter((k) => !before.includes(k))
    expect(added).toEqual(['AllFantasy'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).AllFantasy).toBe(AllFantasy)
  })
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).AllFantasy
})
