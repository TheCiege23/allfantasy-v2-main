import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import type { LiveEvent } from '@/lib/live/eventDetector'
import { headlineFor, PLAY_FEED_SPORT } from '@/lib/live/playFeedPresentation'
import { headshotUrl } from '@/lib/media-url'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { SCORING_SEASON_STATUSES } from '@/lib/redraft/seasonStatus'
import { leagueIdentityColumns, type LeagueIdentityColumn } from '@/lib/player-identity/externalIdNamespace'

/**
 * Turn live play events into notifications — but only for the managers who
 * actually START the player.
 *
 * ⚠ THE ROSTER SCOPE IS THE WHOLE FEATURE. An alert for every 20-yard run in
 * the league is a notification every few seconds on a Sunday, which trains
 * people to mute the app. Sleeper feels good because it tells you about YOUR
 * players. Everything below exists to keep that true.
 *
 * User decision, 2026-09-13: every score and every play of 20+ yards, to the
 * managers STARTING the player (a benched player's touchdown scores nothing for
 * you), by push + the in-app bell — never email or SMS.
 *
 * ⚠ NEVER ALERT ON A NEGATIVE DELTA. A cumulative stat going DOWN is a stat
 * correction, not a play — the vendor reprocesses for ~12h after a game and
 * ships no correction flag, so a revision is indistinguishable from a new event
 * except by its sign. Without this guard a correction fires a phantom
 * "20-yard run" for a run that was taken away.
 */

/**
 * What we will interrupt someone's Sunday for.
 *
 * FIELD_GOAL was deliberately excluded until 2026-09-13 ("the kicker's owner
 * cares, nobody else does"). The recipients are now exactly the managers
 * starting that kicker, which is the one audience that argument granted, and the
 * user asked for every score.
 */
const ALERTABLE: ReadonlySet<LiveEvent['type']> = new Set([
  'TOUCHDOWN',
  'BIG_PLAY',
  'FIELD_GOAL',
  'DEFENSIVE_SCORE',
  'SPECIAL_TEAMS_SCORE',
  'TURNOVER',
  // A score, worth 2 to the passer and the scorer — and never announced as the touchdown before it.
  'TWO_POINT_CONVERSION',
])

/**
 * Slots that do not score. Redraft rows spell them in both cases ('bench' and
 * 'BENCH' are both written by different engines), so every spelling seen in the
 * code is listed rather than trusting one.
 */
const NON_STARTER_SLOTS = [
  'bench', 'BENCH', 'Bench',
  'ir', 'IR',
  'taxi', 'TAXI',
  'devy', 'DEVY',
  'free_agent',
  'pro_bench', 'pro_ir', 'college',
]

export type NotifyResult = {
  eventsConsidered: number
  eventsAlertable: number
  notificationsSent: number
  skipped: 'no-events' | 'no-rosters' | null
}

export type PlayerLeagueImpact = {
  leagueId: string
  leagueName: string
  platform: string
  guillotine: boolean
  rank: number | null
}

type UserImpact = { userId: string; leagues: PlayerLeagueImpact[] }

function idsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item : String((item as { id?: unknown } | null)?.id ?? ''))
    .filter(Boolean)
}

/**
 * 🛑 EVERY LOOKUP BELOW IS SCOPED TO ONE SPORT, AND A CALL WITHOUT ONE RESOLVES NOBODY.
 *
 * Every id in play here is per provider AND per sport: Rolling Insights numbers players per sport,
 * and ESPN, Fantrax and Sleeper ids overlap numerically across people and sports. Measured on
 * production 2026-10-11: all 9,567 NFL RI ids are also the RI id of some MLB / NBA / NHL / NCAAB /
 * NCAAF / soccer identity row; 2,824 MLB and 8,056 NCAAF identity rows carry a `fantraxId` and
 * 2,346 NCAAB rows an `espnId`. Unscoped, an NFL play's RI id pulled those rows in, their ids were
 * matched against every league's starters, and a push could say an NFL play happened "Starting in"
 * a college league. The roster side has the same hazard — 4 NHL rosters start an id that is also
 * an RI-linked NFL Sleeper id — so the LEAGUE is scoped too, not only the identity row.
 *
 * Returns the sport normalised, or null when none was given; callers return an empty map on null
 * rather than run an unscoped query.
 */
function scopeSport(sport: string | null | undefined): string | null {
  const value = typeof sport === 'string' ? sport.trim().toUpperCase() : ''
  return value || null
}

/** Every `PlayerIdentityMap` column a league's roster ids can be written in (`leagueIdentityColumns`). */
const LEAGUE_IDENTITY_COLUMNS: readonly LeagueIdentityColumn[] = [
  'sleeperId', 'espnId', 'fantraxId', 'mflId', 'fleaflickerId', 'rollingInsightsId',
]

/**
 * Resolve the exact imported leagues in which each player is starting.
 *
 * 🛑 EACH ROSTER IS MATCHED ONLY ON ITS OWN LEAGUE'S ID COLUMN (`leagueIdentityColumns`). This used
 * to pool sleeperId, espnId, fantraxId, mflId and fleaflickerId into one map and match it against
 * every roster in the sport, so a Fleaflicker or ESPN starter whose number happened to be the
 * play's player's SLEEPER id was told "your starter scored" about a stranger. Measured on
 * production 2026-10-12: 23 of 120 Fleaflicker and 6 of 907 ESPN NFL starter slots hold an NFL
 * Sleeper id that is not their own player, and 20 distinct Sleeper/native starter ids are some other
 * NFL player's ESPN/Fleaflicker/MFL/Fantrax id. Yahoo (and any platform with no column) resolves
 * nobody — `rosterIdSpace` treats its ids as foreign; production holds no Yahoo rosters today.
 */
export async function starterImpactsByPlayerId(
  playerIds: string[],
  sportInput: string,
): Promise<Map<string, UserImpact[]>> {
  const out = new Map<string, UserImpact[]>()
  const sport = scopeSport(sportInput)
  const unique = [...new Set(playerIds.filter(Boolean))]
  if (unique.length === 0 || !sport) return out

  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport, rollingInsightsId: { in: unique } },
    select: {
      rollingInsightsId: true,
      sport: true,
      sleeperId: true,
      espnId: true,
      fantraxId: true,
      mflId: true,
      fleaflickerId: true,
    },
  }).catch(() => [])

  // One map PER COLUMN: the same number in two columns is two different people.
  const riByColumn = new Map<LeagueIdentityColumn, Map<string, string>>()
  const allCandidates = new Set<string>()
  for (const identity of identities) {
    if (!identity.rollingInsightsId) continue
    // Belt and braces for the `where`: another sport's row never contributes an id.
    if ((identity.sport ?? '').toUpperCase() !== sport) continue
    for (const column of LEAGUE_IDENTITY_COLUMNS) {
      const value = identity[column]
      if (!value) continue
      const byId = riByColumn.get(column) ?? new Map<string, string>()
      byId.set(String(value), identity.rollingInsightsId)
      riByColumn.set(column, byId)
      allCandidates.add(String(value))
    }
  }
  if (allCandidates.size === 0) return out

  // The query may over-fetch (any column's id); the per-platform match below is what decides.
  const candidates = [...allCandidates]
  const rosters = await prisma.roster.findMany({
    where: {
      // The same numeric id names a different player in another sport's league.
      league: { sport: sport as LeagueSport },
      OR: candidates.map((id) => ({ playerData: { path: ['starters'], array_contains: [id] } })),
    },
    select: {
      platformUserId: true,
      playerData: true,
      redraftRoster: { select: { ownerId: true } },
      league: {
        select: {
          id: true,
          name: true,
          platform: true,
          guillotineMode: true,
          teams: {
            select: { platformUserId: true, claimedByUserId: true, currentRank: true },
          },
        },
      },
    },
  }).catch(() => [])

  const possibleUserIds = [...new Set(rosters.flatMap((roster) => [
    roster.platformUserId,
    roster.redraftRoster?.ownerId ?? '',
    ...roster.league.teams.map((team) => team.claimedByUserId ?? ''),
  ]).filter(Boolean))]
  const appUsers = await prisma.appUser.findMany({
    where: { id: { in: possibleUserIds } },
    select: { id: true },
  }).catch(() => [])
  const appUserIds = new Set(appUsers.map((user) => user.id))

  for (const roster of rosters) {
    const data = roster.playerData && typeof roster.playerData === 'object' && !Array.isArray(roster.playerData)
      ? roster.playerData as Record<string, unknown>
      : {}
    const normalized = getNormalizedLineupSections(data)
    const starters = new Set(
      normalized.starters.length > 0
        ? normalized.starters.map((row) => String(row.id))
        : idsFrom(data.starters),
    )
    const team = roster.league.teams.find((row) => row.platformUserId === roster.platformUserId)
      ?? roster.league.teams.find((row) => row.claimedByUserId === roster.platformUserId)
    const userId = team?.claimedByUserId
      ?? (appUserIds.has(roster.platformUserId) ? roster.platformUserId : null)
      ?? (roster.redraftRoster?.ownerId && appUserIds.has(roster.redraftRoster.ownerId)
        ? roster.redraftRoster.ownerId
        : null)
    if (!userId) continue

    const matches: string[] = []
    for (const { column, ids } of leagueIdentityColumns([...starters], sport, roster.league.platform)) {
      const byId = riByColumn.get(column)
      if (!byId) continue
      for (const id of ids) {
        const riId = byId.get(id)
        if (riId) matches.push(riId)
      }
    }
    for (const riId of matches) {
      const users = out.get(riId) ?? []
      let user = users.find((row) => row.userId === userId)
      if (!user) {
        user = { userId, leagues: [] }
        users.push(user)
      }
      if (!user.leagues.some((league) => league.leagueId === roster.league.id)) {
        user.leagues.push({
          leagueId: roster.league.id,
          leagueName: roster.league.name ?? 'Imported league',
          platform: roster.league.platform,
          guillotine: roster.league.guillotineMode === true,
          rank: team?.currentRank ?? null,
        })
      }
      out.set(riId, users)
    }
  }

  return out
}

/**
 * Map players to the users who roster them — or, with `startersOnly`, who have
 * them in a starting lineup — for seasons still being played (`SCORING_SEASON_STATUSES`) only.
 *
 * A dropped player keeps his row until `droppedAt` is set, so filtering on it
 * is what stops a manager being told about someone they cut last week.
 *
 * Exported for reuse by the injury importer — same recipients question, same
 * id-space rules (Rolling Insights ids in, AF user ids out; no identity row,
 * no guess). The importer wants the whole roster, so `startersOnly` defaults off.
 *
 * `sport` is required and scopes the identity rows AND the leagues — see `scopeSport`.
 */
export async function ownersByPlayerId(
  playerIds: string[],
  opts: { startersOnly?: boolean; sport: string },
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const sport = scopeSport(opts?.sport)
  if (playerIds.length === 0 || !sport) return out

  /*
   * ⚠ THE FEED AND THE ROSTERS SPEAK DIFFERENT ID LANGUAGES. Play events carry
   * Rolling Insights ids; redraft roster rows carry the draft pick's SLEEPER
   * id. Both are numeric strings, so joining them directly does not fail — it
   * silently matches the wrong player, or nobody. Cross through
   * PlayerIdentityMap once here and share the translation with both branches.
   * A player with no identity row is skipped, not guessed at.
   */
  const found = await prisma.playerIdentityMap
    .findMany({
      where: { sport, rollingInsightsId: { in: playerIds }, sleeperId: { not: null } },
      select: { rollingInsightsId: true, sleeperId: true, sport: true },
    })
    .catch(() => [])
  // Belt and braces for the `where`: another sport's row never contributes an id.
  const identities = (found ?? []).filter((identity) => (identity.sport ?? '').toUpperCase() === sport)

  const riIdBySleeperId = new Map<string, string>()
  for (const identity of identities) {
    if (identity.rollingInsightsId && identity.sleeperId) {
      riIdBySleeperId.set(identity.sleeperId, identity.rollingInsightsId)
    }
  }
  if (riIdBySleeperId.size === 0) return out

  const rows = await prisma.redraftRosterPlayer
    .findMany({
      where: {
        playerId: { in: [...riIdBySleeperId.keys()] },
        droppedAt: null,
        /*
         * 🛑 NOT `status: 'active'`. `RedraftSeason.status` has two writers that disagree
         * (`lib/redraft/seasonStatus.ts`): native drafts write 'active', imports write
         * 'in_season'. Measured on production 2026-10-11: 534 NFL seasons are 'in_season' and
         * ONE is 'active', so the old filter told almost no redraft manager about anything.
         * SCORING_SEASON_STATUSES is the shared "games are still being played and scored" set —
         * both spellings plus 'playoffs', where a starter's touchdown still decides a matchup.
         */
        roster: { season: { status: { in: [...SCORING_SEASON_STATUSES] }, sport } },
        ...(opts.startersOnly ? { NOT: { slotType: { in: NON_STARTER_SLOTS } } } : {}),
      },
      select: { playerId: true, roster: { select: { ownerId: true } } },
    })
    .catch(() => [])

  for (const row of rows) {
    const owner = row.roster?.ownerId
    if (!owner) continue
    const riId = riIdBySleeperId.get(row.playerId)
    if (!riId) continue
    const list = out.get(riId) ?? []
    // One manager can hold the same player in several leagues; one alert is
    // enough, so the owner list is deduped per player.
    if (!list.includes(owner)) list.push(owner)
    out.set(riId, list)
  }

  /*
   * ⚠ IMPORTED LEAGUES ARE THE MAJORITY AND LIVE IN A DIFFERENT SHAPE. Redraft
   * rosters are relational rows; imported (Sleeper) rosters are a JSON blob on
   * `Roster.playerData`, holding SLEEPER player ids under `.players` (the whole
   * roster) and `.starters` (the lineup). Measured: 205 redraft roster rows
   * against 914 imported ones. Querying only the first means the feature fires
   * for a fifth of the league and looks broken to everyone else.
   *
   * The ids do not match either — the play feed speaks Rolling Insights ids —
   * so this crosses through PlayerIdentityMap, which carries both spellings on
   * the same row. A player with no identity row is skipped, not guessed at.
   */
  await addImportedLeagueOwners(identities, out, opts.startersOnly === true, sport)
  return out
}

/*
 * Two fixed statements rather than one with an interpolated key: the JSON key is
 * never built from a string at runtime, so there is nothing to inject into.
 * The sport is a bound parameter ($2) for the same reason.
 *
 * ⚠ SLEEPER LEAGUES ONLY. $1 is a SLEEPER player id and the owner is resolved as a SLEEPER user id,
 * so only a league whose roster ids are Sleeper's may answer — the same per-platform rule as
 * `starterImpactsByPlayerId`. Unscoped, a Fleaflicker/ESPN roster holding that number (29 NFL starter
 * slots on production, 2026-10-12) matched; only the owner-id translation failing kept it from
 * reaching anyone. Native leagues hold Sleeper ids too, but their owners are AF users and are
 * resolved by `starterImpactsByPlayerId`, not here.
 */
const ROSTERED_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         JOIN leagues l ON l.id = r."leagueId"
         WHERE l.sport::text = $2
           AND lower(l.platform) = 'sleeper'
           AND r."playerData"->'players' @> $1::jsonb`
const STARTING_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         JOIN leagues l ON l.id = r."leagueId"
         WHERE l.sport::text = $2
           AND lower(l.platform) = 'sleeper'
           AND r."playerData"->'starters' @> $1::jsonb`

/**
 * Resolve imported-league owners for the same players.
 *
 * Uses a JSONB containment test rather than loading every roster: `@>` asks
 * whether the array contains that id, which Postgres can answer without us
 * pulling 914 blobs into memory every poll.
 */
async function addImportedLeagueOwners(
  identities: Array<{ rollingInsightsId: string | null; sleeperId: string | null }>,
  out: Map<string, string[]>,
  startersOnly: boolean,
  sport: string,
): Promise<void> {
  try {
    if (identities.length === 0) return

    // riId → the Sleeper user ids rostering that player on imported leagues.
    const sleeperOwnersByRiId = new Map<string, string[]>()
    for (const identity of identities) {
      const riId = identity.rollingInsightsId
      const sleeperId = identity.sleeperId
      if (!riId || !sleeperId) continue

      const rosters = await prisma.$queryRawUnsafe<Array<{ platformUserId: string }>>(
        startersOnly ? STARTING_SQL : ROSTERED_SQL,
        JSON.stringify([sleeperId]),
        sport,
      )

      const list = sleeperOwnersByRiId.get(riId) ?? []
      for (const row of rosters) {
        if (row.platformUserId && !list.includes(row.platformUserId)) {
          list.push(row.platformUserId)
        }
      }
      if (list.length > 0) sleeperOwnersByRiId.set(riId, list)
    }
    if (sleeperOwnersByRiId.size === 0) return

    /*
     * ⚠ platformUserId, NOT our user id. On an imported league this is the
     * SLEEPER user id, and NOTHING downstream resolves it — the dispatcher
     * looks profiles up by our user id and silently skips ids it does not
     * know. Translate here through UserProfile.sleeperUserId. A Sleeper
     * manager who never linked an AF account has nowhere to receive the
     * alert and is skipped.
     */
    const sleeperUserIds = [...new Set([...sleeperOwnersByRiId.values()].flat())]
    const profiles = await prisma.userProfile.findMany({
      where: { sleeperUserId: { in: sleeperUserIds } },
      select: { userId: true, sleeperUserId: true },
    })
    const userIdBySleeperId = new Map<string, string>()
    for (const profile of profiles) {
      if (profile.sleeperUserId) userIdBySleeperId.set(profile.sleeperUserId, profile.userId)
    }

    for (const [riId, sleeperOwners] of sleeperOwnersByRiId) {
      const list = out.get(riId) ?? []
      for (const sleeperUserId of sleeperOwners) {
        const userId = userIdBySleeperId.get(sleeperUserId)
        if (userId && !list.includes(userId)) list.push(userId)
      }
      if (list.length > 0) out.set(riId, list)
    }
  } catch {
    // Imported-league resolution is additive. If it fails, redraft managers
    // still get their alerts rather than nobody getting any.
  }
}

/** The line a manager actually reads on their phone. */
export function notificationTitleFor(event: LiveEvent): string {
  const yards = Number.isFinite(event.delta) ? Math.round(event.delta) : 0
  switch (event.type) {
    case 'TOUCHDOWN':
      return yards >= 20 ? `${yards}-yard touchdown` : 'Touchdown'
    case 'BIG_PLAY':
      return 'Big play'
    case 'FIELD_GOAL':
      return 'Field goal'
    case 'DEFENSIVE_SCORE':
      return yards >= 20 ? `${yards}-yard defensive touchdown` : 'Defensive touchdown'
    case 'SPECIAL_TEAMS_SCORE':
      return yards >= 20 ? `${yards}-yard return touchdown` : 'Special teams touchdown'
    case 'TURNOVER':
      return 'Turnover'
    case 'TWO_POINT_CONVERSION':
      return '2-pt conversion'
    default:
      return 'Live update'
  }
}

/**
 * A touchdown is worth waking someone up for. A 21-yard catch is not, quite.
 */
function severityFor(event: LiveEvent): NotificationEvent['severity'] {
  if (event.type === 'TOUCHDOWN' || event.type === 'DEFENSIVE_SCORE' || event.type === 'SPECIAL_TEAMS_SCORE') {
    return 'high'
  }
  if (event.type === 'TURNOVER' || event.type === 'FIELD_GOAL' || event.type === 'TWO_POINT_CONVERSION') return 'medium'
  return 'low'
}

/**
 * The same play told from the passer's side: "Kirk Cousins 34-yard TD pass to
 * Drake London". A passing touchdown scores for the QB's managers too, and the
 * play event is keyed on the receiver, so without this they heard nothing.
 */
function passerSide(event: LiveEvent): LiveEvent | null {
  if (!event.passerId || !event.passerName) return null
  if (event.type !== 'TOUCHDOWN' && event.type !== 'BIG_PLAY' && event.type !== 'TWO_POINT_CONVERSION') return null
  return {
    ...event,
    playerId: event.passerId,
    playerName: event.passerName,
    role: 'passer',
    passerId: null,
    passerName: null,
    receiverName: event.playerName,
  }
}

/**
 * Headshot per Rolling Insights player id, for the push picture. The feed speaks RI ids and the
 * headshot CDN speaks Sleeper ids, so this crosses PlayerIdentityMap like ownersByPlayerId does.
 * A player with no Sleeper identity gets no picture — the alert still goes out as text.
 *
 * Scoped to `sport` like every lookup here (see `scopeSport`). And `headshotUrl` builds Sleeper's
 * NFL CDN path, so a Sleeper id is only turned into a picture for NFL — anything else gets none.
 */
export async function headshotsByRiId(riIds: string[], sportInput: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sport = scopeSport(sportInput)
  const unique = [...new Set(riIds.filter(Boolean))]
  if (unique.length === 0 || sport !== 'NFL') return out
  const identities = await prisma.playerIdentityMap
    .findMany({
      where: { sport, rollingInsightsId: { in: unique }, sleeperId: { not: null } },
      select: { rollingInsightsId: true, sleeperId: true, sport: true },
    })
    .catch(() => [])
  for (const identity of identities ?? []) {
    if ((identity.sport ?? '').toUpperCase() !== sport) continue
    const url = headshotUrl(identity.sleeperId)
    if (identity.rollingInsightsId && url) out.set(identity.rollingInsightsId, url)
  }
  return out
}

function notificationFor(
  event: LiveEvent,
  userIds: string[],
  side: 'subject' | 'passer',
  impact?: UserImpact,
  imageUrl?: string | null,
): NotificationEvent {
  const leagues = impact?.leagues ?? []
  const leagueLine = leagues.length > 0
    ? ` Starting in ${leagues.map((league) =>
      `${league.leagueName}${league.guillotine && league.rank ? ` (#${league.rank}, guillotine)` : ''}`
    ).slice(0, 3).join(', ')}${leagues.length > 3 ? ` +${leagues.length - 3} more` : ''}.`
    : ''
  return {
    type: 'live_score_swing',
    title: notificationTitleFor(event),
    body: leagueLine ? `${headlineFor(event, null)}.${leagueLine}`.replace('..', '.') : headlineFor(event, null),
    userIds,
    severity: severityFor(event),
    source: 'live-plays',
    actionHref: '/core/live?sport=NFL',
    actionLabel: 'Live scores',
    /*
     * ⚠ NEVER EMAIL A BIG PLAY. The category default is in-app + email, and
     * an email per play on a Sunday is an inbox flood that burns the sending
     * domain. In-app + push (matchup_results is a push category) is the
     * whole interrupt.
     */
    skipChannels: { email: true, sms: true },
    meta: {
      gameId: event.gameId,
      playerId: event.playerId,
      playerName: event.playerName,
      team: event.team,
      eventType: event.type,
      stat: event.stat,
      // A try's delta is its two points, not yards.
      yards: event.type !== 'TWO_POINT_CONVERSION' && Number.isFinite(event.delta) ? Math.round(event.delta) : null,
      affectedLeagues: leagues,
      starterLeagueIds: leagues.map((league) => league.leagueId),
      /*
       * ⚠ CARRIED SO AN ALERT CAN BE RETRACTED. Officiating reversals happen
       * and the vendor ships no correction flag. Storing the key that
       * produced this notification is what lets a later reversal find it and
       * send a correction instead of leaving a manager believing a
       * touchdown that was overturned.
       *
       * It is also what makes each play its OWN notification in the engine's
       * cooldown key — see `buildSourceKey`.
       */
      idempotencyKey: event.idempotencyKey,
      /*
       * One device notification per play. The dispatcher's default tag is one
       * per category, so a second touchdown would silently replace the first on
       * the phone before anyone read it.
       */
      pushTag: `live-play:${event.idempotencyKey}:${side}`,
      // The player this side of the play is about — the scorer, or the passer on the passer's side.
      ...(imageUrl ? { imageUrl } : {}),
    },
  }
}

/**
 * Send notifications for a batch of live events.
 *
 * Returns counts rather than throwing: this runs on the game-day path behind
 * scoring, and a missed alert must never cost a score update.
 */
export async function notifyBigPlays(events: LiveEvent[]): Promise<NotifyResult> {
  if (events.length === 0) {
    return { eventsConsidered: 0, eventsAlertable: 0, notificationsSent: 0, skipped: 'no-events' }
  }

  const alertable = events.filter((e) => {
    if (!ALERTABLE.has(e.type)) return false
    // The correction guard. A stat that went down is a revision, not a play.
    if (typeof e.delta === 'number' && e.delta < 0) return false
    return true
  })

  if (alertable.length === 0) {
    return { eventsConsidered: events.length, eventsAlertable: 0, notificationsSent: 0, skipped: null }
  }

  const ids = new Set<string>()
  for (const e of alertable) {
    ids.add(e.playerId)
    if (e.passerId) ids.add(e.passerId)
  }
  // The play feed is NFL by construction; `LiveEvent` carries no sport, so it is stated here.
  const [owners, impacts] = await Promise.all([
    ownersByPlayerId([...ids], { startersOnly: true, sport: PLAY_FEED_SPORT }),
    starterImpactsByPlayerId([...ids], PLAY_FEED_SPORT),
  ])
  for (const [playerId, rows] of impacts) {
    const users = owners.get(playerId) ?? []
    for (const row of rows) if (!users.includes(row.userId)) users.push(row.userId)
    if (users.length > 0) owners.set(playerId, users)
  }
  if (owners.size === 0) {
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: 'no-rosters',
    }
  }

  // After the recipient lookups, so a missing picture can never cost anyone the alert.
  const headshots = await headshotsByRiId([...ids], PLAY_FEED_SPORT).catch(() => new Map<string, string>())

  const batch: NotificationEvent[] = []
  const enqueue = (event: LiveEvent, userIds: string[], side: 'subject' | 'passer') => {
    const contextual = impacts.get(event.playerId) ?? []
    const imageUrl = headshots.get(event.playerId) ?? null
    const withoutContext: string[] = []
    for (const userId of userIds) {
      const impact = contextual.find((row) => row.userId === userId)
      if (impact) batch.push(notificationFor(event, [userId], side, impact, imageUrl))
      else withoutContext.push(userId)
    }
    if (withoutContext.length > 0) batch.push(notificationFor(event, withoutContext, side, undefined, imageUrl))
  }
  for (const event of alertable) {
    const subjectUsers = owners.get(event.playerId) ?? []
    if (subjectUsers.length > 0) enqueue(event, subjectUsers, 'subject')

    const thrown = passerSide(event)
    if (thrown) {
      // A manager starting both ends of the play hears it once, from the scorer's side.
      const passerUsers = (owners.get(thrown.playerId) ?? []).filter((u) => !subjectUsers.includes(u))
      if (passerUsers.length > 0) enqueue(thrown, passerUsers, 'passer')
    }
  }

  if (batch.length === 0) {
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: 'no-rosters',
    }
  }

  try {
    await ingestBatch(batch)
  } catch {
    // A failed send must not take down the tick that produced the score.
    return {
      eventsConsidered: events.length,
      eventsAlertable: alertable.length,
      notificationsSent: 0,
      skipped: null,
    }
  }

  return {
    eventsConsidered: events.length,
    eventsAlertable: alertable.length,
    notificationsSent: batch.length,
    skipped: null,
  }
}
