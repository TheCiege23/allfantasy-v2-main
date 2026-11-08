/**
 * The shared ESPN id tables. These pin the values that were in production before the tables were
 * consolidated, so the move cannot silently change what any position, slot or team is called.
 */
import { describe, it, expect } from 'vitest'
import {
  ESPN_ACTIVITY_MESSAGE_TYPE_IDS,
  ESPN_ACTIVITY_TYPE_MAP,
  ESPN_BENCH_SLOT,
  ESPN_IR_SLOT,
  ESPN_LINEUP_SLOT_LABELS,
  ESPN_POSITION_LABELS,
  ESPN_TEAM_ABBREVIATIONS,
  classifyEspnLineupSlot,
  espnDefenseTeamAbbreviation,
  espnLineupSlotLabel,
  espnPositionLabel,
  espnProTeamAbbreviation,
} from '@/lib/league-import/espn/espnLookups'
import * as fetchService from '@/lib/league-import/espn/EspnLeagueFetchService'

describe('ESPN lookups', () => {
  it('maps the offensive positions and D/ST, and nothing it cannot evidence', () => {
    expect(ESPN_POSITION_LABELS).toEqual({ 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' })
    expect(espnPositionLabel(3)).toBe('WR')
    expect(espnPositionLabel('16')).toBe('D/ST')
    // Unmapped (e.g. IDP, uncaptured) falls back rather than guessing.
    expect(espnPositionLabel(11)).toBe('N/A')
    expect(espnPositionLabel(undefined, 'UNK')).toBe('UNK')
  })

  it('labels lineup slots, treating 0 as QB rather than missing', () => {
    expect(espnLineupSlotLabel(0)).toBe('QB')
    expect(espnLineupSlotLabel(7)).toBe('SUPER_FLEX')
    expect(espnLineupSlotLabel(23)).toBe('FLEX')
    expect(espnLineupSlotLabel(20)).toBe('BE')
    expect(espnLineupSlotLabel(21)).toBe('IR')
    expect(espnLineupSlotLabel(99)).toBe('SLOT_99')
    expect(Object.keys(ESPN_LINEUP_SLOT_LABELS)).toHaveLength(24)
  })

  it('separates starters, bench and IR — bench is never IR', () => {
    expect(ESPN_BENCH_SLOT).toBe(20)
    expect(ESPN_IR_SLOT).toBe(21)
    expect(classifyEspnLineupSlot(0)).toBe('starter')
    expect(classifyEspnLineupSlot(23)).toBe('starter')
    expect(classifyEspnLineupSlot(20)).toBe('bench')
    expect(classifyEspnLineupSlot(21)).toBe('ir')
    expect(classifyEspnLineupSlot(undefined)).toBe('bench')
  })

  it('maps all 32 NFL teams and free agents', () => {
    expect(Object.keys(ESPN_TEAM_ABBREVIATIONS)).toHaveLength(32)
    expect(espnProTeamAbbreviation(12)).toBe('KC')
    expect(espnProTeamAbbreviation(33)).toBe('BAL')
    expect(espnProTeamAbbreviation(0)).toBe('')
    expect(espnDefenseTeamAbbreviation('-16012')).toBe('KC')
  })

  it('keeps the activity codes and the order production sends them in', () => {
    expect(ESPN_ACTIVITY_MESSAGE_TYPE_IDS).toEqual([178, 180, 179, 239, 181, 244])
    expect(ESPN_ACTIVITY_TYPE_MAP[244]).toEqual({ type: 'trade', description: 'traded_away' })
    for (const id of ESPN_ACTIVITY_MESSAGE_TYPE_IDS) expect(ESPN_ACTIVITY_TYPE_MAP[id]).toBeDefined()
  })

  it('is the same table the fetch service re-exports (one copy, not two)', () => {
    expect(fetchService.ESPN_POSITION_LABELS).toBe(ESPN_POSITION_LABELS)
    expect(fetchService.ESPN_TEAM_ABBREVIATIONS).toBe(ESPN_TEAM_ABBREVIATIONS)
  })
})
