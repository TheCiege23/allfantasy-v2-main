/**
 * Fantrax's public `fxea` API — the college side, by league id.
 *
 * ⚠ THIS REPO ASSUMED FANTRAX WAS A CSV UPLOAD. `FantraxAdapter` is a pure
 * mapper with no `fetch` anywhere, `FantraxLeagueFetchService` reads
 * `prisma.fantraxLeague`, and that table is filled by a multipart CSV upload at
 * `server/api-route-modules/legacy/fantrax/route.ts`. Verified 2026-08-26 there
 * is a live, unauthenticated JSON API instead: `getPlayerIds?sport=CFB` returns
 * 16,886 college players and `getLeagueInfo?leagueId=` returns a full league.
 *
 * ⚠ FANTRAX ANSWERS HTTP 200 FOR ERRORS, AND THIS IS THE TRAP. A missing league
 * comes back as:
 *
 *     HTTP 200  {"error":{"onScreen":false,"code":"WARNING",
 *                "message":"Invalid 'leagueId' parameter - league ID: x not found"}}
 *
 * So `res.ok` is TRUE for a league that does not exist, and a client that checks
 * only the status imports an empty league and reports success. Every read here
 * inspects the BODY.
 *
 * ⚠ AND A BAD ID CAN COME BACK AS HTML. An uppercased id returns HTTP 400 with a
 * web page, so `JSON.parse` throws rather than returning an error object. Both
 * shapes are handled; neither is allowed to look like an empty league.
 *
 * ⚠ LEAGUE IDS ARE CASE-SENSITIVE. `v2kzedypmm8jp61b` resolves;
 * `V2KZEDYPMM8JP61B` is a 400. Never normalise the case of one.
 */

export const FANTRAX_FXEA_BASE = 'https://www.fantrax.com/fxea/general'

/**
 * The complete endpoint list, read off the official docs 2026-08-26.
 *
 * ⚠ THERE IS NO TRANSACTIONS OR TRADES ENDPOINT. The word does not appear in the
 * documentation at all, so trade history is available only from the league CSV
 * export. Roster state IS available per period via `getTeamRosters&period=N`,
 * so moves can be DERIVED by diffing consecutive periods — that is the only
 * route to trade data from the API.
 *
 * ⚠ AND `getAdp?sport=NCAAF` EXISTS. It returns real average-draft-position for
 * college players, which is the market-shaped signal `DevyPlayer.devyAdp` has
 * always been null for. See lib/trade-intel/devyOutlook.ts, which states that no
 * market prices college players — true of everything we held, and not true of
 * this endpoint.
 */
export const FANTRAX_ENDPOINTS = [
  'getAdp',
  'getPlayerIds',
  'getLeagues',
  'getLeagueInfo',
  'getDraftPicks',
  'getDraftResults',
  'getTeamRosters',
  'getStandings',
  'getMatchupScores',
] as const

/** Fantrax's own sport codes. 'CFB' and 'NCAAF' are the same 16,886-row map. */
export type FantraxSport = 'CFB' | 'NCAAF' | 'NFL'

export type FantraxFailure = {
  kind: 'not_found' | 'api_error' | 'not_json' | 'network'
  /** Safe to log — no credential is involved; this API is unauthenticated. */
  message: string
}

export type FantraxResult<T> = { ok: true; data: T } | { ok: false; failure: FantraxFailure }

export type FantraxPlayerRef = {
  fantraxId: string
  name: string
  team: string
  position: string
}

export type FantraxRosterItem = {
  id: string
  position: string
  status: string
}

export type FantraxTeamRoster = {
  teamName: string
  rosterItems: FantraxRosterItem[]
}

export type FantraxLeagueInfo = {
  leagueName: string
  seasonYear: string | number | null
  draftType: string | null
  ppr: boolean | null
  startDate: string | null
  endDate: string | null
  teamInfo: Record<string, { id: string; name: string }>
  /** Present but sparse — eligiblePos and status only, no names. */
  playerInfo: Record<string, unknown>
  rosterInfo: Record<string, unknown>
}

/**
 * One GET, with Fantrax's 200-for-errors behaviour handled.
 */
async function fxeaGet<T>(path: string): Promise<FantraxResult<T>> {
  let res: Response
  try {
    res = await fetch(`${FANTRAX_FXEA_BASE}${path}`, { headers: { Accept: 'application/json' } })
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: 'network',
        message: `Fantrax request failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }

  const text = await res.text().catch(() => '')

  /*
   * A bad id can return an HTML page rather than JSON. Detecting that before
   * parsing keeps a broken request from surfacing as a parse crash.
   */
  if (text.trimStart().startsWith('<')) {
    return {
      ok: false,
      failure: {
        kind: 'not_json',
        message: `Fantrax returned a web page rather than JSON (HTTP ${res.status}). League ids are case-sensitive — check the id exactly as it appears in the league URL.`,
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, failure: { kind: 'not_json', message: `Fantrax returned unparseable JSON (HTTP ${res.status})` } }
  }

  /*
   * ⚠ THE 200-WITH-ERROR CASE. This is the one that would otherwise import an
   * empty league and call it a success.
   */
  const asRecord = parsed as { error?: { message?: string } }
  if (asRecord && typeof asRecord === 'object' && asRecord.error) {
    const message = asRecord.error.message ?? 'unknown Fantrax error'
    const notFound = /not found/i.test(message)
    return {
      ok: false,
      failure: { kind: notFound ? 'not_found' : 'api_error', message },
    }
  }

  return { ok: true, data: parsed as T }
}

export function getFantraxLeagueInfo(leagueId: string): Promise<FantraxResult<FantraxLeagueInfo>> {
  return fxeaGet<FantraxLeagueInfo>(`/getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}`)
}

/**
 * Team rosters, keyed by Fantrax team id.
 *
 * ⚠ THE PAYLOAD NESTS UNDER `rosters` SOMETIMES AND NOT OTHERS, so both shapes
 * are accepted. Guessing one and getting an empty object back would look exactly
 * like a league with no rosters.
 */
export async function getFantraxTeamRosters(
  leagueId: string,
): Promise<FantraxResult<Record<string, FantraxTeamRoster>>> {
  const res = await fxeaGet<Record<string, unknown>>(
    `/getTeamRosters?leagueId=${encodeURIComponent(leagueId)}`,
  )
  if (!res.ok) return res

  const body = res.data as { rosters?: Record<string, FantraxTeamRoster> }
  const rosters = (body.rosters ?? body) as Record<string, FantraxTeamRoster>

  const teamCount = Object.keys(rosters).length
  if (teamCount === 0) {
    return {
      ok: false,
      failure: { kind: 'api_error', message: 'Fantrax returned no team rosters for this league' },
    }
  }
  return { ok: true, data: rosters }
}

/**
 * The id -> player map for a sport.
 *
 * ⚠ 'CFB' IS THE COLLEGE MAP AND IT IS A DIFFERENT ID SPACE FROM 'NFL'. Measured
 * on a real college league 2026-08-26: 0 of 38 roster ids matched the NFL map,
 * 447 of 466 matched CFB. Resolving college rosters against the NFL map returns
 * nothing and looks like an empty league.
 */
export async function getFantraxPlayerIds(
  sport: FantraxSport,
): Promise<FantraxResult<Record<string, FantraxPlayerRef>>> {
  const res = await fxeaGet<Record<string, FantraxPlayerRef>>(`/getPlayerIds?sport=${sport}`)
  if (!res.ok) return res
  if (Object.keys(res.data).length === 0) {
    return { ok: false, failure: { kind: 'api_error', message: `Fantrax returned no players for ${sport}` } }
  }
  return res
}

/**
 * Every league a Fantrax user owns, from the Secret ID on their profile page.
 *
 * ⚠ THE SECRET ID IS A CREDENTIAL AND IS NEVER PERSISTED OR LOGGED. It is used
 * for this one request and discarded. Nothing here writes it anywhere, and the
 * failure messages below deliberately do not echo it.
 *
 * ⚠ AND A BAD SECRET ID LOOKS EXACTLY LIKE AN EMPTY ACCOUNT. Verified against
 * the live service 2026-08-26: an unknown, fake, and empty Secret ID all return
 *
 *     HTTP 200  {}
 *
 * with no error object — a third failure shape, distinct from the 200-with-error
 * of getLeagueInfo and the 400-with-HTML of a miscased league id. So an empty
 * result CANNOT be reported as "you own no leagues": that would tell a user with
 * a typo that their account is empty. It is reported as genuinely ambiguous.
 */
export type FantraxLeagueSummary = {
  leagueId: string
  leagueName: string
  /** The team(s) this user owns in that league, when the API names them. */
  teamIds: string[]
  teamNames: string[]
}

export async function getFantraxLeagues(
  userSecretId: string,
): Promise<FantraxResult<FantraxLeagueSummary[]>> {
  const trimmed = userSecretId.trim()
  if (!trimmed) {
    return { ok: false, failure: { kind: 'api_error', message: 'a Fantrax Secret ID is required' } }
  }

  const res = await fxeaGet<unknown>(`/getLeagues?userSecretId=${encodeURIComponent(trimmed)}`)
  if (!res.ok) return res

  const body = res.data as Record<string, unknown>
  const raw = Array.isArray(body)
    ? body
    : Array.isArray((body as { leagues?: unknown[] }).leagues)
      ? ((body as { leagues: unknown[] }).leagues as unknown[])
      : Object.values(body ?? {})

  const leagues: FantraxLeagueSummary[] = raw
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l != null)
    .map((l) => ({
      leagueId: String(l.leagueId ?? l.id ?? ''),
      leagueName: String(l.leagueName ?? l.name ?? 'Unnamed league'),
      teamIds: toStringArray(l.teamIds ?? l.teamId),
      teamNames: toStringArray(l.teamNames ?? l.teamName),
    }))
    .filter((l) => l.leagueId)

  if (leagues.length === 0) {
    return {
      ok: false,
      failure: {
        kind: 'not_found',
        message:
          'Fantrax returned no leagues. That means either the Secret ID is wrong or the account owns no leagues — the API answers the same way for both, so we cannot tell which. Check the Secret ID on your Fantrax profile page.',
      },
    }
  }

  return { ok: true, data: leagues }
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (v == null || v === '') return []
  return [String(v)]
}

export type ResolvedRoster = {
  teamId: string
  teamName: string
  players: Array<{
    fantraxId: string
    /** Null when the id is absent from the sport's player map. */
    name: string | null
    team: string | null
    /** The slot Fantrax reports, e.g. 'RWT', 'SFX', 'QB'. */
    position: string
    status: string
  }>
  /** How many of this team's players the map could name. */
  resolved: number
  total: number
}

/**
 * Join rosters to the player map.
 *
 * ⚠ AN UNRESOLVED ID IS RETURNED WITH A NULL NAME, NOT DROPPED. Measured 96%
 * (447/466) on a real league, so roughly one player in twenty is not in the map
 * — likely graduated or inactive. Dropping them would silently shrink every
 * roster and make a 39-man squad look like 37.
 */
export function resolveRosters(
  rosters: Record<string, FantraxTeamRoster>,
  playerMap: Record<string, FantraxPlayerRef>,
): ResolvedRoster[] {
  return Object.entries(rosters).map(([teamId, team]) => {
    const players = (team.rosterItems ?? []).map((item) => {
      const hit = playerMap[item.id]
      return {
        fantraxId: item.id,
        name: hit?.name ?? null,
        team: hit?.team ?? null,
        position: item.position,
        status: item.status,
      }
    })
    return {
      teamId,
      teamName: team.teamName,
      players,
      resolved: players.filter((p) => p.name != null).length,
      total: players.length,
    }
  })
}
