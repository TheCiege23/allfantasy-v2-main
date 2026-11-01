/**
 * The imported Guilly check (lib/guillotine/importedGuillyHealth.ts): what the app infers about an
 * imported league's chops, and every way that inference can be quietly wrong.
 */
import { describe, expect, it } from 'vitest'
import { assessImportedGuilly, chopTimeline, importedGuillyFormat, type ImportedGuillyInput, type ImportedGuillyRow } from '@/lib/guillotine/importedGuillyHealth'

const NOW = new Date('2026-10-30T12:00:00Z')
const row = (week: number, rosterId: string, pointsFor: number, matchupId: number | null = null): ImportedGuillyRow => ({ week, rosterId, pointsFor, matchupId })

/** Four teams; 4 is chopped after week 1, 3 after week 2. Week 3 is being played. */
const CLEAN: ImportedGuillyRow[] = [
  row(1, '1', 110), row(1, '2', 100), row(1, '3', 90), row(1, '4', 80),
  row(2, '1', 105), row(2, '2', 95), row(2, '3', 70), row(2, '4', 0),
  row(3, '1', 50), row(3, '2', 40), row(3, '3', 0), row(3, '4', 0),
]
const input = (over: Partial<ImportedGuillyInput> = {}): ImportedGuillyInput => ({
  leagueType: 'guillotine',
  guillotineMode: null,
  settings: { leagueTypeConfirmation: { type: 'guillotine' } },
  rows: CLEAN,
  rosters: [{ rosterId: '1', players: 15 }, { rosterId: '2', players: 15 }, { rosterId: '3', players: 0 }, { rosterId: '4', players: 0 }],
  currentWeek: 3,
  lastReadAt: new Date('2026-10-30T11:00:00Z'),
  inSeason: true,
  now: NOW,
  ...over,
})
const codes = (h: ReturnType<typeof assessImportedGuilly>) => h?.findings.map((f) => f.code) ?? []

describe('which leagues it applies to', () => {
  it('a confirmed Guilly league, an importer’s guess, and nothing else', () => {
    expect(importedGuillyFormat({ leagueType: 'redraft', guillotineMode: null, settings: { leagueTypeConfirmation: { type: 'guillotine' } } })).toBe('confirmed')
    expect(importedGuillyFormat({ leagueType: 'guillotine', guillotineMode: null, settings: {} })).toBe('detected')
    expect(importedGuillyFormat({ leagueType: 'redraft', guillotineMode: true, settings: null })).toBe('detected')
    expect(importedGuillyFormat({ leagueType: 'redraft', guillotineMode: null, settings: {} })).toBeNull()
    // The commissioner said it is something else: an importer's "guillotine" no longer counts.
    expect(importedGuillyFormat({ leagueType: 'guillotine', guillotineMode: null, settings: { leagueTypeConfirmation: { type: 'redraft' } } })).toBeNull()
    expect(assessImportedGuilly(input({ leagueType: 'redraft', settings: {} }))).toBeNull()
  })
})

describe('the chop timeline', () => {
  it('reads each chop and the week it happened, by the rail’s rule', () => {
    expect(chopTimeline(CLEAN, 3).chops).toEqual([{ week: 1, rosterIds: ['4'] }, { week: 2, rosterIds: ['3'] }])
  })

  it('a team that went at 0 without being the unique lowest is dated to the week before', () => {
    const rows = [row(1, '1', 100), row(1, '2', 80), row(1, '3', 80), row(2, '1', 90), row(2, '2', 70), row(2, '3', 0)]
    const t = chopTimeline(rows, 3)
    expect(t.ties).toEqual([{ week: 1, rosterIds: ['2', '3'] }])
    expect(t.chops).toEqual([{ week: 1, rosterIds: ['3'] }, { week: 2, rosterIds: ['2'] }])
  })
})

describe('a healthy league', () => {
  it('is ok, lists its chops, and counts the teams still alive', () => {
    const h = assessImportedGuilly(input())
    expect(h).toMatchObject({ format: 'confirmed', status: 'ok', teamsAlive: 2, chops: [{ week: 1, rosterIds: ['4'] }, { week: 2, rosterIds: ['3'] }] })
    expect(h!.findings).toEqual([])
  })
})

describe('what it warns about', () => {
  it('an importer’s guess is flagged for the commissioner to confirm (info, not a failure)', () => {
    const h = assessImportedGuilly(input({ settings: {} }))
    expect(h).toMatchObject({ format: 'detected', status: 'ok' })
    expect(codes(h)).toEqual(['unconfirmed_format'])
  })

  it('teams paired head-to-head: probably not a Guilly league at all', () => {
    const rows = [row(1, '1', 110, 1), row(1, '2', 100, 1), row(1, '3', 90, 2), row(1, '4', 80, 2)]
    expect(codes(assessImportedGuilly(input({ rows, currentWeek: 2 })))).toContain('plays_head_to_head')
    // A Guilly provider that numbers every team's row on its own is not pairing anyone.
    const solo = [row(1, '1', 110, 1), row(1, '2', 100, 2), row(1, '3', 90, 3), row(1, '4', 80, 4)]
    expect(codes(assessImportedGuilly(input({ rows: solo, currentWeek: 2, rosters: [] })))).not.toContain('plays_head_to_head')
  })

  it('a stale read in season, and a league never read; out of season it does not matter', () => {
    expect(assessImportedGuilly(input({ lastReadAt: new Date('2026-10-28T12:00:00Z') }))!.findings.find((f) => f.code === 'stale_read')?.text).toContain('2 days ago')
    expect(codes(assessImportedGuilly(input({ lastReadAt: null })))).toContain('stale_read')
    expect(codes(assessImportedGuilly(input({ lastReadAt: null, inSeason: false })))).not.toContain('stale_read')
  })

  it('no scores mid-season means no chop can be read', () => {
    expect(codes(assessImportedGuilly(input({ rows: [], rosters: [] })))).toContain('no_scores')
  })

  it('a team read as chopped that scores again: the chop view is wrong for it', () => {
    const rows = [...CLEAN.filter((r) => !(r.week === 3 && r.rosterId === '3')), row(3, '3', 60)]
    const h = assessImportedGuilly(input({ rows, rosters: [{ rosterId: '1', players: 15 }, { rosterId: '2', players: 15 }, { rosterId: '3', players: 15 }, { rosterId: '4', players: 0 }] }))
    expect(h!.status).toBe('attention')
    expect(h!.findings.find((f) => f.code === 'scored_after_chop')).toMatchObject({ rosterIds: ['3'] })
  })

  it('a tie at the bottom is noted, not guessed', () => {
    const rows = [row(1, '1', 100), row(1, '2', 80), row(1, '3', 80), row(1, '4', 90)]
    const h = assessImportedGuilly(input({ rows, currentWeek: 2, rosters: [] }))
    expect(h!.findings.find((f) => f.code === 'tie_at_bottom')).toMatchObject({ week: 1, rosterIds: ['2', '3'], severity: 'info' })
    expect(h!.chops).toEqual([])
  })

  it('half the league emptied at once is a new season or re-import, not chops', () => {
    const h = assessImportedGuilly(input({ rosters: [{ rosterId: '1', players: 0 }, { rosterId: '2', players: 0 }, { rosterId: '3', players: 0 }, { rosterId: '4', players: 0 }] }))
    expect(codes(h)).toContain('mass_emptying')
    expect(codes(h)).not.toContain('empty_without_chop')
  })

  it('an empty roster the scores do not explain', () => {
    const h = assessImportedGuilly(input({ rosters: [{ rosterId: '1', players: 0 }, { rosterId: '2', players: 15 }, { rosterId: '3', players: 15 }, { rosterId: '4', players: 15 }, { rosterId: '5', players: 15 }] }))
    expect(h!.findings.find((f) => f.code === 'empty_without_chop')).toMatchObject({ rosterIds: ['1'] })
  })
})
