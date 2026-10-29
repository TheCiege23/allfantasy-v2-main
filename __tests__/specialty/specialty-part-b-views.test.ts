import { describe, expect, it } from 'vitest'
import { buildUniverseMap, daysUntilResolution, infectionHeadline } from '@/lib/zombie/zombieHomeView'
import { bidCapPreview, bidFits, capBarSegments, clampSalary, contractTags } from '@/lib/salary-cap/capHomeView'
import { buildDevyStash, devyFeedItems, devyPipelineByYear, devyYearTag } from '@/lib/devy/devyHomeView'
import { buildCampusLineup, campusShare, graduatingRights } from '@/lib/merged-devy-c2c/c2cHomeView'

describe('zombie home view', () => {
  const rows = [
    { leagueId: 'g2', rosterId: 'a', levelId: 'L3', levelName: 'Gamma', status: 'Survivor', leagueName: 'Gamma 2' },
    { leagueId: 'g2', rosterId: 'b', levelId: 'L3', levelName: 'Gamma', status: 'Zombie', leagueName: 'Gamma 2' },
    { leagueId: 'g2', rosterId: 'c', levelId: 'L3', levelName: 'Gamma', status: 'Whisperer', leagueName: 'Gamma 2' },
    { leagueId: 'a1', rosterId: 'd', levelId: 'L1', levelName: 'Alpha', status: 'Zombie', leagueName: 'Alpha 1' },
    { leagueId: 'b1', rosterId: 'e', levelId: 'L2', levelName: 'Beta', status: 'Survivor', leagueName: 'Beta 1' },
  ]

  it('orders levels Alpha → Beta → Gamma and cells Whisperer → Zombie → Survivor', () => {
    const map = buildUniverseMap(rows, 'g2')
    expect(map.map((l) => l.levelName)).toEqual(['Alpha', 'Beta', 'Gamma'])
    const mine = map[2].leagues[0]
    expect(mine.isMine).toBe(true)
    expect(mine.cells).toEqual(['whisperer', 'zombie', 'survivor'])
    expect(mine.turned).toBe(1)
    expect(mine.total).toBe(3)
  })

  it('never shows a Whisperer the server disguised as a Survivor', () => {
    const redacted = rows.map((r) => (r.status === 'Whisperer' ? { ...r, status: 'Survivor' } : r))
    const cells = buildUniverseMap(redacted, 'g2')[2].leagues[0].cells
    expect(cells).not.toContain('whisperer')
  })

  it('counts whole days to the resolution day', () => {
    // 2026-10-18 is a Sunday.
    const sunday = new Date(2026, 9, 18, 12)
    expect(daysUntilResolution('Tuesday', sunday)).toBe(2)
    expect(daysUntilResolution('Sunday', sunday)).toBe(0)
    expect(daysUntilResolution('Someday', sunday)).toBeNull()
  })

  it('picks the infection-night headline from the moment first', () => {
    expect(infectionHeadline({ momentKind: 'turned', myStatus: 'zombie', won: false }).tone).toBe('turned')
    expect(infectionHeadline({ momentKind: null, myStatus: 'survivor', won: true }).head).toBe('Still human')
    expect(infectionHeadline({ momentKind: null, myStatus: 'zombie', won: true }).tone).toBe('feeding')
  })
})

describe('salary cap home view', () => {
  const projection = [
    { capYear: 2027, capCeiling: 262.5, totalCapHit: 196, deadMoney: 0, projectedSpace: 66.5 },
    { capYear: 2026, capCeiling: 250, totalCapHit: 231.6, deadMoney: 6, projectedSpace: 18.4 },
    { capYear: 2028, capCeiling: 275.6, totalCapHit: 142.5, deadMoney: 0, projectedSpace: 133.1 },
  ]

  it('applies the bid only to the contract years, in cap-year order', () => {
    const rows = bidCapPreview(projection, 11, 2)
    expect(rows.map((r) => r.capYear)).toEqual([2026, 2027, 2028])
    expect(rows.map((r) => r.left)).toEqual([7.4, 55.5, 133.1])
    expect(bidFits(rows)).toBe(true)
  })

  it('blocks a bid that goes over in any year', () => {
    const rows = bidCapPreview(projection, 20, 1)
    expect(rows[0].over).toBe(true)
    expect(bidFits(rows)).toBe(false)
  })

  it('splits the cap bar into active, dead and rollover', () => {
    const seg = capBarSegments({ totalCapHit: 231.6, deadMoneyHit: 6, rolloverUsed: 12, capSpace: 18.4 }, 250)
    expect(seg.active).toBe(225.6)
    expect(seg.dead).toBe(6)
    expect(seg.rollover).toBe(12)
    expect(seg.activePct + seg.deadPct + seg.rolloverPct).toBeLessThanOrEqual(100)
  })

  it('clamps salary to the league minimum', () => {
    expect(clampSalary(0, 1, 50)).toBe(1)
    expect(clampSalary(80, 1, 50)).toBe(50)
  })

  it('tags expiring, rookie and extension-eligible contracts', () => {
    const cfg = { extensionsEnabled: true, franchiseTagEnabled: true }
    const expiring = contractTags({ yearsRemaining: 0, source: 'auction', status: 'active', contractYear: 3, yearsTotal: 3 }, cfg, 2026)
    expect(expiring.map((t) => t.label)).toEqual(['Expiring · tag candidate', 'Extension eligible 2026'])
    const rookie = contractTags({ yearsRemaining: 2, source: 'rookie_draft', status: 'active', contractYear: 1, yearsTotal: 3 }, cfg, 2026)
    expect(rookie.map((t) => t.label)).toEqual(['Rookie deal'])
  })
})

describe('devy home view', () => {
  const players = [
    { id: 'p1', name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', classYear: 3, draftEligibleYear: 2027, draftProjectionScore: 92 },
    { id: 'p2', name: 'Arch Manning', position: 'QB', school: 'Texas', classYear: 3, draftEligibleYear: 2027, draftProjectionScore: 80 },
    { id: 'p3', name: 'Bryce Underwood', position: 'QB', school: 'Michigan', classYear: 2, draftEligibleYear: 2028, devyValue: 50 },
    { id: 'p4', name: 'Gone Player', position: 'RB', school: 'X', classYear: 4, draftEligibleYear: 2026 },
  ]
  const rights = [
    { id: 'r2', devyPlayerId: 'p2', state: 'NCAA_DEVY_ACTIVE' },
    { id: 'r1', devyPlayerId: 'p1', state: 'DECLARED' },
    { id: 'r3', devyPlayerId: 'p3', state: 'RETURNED_TO_SCHOOL' },
    { id: 'r4', devyPlayerId: 'p4', state: 'PROMOTED_TO_PRO' },
  ]

  it('keeps stash states only, declared first; returned-to-school stays', () => {
    const stash = buildDevyStash(rights, players)
    expect(stash.map((s) => s.name)).toEqual(['Jeremiah Smith', 'Arch Manning', 'Bryce Underwood'])
    expect(stash[0].declared).toBe(true)
    expect(devyYearTag(stash[0])).toBe('Declared')
    expect(devyYearTag(stash[2])).toBe('2028')
    expect(stash[0].classLabel).toBe('Jr')
  })

  it('counts the pipeline by draft year', () => {
    const stash = buildDevyStash(rights, players)
    expect(devyPipelineByYear(stash, 2026)).toEqual([
      { year: 2027, count: 2 },
      { year: 2028, count: 1 },
    ])
  })

  it('skips unknown feed event types', () => {
    const items = devyFeedItems(
      [
        { id: 'e1', eventType: 'declare_detected', devyPlayerId: 'p1', createdAt: '2026-10-01T00:00:00Z' },
        { id: 'e2', eventType: 'internal_debug', devyPlayerId: 'p1', createdAt: '2026-10-01T00:00:00Z' },
      ],
      (id) => (id === 'p1' ? 'Jeremiah Smith' : null),
    )
    expect(items.map((i) => i.title)).toEqual(['Jeremiah Smith declared for the draft'])
  })
})

describe('c2c home view', () => {
  const players = [
    { id: 'p1', name: 'Arch Manning', position: 'QB', school: 'Texas', draftEligibleYear: 2027 },
    { id: 'p2', name: 'Isaac Brown', position: 'RB', school: 'Louisville', draftEligibleYear: 2028 },
    { id: 'p3', name: 'Bench Guy', position: 'WR', school: 'Auburn', draftEligibleYear: 2029 },
  ]
  const rights = [
    { id: 'r2', devyPlayerId: 'p2', state: 'NCAA_DEVY_ACTIVE', c2cLineupRole: 'STARTER' },
    { id: 'r1', devyPlayerId: 'p1', state: 'DECLARED', c2cLineupRole: 'STARTER' },
    { id: 'r3', devyPlayerId: 'p3', state: 'NCAA_DEVY_ACTIVE', c2cLineupRole: null },
  ]

  it('lists campus starters only, QB first, with the latest week summed', () => {
    const scores = [
      { devyPlayerId: 'p1', season: 2026, week: 5, points: 10 },
      { devyPlayerId: 'p1', season: 2026, week: 6, points: 20 },
      { devyPlayerId: 'p1', season: 2026, week: 6, points: 4.6 },
      { devyPlayerId: 'p2', season: 2026, week: 6, points: 18.2 },
      { devyPlayerId: 'p2', season: 2025, week: 9, points: 99 },
    ]
    const lineup = buildCampusLineup(rights, players, scores, 2026)
    expect(lineup.starters.map((s) => s.name)).toEqual(['Arch Manning', 'Isaac Brown'])
    expect(lineup.starters[0].points).toBe(24.6)
    expect(lineup.latestWeek).toBe(6)
    expect(lineup.total).toBe(42.8)
  })

  it('computes the campus share and handles zero', () => {
    expect(campusShare(37, 63)).toBeCloseTo(0.37)
    expect(campusShare(0, 0)).toBeNull()
  })

  it('lists graduating rights, declared first', () => {
    const g = graduatingRights(rights, players, 2026)
    expect(g.map((x) => [x.name, x.status])).toEqual([['Arch Manning', 'Declared']])
  })
})
