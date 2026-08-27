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

export type FantraxScoringPeriod = {
  number: number
  startDate?: string | null
  endDate?: string | null
}

/**
 * ⚠ REAL PLAYOFF STRUCTURE, NOT AN INFERENCE. `firstPlayoffPeriod` and
 * `numPlayoffTeams` are stated by the league rather than guessed from which
 * weeks happen to carry a flag.
 */
export type FantraxPlayoffs = {
  lastRegularSeasonPeriod?: number | null
  firstPlayoffPeriod?: number | null
  numPlayoffTeams?: number | null
  mergePlayoffPeriods?: boolean | null
  used?: boolean | null
}

export type FantraxPeriodMatchups = {
  period: number
  matchupList?: Array<{
    away?: { name?: string; id?: string; shortName?: string } | null
    home?: { name?: string; id?: string; shortName?: string } | null
  }> | null
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
  /**
   * ⚠ THE WHOLE SEASON SCHEDULE IS IN HERE, and it was being thrown away. One
   * entry per scoring period, each with that period's pairings. The import
   * fetched this object for the league name and discarded everything else, so
   * every Fantrax league arrived with no schedule at all.
   */
  matchups?: FantraxPeriodMatchups[] | null
  playoffs?: FantraxPlayoffs | null
  scoringPeriods?: FantraxScoringPeriod[] | null
  /** Real category weights (TE-premium, TD value, per-yard). Not yet consumed. */
  scoringSystem?: Record<string, unknown> | null
}

/** One row of the stored schedule, in the shape the snapshot reader expects. */
export type FantraxScheduleRow = {
  week: number
  awayTeam: string
  homeTeam: string
  isPlayoff: boolean
}

/**
 * Flatten `getLeagueInfo.matchups` into per-pairing rows.
 *
 * ⚠ NO SCORES. `getLeagueInfo` carries the fixtures and not the results; those
 * live on `getMatchupScores?period=N`, one request per period. The rows are
 * deliberately left score-less rather than defaulted to 0, because a stored 0-0
 * is indistinguishable from a real scoreless tie.
 *
 * ⚠ A BYE IS SKIPPED, NOT HALF-STORED. An odd team count leaves a pairing with
 * only one side; writing it with an empty opponent would resolve to no team and
 * read as a corrupt fixture.
 */
export function flattenFantraxSchedule(info: FantraxLeagueInfo): FantraxScheduleRow[] {
  const firstPlayoff = info.playoffs?.used
    ? Number(info.playoffs.firstPlayoffPeriod)
    : Number.NaN

  const rows: FantraxScheduleRow[] = []
  for (const period of info.matchups ?? []) {
    const week = Number(period?.period)
    if (!Number.isFinite(week) || week < 1) continue
    for (const pairing of period.matchupList ?? []) {
      const away = pairing?.away?.name?.trim()
      const home = pairing?.home?.name?.trim()
      if (!away || !home) continue
      rows.push({
        week,
        awayTeam: away,
        homeTeam: home,
        isPlayoff: Number.isFinite(firstPlayoff) && week >= firstPlayoff,
      })
    }
  }
  return rows
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

export type FantraxStandingRow = {
  teamId: string
  teamName: string
  rank: number | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  winPercentage: number | null
  gamesBack: number | null
}

/**
 * Real standings, straight from Fantrax.
 *
 * ⚠ WITHOUT THIS THE RANK IS ARRAY POSITION. `getTeamRosters` returns teams in
 * whatever order it likes, and numbering that order 1..N produces a standings
 * table that looks authoritative and disagrees with the league — measured on a
 * real league, Fantrax ranked Connor0488 first and the roster order ranked
 * Scorescotty first. Records were hardcoded to 0-0 on top of that, which is
 * indistinguishable from a correct preseason table right up until week one.
 *
 * ⚠ THE RECORD ARRIVES AS ONE STRING, `"W-L-T"`, in a field called `points`.
 * Reading it as a number gives NaN; reading `winPercentage` instead loses the
 * count. It is split here so nothing downstream has to know that.
 */
export async function getFantraxStandings(
  leagueId: string,
): Promise<FantraxResult<FantraxStandingRow[]>> {
  const res = await fxeaGet<unknown>(`/getStandings?leagueId=${encodeURIComponent(leagueId)}`)
  if (!res.ok) return res

  /* Documented as a bare array; tolerate a wrapper rather than reading nothing. */
  const body = res.data as { standings?: unknown[] } | unknown[]
  const rows = Array.isArray(body) ? body : Array.isArray(body?.standings) ? body.standings : null
  if (!rows || rows.length === 0) {
    return {
      ok: false,
      failure: { kind: 'api_error', message: 'Fantrax returned no standings for this league' },
    }
  }

  return {
    ok: true,
    data: rows.map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>
      const [w, l, t] = String(row.points ?? '').split('-')
      const num = (v: unknown) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : 0
      }
      return {
        teamId: String(row.teamId ?? ''),
        teamName: String(row.teamName ?? ''),
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
        wins: num(w),
        losses: num(l),
        ties: num(t),
        pointsFor: num(row.totalPointsFor),
        winPercentage: Number.isFinite(Number(row.winPercentage)) ? Number(row.winPercentage) : null,
        gamesBack: Number.isFinite(Number(row.gamesBack)) ? Number(row.gamesBack) : null,
      }
    }),
  }
}

/**
 * Pull a Fantrax league id out of whatever the user pasted.
 *
 * ⚠ PEOPLE PASTE THE URL, NOT THE ID. The id is only visible as a path segment
 * of the league page, so "copy the league ID" in practice means copying
 * `https://www.fantrax.com/fantasy/league/v2kzedypmm8jp61b/home` out of the
 * address bar. Rejecting that and asking again is a dead end the user cannot
 * debug, because nothing on Fantrax ever shows the bare id.
 *
 * ⚠ CASE IS PRESERVED DELIBERATELY. Fantrax ids are case-sensitive and a
 * lowercased id returns an HTML error page rather than JSON — which `fxeaGet`
 * reports, but only after a wasted round trip and a confusing message.
 */
export function parseFantraxLeagueId(input: string): string | null {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return null

  const fromUrl = trimmed.match(/fantrax\.com\/(?:fantasy\/)?league\/([A-Za-z0-9]+)/)
  if (fromUrl?.[1]) return fromUrl[1]

  /* A bare id. Bounded so a username or a sentence cannot masquerade as one. */
  if (/^[A-Za-z0-9]{8,32}$/.test(trimmed)) return trimmed

  return null
}
