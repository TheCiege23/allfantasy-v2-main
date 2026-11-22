/**
 * The league Team tab's save must send an IR row's REAL injury designation. The save route admits an
 * IR row by its status (`validateIrSectionAgainstLeague`, run by `persistRosterLineupWithEngine` for
 * every save, a commissioner's edit of another team included), and the tab sent `status: 'healthy'`
 * on every row — so any Team-tab save of a roster with a player on IR was refused, not just IR moves.
 * Driven through the real body builder, the save route's normalizer and a JSON round-trip.
 */
import { describe, expect, it } from 'vitest'
import { buildLineupSaveRoster, buildPlayerRow } from '@/app/league/[leagueId]/tabs/team-tab-roster-helpers'
import { buildPersistedRosterDataFromRosterState } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { validateIrSectionAgainstLeague } from '@/lib/roster-lineup-engine/rosterValidationService'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import type { DisplayPlayerMap } from '@/lib/player-data/adapters/redraftDisplayPlayers'

const league = {
  irAllowOut: true,
  irAllowCovid: false,
  irAllowSuspended: false,
  irAllowNA: false,
  irAllowDNR: false,
  irAllowDoubtful: false,
} as unknown as LineupValidationContext['league']

const PLAYERS: DisplayPlayerMap = {
  qb: { id: 'qb', name: 'QB', position: 'QB', team: 'KC', injuryStatus: null },
  hurt: { id: 'hurt', name: 'Hurt', position: 'RB', team: 'KC', injuryStatus: 'IR' },
  out: { id: 'out', name: 'Out', position: 'WR', team: 'KC', injuryStatus: 'Out' },
  fine: { id: 'fine', name: 'Fine', position: 'TE', team: 'KC', injuryStatus: null },
  sleeperOnly: { id: 'sleeperOnly', name: 'S', position: 'WR', team: 'KC' },
}
const lists = (ir: string[]) => ({ starters: ['qb'], bench: [], ir, taxi: [], devy: [] })
const store = (body: unknown, existing: unknown = {}) =>
  JSON.parse(JSON.stringify(buildPersistedRosterDataFromRosterState(body, existing)))
const issues = (pd: unknown) => validateIrSectionAgainstLeague(league, pd).map((i) => [i.code, i.playerId])

/** The Team tab's IR rows before this fix. */
const bodyBeforeFix = (ir: string[]) => ({
  ...buildLineupSaveRoster(lists(ir), PLAYERS),
  ir: ir.map((id) => buildPlayerRow(id, PLAYERS)),
})

describe('Team tab save: IR rows carry the real designation', () => {
  it('positive control: the old body is refused for a player who IS on IR', () => {
    expect(issues(store(bodyBeforeFix(['hurt'])))).toEqual([['ir_ineligible_status', 'hurt']])
  })

  it('an IR player is admitted, and so is OUT where the league allows it', () => {
    const pd = store(buildLineupSaveRoster(lists(['hurt', 'out']), PLAYERS))
    expect(pd.lineup_sections.ir.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual([['hurt', 'ir'], ['out', 'out']])
    expect(issues(pd)).toEqual([])
  })

  it('a healthy player on IR is still refused — the server rule is unchanged', () => {
    expect(issues(store(buildLineupSaveRoster(lists(['fine']), PLAYERS)))).toEqual([['ir_ineligible_status', 'fine']])
  })

  it('with no live designation, the status already stored on his row stands', () => {
    const stored = { lineup_sections: { starters: [{ id: 'qb' }], ir: [{ id: 'sleeperOnly', status: 'ir' }] } }
    const pd = store(buildLineupSaveRoster(lists(['sleeperOnly']), PLAYERS, stored), stored)
    expect(issues(pd)).toEqual([])
    expect(issues(store(bodyBeforeFix(['sleeperOnly']), stored))).toHaveLength(1)
  })

  it('only IR rows change: starters and bench still save as before', () => {
    const body = buildLineupSaveRoster({ ...lists(['hurt']), bench: ['out'] }, PLAYERS)
    expect(body.starters[0]).toMatchObject({ id: 'qb', status: 'healthy', slotIndex: 0 })
    expect(body.bench[0]).toMatchObject({ id: 'out', status: 'healthy' })
  })
})
