import { describe, expect, it } from 'vitest'
import { allBudgets, budgetFor, evaluateBudget } from '@/lib/sports-os/budgets'

describe('sports-os budgets', () => {
  it('scales client-felt phases by device but leaves server phases alone', () => {
    const shellDesktop = budgetFor({ phase: 'shell', device: 'desktop' })
    const shellMobile = budgetFor({ phase: 'shell', device: 'mobile' })
    expect(shellMobile.targetMs).toBeGreaterThan(shellDesktop.targetMs)

    // The point of the split: a query does not run slower because the caller holds a phone, and a
    // mobile multiplier on `db` would hide a real regression behind the user's hardware.
    const dbDesktop = budgetFor({ phase: 'db', device: 'desktop' })
    const dbMobile = budgetFor({ phase: 'db', device: 'mobile' })
    expect(dbMobile).toEqual(dbDesktop)

    const importDesktop = budgetFor({ phase: 'import', device: 'desktop' })
    const importMobile = budgetFor({ phase: 'import', device: 'mobile' })
    expect(importMobile).toEqual(importDesktop)
  })

  it('applies a name override and still scales it for the device', () => {
    const plainCard = budgetFor({ phase: 'card', name: 'week', device: 'desktop' })
    const fanOutCard = budgetFor({ phase: 'card', name: 'dash34', device: 'desktop' })
    expect(fanOutCard.targetMs).toBeGreaterThan(plainCard.targetMs)

    const fanOutMobile = budgetFor({ phase: 'card', name: 'dash34', device: 'mobile' })
    expect(fanOutMobile.targetMs).toBeGreaterThan(fanOutCard.targetMs)
  })

  it('ignores an unsafe or unbounded name rather than keying a budget on it', () => {
    // A league id must not become its own budget entry — the cardinality rule requestContext carries.
    const withLeagueId = budgetFor({ phase: 'card', name: 'league_9f3a-UUID-2f', device: 'desktop' })
    expect(withLeagueId).toEqual(budgetFor({ phase: 'card', device: 'desktop' }))
    expect(evaluateBudget({ phase: 'card', name: 'NOT a name' }, 10).name).toBeNull()
  })

  it('returns within / warn / over at the right boundaries', () => {
    const key = { phase: 'shell', device: 'desktop' } as const
    const { targetMs, ceilingMs } = budgetFor(key)

    expect(evaluateBudget(key, targetMs).verdict).toBe('within')
    expect(evaluateBudget(key, targetMs + 1).verdict).toBe('warn')
    expect(evaluateBudget(key, ceilingMs).verdict).toBe('warn')
    expect(evaluateBudget(key, ceilingMs + 1).verdict).toBe('over')
  })

  it('reports ratio against the target, not the ceiling', () => {
    const key = { phase: 'shell', device: 'desktop' } as const
    const { targetMs } = budgetFor(key)
    expect(evaluateBudget(key, targetMs * 2).ratio).toBeCloseTo(2, 3)
  })

  it('clamps clock skew but never calls a broken measurement "within"', () => {
    // A clock that went backwards around a fast operation is still a fast operation.
    expect(evaluateBudget({ phase: 'card' }, -500).observedMs).toBe(0)
    expect(evaluateBudget({ phase: 'card' }, -500).verdict).toBe('within')

    // NaN / Infinity are NOT measurements. Reporting them as `within` is the check-that-cannot-fail
    // shape: a hung read would read as comfortably inside budget. This caught a real bug — the
    // first version clamped Infinity to 0 because Number.isFinite(Infinity) is false.
    expect(evaluateBudget({ phase: 'card' }, Number.NaN).verdict).toBe('unknown')
    expect(evaluateBudget({ phase: 'card' }, Number.POSITIVE_INFINITY).verdict).toBe('unknown')
    expect(evaluateBudget({ phase: 'card' }, Number.POSITIVE_INFINITY).ratio).toBe(0)
  })

  it('declares a ceiling at or above the target for every budget', () => {
    const rows = allBudgets()
    expect(rows.length).toBeGreaterThan(0)
    for (const { key, budget } of rows) {
      expect(budget.targetMs, key).toBeGreaterThan(0)
      expect(budget.ceilingMs, key).toBeGreaterThanOrEqual(budget.targetMs)
    }
  })
})
