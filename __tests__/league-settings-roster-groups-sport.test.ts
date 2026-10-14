/**
 * The commissioner roster editor lays rows out from the SPORT's own slot definitions (2026-10-14).
 *
 * 🛑 An NBA league was shown an NFL roster. Whatever the stored data says, the editor must never
 * render football slots for a non-football sport, must list IR/IL apart (they don't use draft
 * rounds), and must flag a stored roster that belongs to another sport instead of showing it.
 */
import { describe, expect, it } from 'vitest'
import { NBA_ROSTER_SLOTS, NBA_ROSTER_TEMPLATES } from '@/lib/nba-roster/NbaRosterTemplates'
import { NFL_ROSTER_SLOTS, NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'
import { alignSlotsToSport, buildRosterGroups, isInjuredSlot } from '@/components/league-settings/roster/buildRosterGroups'
import type { SlotDef } from '@/components/league-settings/roster/types'

const NBA = NBA_ROSTER_SLOTS as unknown as SlotDef[]
const NFL = NFL_ROSTER_SLOTS as unknown as SlotDef[]
const FOOTBALL_KEYS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IR']

const keysOf = (groups: ReturnType<typeof buildRosterGroups>) => groups.flatMap((g) => g.defs.map((d) => d.key))

describe('NBA roster layout', () => {
  const tpl = NBA_ROSTER_TEMPLATES[0]!
  const { slots, foreign } = alignSlotsToSport(tpl.slots, NBA)

  it('a real NBA template is not flagged and keeps only NBA keys', () => {
    expect(foreign).toBe(false)
    for (const k of Object.keys(slots)) expect(NBA.some((d) => d.key === k), k).toBe(true)
  })

  it('shows NBA positions and no football slot, for commissioner and member alike', () => {
    for (const isCommissioner of [true, false]) {
      const keys = keysOf(buildRosterGroups(NBA, slots, { isCommissioner, sport: 'NBA' }))
      for (const k of FOOTBALL_KEYS) expect(keys, `${k} commish=${isCommissioner}`).not.toContain(k)
    }
    const commish = keysOf(buildRosterGroups(NBA, slots, { isCommissioner: true, sport: 'NBA' }))
    for (const k of ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN', 'IL']) expect(commish, k).toContain(k)
  })

  it('lists the injured list on its own, coded IL', () => {
    const groups = buildRosterGroups(NBA, slots, { isCommissioner: true, sport: 'NBA' })
    const injured = groups.find((g) => g.kind === 'injured')
    expect(injured?.injuredCode).toBe('IL')
    expect(injured?.defs.map((d) => d.key)).toEqual(expect.arrayContaining(['IL']))
    expect(groups.find((g) => g.kind === 'reserve')?.defs.some((d) => isInjuredSlot(d)) ?? false).toBe(false)
  })

  it('🛑 an NFL roster stored on an NBA league is flagged, not rendered', () => {
    const nflSlots = NFL_ROSTER_TEMPLATES[0]!.slots
    const aligned = alignSlotsToSport(nflSlots, NBA)
    expect(aligned.foreign).toBe(true)
    for (const k of FOOTBALL_KEYS) expect(Object.keys(aligned.slots)).not.toContain(k)
  })
})

describe('NFL roster layout still works', () => {
  it('keeps football slots and codes the injured group IR', () => {
    const { slots, foreign } = alignSlotsToSport(NFL_ROSTER_TEMPLATES[0]!.slots, NFL)
    expect(foreign).toBe(false)
    const groups = buildRosterGroups(NFL, slots, { isCommissioner: true, sport: 'NFL' })
    expect(keysOf(groups)).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'BN']))
    expect(groups.find((g) => g.kind === 'injured')?.injuredCode).toBe('IR')
  })

  it('hides IDP rows for a non-football sport even for commissioners, and college rows unless used', () => {
    const fakeIdp = [{ key: 'DL', label: 'DL', shortLabel: 'DL', color: '', category: 'idp', defaultCount: 0, minCount: 0, maxCount: 3 }] as SlotDef[]
    expect(buildRosterGroups(fakeIdp, {}, { isCommissioner: true, sport: 'NBA' })).toEqual([])
    expect(keysOf(buildRosterGroups(fakeIdp, {}, { isCommissioner: true, sport: 'NFL' }))).toEqual(['DL'])
    const nbaCollege = NBA.filter((d) => d.category === 'college')
    expect(buildRosterGroups(nbaCollege, {}, { isCommissioner: true, sport: 'NBA' })).toEqual([])
  })
})
