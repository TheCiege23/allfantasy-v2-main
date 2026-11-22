/**
 * Fixture for the dynasty My team harness (/e2e/dynasty-core/myteam). Every value is invented for the
 * screenshot. The lineup is the redraft harness's NFL roster with the league switched to dynasty, two
 * rookies on a taxi squad, and markers built by the REAL builder (lib/core-app/dynastyRosterMarkers.ts)
 * from fixture SportsPlayer-shaped rows — so the harness exercises the same matching (id AND name) and
 * tone rules the loader runs.
 */
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'
import { buildDynastyRosterMarkers, type MarkerRow } from '@/lib/core-app/dynastyRosterMarkers'
import { myTeamFixture } from '../../redraft-core/myteam/fixtures'

/** Ages by row order — rising, prime and past-peak players spread across the lineup. */
const AGES = [26, 24, 29, 22, 31, 27, 23, 25, 28, 30, 21, 24, 27, 33, 22, 26]

export function dynastyMyTeamFixture(opts: { markers: boolean }): MyTeamData {
  const base = myTeamFixture('NFL')
  const taxiPlayers: Array<LineupPlayer & { tenure: null }> = [0, 1].map((k) => {
    const src = base.bench.available ? base.bench.data[k] : null
    return { ...(src as LineupPlayer), sleeperId: `fx-NFL-taxi-${k}`, name: k === 0 ? 'Jalen Rookie' : 'Tre Prospect', position: k === 0 ? 'WR' : 'RB', tenure: null }
  })
  const all: LineupPlayer[] = [
    ...(base.starters.available ? base.starters.data.flatMap((s) => (s.player ? [s.player] : [])) : []),
    ...(base.bench.available ? base.bench.data : []),
    ...(base.ir.available ? base.ir.data : []),
    ...taxiPlayers,
  ]
  const rows: MarkerRow[] = all.map((p, i) => {
    const taxi = p.sleeperId.includes('taxi')
    return { sleeperId: p.sleeperId, name: p.name, position: p.position, age: taxi ? 21 : AGES[i % AGES.length], yearsExp: taxi || i === 6 ? 0 : 3 }
  })
  return {
    ...base,
    league: { ...base.league, id: 'e2e-dynasty-core-myteam', name: 'The Deep!', platform: 'sleeper', format: 'dynasty' },
    taxi: { available: true, data: taxiPlayers },
    dynasty: {
      picks: {
        available: true,
        coverage: 'complete',
        bySeason: [
          { season: 2027, picks: [{ season: 2027, round: 1, label: '1st', fromTeamName: null }, { season: 2027, round: 2, label: '2nd', fromTeamName: null }] },
          { season: 2028, picks: [{ season: 2028, round: 1, label: '1st', fromTeamName: 'Taco Tuesday' }] },
        ],
      },
      ages: { available: true, medianStarterAge: 25.5, known: 9, total: 9, aging: [], youngCore: 6 },
    },
    dynastyMarkers: opts.markers ? buildDynastyRosterMarkers(all, rows, 'NFL') : null,
  } as MyTeamData
}
