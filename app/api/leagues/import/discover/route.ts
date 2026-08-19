import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import {
  getImportProviderLabel,
  supportsImportProviderDiscovery,
} from '@/lib/league-import/provider-ui-config'
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
