import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import type { DevyPlayerValue } from '@/lib/cfb-player-data'
import {
  searchDevyPlayersFromDb,
  getDevyTeamRosterFromDb,
  getDevyValuesForNamesFromDb,
  getDevyPassingProfileFromDb,
  getDevyPassingProfilesByNameFromDb,
  type DevyPassingProfile,
} from '@/lib/devy/devyPlayerReads'
import { prisma } from '@/lib/prisma'

export const GET = withApiUsage({ endpoint: "/api/legacy/cfb-players", tool: "LegacyCfbPlayers" })(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams?.get('action') || 'search'
  const query = searchParams?.get('q') || searchParams?.get('query')
  const team = searchParams?.get('team')
  const username = searchParams?.get('username')
  const year = searchParams?.get('year') ? parseInt(searchParams?.get('year')!) : undefined

  try {
    // Action: search - Search for CFB players by name
    if (action === 'search' && query) {
      const players = await searchDevyPlayersFromDb(query)
      return NextResponse.json({ players })
    }

    // Action: roster - Get full team roster with devy values
    if (action === 'roster' && team) {
      // `year` is accepted for backward compatibility but no longer selects a
      // roster season: the pool holds one current row per player, stamped with
      // `lastRosterYear` by the ingest. Honouring the parameter would mean
      // promising historical rosters we do not store.
      const roster = await getDevyTeamRosterFromDb(team)
      return NextResponse.json({ roster })
    }

    // Action: values - Get devy values for specific players
    if (action === 'values') {
      const playerNames = searchParams?.get('players')?.split(',') || []
      
      if (playerNames.length === 0) {
        return NextResponse.json({ error: 'No players specified' }, { status: 400 })
      }

      // Unresolved names come back null rather than as an invented value built
      // from a hardcoded 'JR' default, which was indistinguishable downstream
      // from a real one. They are reported separately so a caller can see which
      // names the pool does not cover.
      const resolved = await getDevyValuesForNamesFromDb(playerNames.map(n => n.trim()))
      return NextResponse.json({
        values: resolved.filter((v): v is DevyPlayerValue => v !== null),
        unresolved: playerNames.map(n => n.trim()).filter((_, i) => resolved[i] === null),
      })
    }

    /*
     * Action: passing — air yards, ADOT, YAC and the short/deep × left/middle/
     * right grid CFBD published 2026-08-30.
     *
     * ⚠ THE DENOMINATORS ARE PART OF THE PAYLOAD, NOT DEBUG DETAIL. CFBD's
     * air-yard and location coverage is partial — its own note says 2025 is thin
     * and even 2026 games can have gaps — so `adot` is an average over
     * `airYardsAttempts`, NOT over `attempts`, and the location grid describes
     * `locations.located` of `locations.attempts` throws. A client that renders
     * ADOT or a tendency chart without those counts is showing a 40-attempt
     * sample and a 400-attempt one as though they were the same measurement.
     * They are returned alongside every figure so that cannot happen silently.
     *
     * A player the phase has never written is returned in `unresolved` rather
     * than as a row of zeroes — absence is not a quarterback who threw
     * everything at the line of scrimmage.
     */
    if (action === 'passing') {
      const names = searchParams?.get('players')?.split(',').map((n) => n.trim()).filter(Boolean) ?? []

      if (names.length > 0) {
        const resolved = await Promise.all(names.map((n) => getDevyPassingProfileFromDb(n)))
        return NextResponse.json({
          passing: resolved.filter((p): p is DevyPassingProfile => p !== null),
          unresolved: names.filter((_, i) => resolved[i] === null),
        })
      }

      if (team) {
        const byName = await getDevyPassingProfilesByNameFromDb([team])
        return NextResponse.json({ passing: [...byName.values()] })
      }

      return NextResponse.json(
        { error: 'action=passing needs either players= or team=' },
        { status: 400 },
      )
    }

    // Action: fantrax-roster - Get Fantrax league roster with devy values
    if (action === 'fantrax-roster' && username) {
      // Get user's Fantrax leagues
      const fantraxUser = await prisma.fantraxUser.findFirst({
        where: { fantraxUsername: { equals: username, mode: 'insensitive' } },
        include: { leagues: true },
      })

      if (!fantraxUser || fantraxUser.leagues.length === 0) {
        return NextResponse.json({ 
          error: 'No Fantrax leagues found',
          roster: [],
        })
      }

      // Get the latest devy league
      const devyLeagues = fantraxUser.leagues.filter((l: { isDevy: boolean }) => l.isDevy)
      const league = devyLeagues.length > 0 ? devyLeagues[0] : fantraxUser.leagues[0]
      
      // Parse roster from league's roster field (Json?)
      const rosterJson = (league as any).roster
      const rosterData = (Array.isArray(rosterJson) ? rosterJson : []) as Array<{
        name: string
        position: string
        nflTeam: string
        year?: string
        fantasyPoints?: number
      }>

      // Get devy values for each player
      const enrichedRoster: Array<DevyPlayerValue & { fantasyPoints?: number }> = []

      // The 50-player cap was here because each player cost a live CFBD search
      // — up to 50 sequential vendor round-trips inside one GET. The whole
      // roster now resolves in a single indexed query, so the cap is gone and
      // the loop below is pure in-memory assembly.
      const poolValues = await getDevyValuesForNamesFromDb(rosterData.map(p => p.name))

      for (const [index, player] of rosterData.entries()) {
        const pooled = poolValues[index]

        if (pooled) {
          enrichedRoster.push({
            ...pooled,
            // Fantrax is authoritative for what the manager actually rosters;
            // the pool is authoritative for who the player is.
            position: pooled.position || player.position,
            fantasyPoints: player.fantasyPoints,
          })
        } else {
          // Use parsed Fantrax data as fallback
          const classYear = player.year || 'JR'
          const classYearNum = classYear === 'FR' ? 1 : classYear === 'SO' ? 2 : classYear === 'JR' ? 3 : 4
          
          enrichedRoster.push({
            name: player.name,
            team: player.nflTeam || 'Unknown',
            position: player.position,
            classYear,
            devyValue: calculateQuickDevyValue(player.position, classYearNum),
            projectedNFLValue: null,
            draftEligibleYear: new Date().getFullYear() + Math.max(0, 4 - classYearNum),
            projectedRound: null,
            trend: 'stable',
            notes: null,
            fantasyPoints: player.fantasyPoints,
          })
        }
      }

      return NextResponse.json({
        league: {
          name: league.leagueName,
          season: league.season,
          teamCount: league.teamCount,
          isDevy: league.isDevy,
        },
        roster: enrichedRoster,
      })
    }

    return NextResponse.json({ error: 'Invalid action or missing parameters' }, { status: 400 })

  } catch (error) {
    console.error('CFB players API error:', error)
    return NextResponse.json({ error: 'Failed to fetch CFB player data' }, { status: 500 })
  }
})

function calculateQuickDevyValue(position: string, classYear: number | null): number {
  const baseValues: Record<string, number> = {
    QB: 6000,
    RB: 4500,
    WR: 5000,
    TE: 3500,
    OL: 1500,
    DL: 1500,
    LB: 1500,
    DB: 1500,
    K: 500,
    P: 300,
  }

  let value = baseValues[position] || 2000

  // Class year multiplier
  const multipliers: Record<number, number> = { 1: 1.4, 2: 1.3, 3: 1.1, 4: 1.0, 5: 0.9 }
  value *= multipliers[classYear || 4] || 1.0

  return Math.round(value)
}

