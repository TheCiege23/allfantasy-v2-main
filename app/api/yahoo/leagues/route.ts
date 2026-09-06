import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import {
  getYahooIdentityForUser,
  linkYahooIdentity,
  loadYahooCredential,
  refreshYahooCredential,
  YahooImportConnectionError,
  type YahooCredentialContext,
} from '@/lib/yahoo/yahooCredentialStore'

const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET

/**
 * 🛑 THIS ROUTE USED TO READ A DIFFERENT STORE FROM EVERY OTHER YAHOO READER.
 *
 * It resolved the connection from a `yahoo_user_id` cookie, looked the row up in
 * `YahooConnection`, and took the access token off that row. Three things were
 * wrong with that and they compounded:
 *
 *   1. The token is not there. `YahooConnection` was demoted to an identity
 *      record by the 2026-09-04 migration — its token columns are nullable and
 *      the credential lives in `league_auths`, which is what the import path,
 *      `league-sync-core` and the `/import` connected-check all read.
 *   2. The cookie is not a store. 30-day maxAge, one browser, gone in a private
 *      window — and when it went, a perfectly good connection was unreachable.
 *   3. Its refresh wrote the new token back to `YahooConnection` too, so even a
 *      successful refresh deepened the split.
 *
 * Everything now goes through `lib/yahoo/yahooCredentialStore.ts`. The session
 * says who is asking; `league_auths` holds the credential; `YahooConnection`
 * says which Yahoo account is theirs and gives `YahooLeague` its FK target.
 */

const YAHOO_LEAGUES_URL =
  'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nba/leagues?format=json' // db-first-exception: user-delegated OAuth import, requires live accessToken
const YAHOO_LOGGED_IN_USER_URL =
  'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json' // db-first-exception: user-delegated OAuth import, requires live accessToken

/**
 * GET with one refresh-and-retry on a 401.
 *
 * ⚠ REFRESH ON THE VENDOR'S ANSWER, NOT ON A CLOCK. The previous form compared
 * `tokenExpiresAt` and skipped the refresh when it looked current — which is
 * wrong in both directions: a token Yahoo revoked early still looks valid, and a
 * null expiry (the normal state now that the column is vestigial) compares
 * FALSE against `new Date() >=` and skipped the refresh precisely when it was
 * most needed. A 401 is Yahoo telling us directly, and it cannot be stale.
 */
async function yahooGet(url: string, context: YahooCredentialContext): Promise<Response> {
  const send = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  let response = await send(context.accessToken)
  if (response.status === 401 && context.refreshToken) {
    const refreshed = await refreshYahooCredential(context)
    response = await send(refreshed)
  }
  return response
}

/**
 * The caller's Yahoo credential plus the identity row `YahooLeague` hangs from.
 *
 * ⚠ IT SELF-HEALS A MISSING IDENTITY ROW, WHICH IS NOT A CONVENIENCE. Every user
 * who connected Yahoo through `/api/league/yahoo/callback` has a `league_auths`
 * row and NO `YahooConnection` row, because that callback only ever wrote the
 * credential. Returning "connection not found" to them would report a working,
 * fully-authorised Yahoo account as disconnected. The guid is one cheap call
 * away and the token in hand is proof of ownership, so we fetch it and link.
 */
async function resolveYahooAccess(userId: string): Promise<{
  context: YahooCredentialContext
  connection: { id: string; yahooUserId: string; displayName: string | null } | null
}> {
  const context = await loadYahooCredential(userId)

  let connection = await getYahooIdentityForUser(userId)
  if (connection) return { context, connection }

  const userResponse = await yahooGet(YAHOO_LOGGED_IN_USER_URL, context)
  if (userResponse.ok) {
    const userData = await userResponse.json()
    const user = userData?.fantasy_content?.users?.[0]?.user?.[0]
    const yahooUserId = user?.guid
    if (yahooUserId) {
      await linkYahooIdentity({
        userId,
        yahooUserId,
        displayName: user?.profile?.display_name || user?.name || null,
      })
      connection = await getYahooIdentityForUser(userId)
    }
  }

  return { context, connection }
}

/**
 * One shape for "Yahoo is not connected", so the two handlers cannot drift on it.
 * 401 rather than 404: the account is fine, the authorisation is missing.
 */
function notConnected(error: unknown): NextResponse | null {
  if (error instanceof YahooImportConnectionError) {
    return NextResponse.json({ error: error.message, connected: false }, { status: 401 })
  }
  return null
}

export const GET = withApiUsage({ endpoint: "/api/yahoo/leagues", tool: "YahooLeagues" })(async (_request: NextRequest) => {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    console.error("[YahooLeagues] Missing YAHOO_CLIENT_ID or YAHOO_CLIENT_SECRET")
    return NextResponse.json({ error: "Yahoo integration is not configured" }, { status: 500 })
  }

  try {
    const { context, connection } = await resolveYahooAccess(auth.userId)

    const leaguesResponse = await yahooGet(YAHOO_LEAGUES_URL, context)

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

            /*
             * ⚠ PERSISTENCE IS SKIPPED, NOT FAKED, WITHOUT AN IDENTITY ROW.
             * `YahooLeague.connectionId` is a required FK. If the identity link
             * above could not be established the list is still correct and still
             * returned — the caller renders it either way — so failing the whole
             * request over a cache write would be trading the user's answer for
             * our bookkeeping.
             */
            if (connection) {
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
    }

    return NextResponse.json({
      connected: true,
      yahooUserId: connection?.yahooUserId ?? null,
      displayName: connection?.displayName ?? null,
      leagues,
    })
  } catch (error: any) {
    const disconnected = notConnected(error)
    if (disconnected) return disconnected
    console.error('Yahoo leagues error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch leagues' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/yahoo/leagues", tool: "YahooLeagues" })(async (request: NextRequest) => {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  if (!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET) {
    console.error("[YahooLeagues] Missing YAHOO_CLIENT_ID or YAHOO_CLIENT_SECRET")
    return NextResponse.json({ error: "Yahoo integration is not configured" }, { status: 500 })
  }

  try {
    const { leagueKey } = await request.json()

    if (!leagueKey) {
      return NextResponse.json({ error: 'League key required' }, { status: 400 })
    }

    const { context } = await resolveYahooAccess(auth.userId)

    const teamsResponse = await yahooGet(
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueKey}/teams?format=json`, // db-first-exception: user-delegated OAuth import, requires live accessToken
      context,
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
    const disconnected = notConnected(error)
    if (disconnected) return disconnected
    console.error('Yahoo teams error:', error)
    return NextResponse.json({ error: error.message || 'Failed to fetch teams' }, { status: 500 })
  }
})
