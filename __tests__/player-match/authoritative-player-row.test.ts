/**
 * For a Sleeper id, the Sleeper row is authoritative; other sources may only fill its gaps,
 * and only when they describe the same man. Rows are the production rows measured 2026-10-11.
 */
import { describe, expect, it } from 'vitest'
import {
  authoritativeRowsBySleeperId,
  positionGroupsAgree,
  selectAuthoritativePlayerRow,
} from '@/lib/player-match/authoritativePlayerRow'

type Row = {
  externalId: string
  source: string
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  fetchedAt: Date
}
const at = (iso: string) => new Date(iso)

const MURPHY: Row[] = [
  { externalId: 'tsdb_34249738', source: 'thesportsdb', sleeperId: '5864', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', imageUrl: 'https://r2.thesportsdb.com/dt.png', fetchedAt: at('2026-10-11T08:42:36Z') },
  { externalId: 'sleeper:5864', source: 'sleeper', sleeperId: '5864', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/5864.jpg', fetchedAt: at('2026-10-10T12:06:58Z') },
]
const JENKINS: Row[] = [
  { externalId: 'tsdb_34201216', source: 'thesportsdb', sleeperId: '11304', name: 'Elgton Jenkins', position: 'G', team: 'Cleveland Browns', imageUrl: 'https://r2.thesportsdb.com/g.png', fetchedAt: at('2026-10-11T08:42:36Z') },
  { externalId: 'sleeper:11304', source: 'sleeper', sleeperId: '11304', name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles', imageUrl: null, fetchedAt: at('2026-10-10T18:07:45Z') },
  { externalId: '7601', source: 'rolling_insights', sleeperId: '11304', name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles', imageUrl: 'https://ri.example/ej.png', fetchedAt: at('2026-10-10T09:15:02Z') },
]

describe('selectAuthoritativePlayerRow', () => {
  it('keeps CB Byron Murphy (MIN) and ignores the newer Seahawks DT row carrying his Sleeper id', () => {
    const picked = selectAuthoritativePlayerRow(MURPHY)!
    expect(picked.base.externalId).toBe('sleeper:5864')
    expect(picked.row).toMatchObject({ position: 'CB', team: 'Minnesota Vikings', imageUrl: MURPHY[1]!.imageUrl })
    expect(picked.ignored.map((r) => r.externalId)).toEqual(['tsdb_34249738'])
  })

  it('ignores the Elgton Jenkins row entirely and fills a gap only from the agreeing E.J. Jenkins row', () => {
    const picked = selectAuthoritativePlayerRow(JENKINS)!
    expect(picked.base.externalId).toBe('sleeper:11304')
    expect(picked.row.name).toBe('E.J. Jenkins')
    // The Sleeper row has no image: the agreeing rolling_insights row may supply it, the
    // newer contradicting TheSportsDB guard's photo may not.
    expect(picked.row.imageUrl).toBe('https://ri.example/ej.png')
    expect(picked.ignored.map((r) => r.name)).toEqual(['Elgton Jenkins'])
  })

  it('rejects other measured namesakes: Ty Johnson / Tyler Johnson, P.J. Johnson / Jackson Powers-Johnson', () => {
    const ty = selectAuthoritativePlayerRow([
      { externalId: 'tsdb_34177329', source: 'thesportsdb', sleeperId: '6039', name: 'Tyler Johnson', position: 'WR', team: 'Dallas Cowboys', imageUrl: 'x', fetchedAt: at('2026-10-12T00:00:00Z') },
      { externalId: 'sleeper:6039', source: 'sleeper', sleeperId: '6039', name: 'Ty Johnson', position: 'RB', team: 'Buffalo Bills', imageUrl: null, fetchedAt: at('2026-10-11T06:14:15Z') },
    ])!
    expect(ty.row).toMatchObject({ name: 'Ty Johnson', position: 'RB', team: 'Buffalo Bills', imageUrl: null })
    const pj = selectAuthoritativePlayerRow([
      { externalId: 'tsdb_34249182', source: 'thesportsdb', sleeperId: '6273', name: 'Jackson Powers-Johnson', position: 'G', team: 'Las Vegas Raiders', imageUrl: 'x', fetchedAt: at('2026-10-11T08:42:36Z') },
      { externalId: 'sleeper:6273', source: 'sleeper', sleeperId: '6273', name: 'P.J. Johnson', position: 'DT', team: 'Las Vegas Raiders', imageUrl: null, fetchedAt: at('2026-10-10T18:07:45Z') },
    ])!
    expect(pj.row).toMatchObject({ name: 'P.J. Johnson', position: 'DT', imageUrl: null })
  })

  it('never fills a null Sleeper team: a free agent is not on his last club', () => {
    const picked = selectAuthoritativePlayerRow([
      { externalId: '720', source: 'rolling_insights', sleeperId: '720', name: 'Jason Pierre-Paul', position: 'LB', team: 'Tampa Bay Buccaneers', imageUrl: null, fetchedAt: at('2026-10-10T09:00:00Z') },
      { externalId: 'sleeper:720', source: 'sleeper', sleeperId: '720', name: 'Jason Pierre-Paul', position: 'LB', team: null, imageUrl: null, fetchedAt: at('2026-10-10T08:00:00Z') },
    ])!
    expect(picked.row.team).toBeNull()
    expect(picked.ignored).toEqual([])
  })

  it('without a Sleeper row keeps the old order: team and position, then position, then freshest', () => {
    const picked = selectAuthoritativePlayerRow([
      { externalId: 'a', source: 'thesportsdb', sleeperId: '1', name: 'X', position: null, team: null, imageUrl: null, fetchedAt: at('2026-10-11T00:00:00Z') },
      { externalId: 'b', source: 'rolling_insights', sleeperId: '1', name: 'X', position: 'WR', team: 'MIN', imageUrl: null, fetchedAt: at('2026-10-01T00:00:00Z') },
    ])!
    expect(picked.base.externalId).toBe('b')
  })

  it('groups by Sleeper id case-insensitively', () => {
    const map = authoritativeRowsBySleeperId([...MURPHY, ...JENKINS, { ...JENKINS[1]!, sleeperId: null }])
    expect([...map.keys()].sort()).toEqual(['11304', '5864'])
    expect(map.get('5864')!.position).toBe('CB')
    expect(map.get('11304')!.name).toBe('E.J. Jenkins')
  })
})

describe('positionGroupsAgree', () => {
  it('treats feed disagreement inside a group as agreement and across groups as contradiction', () => {
    expect(positionGroupsAgree('CB', 'DB')).toBe(true)
    expect(positionGroupsAgree('DE', 'OLB')).toBe(true)
    expect(positionGroupsAgree('DT', 'DL')).toBe(true)
    expect(positionGroupsAgree('CB', 'DT')).toBe(false)
    expect(positionGroupsAgree('TE', 'G')).toBe(false)
    expect(positionGroupsAgree('QB', 'G')).toBe(false)
    expect(positionGroupsAgree(null, 'QB')).toBe(false)
  })
})
