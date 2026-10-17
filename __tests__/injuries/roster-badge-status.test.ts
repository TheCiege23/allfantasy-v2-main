/**
 * Roster board injury badge.
 *
 * Two bugs: (1) the stored-status mapping matched exact upper-case tokens, so "Injured Reserve",
 * "Suspension", "Day-To-Day", "60-day IL" … all rendered as healthy; (2) the badge only ever read the
 * status frozen into the roster's stored JSON, while the fresher unified-roster label sat unused in
 * `providerInjuryLabel`.
 */
import { describe, expect, it } from 'vitest'
import {
  injuryNeedsAttention,
  isDisplayableInjuryDesignation,
  isRosterStatusCode,
  rosterBadgeStatus,
} from '@/lib/injuries/injuryStatusDisplay'
import { buildRosterStateFromPlayerData } from '@/components/app/roster/useRosterManager'
import { mergeUnifiedIntoRosterState } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

describe('rosterBadgeStatus — every production spelling, not just exact tokens', () => {
  it.each([
    // reserve lists → ir
    ['IR', 'ir'],
    ['Injured Reserve', 'ir'],
    ['injured reserve', 'ir'],
    ['OUT_IR', 'ir'],
    ['PUP', 'ir'],
    ['PUP-R', 'ir'],
    ['Physically Unable to Perform', 'ir'],
    ['NFI-R', 'ir'],
    ['60-day IL', 'ir'],
    ['15-day IL', 'ir'],
    ['10-day IL', 'ir'],
    ['7-day IL', 'ir'],
    ['IL60', 'ir'],
    // unavailable → out
    ['Out', 'out'],
    ['OUT', 'out'],
    ['Suspension', 'out'],
    ['Suspended', 'out'],
    ['Sus', 'out'],
    ['Paternity', 'out'],
    ['COV', 'out'],
    // game-time doubt → q
    ['Questionable', 'q'],
    ['QUES', 'q'],
    ['Q', 'q'],
    ['Doubtful', 'q'],
    ['Day-To-Day', 'q'],
    ['day_to_day', 'q'],
    ['DTD', 'q'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(rosterBadgeStatus(raw)).toBe(expected)
  })

  it.each(['ACT', 'Active', 'INACT', 'Inactive', 'NA', 'Practice Squad', 'Healthy', 'Probable', '', '   '])(
    'roster code / non-injury %j → healthy',
    (raw) => {
      expect(rosterBadgeStatus(raw)).toBe('healthy')
    },
  )

  it('null / undefined / objects → healthy', () => {
    expect(rosterBadgeStatus(null)).toBe('healthy')
    expect(rosterBadgeStatus(undefined)).toBe('healthy')
    expect(rosterBadgeStatus({ status: 'IR' })).toBe('healthy')
  })
})

describe('isRosterStatusCode / isDisplayableInjuryDesignation / injuryNeedsAttention', () => {
  it('roster codes are not injury designations', () => {
    for (const code of ['ACT', 'act', 'INACT', 'Inactive', 'Active', 'NA', 'Practice Squad', 'healthy']) {
      expect(isRosterStatusCode(code)).toBe(true)
      expect(isDisplayableInjuryDesignation(code)).toBe(false)
      expect(injuryNeedsAttention(code)).toBe(false)
    }
  })

  it('real designations need attention', () => {
    for (const s of ['Questionable', 'Out', 'IR', 'Doubtful', 'Day-To-Day', '60-day IL', 'Suspension', 'Probable']) {
      expect(isDisplayableInjuryDesignation(s)).toBe(true)
      expect(injuryNeedsAttention(s)).toBe(true)
    }
  })

  it('empty is neither', () => {
    expect(injuryNeedsAttention(null)).toBe(false)
    expect(injuryNeedsAttention('')).toBe(false)
    expect(injuryNeedsAttention('  ')).toBe(false)
  })
})

describe('roster board — stored snapshot mapping', () => {
  it('maps real stored spellings instead of falling through to healthy', () => {
    const state = buildRosterStateFromPlayerData({
      lineup_sections: {
        starters: [],
        bench: [
          { id: 'p1', name: 'A', position: 'RB', status: 'Injured Reserve' },
          { id: 'p2', name: 'B', position: 'WR', injury_status: 'Day-To-Day' },
          { id: 'p3', name: 'C', position: 'QB', status: 'ACT' },
          { id: 'p4', name: 'D', position: 'SP', status: '60-day IL' },
          { id: 'p5', name: 'E', position: 'TE', status: 'Suspension' },
        ],
        ir: [],
        taxi: [],
        devy: [],
      },
    })
    expect(state.bench.map((p) => [p.id, p.status])).toEqual([
      ['p1', 'ir'],
      ['p2', 'q'],
      ['p3', 'healthy'],
      ['p4', 'ir'],
      ['p5', 'out'],
    ])
  })
})

function wire(id: string, injuryStatus: string | null): UnifiedPlayerWireDto {
  return {
    id,
    name: id,
    position: 'RB',
    team: 'DAL',
    sport: 'NFL',
    headshotUrl: null,
    injuryStatus,
    fantasyPointsPerGame: null,
    projectedPoints: null,
    adp: null,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: null,
    statsSource: null,
    projectionsSource: null,
    normalizedStats: {},
    normalizedProjections: {},
    product: { unified: {} as any, yearsExp: null, byeWeek: null },
  }
}

function stored(id: string, status: 'healthy' | 'q' | 'out' | 'ir', slot: 'bench' | 'ir' = 'bench') {
  return {
    id,
    name: id,
    team: 'DAL',
    position: 'RB',
    opponent: '—',
    gameTime: '—',
    projection: 0,
    actual: null,
    status,
    slot,
  }
}

describe('roster board — enriched players take the badge from the unified label', () => {
  it('a null label from an enriched player is healthy, even if the snapshot said IR', () => {
    const next = mergeUnifiedIntoRosterState(
      { starters: [], bench: [], ir: [stored('back', 'ir', 'ir')], taxi: [], devy: [] },
      [wire('back', null)],
    )
    expect(next.ir[0]!.status).toBe('healthy')
    expect(next.ir[0]!.providerInjuryLabel).toBeNull()
  })

  it('a fresh designation overrides a healthy snapshot', () => {
    const next = mergeUnifiedIntoRosterState(
      { starters: [stored('hurt', 'healthy')], bench: [stored('ir', 'healthy')], ir: [], taxi: [], devy: [] },
      [wire('hurt', 'Questionable'), wire('ir', 'Injured Reserve')],
    )
    expect(next.starters[0]!.status).toBe('q')
    expect(next.bench[0]!.status).toBe('ir')
  })

  it('a roster code from the unified row is not an injury', () => {
    const next = mergeUnifiedIntoRosterState(
      { starters: [stored('x', 'out')], bench: [], ir: [], taxi: [], devy: [] },
      [wire('x', 'ACT')],
    )
    expect(next.starters[0]!.status).toBe('healthy')
  })

  it('an unenriched player keeps his stored status', () => {
    const next = mergeUnifiedIntoRosterState(
      { starters: [], bench: [stored('lonely', 'out')], ir: [], taxi: [], devy: [] },
      [wire('someone-else', null)],
    )
    expect(next.bench[0]!.status).toBe('out')
  })
})
