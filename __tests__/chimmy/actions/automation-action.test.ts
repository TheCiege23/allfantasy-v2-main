import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Turn on the recommended setup" through Chimmy (phase 12): commissioners only, a card lists exactly
 * what will change, and the confirm refuses when the league no longer matches the card.
 */

const h = vi.hoisted(() => ({
  elevated: vi.fn(async () => true),
  facts: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  setHandover: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ name: 'Dynasty Ten', sport: 'NFL', season: 2026 })) } } }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: h.elevated }))
vi.mock('@/lib/commissioner-hub/automationOverviewService', () => ({ readAutomationFacts: h.facts }))
vi.mock('@/lib/commissioner-hub/automationPresetService', () => ({ previewAutomationPreset: h.preview, applyAutomationPreset: h.apply }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ setAutoHandover: h.setHandover }))

import { executeAutomationAction, proposeAutomationChange } from '@/lib/chimmy/actions/automationAction'
import { verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'

const NOW = new Date('2026-10-29T15:00:00Z')
const prevSecret = process.env.NEXTAUTH_SECRET
const PLAN = {
  preset: 'recommended',
  changes: [
    { step: { key: 'fill_empty_starters', on: true }, label: 'Fill empty starting spots before lock', labelEs: '' },
    { step: { key: 'ir_auto_move', on: true }, label: 'Move healthy players off IR', labelEs: '' },
  ],
  needsPlan: [],
  needsPlanEs: [],
}
const facts = (settings: unknown = {}, commissionerPlan = false) => ({ native: true, facts: { settings, commissionerPlan } })

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  vi.clearAllMocks()
  h.elevated.mockResolvedValue(true)
  h.facts.mockResolvedValue(facts())
  h.preview.mockResolvedValue({ ok: true, plan: PLAN })
  h.apply.mockResolvedValue({ ok: true, plan: PLAN })
  h.setHandover.mockImplementation(async (_l: string, _u: string, rule: unknown) => ({ ok: true, rule }))
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

const payloadOf = (token: string) => {
  const v = verifyChimmyActionToken(token, NOW)
  if (!v.ok) throw new Error(v.reason)
  return v.payload
}

describe('proposeAutomationChange', () => {
  it('refuses anyone who is not the commissioner and writes nothing', async () => {
    h.elevated.mockResolvedValue(false)
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u2', preset: 'recommended', now: NOW })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/commissioner/)
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.setHandover).not.toHaveBeenCalled()
  })

  it('builds a card listing the preset changes and saves nothing', async () => {
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', now: NOW })
    if (!r.ok) throw new Error(r.text)
    expect(r.card.kind).toBe('automation')
    expect(r.card.automation?.changes).toEqual(['Fill empty starting spots before lock', 'Move healthy players off IR'])
    expect(r.text).toMatch(/NOTHING has changed yet/)
    expect(payloadOf(r.card.token).spec).toEqual({ kind: 'automation', change: { type: 'preset', preset: 'recommended' }, expectedKeys: ['fill_empty_starters', 'ir_auto_move'] })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('says so when the preset is already in place', async () => {
    h.preview.mockResolvedValue({ ok: true, plan: { ...PLAN, changes: [] } })
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', now: NOW })
    expect(r).toMatchObject({ ok: false })
    expect(r.text).toMatch(/already in place/)
  })

  it('refuses an imported league', async () => {
    h.facts.mockResolvedValue({ native: false })
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', now: NOW })).ok).toBe(false)
  })

  it('needs exactly one of preset or handover', async () => {
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', now: NOW })).ok).toBe(false)
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', handoverDays: 14, now: NOW })).ok).toBe(false)
  })

  it('hands quiet teams to lineups without the plan, autopilot with it', async () => {
    const free = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 14, now: NOW })
    if (!free.ok) throw new Error(free.text)
    expect(payloadOf(free.card.token).spec).toMatchObject({ change: { type: 'handover', rule: { days: 14, to: 'lineups' } } })
    h.facts.mockResolvedValue(facts({}, true))
    const paid = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 14, now: NOW })
    if (!paid.ok) throw new Error(paid.text)
    expect(payloadOf(paid.card.token).spec).toMatchObject({ change: { type: 'handover', rule: { days: 14, to: 'autopilot' } } })
  })

  it('refuses autopilot handover without the plan, and an unchanged rule', async () => {
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 14, handoverTo: 'autopilot', now: NOW })).text).toMatch(/AF Commissioner/)
    h.facts.mockResolvedValue(facts({ inactive_auto_handover: { days: 14, to: 'lineups', since: NOW.toISOString(), byUserId: 'u1' } }))
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 14, now: NOW })).text).toMatch(/already on/)
    expect((await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 0, now: NOW })).ok).toBe(true)
  })
})

describe('executeAutomationAction', () => {
  it('applies the preset when the league still matches the card', async () => {
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', now: NOW })
    if (!r.ok) throw new Error(r.text)
    expect(await executeAutomationAction(payloadOf(r.card.token), 'u1')).toMatchObject({ ok: true })
    expect(h.apply).toHaveBeenCalledWith('L1', 'u1', 'recommended')
  })

  it('refuses when what the preset would change is no longer what the card showed', async () => {
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', preset: 'recommended', now: NOW })
    if (!r.ok) throw new Error(r.text)
    h.preview.mockResolvedValue({ ok: true, plan: { ...PLAN, changes: [PLAN.changes[0]] } })
    expect(await executeAutomationAction(payloadOf(r.card.token), 'u1')).toMatchObject({ ok: false, message: expect.stringMatching(/changed since/) })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it('saves the handover rule, and does not re-save one already in place', async () => {
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 21, now: NOW })
    if (!r.ok) throw new Error(r.text)
    expect(await executeAutomationAction(payloadOf(r.card.token), 'u1')).toMatchObject({ ok: true })
    expect(h.setHandover).toHaveBeenCalledWith('L1', 'u1', { days: 21, to: 'lineups' })
    h.setHandover.mockClear()
    h.facts.mockResolvedValue(facts({ inactive_auto_handover: { days: 21, to: 'lineups', since: NOW.toISOString(), byUserId: 'u1' } }))
    expect(await executeAutomationAction(payloadOf(r.card.token), 'u1')).toMatchObject({ ok: false })
    expect(h.setHandover).not.toHaveBeenCalled()
  })

  it('refuses a user who stopped being commissioner', async () => {
    const r = await proposeAutomationChange({ leagueId: 'L1', userId: 'u1', handoverDays: 7, now: NOW })
    if (!r.ok) throw new Error(r.text)
    h.elevated.mockResolvedValue(false)
    expect(await executeAutomationAction(payloadOf(r.card.token), 'u1')).toMatchObject({ ok: false })
    expect(h.setHandover).not.toHaveBeenCalled()
  })
})
