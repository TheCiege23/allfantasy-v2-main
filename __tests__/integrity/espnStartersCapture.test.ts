import { describe, expect, it } from 'vitest'
import { captureStarters, snapshotSlotsFromTemplate, weekEnd, weekStarters } from '@/lib/integrity/espnStartersCapture'
import { importedLineupTemplateSlots } from '@/lib/league/importedLineupTemplate'

const SUN_1PM = new Date('2026-11-15T18:00:00Z')
const SUN_4PM = new Date('2026-11-15T21:25:00Z')
const MNF = new Date('2026-11-17T01:15:00Z')
const WEEK_START = new Date('2026-11-11T07:15:00Z')
const WEEK_END = weekEnd(MNF)

const read = (started: boolean, proj = 10) => ({ name: 'x', position: 'RB', proj, status: null, bye: null, team: 'KC', frozenAt: null, started })
const kickoffs = new Map([
  ['early', SUN_1PM],
  ['late', SUN_4PM],
])

describe('captureStarters', () => {
  it('a roster read BEFORE a kickoff is never frozen: the manager could still move him', () => {
    const r = captureStarters({ prior: null, current: { early: read(true) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T17:50:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
    expect(r.players.early).toMatchObject({ started: true, frozenAt: null })
  })

  it('freezes the slot from the first read after his kickoff, keeping the projection from before it', () => {
    const before = captureStarters({ prior: null, current: { early: read(false, 14) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T17:50:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END }).players
    // After kickoff the stored lineup has him starting and the projection has moved: the slot is taken
    // from this read, the projection from the pre-kickoff one.
    const after = captureStarters({ prior: before, current: { early: read(true, 3) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T18:10:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
    expect(after.players.early).toMatchObject({ started: true, proj: 14, frozenAt: '2026-11-15T18:10:00.000Z' })
    // Frozen means final: a later read cannot change it.
    const later = captureStarters({ prior: after.players, current: { early: read(false, 0) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T23:00:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
    expect(later.players.early).toMatchObject({ started: true, proj: 14 })
    expect(later.changed).toBe(false)
  })

  it('a player still before his kickoff keeps following the lineup; one after his is frozen', () => {
    const r = captureStarters({ prior: null, current: { early: read(true), late: read(false) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T19:00:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
    expect(r.players.early.frozenAt).not.toBeNull()
    expect(r.players.late).toMatchObject({ started: false, frozenAt: null })
  })

  it('a change of slot alone is written (it is the thing being recorded)', () => {
    const first = captureStarters({ prior: null, current: { late: read(false) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T19:00:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END }).players
    const moved = captureStarters({ prior: first, current: { late: read(true) }, kickoffById: kickoffs, fetchedAt: new Date('2026-11-15T20:00:00Z'), weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
    expect(moved.changed).toBe(true)
    expect(moved.players.late.started).toBe(true)
  })

  it('a roster read outside the week says nothing about it', () => {
    for (const fetchedAt of [new Date(WEEK_END.getTime() + 60_000), new Date(WEEK_START.getTime() - 60_000)]) {
      const r = captureStarters({ prior: null, current: { early: read(true) }, kickoffById: kickoffs, fetchedAt, weekStartsAt: WEEK_START, weekEndsAt: WEEK_END })
      expect(r).toMatchObject({ ignored: true, changed: false, players: {} })
    }
  })
})

describe('weekStarters', () => {
  it('complete only after the week ends with every player who had a game captured after kickoff', () => {
    const players = {
      early: { ...read(true), frozenAt: '2026-11-15T18:10:00Z' },
      late: { ...read(false), frozenAt: '2026-11-15T21:40:00Z' },
      bye: { ...read(true) },
    }
    const after = new Date(WEEK_END.getTime() + 60_000)
    expect(weekStarters(players, kickoffs, after, WEEK_END)).toEqual({ starterIds: ['early', 'bye'], complete: true, uncaptured: [] })
    // Before the week ends, never complete.
    expect(weekStarters(players, kickoffs, MNF, WEEK_END).complete).toBe(false)
    // A player whose game started but was never read after it: incomplete, and named — not "benched".
    const missed = { ...players, late: { ...read(false) } }
    expect(weekStarters(missed, kickoffs, after, WEEK_END)).toMatchObject({ complete: false, uncaptured: ['late'] })
  })
})

describe('ESPN slots', () => {
  it('SLOT:COUNT pairs become one seat per starting slot; bench and IR are not seats', () => {
    const rows = importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1'] } })
    const seats = snapshotSlotsFromTemplate(rows)
    expect(seats?.map((s) => s.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST', 'K'])
    expect(seats?.find((s) => s.slot === 'DST')?.eligible).toContain('DST')
  })

  it('an unreadable layout is null, never a guessed lineup', () => {
    expect(snapshotSlotsFromTemplate(importedLineupTemplateSlots({ sport: 'NFL', settings: { roster_positions: ['QB:1', 'MYSTERY:1', 'BE:6'] } }))).toBeNull()
    expect(snapshotSlotsFromTemplate(null)).toBeNull()
  })
})
