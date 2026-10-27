import { describe, expect, it } from 'vitest'

import { findDailyIdleStarts, type DailyRosterPlayer } from '@/lib/integrity/dailyIdleStarts'

/**
 * Daily-lineup tanking evidence: a starter whose team had no game that day, while a bench player who
 * played could have taken his slot. Week of Mon 2 Nov – Wed 4 Nov (Eastern day keys).
 */
const day = (d: string) => new Date(`${d}T00:00:00Z`)
const DAYS = [day('2026-11-02'), day('2026-11-03'), day('2026-11-04')]

// BOS plays Mon and Wed; NYK plays every day; XXX is a team the schedule never names.
const TEAM_DAYS = new Map<string, Set<string>>([
  ['BOS', new Set(['2026-11-02', '2026-11-04'])],
  ['NYK', new Set(['2026-11-02', '2026-11-03', '2026-11-04'])],
])

const player = (over: Partial<DailyRosterPlayer> & { playerId: string }): DailyRosterPlayer => ({
  rosterId: 'A',
  playerName: over.playerId,
  position: 'PG',
  slotType: 'PG',
  team: 'BOS',
  injuryStatus: null,
  addedAt: day('2026-10-01'),
  droppedAt: null,
  ...over,
})

const run = (players: DailyRosterPlayer[], dailyRows: Array<[string, string, string]> = []) => {
  // dailyRows: [playerId, day, slot]
  const byPlayer = new Map<string, Map<string, string>>()
  for (const [pid, d, slot] of dailyRows) byPlayer.set(pid, (byPlayer.get(pid) ?? new Map()).set(d, slot))
  return findDailyIdleStarts({
    sport: 'NBA',
    days: DAYS,
    players,
    weekLineups: new Map(),
    dailyLineups: new Map([['A', byPlayer]]),
    teamDays: TEAM_DAYS,
    teamKey: (t) => String(t ?? ''),
  })
}

describe('findDailyIdleStarts', () => {
  it('a starter on his team\'s off day, with a bench guard who played, is one wasted start', () => {
    const r = run([player({ playerId: 'idle' }), player({ playerId: 'bench', slotType: 'BN', team: 'NYK' })])
    expect(r.get('A')?.idleStarts).toEqual([
      { day: '2026-11-03', slot: 'PG', playerId: 'idle', playerName: 'idle', benchPlayerId: 'bench', benchPlayerName: 'bench' },
    ])
  })

  it('no bench player who could fill the slot (a center for a PG slot) is not a wasted start', () => {
    const r = run([player({ playerId: 'idle' }), player({ playerId: 'big', slotType: 'BN', team: 'NYK', position: 'C' })])
    expect(r.get('A')).toBeUndefined()
  })

  it('a bench player who did not play that day, or is listed Out, is no alternative', () => {
    expect(run([player({ playerId: 'idle' }), player({ playerId: 'bench', slotType: 'BN', team: 'BOS' })]).get('A')).toBeUndefined()
    expect(run([player({ playerId: 'idle' }), player({ playerId: 'bench', slotType: 'BN', team: 'NYK', injuryStatus: 'Out' })]).get('A')).toBeUndefined()
  })

  it('a team the schedule never names is unknown, never idle', () => {
    expect(run([player({ playerId: 'idle', team: 'XXX' }), player({ playerId: 'bench', slotType: 'BN', team: 'NYK' })]).get('A')).toBeUndefined()
  })

  it("reads each day's saved lineup: benched on the off day is not a start", () => {
    const r = run(
      [player({ playerId: 'idle' }), player({ playerId: 'bench', slotType: 'BN', team: 'NYK' })],
      [['idle', '2026-11-03', 'BN'], ['bench', '2026-11-03', 'PG'], ['idle', '2026-11-04', 'PG'], ['bench', '2026-11-04', 'BN']],
    )
    expect(r.get('A')).toBeUndefined()
  })

  it('one bench player covers one idle slot a day', () => {
    const r = run([
      player({ playerId: 'idle1' }),
      player({ playerId: 'idle2', slotType: 'G' }),
      player({ playerId: 'bench', slotType: 'BN', team: 'NYK' }),
    ])
    expect(r.get('A')?.idleStarts).toHaveLength(1)
  })

  it('days off the roster do not count: dropped on Monday, he was not idle on Tuesday', () => {
    const r = run([
      player({ playerId: 'idle', droppedAt: new Date('2026-11-02T20:00:00Z') }),
      player({ playerId: 'bench', slotType: 'BN', team: 'NYK' }),
    ])
    expect(r.get('A')).toBeUndefined()
  })

  it('a starter listed Out who was started on a day his team played is reported once', () => {
    const r = run([player({ playerId: 'hurt', team: 'NYK', injuryStatus: 'Out' })])
    expect(r.get('A')?.ruledOutStarters).toEqual([{ playerId: 'hurt', playerName: 'hurt', status: 'Out' }])
    expect(r.get('A')?.idleStarts).toEqual([])
  })
})
