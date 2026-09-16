import { describe, expect, it } from 'vitest'
import {
  BUCKET_SPACE,
  DEFAULT_ROLLOUTS,
  bucketFor,
  evaluateRollout,
  hash32,
  isEnabled,
  parseRolloutEnv,
  type RolloutRule,
} from '@/lib/sports-os/rollout'

const rules = (overrides: Partial<RolloutRule> = {}): Record<string, RolloutRule> => ({
  feat: { enabled: true, percentage: 50, ...overrides },
})

describe('sports-os rollout', () => {
  it('buckets a subject deterministically', () => {
    // A user flipping cohort per request is half-rendered A and half-rendered B.
    const a = bucketFor('feat', 'user_1')
    for (let i = 0; i < 10; i++) expect(bucketFor('feat', 'user_1')).toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(BUCKET_SPACE)
  })

  it('salts the bucket per flag so cohorts are independent', () => {
    // Without the salt the same unlucky users lead EVERY rollout and carry every regression.
    const subjects = Array.from({ length: 300 }, (_, i) => `user_${i}`)
    const inA = new Set(subjects.filter((s) => bucketFor('flag-a', s) < BUCKET_SPACE / 10))
    const inB = new Set(subjects.filter((s) => bucketFor('flag-b', s) < BUCKET_SPACE / 10))
    const overlap = [...inA].filter((s) => inB.has(s)).length

    expect(inA.size).toBeGreaterThan(0)
    expect(inB.size).toBeGreaterThan(0)
    // Independent draws overlap at roughly 10% of a 10% cohort — never the whole set.
    expect(overlap).toBeLessThan(Math.min(inA.size, inB.size))
  })

  it('spreads short ids across the bucket space', () => {
    // A hashCode-style sum clusters short ids, which silently makes a 1% cohort not 1%.
    const buckets = Array.from({ length: 2_000 }, (_, i) => bucketFor('feat', String(i)))
    const decile = new Array(10).fill(0)
    for (const b of buckets) decile[Math.floor((b / BUCKET_SPACE) * 10)] += 1
    for (const count of decile) expect(count).toBeGreaterThan(80) // even split would be 200
  })

  it('honours a 0% and a 100% rule exactly', () => {
    const subjects = Array.from({ length: 200 }, (_, i) => `u${i}`)
    expect(subjects.some((s) => isEnabled('feat', s, rules({ percentage: 0 })))).toBe(false)
    expect(subjects.every((s) => isEnabled('feat', s, rules({ percentage: 100 })))).toBe(true)
  })

  it('lands near the requested percentage', () => {
    const subjects = Array.from({ length: 4_000 }, (_, i) => `user_${i}`)
    const on = subjects.filter((s) => isEnabled('feat', s, rules({ percentage: 25 }))).length
    expect(on / subjects.length).toBeGreaterThan(0.22)
    expect(on / subjects.length).toBeLessThan(0.28)
  })

  it('lets the kill switch beat everything, and the denylist beat the allowlist', () => {
    const killed = evaluateRollout('feat', 'vip', { feat: { enabled: false, percentage: 100, allowlist: ['vip'] } })
    expect(killed).toMatchObject({ enabled: false, reason: 'kill-switch' })

    // The list that takes something away has to be the one that wins.
    const both = evaluateRollout('feat', 'vip', {
      feat: { enabled: true, percentage: 100, allowlist: ['vip'], denylist: ['vip'] },
    })
    expect(both).toMatchObject({ enabled: false, reason: 'denylist' })

    expect(evaluateRollout('feat', 'vip', rules({ percentage: 0, allowlist: ['vip'] }))).toMatchObject({
      enabled: true,
      reason: 'allowlist',
    })
  })

  it('treats an anonymous subject as off below 100%', () => {
    // There is no stable cohort for an anonymous visitor, so bucketing them would re-roll per request.
    expect(evaluateRollout('feat', null, rules({ percentage: 99 }))).toMatchObject({ enabled: false, reason: 'no-subject' })
    expect(evaluateRollout('feat', '   ', rules({ percentage: 99 })).enabled).toBe(false)
    expect(evaluateRollout('feat', null, rules({ percentage: 100 }))).toMatchObject({ enabled: true, reason: 'no-subject' })
  })

  it('reports an unknown flag as off rather than guessing', () => {
    expect(evaluateRollout('nope', 'u1', rules())).toMatchObject({ enabled: false, reason: 'unknown-flag' })
  })

  it('parses env overrides and falls back to the code default on nonsense', () => {
    const fallback: RolloutRule = { enabled: true, percentage: 5, allowlist: ['staff'] }
    expect(parseRolloutEnv('off', fallback)).toMatchObject({ enabled: false })
    expect(parseRolloutEnv('on', fallback)).toMatchObject({ enabled: true, percentage: 100 })
    expect(parseRolloutEnv('25', fallback)).toMatchObject({ enabled: true, percentage: 25, allowlist: ['staff'] })
    expect(parseRolloutEnv('10|a, b', fallback)).toMatchObject({ percentage: 10, allowlist: ['a', 'b'] })
    expect(parseRolloutEnv('150', fallback).percentage).toBe(100)

    // A typo'd variable silently disabling a shipped feature is the worse failure, and correcting
    // it on Railway costs a redeploy.
    expect(parseRolloutEnv('banana', fallback)).toEqual(fallback)
    expect(parseRolloutEnv(undefined, fallback)).toEqual(fallback)
    expect(parseRolloutEnv('', fallback)).toEqual(fallback)
  })

  it('hashes stably across calls', () => {
    expect(hash32('allfantasy')).toBe(hash32('allfantasy'))
    expect(hash32('a')).not.toBe(hash32('b'))
  })

  it('declares every default rollout with a note and a legal percentage', () => {
    for (const [flag, rule] of Object.entries(DEFAULT_ROLLOUTS)) {
      expect(rule.percentage, flag).toBeGreaterThanOrEqual(0)
      expect(rule.percentage, flag).toBeLessThanOrEqual(100)
      expect(rule.note, flag).toBeTruthy()
    }
  })
})
