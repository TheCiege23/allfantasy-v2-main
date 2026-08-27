import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import {
  getImportProviderLabel,
  supportsImportProviderDiscovery,
} from '@/lib/league-import/provider-ui-config'
import {
  getFantraxLeagueInfo,
  parseFantraxLeagueId,
} from '@/lib/league-import/fantrax/fantraxApi'
import { lookupSleeperUser } from '@/lib/sleeper/user-lookup'
import { getUserLeagues } from '@/lib/sleeper-client'
import {
  listYahooLeaguesForAccount,
  YahooApiResponseError,
  YahooImportConnectionError,
} from '@/lib/league-import/yahoo/YahooLeagueFetchService'

function normalizeSeason(raw: unknown): string {
  const currentSeason = String(new Date().getFullYear())
  if (typeof raw !== 'string') return currentSeason
  const trimmed = raw.trim()
  return trimmed || currentSeason
}

function normalizeSport(raw: unknown): string {
  if (typeof raw !== 'string') return 'nfl'
  const trimmed = raw.trim().toLowerCase()
  return trimmed || 'nfl'
}

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  let body: {
    provider?: string
    accountIdentifier?: string
    season?: string
    sport?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const provider = resolveProvider(body.provider ?? '')
  const accountIdentifier =
    typeof body.accountIdentifier === 'string' ? body.accountIdentifier.trim() : ''
  const season = normalizeSeason(body.season)
  const sport = normalizeSport(body.sport)

  if (!provider) {
    return NextResponse.json({ error: 'Unsupported import provider' }, { status: 400 })
  }

  if (!supportsImportProviderDiscovery(provider)) {
    return NextResponse.json(
      {
        error: `${getImportProviderLabel(provider)} account discovery is not available yet.`,
      },
      { status: 400 },
    )
  }

  // ── Yahoo: discovery reads the CONNECTED Yahoo account (OAuth use_login=1).
  // No accountIdentifier is needed or used — Yahoo scopes the list to the
  // logged-in session, so we never enumerate someone else's account.
  if (provider === 'yahoo') {
    try {
      const leagues = await listYahooLeaguesForAccount(auth.userId)
      const filtered = leagues
        .filter(
          (league) => !league.sport || league.sport.toLowerCase() === sport,
        )
        .sort((a, b) => (b.season ?? 0) - (a.season ?? 0))
      return NextResponse.json({
        provider,
        sport,
        season: null,
        account: {
          providerUserId: null,
          accountIdentifier: 'connected-yahoo-account',
          displayName: 'Your connected Yahoo account',
        },
        leagues: filtered.map((league) => ({
          sourceId: league.leagueKey,
          name: league.name ?? league.leagueKey,
          sport: league.sport ? league.sport.toLowerCase() : null,
          season: league.season != null ? String(league.season) : null,
          totalTeams: league.numTeams,
        })),
      })
    } catch (error) {
      if (error instanceof YahooImportConnectionError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof YahooApiResponseError) {
        return NextResponse.json(
          {
            error:
              'Yahoo rejected the league list request. Reconnect Yahoo in League Sync and try again.',
          },
          { status: 502 },
        )
      }
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to discover Yahoo leagues.',
        },
        { status: 500 },
      )
    }
  }

  /*
   * ── Fantrax: the identifier is a LEAGUE, and what comes back is its TEAMS.
   *
   * ⚠ THIS IS THE ONE PROVIDER WHERE DISCOVERY DOES NOT LIST LEAGUES, and the
   * shape is deliberate. Listing someone's Fantrax leagues needs their Secret
   * ID, which is a credential we will not ask for in an import box. A league id
   * is not a credential — it is in the URL of the league page — so the flow
   * inverts: you name the league, and we ask which team is yours.
   *
   * ⚠ AND THE TEAM QUESTION IS NOT OPTIONAL. Fantrax's API will not say which
   * team belongs to the caller, and `importFantraxLeague` refuses to guess:
   * defaulting to the first roster attributes a stranger's players to them and
   * then grades trades against those players.
   */
  if (provider === 'fantrax') {
    const leagueId = parseFantraxLeagueId(accountIdentifier)
    if (!leagueId) {
      return NextResponse.json(
        {
          error:
            'Paste your Fantrax league ID, or the address of the league page. The ID is the code in the URL, like fantrax.com/fantasy/league/THIS-PART/home.',
        },
        { status: 400 },
      )
    }

    const info = await getFantraxLeagueInfo(leagueId)
    if (!info.ok) {
      /* Fantrax answers 200 with an error body, so `ok` is the only signal; a
         bad id reads as not-found rather than as a server fault. */
      return NextResponse.json(
        { error: info.failure.message },
        { status: info.failure.kind === 'not_found' ? 404 : 502 },
      )
    }

    const teams = Object.values(info.data.teamInfo ?? {})
    if (teams.length === 0) {
      return NextResponse.json(
        { error: 'Fantrax returned no teams for that league, so there is nothing to import yet.' },
        { status: 502 },
      )
    }

    const season = info.data.seasonYear != null ? String(info.data.seasonYear) : null
    return NextResponse.json({
      provider,
      sport: null,
      season,
      accountLabel: info.data.leagueName,
      account: {
        providerUserId: null,
        accountIdentifier: leagueId,
        displayName: info.data.leagueName,
      },
      /*
       * The team name round-trips in the sourceId because preview and commit are
       * stateless — `fantrax-league:<leagueId>|<teamName>` is the only place the
       * choice is carried, and FantraxLeagueFetchService parses it back out.
       */
      leagues: teams.map((team) => ({
        sourceId: `fantrax-league:${leagueId}|${team.name}`,
        name: team.name,
        sport: null,
        season,
        totalTeams: teams.length,
      })),
    })
  }

  // ── Sleeper self-discovery: with no identifier, use the caller's own linked
  // Sleeper account — this is what lets the import page show "your leagues"
  // (and the Import All button) without typing anything.
  if (!accountIdentifier && provider === 'sleeper') {
    const profile = await prisma.userProfile
      .findUnique({ where: { userId: auth.userId }, select: { sleeperUserId: true, sleeperUsername: true } })
      .catch(() => null)
    if (!profile?.sleeperUserId) {
      return NextResponse.json(
        { error: 'accountIdentifier is required (no linked Sleeper account on your profile)' },
        { status: 400 },
      )
    }
    try {
      const leagues = await getUserLeagues(profile.sleeperUserId, sport, season)
      return NextResponse.json({
        provider,
        sport,
        season,
        account: {
          providerUserId: profile.sleeperUserId,
          accountIdentifier: profile.sleeperUsername ?? profile.sleeperUserId,
          displayName: profile.sleeperUsername ?? 'Your Sleeper account',
        },
        leagues: leagues.map((league) => ({
          sourceId: league.league_id,
          name: league.name,
          sport: league.sport,
          season: league.season,
          status: league.status,
          totalTeams: league.total_rosters,
          isDynasty: league.settings?.type === 2,
          avatarUrl: league.avatar
            ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}`
            : null,
        })),
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to discover your Sleeper leagues.' },
        { status: 500 },
      )
    }
  }

  if (!accountIdentifier) {
    return NextResponse.json(
      { error: 'accountIdentifier is required' },
      { status: 400 },
    )
  }

  if (provider !== 'sleeper') {
    return NextResponse.json(
      {
        error: `${getImportProviderLabel(provider)} account discovery is not implemented yet.`,
      },
      { status: 400 },
    )
  }

  const sleeperUser = await lookupSleeperUser(accountIdentifier)
  if (sleeperUser.status === 'not_found') {
    return NextResponse.json(
      { error: 'Provider account not found.' },
      { status: 404 },
    )
  }
  if (sleeperUser.status === 'unavailable') {
    return NextResponse.json(
      { error: 'Provider lookup is temporarily unavailable. Try again shortly.' },
      { status: 503 },
    )
  }

  /*
   * ⚠ STAMP THE LINK WHILE WE HOLD THE RESOLVED USER. The commissioner gate
   * on preview/commit requires a linked Sleeper account, but nothing in this
   * modern pipeline ever wrote one — a direct signup discovered their leagues
   * here and then failed the very next step with "Link your Sleeper account",
   * with no surface to do the linking. First-write-wins: an already-linked
   * profile is never overwritten, and a handle claimed by ANOTHER account is
   * left alone (unique constraint) — discovery still works, the gate then
   * refuses with its own message.
   */
  try {
    const profile = await prisma.userProfile.upsert({
      where: { userId: auth.userId },
      update: {},
      create: { userId: auth.userId },
    })
    if (!profile.sleeperUserId) {
      await prisma.userProfile.update({
        where: { userId: auth.userId },
        data: {
          sleeperUserId: sleeperUser.user.user_id,
          sleeperUsername: sleeperUser.user.username ?? accountIdentifier,
          sleeperLinkedAt: new Date(),
        },
      })
    }
  } catch {
    /* unique-violation (handle owned by another account), a partial prisma in
       tests, or a transient DB failure — discovery itself must not break on
       the stamp. try/catch, not .catch(): a mocked client without the
       userProfile delegate throws SYNCHRONOUSLY, before any promise exists. */
  }

  try {
    const leagues = await getUserLeagues(sleeperUser.user.user_id, sport, season)
    return NextResponse.json({
      provider,
      sport,
      season,
      account: {
        providerUserId: sleeperUser.user.user_id,
        accountIdentifier: sleeperUser.user.username ?? accountIdentifier,
        displayName:
          sleeperUser.user.display_name?.trim() ||
          sleeperUser.user.username ||
          accountIdentifier,
      },
      leagues: leagues.map((league) => ({
        sourceId: league.league_id,
        name: league.name,
        sport: league.sport,
        season: league.season,
        status: league.status,
        totalTeams: league.total_rosters,
        isDynasty: league.settings?.type === 2,
        avatarUrl: league.avatar
          ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}`
          : null,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to discover provider leagues.',
      },
      { status: 500 },
    )
  }
}
