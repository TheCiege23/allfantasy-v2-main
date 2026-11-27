import { describe, expect, it, vi } from 'vitest'
// The registry loads each sport with a CommonJS require vitest cannot resolve; this is the same registry over ESM imports.
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => (await import('../dynasty-sim/rosterRegistryEsm')).buildEsmRosterRegistryModule())
import { planImportedRosterLayout, rosterSavedInAllFantasy, savedInAllFantasy } from '@/lib/league/nativeScaffolding'

const nfl = (settings: Record<string, unknown>, platform = 'sleeper') => planImportedRosterLayout({ sport: 'NFL', platform, leagueType: 'redraft', settings, taxiSlots: 0 })

describe('planImportedRosterLayout', () => {
  it('maps a Sleeper layout, adding IR from reserve_slots', () => {
    const layout = nfl({ roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'], reserve_slots: 2 })
    expect(layout.kind).toBe('mapped')
    if (layout.kind !== 'mapped') return
    expect(layout.slots.QB).toBe(1)
    expect(layout.slots.RB).toBe(2)
    expect(layout.slots.IR).toBe(2)
  })

  it('maps an ESPN SLOT:COUNT layout', () => {
    const layout = nfl({ roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1'] }, 'espn')
    expect(layout.kind).toBe('mapped')
  })

  it('cannot read a league with no stored layout', () => {
    expect(nfl({})).toEqual({ kind: 'unreadable', reason: 'AllFantasy could not read the roster layout the import stored.' })
  })

  it('cannot read a slot the roster engine does not have', () => {
    expect(nfl({ roster_positions: ['QB', 'MYSTERY_SLOT', 'BN'] }).kind).toBe('unreadable')
  })

  it('keeps a layout the commissioner saved in AllFantasy, even with nothing to map', () => {
    expect(nfl({ roster: { updatedBy: 'commish', auditLog: [{ action: 'updated' }] } })).toEqual({ kind: 'af_saved' })
  })

  it("re-maps over a previous switch attempt's own roster write instead of treating it as the commissioner's", () => {
    const retried = { roster: { updatedBy: 'admin', auditLog: [{ action: 'import' }] }, roster_positions: ['QB', 'BN'] }
    expect(rosterSavedInAllFantasy(retried)).toBe(false)
    expect(nfl(retried).kind).not.toBe('af_saved')
  })

  it('leaves baseball to its scoring conversion', () => {
    expect(planImportedRosterLayout({ sport: 'MLB', platform: 'fantrax', leagueType: 'redraft', settings: {} })).toEqual({ kind: 'mlb' })
  })
})

describe('savedInAllFantasy', () => {
  it('is a store a person saved, not the seeder and not a conversion', () => {
    expect(savedInAllFantasy({ lastUpdatedBy: 'commish', source: 'CUSTOM' })).toBe(true)
    expect(savedInAllFantasy({ lastUpdatedBy: null, source: 'AF_DEFAULT' })).toBe(false)
    expect(savedInAllFantasy({ lastUpdatedBy: 'commish', source: 'IMPORTED_MAPPED' })).toBe(false)
    expect(savedInAllFantasy(undefined)).toBe(false)
  })
})

describe('the roster engine keys a converted layout uses', () => {
  it('renames the template spellings the engine keys differently, and keeps a superflex league superflex', () => {
    const layout = nfl({ roster_positions: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX', 'DEF', 'BN', 'BN'] })
    expect(layout).toEqual({ kind: 'mapped', slots: { QB: 1, RB: 1, WR: 1, TE: 1, SUPERFLEX: 1, FLEX_WR_RB: 1, FLEX_WR_TE: 1, DEF: 1, BN: 2 } })
  })
  it('refuses a split-IDP slot the engine has no key for, instead of dropping it', () => {
    expect(nfl({ roster_positions: ['QB', 'DE', 'BN'] })).toEqual({ kind: 'unreadable', reason: "Roster spots AllFantasy can't place: DE." })
  })
})

describe('the Sleeper scoring the real-database switch test seeds', () => {
  it('converts, so that test can assert the league keeps its own scoring', async () => {
    const { importedNflScoring } = await import('@/lib/league-creation/canonical/importedNflScoring')
    const converted = importedNflScoring({ scoringSettings: { rules: { rec: 0.5, pass_td: 4, pass_yd: 0.04, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6 } } })
    expect(converted).not.toBeNull()
    expect(converted?.convertedCount).toBeGreaterThan(0)
  })
})
