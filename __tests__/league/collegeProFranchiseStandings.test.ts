import { describe, expect, it } from 'vitest'
import { buildFranchiseStandings } from '@/lib/league/collegePro/franchiseStandings'

// Real Peach Bowl (Sleeper) and Cream Bowl (Fantrax) records, 2026-11-22.
const PRO = [
  { key: '8', name: '(F) SF TEP', ownerName: 'TheCiege24', record: { wins: 3, losses: 7, ties: 0, pointsFor: 1000.92 } },
  { key: '11', name: 'GrindingFFB', ownerName: 'GrindingFFB', record: { wins: 9, losses: 1, ties: 0, pointsFor: 1543.36 } },
  { key: '5', name: 'Connor0488', ownerName: 'Connor0488', record: { wins: 10, losses: 0, ties: 0, pointsFor: 1757.22 } },
]
const COLLEGE = [
  { key: 'conn', name: 'Connor0488', ownerName: null, record: { wins: 5, losses: 5, ties: 0, pointsFor: 1548.1 } },
  { key: 'ciege', name: 'Ciege82', ownerName: null, record: { wins: 2, losses: 8, ties: 0, pointsFor: 1511.62 } },
  { key: 'grind', name: 'Grindingffb', ownerName: null, record: { wins: 8, losses: 2, ties: 0, pointsFor: 1764.38 } },
]
const MAP = { '8': 'ciege', '11': 'grind', '5': 'conn' }

describe('buildFranchiseStandings', () => {
  it('adds each franchise’s two records and ranks by franchise wins', () => {
    const { rows, unmatchedCollege } = buildFranchiseStandings({ proTeams: PRO, collegeTeams: COLLEGE, map: MAP, proKey: '8' })
    expect(rows.map((r) => [r.rank, r.proName, r.collegeName, `${r.total.wins}-${r.total.losses}`])).toEqual([
      [1, 'GrindingFFB', 'Grindingffb', '17-3'], // 9-1 + 8-2
      [2, 'Connor0488', 'Connor0488', '15-5'], // 10-0 + 5-5
      [3, '(F) SF TEP', 'Ciege82', '5-15'],
    ])
    expect(rows[0]!.total.pointsFor).toBe(3307.74)
    expect(rows.find((r) => r.isMine)?.proName).toBe('(F) SF TEP')
    expect(unmatchedCollege).toBe(0)
  })

  it('keeps a pro team with no college match, and counts the college teams nobody is matched to', () => {
    const { rows, unmatchedCollege } = buildFranchiseStandings({ proTeams: PRO, collegeTeams: COLLEGE, map: { '5': 'conn' }, proKey: null })
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.proKey === '11')).toMatchObject({ collegeName: null, collegeRecord: null, total: { wins: 9, losses: 1 } })
    expect(unmatchedCollege).toBe(2)
  })

  it('breaks a tie on wins by fewer losses, then by points', () => {
    const pro = [
      { key: 'a', name: 'A', ownerName: null, record: { wins: 5, losses: 5, ties: 0, pointsFor: 900 } },
      { key: 'b', name: 'B', ownerName: null, record: { wins: 5, losses: 4, ties: 1, pointsFor: 800 } },
      { key: 'c', name: 'C', ownerName: null, record: { wins: 5, losses: 5, ties: 0, pointsFor: 1000 } },
    ]
    const { rows } = buildFranchiseStandings({ proTeams: pro, collegeTeams: [], map: {}, proKey: null })
    expect(rows.map((r) => r.proName)).toEqual(['B', 'C', 'A'])
  })
})
