import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => {
  const state = { settings: { scoring: 'ppr' } as Record<string, unknown> | null, locks: [] as string[] }
  const league = {
    findUnique: vi.fn(async () => (state.settings == null ? null : { settings: state.settings })),
    update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
      state.settings = data.settings
      return {}
    }),
  }
  return {
    state,
    prisma: {
      league,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ league, $queryRaw: vi.fn(async (s: TemplateStringsArray, id: string) => { state.locks.push(`${s.join('?')}|${id}`); return [] }) })),
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
const access = vi.hoisted(() => vi.fn(async () => ({ allowed: true })))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = access } }))

import { saveGuillotineAdvanced } from '@/lib/guillotine/guillotineAdvancedSettings'

const rules = { steps: [{ fromWeek: 10, chops: 2 }], overrides: { 8: 0 }, immunity: 'top_scorer' }

beforeEach(() => {
  vi.clearAllMocks()
  db.state.settings = { scoring: 'ppr' }
  db.state.locks = []
  access.mockResolvedValue({ allowed: true })
})

describe('saveGuillotineAdvanced', () => {
  it('saves under the league row lock and keeps every other setting', async () => {
    expect(await saveGuillotineAdvanced('L1', 'u1', rules)).toMatchObject({ ok: true })
    expect(db.state.locks.some((l) => l.includes('FOR UPDATE') && l.endsWith('|L1'))).toBe(true)
    expect(db.state.settings).toEqual({ scoring: 'ppr', guillotine_advanced: { steps: [{ fromWeek: 10, chops: 2 }], overrides: { 8: 0 }, immunity: 'top_scorer', faab: { mode: 'unchanged', amount: 0 } } })
  })
  it('AF Commissioner to change the rules — but resetting to one-a-week is always allowed', async () => {
    access.mockResolvedValue({ allowed: false })
    expect(await saveGuillotineAdvanced('L1', 'u1', rules)).toEqual({ ok: false, error: 'not_entitled' })
    db.state.settings = { scoring: 'ppr', guillotine_advanced: rules }
    expect(await saveGuillotineAdvanced('L1', 'u1', { steps: [], overrides: {}, immunity: 'off' })).toMatchObject({ ok: true })
    expect(db.state.settings).toEqual({ scoring: 'ppr' })
  })
  it('refuses bad input before anything is written', async () => {
    expect(await saveGuillotineAdvanced('L1', 'u1', { steps: [{ fromWeek: 3, chops: 9 }] })).toEqual({ ok: false, error: 'bad_step' })
    expect(db.prisma.league.update).not.toHaveBeenCalled()
  })
})
