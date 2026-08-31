import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  FantraxImportDraftPick,
  FantraxImportPayload,
  FantraxImportTeam,
  FantraxImportTransaction,
} from '@/lib/league-import/adapters/fantrax/types'
import { assignFantraxTeamIds } from './fantraxTeamIds'

type LegacyStanding = {
  rank?: unknown
  team?: unknown
  wins?: unknown
  losses?: unknown
  ties?: unknown
  pointsFor?: unknown
  pointsAgainst?: unknown
  /** Fantrax's durable team id, written by `summarise` so a rename does not
      create a new team. Absent on CSV-era snapshots. */
  fantraxTeamId?: unknown
}

type LegacyMatchup = {
  week?: unknown
  awayTeam?: unknown
  awayScore?: unknown
  homeTeam?: unknown
  homeScore?: unknown
  isPlayoff?: unknown
  /**
   * Fantrax's own team ids, present on a live-API import and absent on a
   * CSV-era snapshot. They are what the numeric roster id is derived from, so a
   * team keeps its id across a rename.
   */
  awayTeamId?: unknown
  homeTeamId?: unknown
}

type LegacyRosterPlayer = {
  fantraxId?: unknown
  name?: unknown
  primaryPosition?: unknown
  position?: unknown
  nflTeam?: unknown
  /**
   * Which team owns him. Present on live-API imports, absent on CSV-era
   * snapshots — a CSV only ever held the uploader's own squad, so an untagged
   * row belongs to the uploader's team.
   */
  teamName?: unknown
  /**
   * Fantrax's own lineup state for this player — `ACTIVE` for a starter,
   * `RESERVE` for a bench slot. Present on live-API imports; absent on CSV-era
   * snapshots, which never carried it.
   *
   * ⚠ THE FIELD WAS ALWAYS IN THE DATA AND NEVER IN THIS TYPE, which is why
   * `starterPlayerIds` was hardcoded empty below: nothing downstream could see
   * the one column that distinguishes a starter from a bench player.
   */
  status?: unknown
}

type LegacyTransaction = {
  type?: unknown
  player?: unknown
  position?: unknown
  team?: unknown
  date?: unknown
  week?: unknown
  managerTeam?: unknown
  fromTeam?: unknown
  toTeam?: unknown
  isDraftPick?: unknown
  pickRound?: unknown
  pickNumber?: unknown
}

export class FantraxImportConnectionError extends Error {}
export class FantraxImportLeagueNotFoundError extends Error {}

interface FantraxSourceLookup {
  leagueRecordId?: string
  username?: string
  leagueName?: string
  season?: number
  /**
   * A live Fantrax league plus the team the user says is theirs. Set only by the
   * `fantrax-league:` form, which fetches from Fantrax rather than reading a
   * previously uploaded snapshot.
   */
  nativeLeague?: { leagueId: string; teamName: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTeamLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function parseFantraxSourceInput(sourceInput: string): FantraxSourceLookup {
  const trimmed = sourceInput.trim()
  if (!trimmed) {
    throw new FantraxImportLeagueNotFoundError(
      'Fantrax source is required. Use a legacy Fantrax league ID or username.'
    )
  }

  /*
   * A live league, chosen from the team list the import screen shows. Carries
   * the team because Fantrax will not tell us which one is the caller's, and
   * guessing attributes a stranger's players to them.
   */
  const native = trimmed.match(/^fantrax-league:([^|]+)\|(.+)$/i)
  if (native?.[1] && native[2]) {
    return { nativeLeague: { leagueId: native[1].trim(), teamName: native[2].trim() } }
  }

  const idPrefixed = trimmed.match(/^id:(.+)$/i)
  if (idPrefixed?.[1]) {
    return { leagueRecordId: idPrefixed[1].trim() }
  }

  const maybeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (maybeUuid.test(trimmed)) {
    return { leagueRecordId: trimmed }
  }

  if (trimmed.includes('|')) {
    const [usernameRaw, secondRaw, ...rest] = trimmed.split('|').map((part) => part.trim())
    const username = usernameRaw || undefined
    if (!username) {
      throw new FantraxImportLeagueNotFoundError(
        'Fantrax source format is username|season|leagueName (or username|leagueName).'
      )
    }

    const secondNumber = asNumber(secondRaw, null)
    if (secondNumber != null) {
      return {
        username,
        season: secondNumber,
        leagueName: rest.join('|').trim() || undefined,
      }
    }
    return {
      username,
      leagueName: [secondRaw, ...rest].join('|').trim() || undefined,
    }
  }

  return { username: trimmed }
}

function resolveFantraxSport(rawSport: string, isDevy: boolean): string {
  const normalized = rawSport.trim().toLowerCase()
  if (normalized === 'cfb' || normalized === 'ncaaf' || normalized === 'college_football') {
    return 'NCAAF'
  }
  if (normalized === 'cbb' || normalized === 'ncaab' || normalized === 'college_basketball') {
    return 'NCAAB'
  }
  if (normalized === 'soccer' || normalized === 'futbol') {
    return 'SOCCER'
  }
  if (normalized === 'nfl' || normalized === 'nba' || normalized === 'mlb' || normalized === 'nhl') {
    return normalized.toUpperCase()
  }
  if (isDevy) return 'NCAAF'
  return normalizeToSupportedSport(rawSport)
}

function parseStandings(raw: unknown): LegacyStanding[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyStanding[]
}

function parseMatchups(raw: unknown): LegacyMatchup[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyMatchup[]
}

/**
 * Split a team's players into the lineup and the bench, using Fantrax's own
 * `status`.
 *
 * ⚠ NO STATUS MEANS NO CLAIM. A CSV-era snapshot carries no status at all, and
 * guessing — first N are starters, say — would put players in a lineup their
 * manager never set. When nothing is marked ACTIVE the split is refused and the
 * caller keeps the previous "everything is bench" shape, which is honest about
 * not knowing rather than confidently wrong.
 *
 * ⚠ ANYTHING NOT `ACTIVE` IS BENCH, not just `RESERVE`. Fantrax also emits
 * injured-reserve and minor-league states; treating only the literal string
 * RESERVE as bench would silently promote those into the starting lineup.
 */
export function splitLineup(players: LegacyRosterPlayer[]): { starters: string[]; reserve: string[] } | null {
  const starters: string[] = []
  const reserve: string[] = []
  for (const p of players) {
    const id = asString(p.fantraxId)
    if (!id) continue
    const status = asString(p.status).trim().toUpperCase()
    if (status === 'ACTIVE') starters.push(id)
    else reserve.push(id)
  }
  if (starters.length === 0) return null
  return { starters, reserve }
}

function parseRoster(raw: unknown): LegacyRosterPlayer[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyRosterPlayer[]
}

function parseTransactions(raw: unknown): LegacyTransaction[] {
  if (!isRecord(raw)) return []
  const groups = ['claims', 'drops', 'trades', 'lineupChanges', 'userTransactions'] as const
  const transactions: LegacyTransaction[] = []
  for (const key of groups) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (isRecord(entry)) transactions.push(entry as LegacyTransaction)
    }
  }
  return transactions
}

/**
 * Team label → the id every downstream surface keys on.
 *
 * 🛑 THIS USED TO EMIT `fantrax-team:<slug>`, AND THAT IS WHY A FANTRAX
 * SCOREBOARD COULD NEVER WORK. `LeagueTeam.externalId` is read back as
 * `Number(externalId)` by `lib/core-app/weekBoard.ts` and its siblings, so a
 * slug is `NaN` and every Fantrax team is silently dropped from the roster-name
 * and my-team lookups. Nothing errored; opponents simply had no names and your
 * own team could not be found. `WeeklyMatchup.rosterId` is an `Int`, so a slug
 * could never have been stored there either.
 *
 * ⚠ THE ID IS HASHED FROM FANTRAX'S OWN TEAM ID WHERE ONE EXISTS, so it survives
 * a rename and does not depend on how many teams the league has. See
 * `fantraxTeamIds.ts` for why an index-based numbering was rejected. The name is
 * the fallback for CSV-era snapshots, which carry no Fantrax ids at all.
 */
function buildTeamIdMap(args: {
  standings: LegacyStanding[]
  matchups: LegacyMatchup[]
  userTeam: string
}): Map<string, string> {
  /*
   * Collect every label alongside the durable id it was seen with. A team can
   * appear in both standings and matchups; the first sighting that carries a
   * real Fantrax id wins, because a name-derived hash is strictly weaker.
   */
  const sourceByLabel = new Map<string, string>()
  const labels: string[] = []
  const note = (label: string, sourceId: string) => {
    const trimmed = label.trim()
    if (!trimmed) return
    labels.push(trimmed)
    const normalized = normalizeTeamLabel(trimmed)
    if (sourceId && !sourceByLabel.get(normalized)) sourceByLabel.set(normalized, sourceId)
  }

  for (const standing of args.standings) {
    note(asString(standing.team), asString(standing.fantraxTeamId))
  }
  for (const matchup of args.matchups) {
    note(asString(matchup.awayTeam), asString(matchup.awayTeamId))
    note(asString(matchup.homeTeam), asString(matchup.homeTeamId))
  }
  if (args.userTeam) note(args.userTeam, '')

  const seen = new Set<string>()
  const teams: Array<{ sourceTeamId: string | null; teamName: string }> = []
  for (const label of labels) {
    const normalized = normalizeTeamLabel(label)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    teams.push({ teamName: label, sourceTeamId: sourceByLabel.get(normalized) ?? null })
  }

  const numeric = assignFantraxTeamIds(teams)
  const map = new Map<string, string>()
  for (const [normalized, id] of numeric) map.set(normalized, String(id))
  return map
}

/**
 * 🛑 THIS COUNTED THE WHOLE LEAGUE'S PLAYER POOL AND CALLED IT A LINEUP.
 *
 * `roster_positions` means STARTING SLOTS — Sleeper's is ["QB","RB","RB","WR",…]
 * — and this returned a census of every rostered player in the league. Measured
 * on production: ["QB:89","RB:129","RWT:36","SFX:12","TE:51","WR:149"], which
 * sums to 466, the entire 12-team pool. `rosterSize` is derived from that sum, so
 * the League row claimed a 466-man roster.
 *
 * ⚠ FANTRAX'S API DOES NOT PUBLISH LINEUP SLOTS, so the honest output is nothing.
 * Emitting a positional breakdown of the pool is worse than emitting none: it is
 * confidently wrong, and every consumer that reads roster_positions as a lineup
 * gets a 466-slot one. The per-team roster SIZE is real and is returned
 * separately below.
 */
function buildRosterPositionCounts(): Array<{ position: string; count: number }> {
  return []
}

/**
 * How many players a team actually rosters, from the rosters themselves.
 *
 * ⚠ THE MEDIAN, NOT THE SUM AND NOT THE MAX. Teams legitimately differ (36–43 on
 * the measured league) because of open slots and IR; the sum is the league pool
 * and the max is whoever is carrying most. The median is the league's real roster
 * size and is stable against one outlier.
 */
function medianRosterSize(players: LegacyRosterPlayer[]): number | null {
  const byTeam = new Map<string, number>()
  for (const player of players) {
    const team = asString(player.teamName).trim().toLowerCase()
    if (!team) continue
    byTeam.set(team, (byTeam.get(team) ?? 0) + 1)
  }
  const counts = Array.from(byTeam.values()).sort((a, b) => a - b)
  if (counts.length === 0) return null
  const mid = Math.floor(counts.length / 2)
  return counts.length % 2 === 0 ? Math.round((counts[mid - 1]! + counts[mid]!) / 2) : counts[mid]!
}

function buildRosterPlayerMap(players: LegacyRosterPlayer[]): Record<string, { name: string; position: string; team: string }> {
  const map: Record<string, { name: string; position: string; team: string }> = {}
  for (const player of players) {
    const playerId = asString(player.fantraxId)
    if (!playerId) continue
    map[playerId] = {
      /*
       * ⚠ A RAW FANTRAX ID IS NOT A NAME. `|| playerId` put "069b6" in the name
       * field, so an unresolved player rendered on the roster as though that
       * WERE his name — measured 10 of 39 on a real college league, because
       * roughly one id in twenty is absent from Fantrax's player map
       * (graduated or inactive). resolveRosters deliberately keeps those rows
       * with a null name rather than dropping them, and this is where that null
       * was being turned back into a confident-looking string.
       *
       * The id stays visible, but labelled as the unknown it is: nothing
       * downstream should match on it, and a hex id would not have matched
       * either.
       */
      name: asString(player.name) || `Unknown player (${playerId})`,
      position: (asString(player.primaryPosition) || asString(player.position) || 'N/A').toUpperCase(),
      team: asString(player.nflTeam),
    }
  }
  return map
}

function buildSyntheticPlayerId(playerName: string, fallback: string): string {
  const slug = slugify(playerName)
  return `fantrax-player:${slug || fallback}`
}

function resolveTeamId(teamLabel: string, teamMap: Map<string, string>): string | null {
  const normalized = normalizeTeamLabel(teamLabel)
  if (!normalized) return null
  return teamMap.get(normalized) ?? null
}

/**
 * Does this caller's own Fantrax account hold that team in that league?
 *
 * The Secret ID is the only thing Fantrax offers that identifies a PERSON —
 * `getLeagues` is the one endpoint keyed on it, and it names the teams the holder
 * owns. Everything else in this integration is keyed on a league id (public) or a
 * team name (a display string, not an identity).
 *
 * ⚠ FAILS CLOSED, DELIBERATELY. No stored credential, an API failure, a thrown
 * import — every one returns false, which leaves the ownership guard in
 * `importFantraxLeague` exactly as strict as it was. This can only ever GRANT
 * ownership on a positive answer from Fantrax itself, never assume it.
 */
async function callerOwnsFantraxTeam(
  userId: string,
  leagueId: string,
  teamName: string,
): Promise<boolean> {
  try {
    const { getDecryptedAuth } = await import('@/lib/league-sync-core')
    const auth = await getDecryptedAuth(userId, 'fantrax')
    const secretId = auth?.apiKey?.trim()
    if (!secretId) return false

    const { getFantraxLeagues } = await import('./fantraxApi')
    const res = await getFantraxLeagues(secretId)
    if (!res.ok) return false

    const wanted = teamName.trim().toLowerCase()
    return res.data.some(
      (league) =>
        league.leagueId === leagueId &&
        league.teamNames.some((name) => name.trim().toLowerCase() === wanted),
    )
  } catch {
    return false
  }
}

export async function fetchFantraxLeagueForImport(
  userId: string,
  sourceInput: string
): Promise<FantraxImportPayload> {
  if (!userId) {
    throw new FantraxImportConnectionError('Sign in before importing from Fantrax.')
  }

  const lookup = parseFantraxSourceInput(sourceInput)
  let liveScoringRules: Array<{ stat_key: string; points_value: number }> = []
  let liveScoringGaps: string[] = []

  /*
   * ⚠ A LIVE LEAGUE IS FETCHED HERE, THEN READ BACK AS A SNAPSHOT. Fantrax has a
   * real read API, so a league id needs no CSV — but everything downstream
   * (normalisation, backfill, the ownership gate below) is written against a
   * stored snapshot. Materialising the row first means the live path and the
   * upload path converge on one code path instead of two that drift.
   *
   * The import stamps `appUserId` with this caller, so the gate below still
   * decides ownership; this does not bypass it.
   */
  if (lookup.nativeLeague) {
    const ownershipVerified = await callerOwnsFantraxTeam(
      userId,
      lookup.nativeLeague.leagueId,
      lookup.nativeLeague.teamName,
    )
    const { importFantraxLeague } = await import('./importFantraxLeague')
    const outcome = await importFantraxLeague({
      leagueId: lookup.nativeLeague.leagueId,
      teamName: lookup.nativeLeague.teamName,
      appUserId: userId,
      ownershipVerified,
    })
    if (!outcome.ok) {
      throw new FantraxImportLeagueNotFoundError(outcome.error)
    }
    lookup.leagueRecordId = outcome.fantraxLeagueId
    /*
     * ⚠ CARRIED FROM THE IMPORT, NOT FROM THE SNAPSHOT. `scoringRules` was
     * hardcoded to [] because the CSV export never contained scoring settings.
     * The live API does, in the getLeagueInfo call the import already makes —
     * and there is no settings column to put it in, so it rides along with this
     * request. A CSV-sourced league still gets [], which is the truth for it.
     */
    liveScoringRules = outcome.scoringRules
    liveScoringGaps = outcome.scoringGaps
  }

  const includeConfig = {
    user: {
      select: {
        id: true,
        fantraxUsername: true,
      },
    },
  } as const

  let leagueRecord:
    | (Awaited<ReturnType<typeof prisma.fantraxLeague.findUnique>> & {
        user: { id: string; fantraxUsername: string }
        appUserId: string | null
      })
    | null = null

  if (lookup.leagueRecordId) {
    leagueRecord = await prisma.fantraxLeague.findUnique({
      where: { id: lookup.leagueRecordId },
      include: includeConfig,
    }) as any
  } else if (lookup.username) {
    leagueRecord = await prisma.fantraxLeague.findFirst({
      where: {
        user: { fantraxUsername: lookup.username },
        leagueName: lookup.leagueName ?? undefined,
        season: lookup.season ?? undefined,
      },
      orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
      include: includeConfig,
    }) as any
  }

  // Import Security Closure phase — real ownership enforcement. A snapshot
  // ID or username|season|leagueName lookup is not authorization. Reject
  // with the same "not found" error used for a genuinely missing snapshot
  // (never a distinct "forbidden" message) so an unauthorized caller can't
  // use this to probe which snapshots exist. A row with `appUserId: null`
  // (a legacy/unattributed row from before this phase) is not importable by
  // anyone until it is re-uploaded by its real owner — fails closed rather
  // than fabricating ownership.
  if (!leagueRecord || leagueRecord.appUserId !== userId) {
    throw new FantraxImportLeagueNotFoundError(
      'Fantrax league not found. Use a Fantrax legacy league ID (UUID), or username|season|leagueName.'
    )
  }

  const username = leagueRecord.user?.fantraxUsername ?? lookup.username ?? 'fantrax-user'
  const season = leagueRecord.season ?? new Date().getFullYear()
  const standings = parseStandings(leagueRecord.standings)
  const matchups = parseMatchups(leagueRecord.matchups)
  const rosterPlayers = parseRoster(leagueRecord.roster)
  const transactionRows = parseTransactions(leagueRecord.transactions)
  const userTeam = leagueRecord.userTeam?.trim() || username
  const sport = resolveFantraxSport(leagueRecord.sport ?? '', Boolean(leagueRecord.isDevy))
  const teamMap = buildTeamIdMap({
    standings,
    matchups,
    userTeam,
  })
  const rosterPlayerMap = buildRosterPlayerMap(rosterPlayers)
  /*
   * ⚠ ROSTERS ARE PER TEAM NOW. Everything used to be attributed to the
   * uploader's team because a CSV export contained nothing else; the live API
   * returns all of them, so they are grouped by the `teamName` each row carries.
   * An untagged row is a CSV-era roster and still falls to the uploader.
   */
  const rosterByTeam = new Map<string, LegacyRosterPlayer[]>()
  for (const player of rosterPlayers) {
    const label = normalizeTeamLabel(asString(player.teamName)) || normalizeTeamLabel(userTeam)
    if (!label) continue
    const bucket = rosterByTeam.get(label)
    if (bucket) bucket.push(player)
    else rosterByTeam.set(label, [player])
  }
  const userTeamId = resolveTeamId(userTeam, teamMap)
  const standingsByNormalizedTeam = new Map<string, LegacyStanding>()
  for (const standing of standings) {
    const label = asString(standing.team)
    const normalized = normalizeTeamLabel(label)
    if (normalized) standingsByNormalizedTeam.set(normalized, standing)
  }

  const teams: FantraxImportTeam[] = Array.from(teamMap.entries()).map(([normalizedLabel, teamId], index) => {
    const standing = standingsByNormalizedTeam.get(normalizedLabel)
    const teamName = asString(standing?.team) || normalizedLabel
    const isUserTeam = normalizeTeamLabel(userTeam) === normalizedLabel
    const ownPlayers = rosterByTeam.get(normalizedLabel) ?? []
    const teamPlayerMap = ownPlayers.length
      ? buildRosterPlayerMap(ownPlayers)
      : isUserTeam
        ? rosterPlayerMap
        : {}
    const rosterPlayerIds = Object.keys(teamPlayerMap)
    /*
     * The same source `teamPlayerMap` was built from, so the lineup split and
     * the player map can never describe different squads.
     */
    const lineupSource = ownPlayers.length > 0 ? ownPlayers : isUserTeam ? rosterPlayers : []
    const lineup = splitLineup(lineupSource)
    return {
      teamId,
      managerId: isUserTeam ? `fantrax-user:${username}` : `fantrax-manager:${slugify(teamName) || teamId}`,
      managerName: isUserTeam ? username : teamName,
      teamName,
      logoUrl: null,
      wins: asNumber(standing?.wins, 0) ?? 0,
      losses: asNumber(standing?.losses, 0) ?? 0,
      ties: asNumber(standing?.ties, 0) ?? 0,
      /*
       * ⚠ NO INVENTED RANK. This was `index + 1`, so a league with no standings
       * got a table numbered by whatever order the rosters arrived in — which
       * looks authoritative and disagrees with the league. Real standings come
       * from Fantrax's getStandings; when they are missing this stays null and
       * the adapter reports the coverage as partial rather than full.
       */
      rank: asNumber(standing?.rank, null),
      pointsFor: asNumber(standing?.pointsFor, 0) ?? 0,
      pointsAgainst: asNumber(standing?.pointsAgainst, null),
      faabRemaining: null,
      waiverPriority: null,
      rosterPlayerIds,
      /*
       * 🛑 THIS WAS HARDCODED `[]`, AND EVERY PLAYER WAS FILED AS BENCH.
       * `Roster.playerData.starters` is what My Team renders a lineup from, so an
       * empty array meant a Fantrax league showed "no starting lineup recorded"
       * AND "no bench players recorded" while holding a full 39-man roster —
       * measured on production before this change. The mapper, the normalized
       * type and the persistence layer all carried `starter_ids` already; only
       * this line never filled it.
       */
      starterPlayerIds: lineup?.starters ?? [],
      reservePlayerIds: lineup?.reserve ?? rosterPlayerIds,
      playerMap: teamPlayerMap,
    }
  })

  const scheduleByWeek = new Map<number, FantraxImportPayload['schedule'][number]['matchups']>()
  for (const matchup of matchups) {
    const week = asNumber(matchup.week, null)
    if (week == null || week < 1) continue
    const awayTeamName = asString(matchup.awayTeam)
    const homeTeamName = asString(matchup.homeTeam)
    const teamId1 = resolveTeamId(awayTeamName, teamMap)
    const teamId2 = resolveTeamId(homeTeamName, teamMap)
    if (!teamId1 || !teamId2) continue
    if (!scheduleByWeek.has(week)) scheduleByWeek.set(week, [])
    scheduleByWeek.get(week)!.push({
      teamId1,
      teamId2,
      points1: asNumber(matchup.awayScore, null) ?? undefined,
      points2: asNumber(matchup.homeScore, null) ?? undefined,
      isPlayoff: asBoolean(matchup.isPlayoff),
    })
  }

  const schedule = Array.from(scheduleByWeek.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, weekMatchups]) => ({
      week,
      season,
      matchups: weekMatchups,
    }))

  /*
   * ⚠ THE CURRENT WEEK IS THE EARLIEST UNSCORED ONE, NEVER `max(week)`.
   *
   * This read `schedule[schedule.length - 1].week` — the LAST week on file —
   * which is correct only while every stored week is a completed one. The
   * schedule is bootstrapped whole from `getLeagueInfo`, so on Cream Bowl that
   * resolved to week 13 on 2026-08-30, two days before period 1 opens. It is
   * the same failure `lib/core-app/currentWeek.ts` documents at length for the
   * Sleeper path, reached independently here.
   *
   * ⚠ AND A WEEK WITH NO SCORE ON FILE IS UNPLAYED, WHICH IS NOT THE SAME AS
   * 0-0. `points1`/`points2` are `undefined` for a period Fantrax has not
   * scored (the fetch deliberately does not default them to zero), so absence
   * is the test — a genuine scoreless week has real zeros and counts as played.
   */
  const firstUnscored = schedule.find((week) =>
    week.matchups.every((m) => m.points1 == null && m.points2 == null),
  )
  const currentWeek =
    firstUnscored?.week ?? (schedule.length > 0 ? schedule[schedule.length - 1].week : null)

  const transactions: FantraxImportTransaction[] = transactionRows.map((transaction, index) => {
    const type = asString(transaction.type).toLowerCase()
    const normalizedType =
      type === 'trade' ? 'trade' : type === 'drop' ? 'drop' : type === 'claim' ? 'waiver' : 'free_agent'
    const playerName = asString(transaction.player)
    const fallbackPlayer = `tx-${index + 1}`
    const playerId = buildSyntheticPlayerId(playerName, fallbackPlayer)
    const managerTeamId = resolveTeamId(asString(transaction.managerTeam), teamMap)
    const fromTeamId = resolveTeamId(asString(transaction.fromTeam), teamMap)
    const toTeamId = resolveTeamId(asString(transaction.toTeam), teamMap)
    const teamId = resolveTeamId(asString(transaction.team), teamMap)
    const rosterIds = Array.from(
      new Set([managerTeamId, fromTeamId, toTeamId, teamId].filter((id): id is string => Boolean(id)))
    )
    const adds: Record<string, string> = {}
    const drops: Record<string, string> = {}

    if (normalizedType === 'waiver' || normalizedType === 'free_agent') {
      const destination = toTeamId ?? managerTeamId ?? teamId
      if (destination && playerName) adds[playerId] = destination
    } else if (normalizedType === 'drop') {
      const sourceTeamId = fromTeamId ?? managerTeamId ?? teamId
      if (sourceTeamId && playerName) drops[playerId] = sourceTeamId
    } else if (normalizedType === 'trade') {
      if (fromTeamId && playerName) drops[playerId] = fromTeamId
      if (toTeamId && playerName) adds[playerId] = toTeamId
    }

    return {
      transactionId: `fantrax:${leagueRecord.id}:tx:${index + 1}:${slugify(playerName || fallbackPlayer)}`,
      type: normalizedType,
      status: 'completed',
      createdAt: toIsoDate(transaction.date),
      teamIds: rosterIds,
      adds,
      drops,
      isDraftPick: asBoolean(transaction.isDraftPick),
      pickRound: asNumber(transaction.pickRound, null),
      pickNumber: asNumber(transaction.pickNumber, null),
      playerId,
      playerName: playerName || null,
      position: asString(transaction.position) || null,
      team: asString(transaction.team) || null,
    }
  })

  const draftPicks: FantraxImportDraftPick[] = transactions
    .filter((transaction) => transaction.isDraftPick)
    .map((transaction) => {
      const round = transaction.pickRound ?? null
      const pickNumber = transaction.pickNumber ?? null
      if (round == null || pickNumber == null) return null
      /*
       * ⚠ DELIBERATELY NOT NUMERIC, NOW THAT REAL TEAM IDS ARE. This is the
       * "we could not attribute this pick to anyone" sentinel; giving it a
       * number would make it indistinguishable from a real team and silently
       * award every unattributed pick to whoever hashed to that id.
       */
      const teamId = transaction.teamIds[0] ?? userTeamId ?? 'fantrax-team:unknown'
      const draftPlayerId = `fantrax-draft-pick:r${round}:p${pickNumber}`
      return {
        round,
        pickNumber,
        teamId,
        playerId: draftPlayerId,
        playerName: transaction.playerName ?? `Draft Pick R${round}P${pickNumber}`,
        position: null,
        team: null,
      } satisfies FantraxImportDraftPick
    })
    .filter(Boolean) as FantraxImportDraftPick[]

  const previousSeasonRecords = await prisma.fantraxLeague.findMany({
    where: {
      userId: leagueRecord.userId,
      leagueName: leagueRecord.leagueName,
      season: { lt: season },
    },
    select: {
      id: true,
      season: true,
    },
    orderBy: { season: 'desc' },
    take: 8,
  })

  return {
    sourceInput,
    league: {
      leagueId: leagueRecord.id,
      name: leagueRecord.leagueName,
      sport,
      season,
      size: leagueRecord.teamCount || teams.length,
      currentWeek,
      isFinished: season < new Date().getFullYear(),
      url: null,
      isDevy: Boolean(leagueRecord.isDevy),
    },
    settings: {
      scoringType: leagueRecord.isDevy ? 'devy' : null,
      rosterPositions: buildRosterPositionCounts(),
      /* The real per-team size, so the mapper stops deriving it from the pool. */
      rosterSize: medianRosterSize(rosterPlayers),
      scoringRules: liveScoringRules.map((r) => ({ statKey: r.stat_key, points: r.points_value })),
      raw: {
        isDevy: leagueRecord.isDevy,
        sport: leagueRecord.sport,
        teamCount: leagueRecord.teamCount,
        /* Categories the mapper could not place. Surfaced as coverage rather
           than dropped: a scoring rule we silently skipped is a wrong score. */
        ...(liveScoringGaps.length > 0 ? { scoringGaps: liveScoringGaps } : {}),
      },
    },
    teams,
    schedule,
    transactions,
    draftPicks,
    playerMap: rosterPlayerMap,
    previousSeasons: previousSeasonRecords.map((record) => ({
      season: String(record.season),
      sourceLeagueId: record.id,
    })),
  }
}

/**
 * Test seam for `splitLineup`. Exported under a distinct name so the rule can be
 * pinned by tests without inviting new production callers to reach past the
 * fetch service for it.
 */
export { splitLineup as splitLineupForTest }
