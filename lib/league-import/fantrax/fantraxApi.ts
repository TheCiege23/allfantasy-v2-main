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
  /**
   * Fantrax's own team ids for the pairing.
   *
   * ⚠ THE NAMES ARE NOT A KEY. Scores arrive from a different endpoint and have
   * to be matched back onto the fixture; matching on the display name breaks the
   * moment somebody renames a team between the two reads, and two teams in one
   * league may differ only by case. The ids are stable and are already in the
   * same response the fixtures come from, so they are carried rather than
   * re-derived.
   */
  awayTeamId: string
  homeTeamId: string
  /**
   * ⚠ NULL IS NOT ZERO, AND THIS IS THE WHOLE POINT OF THE FIELD. A period that
   * has not been played reports `score: 0.0` from Fantrax exactly like a real
   * scoreless week. Only `gamesPlayed` separates them, so an unplayed side stays
   * null here and `played` records which reading it was.
   */
  awayScore: number | null
  homeScore: number | null
  /** True only when Fantrax reported at least one game played on either side. */
  played: boolean
}

/**
 * Flatten `getLeagueInfo.matchups` into per-pairing rows.
 *
 * ⚠ NO SCORES FROM THIS CALL. `getLeagueInfo` carries the fixtures and not the
 * results; those live on `getMatchupScores?period=N`, one request per period.
 * The rows leave `awayScore`/`homeScore` null rather than defaulting to 0,
 * because a stored 0-0 is indistinguishable from a real scoreless tie. Use
 * `fetchFantraxScheduleWithScores` to get fixtures and results together.
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
        awayTeamId: String(pairing?.away?.id ?? '').trim(),
        homeTeamId: String(pairing?.home?.id ?? '').trim(),
        awayScore: null,
        homeScore: null,
        played: false,
        isPlayoff: Number.isFinite(firstPlayoff) && week >= firstPlayoff,
      })
    }
  }
  return rows
}

/**
 * Fantrax's error strings are written for a web page, not for an API consumer.
 *
 * 🛑 THEY CONTAIN HTML, AND WE WERE PUTTING IT ON SCREEN RAW. Observed in
 * production on 2026-08-31, in the red box on `/import`, exactly as the user
 * saw it:
 *
 *     …apologise if this is the case.<br/><br/> <b style="font-size:14px">This
 *     problem should be resolved within the next 1-24 hours.</b><br/><br/>…
 *
 * React escapes it, correctly, so the markup renders as literal text and the
 * message reads like something broke twice. The vendor is entitled to format
 * their own copy; the fix belongs here, at the point we take the string, so no
 * consumer has to remember. Every caller of `fxeaGet` gets it.
 *
 * ⚠ STRIP, NEVER RENDER. The alternative — passing this through
 * `dangerouslySetInnerHTML` so the tags format — would put a third party's
 * markup, including a `style` attribute, into our page from a response body. A
 * vendor error string is untrusted input no matter how ordinary it looks.
 *
 * ⚠ AND IT MUST NOT WIDEN WHAT WE ECHO. `getFantraxLeagues` takes a Secret ID,
 * which is a credential, and its failure messages deliberately do not repeat it
 * (see the note there). This only ever removes characters — tags, entities and
 * runs of whitespace — so it cannot introduce anything that was not already in
 * the message we were showing.
 */
export function humanizeVendorMessage(raw: string | null | undefined): string {
  const text = String(raw ?? '')
  if (!text) return ''
  return text
    /* A tag becomes a space so sentences either side do not run together. */
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
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
    const message = humanizeVendorMessage(asRecord.error.message) || 'unknown Fantrax error'
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
  /*
   * ⚠ OPTIONAL, AND OMITTED MEANS "NOW" RATHER THAN "PERIOD 0". Fantrax returns
   * the CURRENT roster when no period is given, which is what every existing
   * caller wants; sending `period=0` instead would ask for a scoring period that
   * does not exist. This parameter exists because roster state per period is the
   * only route to transaction history — the API publishes no transactions
   * endpoint at all — so `deriveFantraxTransactions` diffs consecutive periods.
   */
  period?: number,
): Promise<FantraxResult<Record<string, FantraxTeamRoster>>> {
  const periodParam =
    typeof period === 'number' && Number.isFinite(period) && period > 0
      ? `&period=${encodeURIComponent(String(Math.trunc(period)))}`
      : ''
  const res = await fxeaGet<Record<string, unknown>>(
    `/getTeamRosters?leagueId=${encodeURIComponent(leagueId)}${periodParam}`,
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
 * One college player's average draft position, straight from Fantrax.
 *
 * ⚠ THE FIELD IS `ADP_PPR`, NOT `adp`, AND THE PAYLOAD IS AN ARRAY. Verified
 * against the live service 2026-08-31: `getAdp?sport=NCAAF` returns HTTP 200
 * with `content-type: text/plain` carrying a JSON ARRAY of 997 entries shaped
 *
 *     { "ADP_PPR": 338.65, "pos": "TE", "name": "Abney, Christian", "id": "06a94" }
 *
 * — not the id-keyed object every other fxea endpoint returns. Assuming the
 * house shape here would parse 997 players as zero.
 *
 * ⚠ AND IT CARRIES NO SCHOOL. Only pos, name and id, so matching these to a
 * college player table on name alone is unsafe — two players share a name far
 * more often than a name AND a school. `getPlayerIds?sport=CFB` holds the school
 * for the same ids and is the intended cross-reference.
 */
/* Local, because this module deliberately shares nothing with the fetch service —
   fantraxApi is the transport layer and imports no league logic. */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function readString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export type FantraxAdpEntry = {
  fantraxId: string
  name: string
  position: string
  /** Average draft position in PPR scoring. Lower is earlier. */
  adp: number
}

/**
 * Average draft position for college players.
 *
 * 🛑 THIS IS THE MARKET SIGNAL THE DEVY STACK HAS NEVER HAD. `DevyPlayer.devyAdp`
 * is read in a dozen places and written by nothing — 337 of 1,721 rows carry a
 * value and the rest are null — and `lib/trade-intel/devyOutlook.ts` states that
 * no market prices college players. That was true of everything we held and is
 * not true of this endpoint.
 */
export async function getFantraxAdp(
  sport: FantraxSport = 'NCAAF',
): Promise<FantraxResult<FantraxAdpEntry[]>> {
  const res = await fxeaGet<unknown>(`/getAdp?sport=${sport}`)
  if (!res.ok) return res

  /* Array is the observed shape; an id-keyed object is accepted too so a vendor
     change to the house convention degrades to fewer rows rather than zero. */
  const raw: unknown[] = Array.isArray(res.data)
    ? (res.data as unknown[])
    : isPlainRecord(res.data)
      ? Object.values(res.data)
      : []

  const entries: FantraxAdpEntry[] = []
  for (const row of raw) {
    if (!isPlainRecord(row)) continue
    const fantraxId = readString(row.id)
    const name = readString(row.name)
    /* Accept the observed key and the obvious alternatives, so a rename does not
       silently zero the feed. */
    const adpRaw = row.ADP_PPR ?? row.adp ?? row.ADP
    const adp = typeof adpRaw === 'number' ? adpRaw : Number(adpRaw)
    if (!fantraxId || !name || !Number.isFinite(adp)) continue
    entries.push({ fantraxId, name, position: readString(row.pos) || readString(row.position), adp })
  }

  if (entries.length === 0) {
    return { ok: false, failure: { kind: 'api_error', message: `Fantrax returned no ADP for ${sport}` } }
  }
  return { ok: true, data: entries }
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

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/** One side of a scored pairing, as `getMatchupScores` reports it. */
export type FantraxMatchupSide = {
  teamId: string
  teamName: string
  score: number
  /**
   * ⚠ THE ONLY THING THAT SEPARATES "0-0" FROM "NOT PLAYED YET". Fantrax
   * reports `score: 0.0` for an unplayed period, which is byte-identical to a
   * genuine scoreless week. Measured on Cream Bowl 2026-08-30, two days before
   * period 1 opens: every side came back `score: 0.0, gamesPlayed: 0`. Storing
   * that as a result is exactly the "every record is 0-0" table this repo has
   * already been burnt by on standings.
   */
  gamesPlayed: number
}

export type FantraxPeriodScore = {
  period: number
  matchups: Array<{ away: FantraxMatchupSide; home: FantraxMatchupSide }>
}

function parseMatchupSide(raw: unknown): FantraxMatchupSide | null {
  if (raw === null || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const teamId = String(row.teamId ?? '').trim()
  if (!teamId) return null
  const score = Number(row.score)
  const gamesPlayed = Number(row.gamesPlayed)
  return {
    teamId,
    teamName: String(row.teamName ?? '').trim(),
    score: Number.isFinite(score) ? score : 0,
    gamesPlayed: Number.isFinite(gamesPlayed) ? gamesPlayed : 0,
  }
}

/**
 * One scoring period's results.
 *
 * ⚠ THIS ENDPOINT WAS LISTED AND NEVER IMPLEMENTED. `getMatchupScores` has sat
 * in `FANTRAX_ENDPOINTS` since the API was first read, with no function calling
 * it — so every Fantrax league imported its fixtures with null scores and then
 * had no week that could ever be scored. That is the single cause of "no week
 * has been scored yet", "we cannot tell which week this league is in", and a
 * standings table where every record is 0-0.
 *
 * ⚠ OMITTING `period` IS NOT THE SAME AS ASKING FOR PERIOD 1. With no period
 * Fantrax answers with the CURRENT one and echoes which that was, so the
 * response is self-describing — the echoed `period` is read back rather than
 * assumed to be the one requested.
 *
 * ⚠ AN OUT-OF-RANGE PERIOD IS AN HTTP 200 WITH AN ERROR BODY, like every other
 * failure on this API ("Invalid 'period' parameter - period 99 not found").
 * `fxeaGet` already inspects the body, so it surfaces as a failure rather than
 * as a period with no matchups.
 */
export async function getFantraxMatchupScores(
  leagueId: string,
  period?: number,
): Promise<FantraxResult<FantraxPeriodScore>> {
  const query =
    period == null
      ? `?leagueId=${encodeURIComponent(leagueId)}`
      : `?leagueId=${encodeURIComponent(leagueId)}&period=${encodeURIComponent(String(period))}`
  const res = await fxeaGet<{ period?: unknown; matchups?: unknown }>(`/getMatchupScores${query}`)
  if (!res.ok) return res

  const echoed = Number(res.data?.period)
  const list = Array.isArray(res.data?.matchups) ? res.data.matchups : []
  const matchups: FantraxPeriodScore['matchups'] = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const away = parseMatchupSide((entry as Record<string, unknown>).away)
    const home = parseMatchupSide((entry as Record<string, unknown>).home)
    /* A half-read pairing cannot be attached to a fixture, so it is dropped
       rather than stored against one side. */
    if (!away || !home) continue
    matchups.push({ away, home })
  }

  return {
    ok: true,
    data: {
      period: Number.isFinite(echoed) && echoed > 0 ? echoed : (period ?? 0),
      matchups,
    },
  }
}

export type FantraxSeasonPosition = {
  /** The period the league is in now, or the last one if the season is over. */
  period: number
  state: 'preseason' | 'in_progress' | 'complete'
  /** How many periods are worth asking for scores — never more than `period`. */
  scoredThrough: number
}

/**
 * Where in its own season a Fantrax league is, read from its own calendar.
 *
 * ⚠ THE LEAGUE'S CALENDAR, NOT THE SPORT'S. This repo has already shipped a
 * header reading "you are here · week 3" off the next real-world kickoff, which
 * happened to be NFL preseason. `getLeagueInfo.scoringPeriods` carries a real
 * start and end date per period, published by the league itself, so the answer
 * comes from the league rather than from a calendar that knows nothing about it.
 *
 * ⚠ AND BEFORE THE FIRST PERIOD OPENS THERE IS NO CURRENT WEEK, which is a
 * different fact from "week 1". `state` says which of the three it is, so a
 * caller can render a preseason league as preseason instead of as an
 * unaccountably empty week 1. `scoredThrough` is 0 there — asking Fantrax for
 * period 1 results two days before period 1 opens returns a full set of
 * `score: 0.0 / gamesPlayed: 0` sides, which is the trap this whole file is
 * about.
 */
export function resolveFantraxSeasonPosition(
  info: FantraxLeagueInfo,
  now: Date = new Date(),
): FantraxSeasonPosition | null {
  const periods = (info.scoringPeriods ?? [])
    .map((p) => ({
      number: Number(p?.number),
      start: p?.startDate ? new Date(p.startDate).getTime() : Number.NaN,
      end: p?.endDate ? new Date(p.endDate).getTime() : Number.NaN,
    }))
    .filter((p) => Number.isFinite(p.number) && p.number >= 1)
    .sort((a, b) => a.number - b.number)
  if (periods.length === 0) return null

  const t = now.getTime()
  const first = periods[0]
  const last = periods[periods.length - 1]

  if (Number.isFinite(first.start) && t < first.start) {
    return { period: first.number, state: 'preseason', scoredThrough: 0 }
  }
  if (Number.isFinite(last.end) && t > last.end) {
    return { period: last.number, state: 'complete', scoredThrough: last.number }
  }

  const live = periods.find(
    (p) => (!Number.isFinite(p.start) || t >= p.start) && (!Number.isFinite(p.end) || t <= p.end),
  )
  const current = live ?? last
  return { period: current.number, state: 'in_progress', scoredThrough: current.number }
}

/**
 * Merge fetched results onto fixtures. Pure — the fetch is the caller's.
 *
 * ⚠ MATCHED ON TEAM ID PAIRS, IN EITHER ORIENTATION. Fantrax is free to report
 * a pairing home/away the other way round from the fixture, and a name match
 * would additionally break on any rename between the two reads.
 *
 * ⚠ A PERIOD WITH `gamesPlayed: 0` ON BOTH SIDES IS LEFT UNSCORED, not written
 * as 0-0. That is the difference between "this week has not happened" and "both
 * teams were shut out", and everything downstream — the current week, the power
 * board, the standings — reads the wrong one as the other.
 */
export function applyFantraxScores(
  rows: FantraxScheduleRow[],
  periods: FantraxPeriodScore[],
): FantraxScheduleRow[] {
  const byWeek = new Map<number, FantraxPeriodScore['matchups']>()
  for (const p of periods) byWeek.set(p.period, p.matchups)

  return rows.map((row) => {
    const pairings = byWeek.get(row.week)
    if (!pairings || !row.awayTeamId || !row.homeTeamId) return row

    for (const pairing of pairings) {
      const straight =
        pairing.away.teamId === row.awayTeamId && pairing.home.teamId === row.homeTeamId
      const flipped =
        pairing.away.teamId === row.homeTeamId && pairing.home.teamId === row.awayTeamId
      if (!straight && !flipped) continue

      const forAway = straight ? pairing.away : pairing.home
      const forHome = straight ? pairing.home : pairing.away
      const played = forAway.gamesPlayed > 0 || forHome.gamesPlayed > 0
      if (!played) return row

      return { ...row, awayScore: forAway.score, homeScore: forHome.score, played: true }
    }
    return row
  })
}

/**
 * Fixtures plus results, in the shape the snapshot column stores.
 *
 * ⚠ ONLY PERIODS THAT COULD HAVE BEEN PLAYED ARE REQUESTED. `getMatchupScores`
 * is one request per period, and a 13-period league asked for all of them in
 * August spends thirteen round trips to learn thirteen times that nothing has
 * happened. Bounded by the league's own calendar: a preseason league costs zero
 * extra requests, and a completed one costs one per period.
 *
 * ⚠ A PERIOD THAT FAILS TO READ IS SKIPPED, NEVER ZEROED. Its fixture keeps its
 * null scores, which reads downstream as "not known" instead of "0-0".
 */
export async function fetchFantraxScheduleWithScores(
  leagueId: string,
  info: FantraxLeagueInfo,
  options?: { now?: Date; maxPeriods?: number },
): Promise<{
  rows: FantraxScheduleRow[]
  position: FantraxSeasonPosition | null
  periodsRead: number
  periodsFailed: number
}> {
  const rows = flattenFantraxSchedule(info)
  const position = resolveFantraxSeasonPosition(info, options?.now ?? new Date())

  const maxPeriods = options?.maxPeriods ?? 30
  const through = Math.min(position?.scoredThrough ?? 0, maxPeriods)
  if (through < 1) return { rows, position, periodsRead: 0, periodsFailed: 0 }

  const wanted = Array.from({ length: through }, (_, i) => i + 1)
  const results = await Promise.all(wanted.map((p) => getFantraxMatchupScores(leagueId, p)))

  const scored: FantraxPeriodScore[] = []
  let periodsFailed = 0
  for (const res of results) {
    if (res.ok) scored.push(res.data)
    else periodsFailed++
  }

  return {
    rows: applyFantraxScores(rows, scored),
    position,
    periodsRead: scored.length,
    periodsFailed,
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
