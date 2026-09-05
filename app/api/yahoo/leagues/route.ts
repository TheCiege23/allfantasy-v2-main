import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { decrypt, encrypt } from '@/lib/league-auth-crypto'

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET

function decryptTokenOrRaw(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return decrypt(value)
  } catch {
    // Backward compatibility for previously stored plaintext tokens.
    return value
  }
}

async function refreshAccessToken(connection: any) {
  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    throw new Error("Yahoo integration is not configured")
  }

  const refreshToken = decryptTokenOrRaw(connection.refreshToken)
  if (!refreshToken) {
    throw new Error('Yahoo refresh token unavailable; please reconnect your Yahoo account')
  }

  const response = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  
  if (!response.ok) {
    throw new Error('Failed to refresh Yahoo token')
  }
  
  const tokens = await response.json()
  const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000)
  
  await prisma.yahooConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : connection.refreshToken,
      tokenExpiresAt,
    },
  })
  
  return tokens.access_token
}

export const GET = withApiUsage({ endpoint: "/api/yahoo/leagues", tool: "YahooLeagues" })(async (request: NextRequest) => {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  const requesterUserId = auth.userId
  const yahooUserId = request.cookies.get('yahoo_user_id')?.value
  const ownerUserId = request.cookies.get('yahoo_owner_user_id')?.value

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    console.error("[YahooLeagues] Missing YAHOO_CLIENT_ID or YAHOO_CLIENT_SECRET")
    return NextResponse.json({ error: "Yahoo integration is not configured" }, { status: 500 })
  }
  if (!yahooUserId) {
    return NextResponse.json({ error: 'Not connected to Yahoo' }, { status: 401 })
  }
  if (!ownerUserId || ownerUserId !== requesterUserId) {
    return NextResponse.json({ error: 'Yahoo connection belongs to a different account' }, { status: 403 })
  }
  
  try {
    let connection = await prisma.yahooConnection.findUnique({
      where: { yahooUserId },
      include: { leagues: { include: { teams: true } } },
    })
    
    if (!connection) {
      return NextResponse.json({ error: 'Yahoo connection not found' }, { status: 404 })
    }
    
    let accessToken = decryptTokenOrRaw(connection.accessToken)
    /*
     * ⚠ A NULL EXPIRY MEANS REFRESH, NOT "NOT YET EXPIRED". These three columns are
     * nullable in production — YahooConnection was demoted to an identity record — and
     * `new Date() >= null` is FALSE, so the previous form skipped the refresh and used a
     * stale token instead. Absent is the one state that most needs a refresh.
     */
    if (!connection.tokenExpiresAt || new Date() >= connection.tokenExpiresAt) {
      accessToken = await refreshAccessToken(connection)
    }
    
    const leaguesResponse = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nba/leagues?format=json', // db-first-exception: user-delegated OAuth import, requires live accessToken
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    )
    
    if (!leaguesResponse.ok) {
      const errorText = await leaguesResponse.text()
      console.error('Yahoo leagues fetch error:', errorText)
      return NextResponse.json({ error: 'Failed to fetch Yahoo leagues' }, { status: 500 })
    }
    
    const leaguesData = await leaguesResponse.json()
    const games = leaguesData?.fantasy_content?.users?.[0]?.user?.[1]?.games
    
    const leagues: any[] = []
    
    if (games) {
      for (const gameKey of Object.keys(games)) {
        if (gameKey === 'count') continue
        const game = games[gameKey]?.game
        if (!game) continue
        
        const gameInfo = game[0]
        const gameLeagues = game[1]?.leagues
        
        if (gameLeagues) {
          for (const leagueKey of Object.keys(gameLeagues)) {
            if (leagueKey === 'count') continue
            const leagueData = gameLeagues[leagueKey]?.league?.[0]
            if (!leagueData) continue
            
            const league = {
              yahooLeagueKey: leagueData.league_key,
              name: leagueData.name,
              sport: gameInfo?.code?.toUpperCase() || 'NFL',
              season: leagueData.season || gameInfo?.season,
              numTeams: parseInt(leagueData.num_teams) || null,
              leagueType: leagueData.league_type,
              draftStatus: leagueData.draft_status,
              currentWeek: parseInt(leagueData.current_week) || null,
              startWeek: parseInt(leagueData.start_week) || null,
              endWeek: parseInt(leagueData.end_week) || null,
              isFinished: leagueData.is_finished === '1',
              rawData: leagueData,
            }
            
            leagues.push(league)
            
            await prisma.yahooLeague.upsert({
              where: { yahooLeagueKey: league.yahooLeagueKey },
              update: {
                ...league,
                connectionId: connection.id,
              },
              create: {
                ...league,
                connectionId: connection.id,
              },
            })
          }
        }
      }
    }
    
    return NextResponse.json({
      connected: true,
      yahooUserId: connection.yahooUserId,
      displayName: connection.displayName,
      leagues,
    })
  } catch (error: any) {
    console.error('Yahoo leagues error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch leagues' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/yahoo/leagues", tool: "YahooLeagues" })(async (request: NextRequest) => {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  const requesterUserId = auth.userId
  const yahooUserId = request.cookies.get('yahoo_user_id')?.value
  const ownerUserId = request.cookies.get('yahoo_owner_user_id')?.value

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    console.error("[YahooLeagues] Missing YAHOO_CLIENT_ID or YAHOO_CLIENT_SECRET")
    return NextResponse.json({ error: "Yahoo integration is not configured" }, { status: 500 })
  }
  if (!yahooUserId) {
    return NextResponse.json({ error: 'Not connected to Yahoo' }, { status: 401 })
  }
  if (!ownerUserId || ownerUserId !== requesterUserId) {
    return NextResponse.json({ error: 'Yahoo connection belongs to a different account' }, { status: 403 })
  }
  
  try {
    const { leagueKey } = await request.json()
    
    if (!leagueKey) {
      return NextResponse.json({ error: 'League key required' }, { status: 400 })
    }
    
    let connection = await prisma.yahooConnection.findUnique({
      where: { yahooUserId },
    })
    
    if (!connection) {
      return NextResponse.json({ error: 'Yahoo connection not found' }, { status: 404 })
    }
    
    let accessToken = decryptTokenOrRaw(connection.accessToken)
    /*
     * ⚠ A NULL EXPIRY MEANS REFRESH, NOT "NOT YET EXPIRED". These three columns are
     * nullable in production — YahooConnection was demoted to an identity record — and
     * `new Date() >= null` is FALSE, so the previous form skipped the refresh and used a
     * stale token instead. Absent is the one state that most needs a refresh.
     */
    if (!connection.tokenExpiresAt || new Date() >= connection.tokenExpiresAt) {
      accessToken = await refreshAccessToken(connection)
    }
    
    const teamsResponse = await fetch(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/teams?format=json`, // db-first-exception: user-delegated OAuth import, requires live accessToken
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    )
    
    if (!teamsResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 })
    }
    
    const teamsData = await teamsResponse.json()
    const teamsObj = teamsData?.fantasy_content?.league?.[1]?.teams
    
    const league = await prisma.yahooLeague.findUnique({
      where: { yahooLeagueKey: leagueKey },
    })
    
    if (!league) {
      return NextResponse.json({ error: 'League not found in database' }, { status: 404 })
    }
    
    const teams: any[] = []
    
    if (teamsObj) {
      for (const teamKey of Object.keys(teamsObj)) {
        if (teamKey === 'count') continue
        const teamData = teamsObj[teamKey]?.team?.[0]
        if (!teamData) continue
        
        const teamInfo: Record<string, any> = {}
        for (const item of teamData) {
          if (typeof item === 'object' && !Array.isArray(item)) {
            Object.assign(teamInfo, item)
          }
        }
        
        const team = {
          yahooTeamKey: teamInfo.team_key,
          name: teamInfo.name,
          managerName: teamInfo.managers?.[0]?.manager?.nickname || null,
          logoUrl: teamInfo.team_logos?.[0]?.team_logo?.url || null,
          waiverPriority: parseInt(teamInfo.waiver_priority) || null,
          faabBalance: parseInt(teamInfo.faab_balance) || null,
          isUserTeam: teamInfo.is_owned_by_current_login === '1',
          rawData: teamInfo,
        }
        
        teams.push(team)
        
        await prisma.yahooTeam.upsert({
          where: { yahooTeamKey: team.yahooTeamKey },
          update: {
            ...team,
            leagueId: league.id,
          },
          create: {
            ...team,
            leagueId: league.id,
          },
        })
      }
    }
    
    return NextResponse.json({ teams })
  } catch (error: any) {
    console.error('Yahoo teams error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch teams' }, { status: 500 })
  }
})
