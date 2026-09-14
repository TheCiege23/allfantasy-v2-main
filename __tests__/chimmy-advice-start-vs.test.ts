// @vitest-environment node
/**
 * The start/sit comparison's call recorded as Chimmy advice (retention item 6, 2026-09-14).
 * Names are matched against YOUR roster only, the week is the label or the current week, and
 * ties, past weeks, ambiguous names and non-Sleeper leagues record nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  teamFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
  currentWeek: vi.fn(),
  record: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFind },
    leagueTeam: { findMany: h.teamFind },
    roster: { findFirst: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
  },
}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeekForLeague: h.currentWeek }))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ recordAdvice: h.record }))

import { parseWeekLabel, recordStartVsAdvice } from '@/lib/chimmy-advice/startVsAdvice'

const USER = 'u1'
const base = {
  userId: USER,
  leagueId: 'af-ice',
  winner: 'playerA' as const,
  confidencePct: 64,
  playerAName: 'Jahmyr Gibbs',
  playerBName: 'Sam LaPorta',
  lineupSlot: 'FLEX',
  weekOrPeriod: 'Week 5',
}

function db(players = [
  { sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null },
  { sleeperId: '9226', name: 'Sam LaPorta', position: 'TE', team: 'DET', sport: 'NFL', imageUrl: null },
  { sleeperId: '4046', name: 'Patrick Mahomes', position: 'QB', team: 'KC', sport: 'NFL', imageUrl: null },
]) {
  h.leagueFind.mockResolvedValue({ id: 'af-ice', platform: 'sleeper', platformLeagueId: 'sl-ice', sport: 'NFL', season: 2026 })
  h.teamFind.mockResolvedValue([{ externalId: '4', platformUserId: 'sl-me' }])
  h.rosterFind.mockResolvedValue({ playerData: { players: ['9221', '4046'], starters: ['4046', '9226'], reserve: [], taxi: ['name:Someone:WR:DET'] } })
  h.playerFind.mockResolvedValue(players)
  h.currentWeek.mockResolvedValue({ seasonYear: 2026, week: 5 })
  h.record.mockResolvedValue('recorded')
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

describe('parseWeekLabel', () => {
  it('reads "Week 7", "wk 7" and "WK. 12"; anything else is null', () => {
    expect(parseWeekLabel('Week 7')).toBe(7)
    expect(parseWeekLabel('wk 7')).toBe(7)
    expect(parseWeekLabel('WK. 12')).toBe(12)
    expect(parseWeekLabel('this week')).toBeNull()
    expect(parseWeekLabel('Week 0')).toBeNull()
    expect(parseWeekLabel('Week 26')).toBeNull()
    expect(parseWeekLabel(null)).toBeNull()
  })
})

describe('recordStartVsAdvice', () => {
  it('🛑 records "start A over B" with both players’ roster Sleeper ids, the week, slot and confidence', async () => {
    db()
    expect(await recordStartVsAdvice(base)).toBe('recorded')
    expect(h.record).toHaveBeenCalledWith({
      userId: USER,
      leagueId: 'af-ice',
      sport: 'NFL',
      season: 2026,
      week: 5,
      adviceType: 'start_sit',
      surface: 'start_vs_comparison',
      rec: { key: '9221', name: 'Jahmyr Gibbs' },
      alt: { key: '9226', name: 'Sam LaPorta' },
      slot: 'FLEX',
      confidencePct: 64,
    })
    expect(h.rosterFind.mock.calls[0][0].where).toEqual({ leagueId: 'af-ice', platformUserId: { in: ['sl-me', '4', USER] } })
    // The importer's unresolvable "name:" ids never reach the player lookup.
    expect(h.playerFind.mock.calls[0][0].where.sleeperId.in).toEqual(['9221', '4046', '9226'])
  })

  it('playerB winning swaps which one is recommended', async () => {
    db()
    await recordStartVsAdvice({ ...base, winner: 'playerB' })
    expect(h.record.mock.calls[0][0]).toMatchObject({ rec: { key: '9226' }, alt: { key: '9221' } })
  })

  it('names match the roster through the canonical normalizer (case, punctuation, spacing)', async () => {
    db()
    expect(await recordStartVsAdvice({ ...base, playerAName: 'jahmyr  GIBBS', playerBName: 'Sam LaPorta' })).toBe('recorded')
  })

  it('🛑 a tie is not advice', async () => {
    db()
    expect(await recordStartVsAdvice({ ...base, winner: 'tie' })).toBe('tie')
    expect(h.leagueFind).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it('🛑 a player not on your roster, or a name two of your players share, records nothing', async () => {
    db()
    expect(await recordStartVsAdvice({ ...base, playerBName: 'Justin Jefferson' })).toBe('unresolved')
    db([
      { sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', sport: 'NFL', imageUrl: null },
      { sleeperId: '9226', name: 'Sam LaPorta', position: 'TE', team: 'DET', sport: 'NFL', imageUrl: null },
      { sleeperId: '4046', name: 'Sam LaPorta', position: 'TE', team: 'DET', sport: 'NFL', imageUrl: null },
    ])
    expect(await recordStartVsAdvice(base)).toBe('unresolved')
    expect(h.record).not.toHaveBeenCalled()
  })

  it('the same player on both sides records nothing', async () => {
    db()
    expect(await recordStartVsAdvice({ ...base, playerBName: 'Jahmyr Gibbs' })).toBe('unresolved')
  })

  it('🛑 non-Sleeper leagues record nothing (no weekly scores could ever resolve them)', async () => {
    db()
    h.leagueFind.mockResolvedValue({ id: 'af-espn', platform: 'espn', platformLeagueId: '123', sport: 'NFL', season: 2026 })
    expect(await recordStartVsAdvice(base)).toBe('not_sleeper')
    h.leagueFind.mockResolvedValue(null)
    expect(await recordStartVsAdvice(base)).toBe('not_sleeper')
    expect(h.teamFind).not.toHaveBeenCalled()
  })

  it('no single claimed team, or no roster, records nothing', async () => {
    db()
    h.teamFind.mockResolvedValue([])
    expect(await recordStartVsAdvice(base)).toBe('no_team')
    h.teamFind.mockResolvedValue([{ externalId: '4', platformUserId: null }, { externalId: '5', platformUserId: null }])
    expect(await recordStartVsAdvice(base)).toBe('no_team')
    db()
    h.rosterFind.mockResolvedValue(null)
    expect(await recordStartVsAdvice(base)).toBe('no_team')
  })

  it('🛑 no week label falls back to the league’s current week; no week at all records nothing', async () => {
    db()
    // A league row whose season lags the schedule: the schedule's season wins.
    h.leagueFind.mockResolvedValue({ id: 'af-ice', platform: 'sleeper', platformLeagueId: 'sl-ice', sport: 'NFL', season: 2025 })
    h.currentWeek.mockResolvedValue({ seasonYear: 2026, week: 8 })
    await recordStartVsAdvice({ ...base, weekOrPeriod: 'this week' })
    expect(h.record.mock.calls[0][0]).toMatchObject({ season: 2026, week: 8 })
    h.currentWeek.mockResolvedValue(null)
    expect(await recordStartVsAdvice({ ...base, weekOrPeriod: null })).toBe('no_week')
    h.currentWeek.mockRejectedValue(new Error('db'))
    expect(await recordStartVsAdvice({ ...base, weekOrPeriod: null })).toBe('no_week')
  })

  it('🛑 a labelled week already behind the current week is not advice', async () => {
    db()
    h.currentWeek.mockResolvedValue({ seasonYear: 2026, week: 6 })
    expect(await recordStartVsAdvice({ ...base, weekOrPeriod: 'Week 5' })).toBe('past_week')
    expect(await recordStartVsAdvice({ ...base, weekOrPeriod: 'Week 6' })).toBe('recorded')
    expect(await recordStartVsAdvice({ ...base, weekOrPeriod: 'Week 9' })).toBe('recorded')
  })

  it('without a current week, a labelled week records against the league’s season', async () => {
    db()
    h.currentWeek.mockResolvedValue(null)
    await recordStartVsAdvice(base)
    expect(h.record.mock.calls[0][0]).toMatchObject({ season: 2026, week: 5 })
  })

  it('passes the store’s own answer through (unavailable before the migration is applied)', async () => {
    db()
    h.record.mockResolvedValue('unavailable')
    expect(await recordStartVsAdvice(base)).toBe('unavailable')
  })
})
