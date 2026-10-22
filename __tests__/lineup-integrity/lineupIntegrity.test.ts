import { describe, expect, it } from 'vitest'
import { auditLineups, describeFinding, isFlagged, type AuditInput } from '@/lib/lineup-integrity/lineupIntegrity'

const starter = (week: number, rosterId: number, playerId: string, points: number | null = 10) => ({ week, rosterId: String(rosterId), playerId, isStarter: true, didNotPlay: (points ?? 0) === 0 })
const base = (rows: AuditInput['rows'], extra: Partial<AuditInput> = {}): AuditInput => ({
  rows,
  requiredStarters: 3,
  byeWeekByClub: { KC: 6 },
  clubByPlayer: new Map([['mahomes', 'KC'], ['kelce', 'KC'], ['hurts', 'PHI'], ['brown', 'PHI'], ['injured', 'DAL']]),
  ruledOutNow: new Set(['injured']),
  teamNameByRoster: new Map([['1', 'Tankers'], ['2', 'Honest']]),
  ...extra,
})

describe('auditLineups', () => {
  it('flags empty slots and bye starters as hard evidence', () => {
    const { findings, summary } = auditLineups(
      base([
        starter(6, 1, 'mahomes'), // KC on bye week 6
        starter(6, 1, 'hurts'), // only 2 of 3 starters → 1 empty
        starter(6, 2, 'hurts'), starter(6, 2, 'brown'), starter(6, 2, 'kelce', 0),
      ]),
    )
    const t1 = findings.find((f) => f.rosterId === '1')!
    expect(t1).toMatchObject({ emptySlots: 1, byeStarters: ['mahomes'] })
    expect(isFlagged(t1)).toBe(true)
    // Team 2 started Kelce on his bye too.
    expect(findings.find((f) => f.rosterId === '2')?.byeStarters).toEqual(['kelce'])
    expect(summary[0]).toMatchObject({ teamName: 'Tankers', weeksFlagged: 1, emptySlots: 1, byeStarts: 1 })
  })

  it('a zero-point starter listed Out now is a soft lead, never a flag', () => {
    const { findings, summary } = auditLineups(base([starter(3, 2, 'hurts'), starter(3, 2, 'brown'), starter(3, 2, 'injured', 0)]))
    expect(findings).toHaveLength(1)
    expect(findings[0].ruledOutStarters).toEqual(['injured'])
    expect(isFlagged(findings[0])).toBe(false)
    expect(summary[0].weeksFlagged).toBe(0)
  })

  it('a player who played is never a ruled-out lead, whatever the report says today', () => {
    const { findings } = auditLineups(base([starter(3, 2, 'hurts'), starter(3, 2, 'brown'), starter(3, 2, 'injured', 12)]))
    expect(findings).toEqual([])
  })

  it('an unknown bye week is not a bye, and a team with no recorded starters is not audited', () => {
    const { findings, summary } = auditLineups(base([starter(6, 2, 'hurts'), starter(6, 2, 'brown'), starter(6, 2, 'unknown-club')]))
    expect(findings).toEqual([])
    expect(summary.map((s) => s.rosterId)).toEqual(['2']) // team 1 had no rows that week → skipped, not "3 empty"
  })

  it('no lineup rules means no empty-slot claims', () => {
    const { findings } = auditLineups(base([starter(2, 1, 'hurts')], { requiredStarters: 0 }))
    expect(findings).toEqual([])
  })

  it('describes a finding in one sentence with names', () => {
    const { findings } = auditLineups(base([starter(6, 1, 'mahomes'), starter(6, 1, 'hurts')]))
    const names: Record<string, string> = { mahomes: 'Patrick Mahomes' }
    expect(describeFinding(findings[0], (id) => names[id] ?? id)).toBe('Week 6: Tankers — 1 empty starting slot; started Patrick Mahomes on a bye.')
  })

  it('a per-player bye week beats the club map, either way', () => {
    const rows = [
      { ...starter(6, 1, 'hurts'), byeWeek: 6 }, // the row says bye, the club map says PHI plays
      { ...starter(6, 1, 'mahomes'), byeWeek: 9 }, // the row says no bye, the club map says KC is off
      starter(6, 1, 'brown'),
    ]
    const { findings } = auditLineups(base(rows))
    expect(findings[0].byeStarters).toEqual(['hurts'])
  })
})
