import { describe, expect, it } from 'vitest'
import { selectFantraxSportMap } from '@/lib/league-import/fantrax/fantraxSportSelection'
import type { FantraxPlayerRef, FantraxTeamRoster } from '@/lib/league-import/fantrax/fantraxApi'

const rosters = { one: { teamName: 'Team One', rosterItems: [
  { id: 'nba-a', position: 'PG', status: 'ACTIVE' },
  { id: 'nba-b', position: 'SG', status: 'RESERVE' },
] } } as unknown as Record<string, FantraxTeamRoster>
const ref = (id: string): FantraxPlayerRef => ({ fantraxId: id, name: `Player ${id}`, team: 'BOS', position: 'PG' })

describe('Fantrax player-directory sport selection', () => {
  it('selects NBA only when its directory uniquely names the roster', () => {
    expect(selectFantraxSportMap(rosters, {
      CFB: {}, NFL: { 'nba-a': ref('nba-a') },
      NBA: { 'nba-a': ref('nba-a'), 'nba-b': ref('nba-b') },
    })).toMatchObject({ sport: 'nba', isDevy: false, named: 2 })
  })

  it('refuses a tie or a roster with no named players', () => {
    expect(selectFantraxSportMap(rosters, {
      NFL: { 'nba-a': ref('nba-a') }, NBA: { 'nba-a': ref('nba-a') },
    })).toBeNull()
    expect(selectFantraxSportMap(rosters, { CFB: {}, NBA: {} })).toBeNull()
  })
})
