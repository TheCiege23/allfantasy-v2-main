import { describe, expect, it } from 'vitest'
import { parseFantraxTradeHistoryCsv } from '@/lib/league-import/fantrax/fantraxTradeHistoryCsv'
import { nflSeasonForTradeDate, planFantraxTradeHistoryImport, type FantraxIdentityRow, type FantraxLeagueTeamRef } from '@/lib/league-import/fantrax/fantraxTradeHistoryPlan'

/** Invented league: teams, managers and players are made up; the CSV shape is Fantrax's export. */
const TEAMS: FantraxLeagueTeamRef[] = [
  { externalId: '101', teamName: 'Harbor Owls', platformUserId: 'fantrax-user:owl' },
  { externalId: '202', teamName: 'Mesa Comets', platformUserId: 'fantrax-manager:mesa-comets' },
  { externalId: '303', teamName: 'Pine Bears', platformUserId: 'fantrax-manager:pine-bears' },
  { externalId: '404', teamName: 'Dune Foxes', platformUserId: null },
]
const IDS: FantraxIdentityRow[] = [
  { fantraxId: 'fx-qb1', canonicalName: 'Quarterback One', currentTeam: 'PHI', position: 'QB' },
  { fantraxId: 'fx-wr3', canonicalName: 'Receiver Three', currentTeam: 'WAS', position: 'WR' },
  // Two players share a name on different teams: the export's team decides.
  { fantraxId: 'fx-rb-lar', canonicalName: 'Back Five', currentTeam: 'LAR', position: 'RB' },
  { fantraxId: 'fx-rb-buf', canonicalName: 'Back Five', currentTeam: 'BUF', position: 'RB' },
]
const H = '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"'
const csv = (...rows: string[]) => {
  const r = parseFantraxTradeHistoryCsv([H, ...rows].join('\n'))
  if (!r.ok) throw new Error(r.error)
  return r.trades
}
const plan = (...rows: string[]) => planFantraxTradeHistoryImport({ trades: csv(...rows), teams: TEAMS, identities: IDS })

describe('planFantraxTradeHistoryImport', () => {
  it('two picks + budget for a superflex QB: players by Fantrax id, picks with their original owner, budget each way', () => {
    const p = plan(
      '"2027 Draft Pick, Round 1 (#3 Harbor Owls)","","","#3 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
      '"2028 Draft Pick, Round 4 (#5 Pine Bears)","","","#3 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
      '"Budget Amount: $5000.00","","","#3 Harbor Owls","#9 Mesa Comets","0","Mon Nov 16, 2026, 7:57PM","10"',
      // "SFX" is the roster slot, not a position: it must not refuse the QB.
      '"Quarterback One","PHI","SFX","#9 Mesa Comets","#3 Harbor Owls","0","Mon Nov 16, 2026, 7:57PM","10"',
    )
    expect(p.refused).toEqual([])
    expect(p.ready).toHaveLength(1)
    const f = p.ready[0]!.fact
    expect(f.rosterIds).toEqual(['101', '202'])
    expect(f.adds).toEqual({ 'fx-qb1': '101' })
    expect(f.drops).toEqual({ 'fx-qb1': '202' })
    expect(f.draftPicks).toEqual([
      { season: '2027', round: 1, rosterId: '101', previousOwnerId: '101', ownerId: '202' },
      { season: '2028', round: 4, rosterId: '303', previousOwnerId: '101', ownerId: '202' },
    ])
    expect(f.waiverBudget).toEqual([{ sender: '101', receiver: '202', amount: 5000 }])
    expect(f.season).toBe(2026)
    expect(f.week).toBe(10)
    expect(p.rosterIdToOwner.get('202')).toBe('fantrax-manager:mesa-comets')
  })

  it('a name shared by two players is settled by the export team, and refused when the team does not settle it', () => {
    const ok = plan(
      '"Back Five","LAR","RB","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
    )
    expect(ok.ready[0]!.fact.adds).toEqual({ 'fx-rb-lar': '202', 'fx-wr3': '101' })
    const noTeam = plan(
      '"Back Five","","RB","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
    )
    expect(noTeam.ready).toEqual([])
    expect(noTeam.refused[0]!.reasons).toEqual(['Back Five RB matches more than one player.'])
  })

  it('refuses the WHOLE trade when one player is unknown, a team is unknown, or a team has no manager', () => {
    const unknownPlayer = plan(
      '"Nobody Known","KC","WR","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
    )
    expect(unknownPlayer.ready).toEqual([])
    expect(unknownPlayer.refused[0]!.reasons[0]).toMatch(/Nobody Known KC WR could not be matched/)
    const wrongTeam = plan('"Receiver Three","DAL","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"')
    expect(wrongTeam.ready).toEqual([])
    expect(plan('"Receiver Three","WAS","WR","#9 Lake Herons","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons).toEqual(['No team in this league is named "#9 Lake Herons".'])
    expect(plan('"Receiver Three","WAS","WR","#9 Dune Foxes","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons).toEqual(['"#9 Dune Foxes" has no manager on file in this league.'])
  })

  it('a three-team trade is reported, not flattened', () => {
    const p = plan(
      '"Receiver Three","WAS","WR","#1 Harbor Owls","#2 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Quarterback One","PHI","QB","#2 Mesa Comets","#3 Pine Bears","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Back Five","LAR","RB","#3 Pine Bears","#1 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
    )
    expect(p.ready).toEqual([])
    expect(p.refused[0]!.reasons).toEqual(['Only two-team trades are imported.'])
  })

  it('two teams sharing a name are ambiguous', () => {
    const p = planFantraxTradeHistoryImport({
      trades: csv('"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"'),
      teams: [...TEAMS, { externalId: '505', teamName: 'harbor  owls', platformUserId: 'fantrax-manager:x' }],
      identities: IDS,
    })
    expect(p.refused[0]!.reasons).toEqual(['Two teams in this league are named "#3 Harbor Owls".'])
  })

  /*
   * 🛑 THE FIRST REAL LEAGUE (2026-11-18): its teams are NAMED "#27 Houston Oilers" — the "#N" is not a standings
   * number there. The reader stripped it, so an upload of five trades added none ("No team in this league is named
   * \"Houston Oilers\""). Invented names below; the shape is that league's.
   */
  it('a league whose team names include "#N" matches them exactly', () => {
    const p = planFantraxTradeHistoryImport({
      trades: csv(
        '"Receiver Three","WAS","WR","#9 Mesa Comets","#27 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
        '"2027 Draft Pick, Round 1 (#27 Harbor Owls)","","","#27 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
      ),
      teams: [
        { externalId: '101', teamName: '#27 Harbor Owls', platformUserId: 'fantrax-user:owl' },
        { externalId: '202', teamName: '#9 Mesa Comets', platformUserId: 'fantrax-manager:mesa-comets' },
      ],
      identities: IDS,
    })
    expect(p.refused).toEqual([])
    expect(p.ready[0]!.fact.rosterIds.sort()).toEqual(['101', '202'])
    expect(p.ready[0]!.fact.draftPicks[0]).toMatchObject({ rosterId: '101', previousOwnerId: '101', ownerId: '202' })
  })

  it('the exact name wins over a prefix-stripped one, so "#9 Owls" never lands on a team named "Owls"', () => {
    const p = planFantraxTradeHistoryImport({
      trades: csv('"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"'),
      teams: [
        { externalId: '101', teamName: '#3 Harbor Owls', platformUserId: 'fantrax-user:owl' },
        { externalId: '999', teamName: 'Harbor Owls', platformUserId: 'fantrax-user:other' },
        { externalId: '202', teamName: 'Mesa Comets', platformUserId: 'fantrax-manager:mesa-comets' },
      ],
      identities: IDS,
    })
    expect(p.refused).toEqual([])
    expect(p.ready[0]!.fact.rosterIds).toContain('101')
    expect(p.ready[0]!.fact.rosterIds).not.toContain('999')
  })

  it('no budget line is a read zero ([]), not "unknown"', () => {
    const p = plan(
      '"Receiver Three","WAS","WR","#9 Mesa Comets","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"',
      '"Quarterback One","PHI","QB","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"',
    )
    expect(p.ready[0]!.fact.waiverBudget).toEqual([])
  })
})

describe('nflSeasonForTradeDate', () => {
  it('January and February belong to the season before; the Eastern date decides', () => {
    expect(nflSeasonForTradeDate(new Date('2027-02-10T17:00:00Z'))).toBe(2026)
    expect(nflSeasonForTradeDate(new Date('2027-03-01T17:00:00Z'))).toBe(2027)
    expect(nflSeasonForTradeDate(new Date('2026-11-17T00:57:00Z'))).toBe(2026)
    // 1 March 03:00 UTC is still 28 February in New York.
    expect(nflSeasonForTradeDate(new Date('2027-03-01T03:00:00Z'))).toBe(2026)
  })
})

describe('the reasons read in Spanish on the Commissioner Hub', () => {
  it('every refusal the planner writes has a Spanish form, names kept as written', async () => {
    const { hubCopy } = await import('@/lib/core-app/commissionerHubCopy')
    const reasons = [
      ...plan('"Nobody Known","KC","WR","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons,
      ...plan('"Back Five","","RB","#3 Harbor Owls","#9 Mesa Comets","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons,
      ...plan('"Receiver Three","WAS","WR","#9 Lake Herons","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons,
      ...plan('"Receiver Three","WAS","WR","#9 Dune Foxes","#3 Harbor Owls","0","Sun Oct 4, 2026, 1:00PM","5"').refused[0]!.reasons,
      'Only two-team trades are imported.',
    ]
    for (const r of reasons) expect(hubCopy(r, 'es'), r).not.toBe(r)
    expect(hubCopy('No team in this league is named "Lake Herons".', 'es')).toBe('Ningún equipo de esta liga se llama "Lake Herons".')
    expect(hubCopy('3 trades added.', 'es')).toBe('Se agregaron 3 intercambios.')
  })
})
