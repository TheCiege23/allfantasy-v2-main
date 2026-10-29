/**
 * A Devy or C2C commissioner's rookie draft rounds and type reach the config the rookie draft is BUILT
 * from (`DynastyLeagueConfig`, read by `createNextLeagueDraft` and by the rules popup), and the save
 * publishes a "What changed" card for the rookie draft and the taxi squad.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: { league: { findUnique: vi.fn() }, dynastyLeagueConfig: { findUnique: vi.fn() } },
  upsertDynasty: vi.fn(async () => ({})),
  taxi: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({ upsertDynastyConfig: h.upsertDynasty }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: h.taxi }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: h.publish }))

import {
  mirrorRookieDraftToDynasty,
  publishVariantConfigChange,
  readVariantConfigRules,
  rookieDraftMirrorFields,
} from '@/lib/league-rules-explainer/variantConfigChange'

let dynastyRow: Record<string, unknown>
beforeEach(() => {
  vi.clearAllMocks()
  dynastyRow = { rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear' }
  h.db.league.findUnique.mockResolvedValue({ settings: {} })
  h.db.dynastyLeagueConfig.findUnique.mockImplementation(async () => dynastyRow)
  h.taxi.mockResolvedValue({ taxiSlotCount: 4, taxiEligibilityYears: 2, taxiDeadlineWeek: null })
})

describe('rookieDraftMirrorFields', () => {
  it('takes rounds and type the dynasty config can hold', () => {
    expect(rookieDraftMirrorFields({ rookieDraftRounds: '3', rookieDraftType: 'snake' })).toEqual({ rookieDraftRounds: 3, rookieDraftType: 'snake' })
  })
  it('drops anything else — and never the pick order, whose vocabulary differs', () => {
    expect(rookieDraftMirrorFields({ rookieDraftRounds: 0, rookieDraftType: 'auction', rookiePickOrderMethod: 'lottery' })).toEqual({})
    expect(rookieDraftMirrorFields({ rookieDraftRounds: 2.5 })).toEqual({})
    expect(rookieDraftMirrorFields({ taxiSize: 6 })).toEqual({})
  })
})

describe('mirrorRookieDraftToDynasty', () => {
  it('writes the rounds and type to the dynasty config', async () => {
    await mirrorRookieDraftToDynasty('L', { rookieDraftRounds: 3, rookieDraftType: 'snake', taxiSize: 6 })
    expect(h.upsertDynasty).toHaveBeenCalledWith('L', { rookieDraftRounds: 3, rookieDraftType: 'snake' })
  })
  it('writes nothing for a save without them', async () => {
    await mirrorRookieDraftToDynasty('L', { taxiSize: 6, rookiePickOrderMethod: 'custom' })
    expect(h.upsertDynasty).not.toHaveBeenCalled()
  })
  it('a failed mirror never fails the save', async () => {
    h.upsertDynasty.mockImplementationOnce(async () => { throw new Error('db down') })
    await expect(mirrorRookieDraftToDynasty('L', { rookieDraftRounds: 3 })).resolves.toBeUndefined()
  })
})

describe('the "What changed" card', () => {
  it('names exactly the rookie-draft and taxi rules that moved', async () => {
    const before = await readVariantConfigRules('L')
    dynastyRow = { ...dynastyRow, rookieDraftRounds: 3, rookieDraftType: 'snake' }
    h.taxi.mockResolvedValue({ taxiSlotCount: 6, taxiEligibilityYears: 2, taxiDeadlineWeek: null })
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before })
    const changes = h.publish.mock.calls[0][0].changes
    expect(changes).toEqual(
      expect.arrayContaining([
        { key: 'rookieDraftRounds', before: 4, after: 3 },
        { key: 'rookieDraftType', before: 'linear', after: 'snake' },
        { key: 'taxiSlots', before: 4, after: 6 },
      ]),
    )
    expect(changes).toHaveLength(3)
    expect(h.publish.mock.calls[0][0]).toMatchObject({ leagueId: 'L', actorUserId: 'u1', section: 'devy' })
  })
  it('the rookie order it reads is the one the draft engine seats from', async () => {
    h.db.league.findUnique.mockResolvedValue({ settings: { rookie_draft_order: { enabled: true, mode: 'worst_to_first' } } })
    expect((await readVariantConfigRules('L'))?.rookieDraftOrder).toBe('auto_worst_to_first')
  })
  it('no card when nothing was read before the save, or the league is gone', async () => {
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before: null })
    const before = await readVariantConfigRules('L')
    h.db.league.findUnique.mockResolvedValue(null)
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before })
    expect(h.publish).not.toHaveBeenCalled()
  })
  it('a failed card never fails the save', async () => {
    const before = await readVariantConfigRules('L')
    dynastyRow = { ...dynastyRow, rookieDraftRounds: 5 }
    h.publish.mockImplementationOnce(async () => { throw new Error('events down') })
    let err: unknown = null
    try { await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before }) } catch (e) { err = e }
    expect(err).toBeNull()
  })
})
