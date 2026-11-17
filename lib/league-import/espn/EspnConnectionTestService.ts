/**
 * "Test connection" for the guided ESPN import — answers, in one or two light requests, the three
 * questions a user has before committing to an import:
 *
 *   1. Is that a real ESPN league?           (league name + team count back, or a friendly miss)
 *   2. Is it public or private?             (tried WITHOUT cookies first; 401/403 = private)
 *   3. If private, do my cookies open it?    (and, when they do, is one of its teams mine?)
 *
 * It never saves anything and never returns a cookie. The import itself still goes through the
 * commissioner gate, which needs the SWID cookie even for a PUBLIC league (it is how we prove the
 * importer has a team there) — so a public result says so rather than implying the import is done.
 */

import {
  EspnFormatChangedError,
  EspnUnavailableError,
  buildEspnCookieHeader,
  fetchEspnLeagueJson,
  probeEspnLeagueAccess,
  type EspnCredentials,
  type EspnFetchJsonOptions,
} from './espnFantasyClient'
import { isEspnMlbSource, parseEspnMlbSource } from './EspnMlbSource'
import {
  EspnImportLeagueNotFoundError,
  espnSeasonCandidates,
  parseEspnLeagueInput,
  resolveEspnViewerTeamId,
  type EspnLeagueInput,
} from './EspnLeagueFetchService'

const NFL_TEST_VIEWS = ['mTeam', 'mSettings'] as const
/** The MLB contract captured exactly this combination; nothing narrower is verified. */
const MLB_TEST_VIEWS = ['mTeam', 'mRoster', 'mSettings', 'mMatchup', 'mDraftDetail'] as const

export type EspnConnectionTestSuccess = {
  ok: true
  access: 'public' | 'private'
  sport: 'NFL' | 'MLB'
  leagueId: string
  season: number
  leagueName: string
  teamCount: number
  /** The viewer's own team, when cookies were available to tell. Null = could not tell. */
  viewerTeamName: string | null
  viewerTeamFound: boolean | null
  /** Cookies were used and worked (private league, or the team lookup on a public one). */
  cookiesVerified: boolean
  usedSavedCookies: boolean
  /** True when importing still needs ESPN connected (always, until a team is matched). */
  needsCookiesToImport: boolean
}

export type EspnConnectionTestFailure = {
  ok: false
  reason: 'invalid_input' | 'not_found' | 'needs_cookies' | 'cookies_rejected' | 'unavailable'
  message: string
  leagueId?: string
  season?: number
  usedSavedCookies?: boolean
}

export type EspnConnectionTestResult = EspnConnectionTestSuccess | EspnConnectionTestFailure

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function teamDisplayName(team: Record<string, unknown>): string {
  const loc = str(team.location)
  const nick = str(team.nickname)
  if (loc && nick) return `${loc} ${nick}`
  return str(team.name) || str(team.abbrev) || `Team ${String(team.id ?? '')}`.trim()
}

function summarise(raw: Record<string, unknown>, leagueId: string, season: number, sport: 'NFL' | 'MLB') {
  const settings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Record<string, unknown>
  const teams = Array.isArray(raw.teams) ? (raw.teams as Array<Record<string, unknown>>) : []
  const size = typeof settings.size === 'number' && settings.size > 0 ? settings.size : null
  return {
    leagueName: str(settings.name) || `ESPN League ${leagueId}`,
    teamCount: teams.length || size || 0,
    teams,
    leagueId,
    season,
    sport,
  }
}

function viewerTeam(raw: Record<string, unknown>, swid: string | null) {
  const teamId = resolveEspnViewerTeamId(raw, swid)
  if (!teamId) return null
  const teams = Array.isArray(raw.teams) ? (raw.teams as Array<Record<string, unknown>>) : []
  const team = teams.find((t) => String(t.id ?? '') === teamId)
  return team ? teamDisplayName(team) : `Team ${teamId}`
}

export async function testEspnLeagueConnection(args: {
  input: string
  /** Cookies typed into the form right now (validated by the caller). */
  pastedCredentials?: EspnCredentials | null
  /** Cookies already saved for this user. Used only when nothing was pasted. */
  savedCredentials?: EspnCredentials | null
  now?: Date
  fetchOptions?: EspnFetchJsonOptions
}): Promise<EspnConnectionTestResult> {
  const now = args.now ?? new Date()
  const pasted = buildEspnCookieHeader(args.pastedCredentials) ? args.pastedCredentials! : null
  const saved = !pasted && buildEspnCookieHeader(args.savedCredentials) ? args.savedCredentials! : null
  const credentials = pasted ?? saved
  const usedSavedCookies = Boolean(saved)
  const fetchOptions: EspnFetchJsonOptions = { ...args.fetchOptions }

  let sport: 'NFL' | 'MLB' = 'NFL'
  let parsed: EspnLeagueInput
  try {
    if (isEspnMlbSource(args.input)) {
      sport = 'MLB'
      const mlb = parseEspnMlbSource(args.input)
      parsed = { leagueId: mlb.leagueId, season: mlb.season, seasonExplicit: true }
    } else {
      parsed = parseEspnLeagueInput(args.input, now)
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_input',
      message:
        error instanceof EspnImportLeagueNotFoundError || error instanceof Error
          ? error.message
          : 'Enter an ESPN league ID or paste your league URL.',
    }
  }

  const game = sport === 'MLB' ? 'flb' : 'ffl'
  const views = sport === 'MLB' ? MLB_TEST_VIEWS : NFL_TEST_VIEWS
  const seasons = sport === 'MLB' ? [parsed.season] : espnSeasonCandidates(parsed, now)

  try {
    for (const season of seasons) {
      const result = await probeEspnLeagueAccess(
        { game, season, leagueId: parsed.leagueId, views, credentials },
        fetchOptions,
      )

      if (result.access === 'not_found') continue
      if (result.access === 'private_needs_cookies') {
        return {
          ok: false,
          reason: 'needs_cookies',
          leagueId: parsed.leagueId,
          season,
          message:
            'Add your ESPN cookies below so we can read it — it takes about two minutes on a computer.',
        }
      }
      if (result.access === 'private_cookies_rejected') {
        return {
          ok: false,
          reason: 'cookies_rejected',
          leagueId: parsed.leagueId,
          season,
          usedSavedCookies,
          message: usedSavedCookies
            ? 'Your saved ESPN cookies no longer open this league — they have probably expired. Paste fresh ones below.'
            : "ESPN didn't accept those cookies for this league. Make sure you copied both values from the same ESPN login, and that this account is in the league.",
        }
      }

      const info = summarise(result.raw, parsed.leagueId, season, sport)
      let viewerTeamName: string | null = null
      let viewerTeamFound: boolean | null = null
      let cookiesVerified = result.access === 'private_ok'

      if (credentials) {
        if (result.access === 'private_ok') {
          viewerTeamName = viewerTeam(result.raw, credentials.swid)
        } else {
          // Public league: one more read WITH cookies is the only way to see which team is theirs.
          const withCookies = await fetchEspnLeagueJson(
            { game, season, leagueId: parsed.leagueId, views },
            { ...fetchOptions, cookieHeader: buildEspnCookieHeader(credentials) },
          ).catch(() => null)
          if (withCookies && typeof withCookies === 'object') {
            cookiesVerified = true
            viewerTeamName = viewerTeam(withCookies as Record<string, unknown>, credentials.swid)
          }
        }
        viewerTeamFound = cookiesVerified ? viewerTeamName != null : null
      }

      return {
        ok: true,
        access: result.access === 'public' ? 'public' : 'private',
        sport,
        leagueId: info.leagueId,
        season: info.season,
        leagueName: info.leagueName,
        teamCount: info.teamCount,
        viewerTeamName,
        viewerTeamFound,
        cookiesVerified,
        usedSavedCookies,
        needsCookiesToImport: viewerTeamFound !== true,
      }
    }
  } catch (error) {
    if (error instanceof EspnUnavailableError || error instanceof EspnFormatChangedError) {
      return { ok: false, reason: 'unavailable', message: error.message, leagueId: parsed.leagueId }
    }
    return {
      ok: false,
      reason: 'unavailable',
      message: 'ESPN import is temporarily unavailable. Please try again in a few minutes.',
      leagueId: parsed.leagueId,
    }
  }

  return {
    ok: false,
    reason: 'not_found',
    leagueId: parsed.leagueId,
    message:
      seasons.length > 1
        ? `We couldn't find ESPN league ${parsed.leagueId} for ${seasons.join(' or ')}. Check the leagueId= number in your league URL, or paste the whole URL.`
        : `We couldn't find ESPN league ${parsed.leagueId} for ${seasons[0]}. Check the leagueId= number in your league URL.`,
  }
}
