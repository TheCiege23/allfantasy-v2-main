import { describe, it, expect } from 'vitest'
import {
  isUnownedTeam,
  ownedTeamNames,
  resolveMemberActivity,
  teamDisplayName,
  unownedTeamNames,
} from '@/lib/core-app/commissioner/activity'

/**
 * Who is actually playing (Commissioner Hub).
 *
 * Measured on production 2026-09-16: the sync rewrites every roster on each pass,
 * so roster timestamps called every Sleeper manager active while the Workspace
 * check-up, reading real moves, had two of them inactive. Imported leagues are
 * judged by moves; the only rows that looked idle by timestamp were leftover roster
 * rows with no team, which the hub then named "Unnamed team".
 */

const NOW = new Date('2026-09-16T20:00:00Z')

describe('imported leagues are judged by moves', () => {
  const fresh = new Date('2026-09-15T12:00:00Z')

  it('active with a move in the window, inactive without (the Workspace detector rule)', () => {
    const r = resolveMemberActivity(
      {
        kind: 'imported',
        managers: [
          { managerName: 'Busy', currentCount: 3, priorCount: 1 },
          { managerName: 'QuietQuinn', currentCount: 0, priorCount: 2 },
          { managerName: 'SilentSam', currentCount: 0, priorCount: 0 },
        ],
        lastActivityAt: fresh,
        eventCount: 40,
      },
      NOW,
      14,
    )
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.data.rows.map((x) => [x.name, x.status])).toEqual([
      ['QuietQuinn', 'inactive'],
      ['SilentSam', 'inactive'],
      ['Busy', 'active'],
    ])
    expect(r.data.rows[0].detail).toBe('no moves in 14 days (2 the 14 before)')
    expect(r.data.rows[2].detail).toBe('3 moves in 14 days')
    expect(r.data).toMatchObject({ total: 3, active: 1, inactive: 2 })
    expect(r.data.basis).toContain('last 14 days')
  })

  it('adds the managers who made no move at all, which the move read leaves out', () => {
    // Measured on production: a 12-team league read "4 of 8 active" without this.
    const r = resolveMemberActivity(
      {
        kind: 'imported',
        managers: [{ managerName: 'Busy', currentCount: 2, priorCount: 0 }],
        teams: ['Busy', 'Ghosted', 'Silent'],
        lastActivityAt: fresh,
        eventCount: 12,
      },
      NOW,
      14,
    )
    expect(r.available && r.data).toMatchObject({ total: 3, active: 1, inactive: 2 })
    expect(r.available && r.data.rows.map((x) => x.name)).toEqual(['Ghosted', 'Silent', 'Busy'])
  })

  it('refuses when the feed has gone quiet, because every manager would read idle', () => {
    const r = resolveMemberActivity(
      {
        kind: 'imported',
        managers: [{ managerName: 'x', currentCount: 0, priorCount: 0 }],
        lastActivityAt: new Date('2026-08-20T00:00:00Z'),
        eventCount: 9,
      },
      NOW,
      14,
    )
    expect(r.available).toBe(false)
    expect(!r.available && r.reason).toContain('27 days old')
  })

  it('refuses when nothing was ever imported, or moves cannot be matched to managers', () => {
    expect(
      resolveMemberActivity({ kind: 'imported', managers: [], lastActivityAt: null, eventCount: 0 }, NOW, 14).available,
    ).toBe(false)
    const unmatched = resolveMemberActivity({ kind: 'imported', managers: [], lastActivityAt: fresh, eventCount: 5 }, NOW, 14)
    expect(!unmatched.available && unmatched.reason).toContain('matched')
  })
})

describe('leagues created in AllFantasy keep the roster clock', () => {
  it('drops roster rows with no team behind them instead of naming an "Unnamed team"', () => {
    const r = resolveMemberActivity(
      {
        kind: 'native',
        rows: [
          { teamName: 'Home Team', managerName: 'me', status: 'active', lastActionAt: '2026-09-16T10:00:00Z' },
          { teamName: null, managerName: null, status: 'inactive', lastActionAt: '2026-08-01T00:00:00Z' },
          { teamName: null, managerName: 'solo', status: 'inactive', lastActionAt: '2026-09-01T00:00:00Z' },
        ],
      },
      NOW,
      14,
    )
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.data.rows.map((x) => x.name)).toEqual(['solo', 'Home Team'])
    expect(r.data.rows[0].detail).toBe('last move 15d ago')
    expect(r.data.rows[1].detail).toBe('active today')
  })

  it('says the read failed rather than reporting an empty league', () => {
    expect(resolveMemberActivity({ kind: 'native', rows: null }, NOW, 14).available).toBe(false)
  })
})

describe('which teams have nobody', () => {
  it('an orphan flag on a team its owner has claimed is not an unowned team', () => {
    // Production: a team flagged isOrphan was claimed by the league's own owner.
    expect(isUnownedTeam({ isOrphan: true, claimedByUserId: 'u1', platformUserId: 'p1' })).toBe(false)
    expect(isUnownedTeam({ isOrphan: true, claimedByUserId: null, platformUserId: 'p1' })).toBe(false)
    expect(isUnownedTeam({ isOrphan: true, claimedByUserId: null, platformUserId: null })).toBe(true)
    expect(isUnownedTeam({ isOrphan: false, claimedByUserId: null, platformUserId: null })).toBe(false)
  })

  it('counts two unowned teams named "Unknown" as two, and does not print "Unknown"', () => {
    const teams = [
      { teamName: 'Unknown', ownerName: 'Unknown', isOrphan: true },
      { teamName: 'Unknown', ownerName: 'Unknown', isOrphan: true },
      { teamName: 'Real', ownerName: 'owner', isOrphan: false, platformUserId: 'p' },
    ]
    expect(unownedTeamNames(teams)).toEqual(['Unnamed team', 'Unnamed team'])
    expect(teamDisplayName({ teamName: '  ', ownerName: 'QuietQuinn' })).toBe('QuietQuinn')
  })

  it('names owned teams the way the move read does, once each', () => {
    const teams = [
      { teamName: 'Busy', ownerName: 'a', platformUserId: 'p1' },
      { teamName: '', ownerName: 'b', platformUserId: 'p2' },
      { teamName: 'Busy', ownerName: 'c', platformUserId: 'p3' },
      { teamName: 'Unknown', ownerName: 'Unknown', isOrphan: true },
    ]
    expect(ownedTeamNames(teams)).toEqual(['Busy', 'b'])
  })
})
