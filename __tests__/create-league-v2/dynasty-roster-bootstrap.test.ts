import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, slots: {} as Record<string, number>, save: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: async () => ({ settings: m.settings }), update: m.update } } }))
vi.mock('@/lib/roster-engine/RosterEngineRegistry', () => ({ getRosterEngineRegistry: () => ({ getService: () => ({
  applyDefaultOnCreate: async () => {},
  getConfig: async () => ({ slots: m.slots, templateKey: m.save.mock.calls.length ? 'custom' : 'dynasty', isCustom: m.save.mock.calls.length > 0 }),
  saveConfig: async (_id: string, config: { slots: Record<string, number> }) => { m.save(config); m.slots = config.slots; m.settings = { ...m.settings, savedSportConfig: config } },
  resolveDefaultTemplate: () => ({ slots: { QB: 1, BN: 14, IR: 3, TAXI: 5 } }),
}) }) }))
import { createDefaultLeagueRosterConfig } from '@/lib/roster-engine/UnifiedRosterConfigService'
describe('dynasty roster bootstrap preserves chosen counts', () => {
  beforeEach(() => { vi.clearAllMocks(); m.settings = { conceptSetup: { benchCount: 8, irCount: 0, taxiSlots: 2 } } })
  it.each([['NFL', 'IR'], ['NBA', 'IL']])('uses %s slot names and preserves saved sport config', async (sport, irSlot) => {
    m.slots = { QB: 1, BN: 14, [irSlot]: 3, TAXI: 5 }
    await createDefaultLeagueRosterConfig('L1', sport as 'NFL', 'dynasty')
    expect(m.slots).toEqual({ QB: 1, BN: 8, [irSlot]: 0, TAXI: 2 })
    const data = m.update.mock.calls[0][0].data
    expect(data.rosterSize).toBe(11)
    expect(data.settings.savedSportConfig).toBeDefined()
    expect(data.settings.roster.source).toBe('CUSTOM')
  })
  it('does not apply dynasty choices to redraft leagues', async () => {
    m.slots = { QB: 1, BN: 14, IR: 3, TAXI: 5 }
    await createDefaultLeagueRosterConfig('L1', 'NFL', 'redraft')
    expect(m.save).not.toHaveBeenCalled()
  })
})
