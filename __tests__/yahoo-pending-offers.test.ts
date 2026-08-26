/**
 * The second platform the inbox can actually read.
 *
 * Sleeper was first because its offers are public. Yahoo needed the connection
 * the import flow already holds — and it turned up a defect on the way: every
 * trade this importer has ever read arrived with `adds` and `drops` EMPTY.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { splitYahooTradeForTeam } from '@/lib/provider-trades/scanPendingYahooTrades'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const FETCH = read('lib/league-import/yahoo/YahooLeagueFetchService.ts')
const SCAN = read('lib/provider-trades/scanPendingYahooTrades.ts')
const ROUTE = read('app/api/league/trades-panel/route.ts')
const SLEEPER = read('lib/provider-trades/scanPendingSleeperTrades.ts')

const MINE = 'nfl.l.123.t.4'
const THEIRS = 'nfl.l.123.t.7'

describe('⚠ a Yahoo trade moved nobody until this change', () => {
  it('records a leg keyed on the team pair, not on the type string', () => {
    /*
     * The importer's two existing rules match Yahoo's waiver vocabulary —
     * `add`, `drop`, `add/drop`. A trade leg carries `type: "trade"`, which
     * contains neither, so both team keys were recorded and WHICH PLAYER WENT
     * WHICH WAY was dropped on the floor.
     */
    expect(FETCH).toContain('A TRADE MOVED NOBODY UNTIL THIS LINE')
    expect(FETCH).toContain('if (playerId && sourceTeamKey && destinationTeamKey) {')
  })

  it('cannot swallow a waiver add or drop, which have only one side', () => {
    // A waiver add has no source team and a drop has no destination, so neither
    // reaches the trade branch and the original rules stay authoritative.
    expect(FETCH).toContain("actionType.includes('add')")
    expect(FETCH).toContain("actionType === 'drop'")
  })
})

describe('⚠ reading the maps backwards reverses every offer on screen', () => {
  const trade = {
    adds: { 'p.100': MINE, 'p.200': THEIRS },
    drops: { 'p.100': THEIRS, 'p.200': MINE },
  }

  it('arrives what this team is added, leaves what it drops', () => {
    const out = splitYahooTradeForTeam({ trade, teamKey: MINE })
    expect(out.assetsReceived.map((a) => a.playerId)).toEqual(['p.100'])
    expect(out.assetsGiven.map((a) => a.playerId)).toEqual(['p.200'])
  })

  it('mirrors exactly for the other team in the same trade', () => {
    const out = splitYahooTradeForTeam({ trade, teamKey: THEIRS })
    expect(out.assetsReceived.map((a) => a.playerId)).toEqual(['p.200'])
    expect(out.assetsGiven.map((a) => a.playerId)).toEqual(['p.100'])
  })

  it('gives an uninvolved team nothing', () => {
    const out = splitYahooTradeForTeam({ trade, teamKey: 'nfl.l.123.t.9' })
    expect(out.assetsGiven).toEqual([])
    expect(out.assetsReceived).toEqual([])
  })

  it('names a player when we hold one, and shows the id when we do not', () => {
    // The raw key is a poor label and a true one; a blank is neither.
    const named = splitYahooTradeForTeam({
      trade: { adds: { 'p.100': MINE }, drops: {} },
      teamKey: MINE,
      nameOf: (id) => (id === 'p.100' ? { name: 'Puka Nacua', position: 'WR', team: 'LAR' } : null),
    })
    expect(named.assetsReceived[0]!.playerName).toBe('Puka Nacua')

    const unnamed = splitYahooTradeForTeam({
      trade: { adds: { 'p.999': MINE }, drops: {} },
      teamKey: MINE,
    })
    expect(unnamed.assetsReceived[0]!.playerName).toBe('p.999')
  })

  it('survives a trade with no movement recorded at all', () => {
    const out = splitYahooTradeForTeam({ trade: { adds: {}, drops: {} }, teamKey: MINE })
    expect(out.assetsGiven).toEqual([])
    expect(out.assetsReceived).toEqual([])
  })
})

describe('⚠ what the Yahoo scan refuses to claim', () => {
  it('does not guess a direction Yahoo never sent', () => {
    /*
     * The payload names no proposer. Guessing would render a manager's own
     * outgoing offer as incoming, with given and received reversed relative to
     * how they built it — a wrong answer that looks like a right one.
     */
    expect(SCAN).toContain('YAHOO DOES NOT NAME A PROPOSER IN THIS PAYLOAD')
    expect(SCAN).toContain('proposedByViewer: false')
  })

  it('keeps its refusals apart, the way the Sleeper scan does', () => {
    expect(SCAN).toContain('this league has no Yahoo league key on file')
    expect(SCAN).toContain('claim your team in this league')
    expect(FETCH).toContain('connect your Yahoo account in League Sync')
    expect(FETCH).toContain('Yahoo did not answer for this league')
  })

  it('is read-only, and says why that is a different reason from Sleeper', () => {
    // Sleeper has no write endpoint at all; Yahoo has one and we hold read
    // scopes only. Either way the honest control is a link out.
    expect(SCAN).toContain('READ-ONLY, LIKE SLEEPER, FOR A DIFFERENT REASON')
  })

  it('drops an offer it could not attribute to either side', () => {
    expect(SCAN).toContain('if (assetsGiven.length === 0 && assetsReceived.length === 0) continue')
  })
})

describe('⚠ platformLeagueId is not guaranteed to be a league key', () => {
  it('resolves whatever shape it was stored in, the way the import path does', () => {
    /*
     * The importer accepts a bare id, a full key, or a pasted URL. A league
     * stored as `1361311` would have built `/league/1361311/transactions`,
     * which Yahoo rejects — and the catch would have reported "Yahoo did not
     * answer", blaming the provider for our own malformed request.
     */
    expect(FETCH).toContain('IS NOT GUARANTEED TO BE A LEAGUE KEY')
    expect(FETCH).toContain('const resolved = await resolveYahooLeagueLookup(leagueKey, context)')
    expect(FETCH).toContain('/league/${resolved.leagueKey}/transactions')
  })
})

describe('⚠ a Yahoo offer must not be labelled Sleeper', () => {
  it('widened the provider tag rather than reusing the wrong one', () => {
    // A Yahoo offer tagged 'sleeper' sends the manager to the wrong site to
    // answer it, which is worse than not showing it.
    expect(SLEEPER).toContain("provider: 'sleeper' | 'yahoo'")
    expect(SCAN).toContain("provider: 'yahoo'")
  })

  it('links out to Yahoo, not to Sleeper', () => {
    expect(ROUTE).toContain('football.fantasysports.yahoo.com')
  })

  it('still names the platforms it cannot read', () => {
    expect(ROUTE).toContain('Sleeper and Yahoo are the two we can')
  })
})
