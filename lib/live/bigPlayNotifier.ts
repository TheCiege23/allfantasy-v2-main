import { prisma } from '@/lib/prisma'
import { ingestBatch, type NotificationEvent } from '@/lib/notification-engine'
import type { LiveEvent } from '@/lib/live/eventDetector'
import { headlineFor } from '@/lib/live/playFeedPresentation'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

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
 * Resolve the exact imported leagues in which each player is starting. The
 * identity crosswalk covers every supported provider; Yahoo imports use the
 * normalized Sleeper id until the schema gains a Yahoo-specific identity.
 */
export async function starterImpactsByPlayerId(playerIds: string[]): Promise<Map<string, UserImpact[]>> {
  const out = new Map<string, UserImpact[]>()
  const unique = [...new Set(playerIds.filter(Boolean))]
  if (unique.length === 0) return out

  const identities = await prisma.playerIdentityMap.findMany({
    where: { rollingInsightsId: { in: unique } },
    select: {
      rollingInsightsId: true,
      sleeperId: true,
      espnId: true,
      fantraxId: true,
      mflId: true,
      fleaflickerId: true,
    },
  }).catch(() => [])

  const riByCandidate = new Map<string, string>()
  for (const identity of identities) {
    if (!identity.rollingInsightsId) continue
    for (const candidate of [
      identity.sleeperId,
      identity.espnId,
      identity.fantraxId,
      identity.mflId,
      identity.fleaflickerId,
    ]) {
      if (candidate) riByCandidate.set(String(candidate), identity.rollingInsightsId)
    }
  }
  if (riByCandidate.size === 0) return out

  const candidates = [...riByCandidate.keys()]
  const rosters = await prisma.roster.findMany({
    where: {
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

    for (const candidate of starters) {
      const riId = riByCandidate.get(candidate)
      if (!riId) continue
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
 * them in a starting lineup — for active seasons only.
 *
 * A dropped player keeps his row until `droppedAt` is set, so filtering on it
 * is what stops a manager being told about someone they cut last week.
 *
 * Exported for reuse by the injury importer — same recipients question, same
 * id-space rules (Rolling Insights ids in, AF user ids out; no identity row,
 * no guess). The importer wants the whole roster, so `startersOnly` defaults off.
 */
export async function ownersByPlayerId(
  playerIds: string[],
  opts: { startersOnly?: boolean } = {},
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (playerIds.length === 0) return out

  /*
   * ⚠ THE FEED AND THE ROSTERS SPEAK DIFFERENT ID LANGUAGES. Play events carry
   * Rolling Insights ids; redraft roster rows carry the draft pick's SLEEPER
   * id. Both are numeric strings, so joining them directly does not fail — it
   * silently matches the wrong player, or nobody. Cross through
   * PlayerIdentityMap once here and share the translation with both branches.
   * A player with no identity row is skipped, not guessed at.
   */
  const identities = await prisma.playerIdentityMap
    .findMany({
      where: { rollingInsightsId: { in: playerIds }, sleeperId: { not: null } },
      select: { rollingInsightsId: true, sleeperId: true },
    })
    .catch(() => [])

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
        roster: { season: { status: 'active' } },
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
  await addImportedLeagueOwners(identities, out, opts.startersOnly === true)
  return out
}

/*
 * Two fixed statements rather than one with an interpolated key: the JSON key is
 * never built from a string at runtime, so there is nothing to inject into.
 */
const ROSTERED_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         WHERE r."playerData"->'players' @> $1::jsonb`
const STARTING_SQL = `SELECT DISTINCT r."platformUserId"
         FROM rosters r
         WHERE r."playerData"->'starters' @> $1::jsonb`

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
  if (event.type === 'TURNOVER' || event.type === 'FIELD_GOAL') return 'medium'
  return 'low'
}

/** Scoring events — the ones that win a same-play tie against a yardage alert. */
const SCORING_TYPES: ReadonlySet<LiveEvent['type']> = new Set([
  'TOUCHDOWN',
  'DEFENSIVE_SCORE',
  'SPECIAL_TEAMS_SCORE',
])

/**
 * Which yardage stat belongs to which scoring stat, so a collapse only ever fires
 * within one phase of the game.
 *
 * ⚠ A RUSHING TD MUST NOT SWALLOW A RECEIVING GAIN. Keying the collapse on the player alone
 * would drop a genuine 30-yard catch because the same player also punched one in from the
 * three on a different play. The pairing is the narrowest thing that still fixes the case the
 * blueprint names.
 */
const SCORING_STAT_FOR_YARDS: Record<string, string> = {
  rushing_yards: 'rushing_touchdowns',
  receiving_yards: 'receiving_touchdowns',
  passing_yards: 'passing_touchdowns',
  /*
   * 🛑 THE `*_long` FALLBACK STATS WERE MISSING, AND THEY ARE THE ONES THAT FIRE ON A MULTI-TOUCH
   * WINDOW.
   *
   * `lib/live/eventDetector.ts` has two yardage paths. The exact one pairs a yardage delta with
   * its attempt counter and only emits when attempts rose by exactly one; when a poll window
   * contains two carries it stays silent and the LONGEST-GAIN fallback emits instead, with
   * `stat` = `rushing_long` / `receiving_long` / `passing_long`. Those keys were absent here, so
   * `pairedScoringStat` was `undefined`, the guard returned early, and a 42-yard rushing
   * touchdown in a two-carry window produced BOTH "Touchdown" and "Big play" — the exact
   * duplicate this function exists to remove, in precisely the window where the fallback is the
   * only detector that fires.
   */
  rushing_long: 'rushing_touchdowns',
  receiving_long: 'receiving_touchdowns',
  passing_long: 'passing_touchdowns',
}

/**
 * The play an event belongs to, when the source can say — otherwise `null`.
 *
 * 🛑 THIS DISTINCTION IS THE WHOLE CORRECTNESS OF THE COLLAPSE BELOW, AND ITS FIRST VERSION
 * DID NOT MAKE IT. Play-by-play keys are `pbp:${gameId}:${sequence}:${type}`, so everything
 * before the last colon identifies a PLAY. Box-score keys are
 * `${gameId}|${playerId}|${stat}|${value}` — a cumulative stat position, which identifies no
 * play at all, because the source cannot see plays.
 *
 * ⚠ SPLIT ON THE LAST COLON, NOT THE THIRD. A provider game id may itself contain a colon;
 * the type suffix never does, because it comes from a closed enum.
 */
export function playIdentityOf(event: LiveEvent): string | null {
  const key = event.idempotencyKey
  if (typeof key !== 'string' || !key.startsWith('pbp:')) return null
  const cut = key.lastIndexOf(':')
  if (cut <= 4) return null
  // Namespaced: a play id is only unique inside its sport.
  return `${namespaceOf(event)}|${key.slice(0, cut)}`
}

/**
 * The namespace every id on a `LiveEvent` lives inside.
 *
 * ⚠ `unknown` IS A REAL VALUE, NOT A FALLBACK TO NFL. A source that does not report its sport
 * gets its own namespace and can still collide with another unknown-sport source — which is
 * exactly the pre-existing behaviour, kept visible rather than papered over with a guess. It is
 * never silently treated as football.
 */
function namespaceOf(event: LiveEvent): string {
  return event.sport ? String(event.sport).toUpperCase() : 'unknown'
}

/**
 * The score itself, independent of which feed observed it.
 *
 * 🛑 RETURNS TWO KEYS, BECAUSE ONE OF THEM COULD NEVER MATCH ACROSS SOURCES.
 *
 * The cross-source rule exists so two feeds reporting one touchdown produce one alert. It
 * compared a single namespaced key — and the two feeds do not agree on the namespace:
 * `rollingInsightsPlayByPlay` hardcodes `sport: 'NFL'` while `detectEvents` sets
 * `sport: opts.sport`, which no caller supplies, so `namespaceOf` yields the literal
 * `'unknown'`. `NFL|g|p|TOUCHDOWN` versus `unknown|g|p|TOUCHDOWN`: the sets could never
 * intersect and the whole block was unreachable.
 *
 * ⚠ THE FIX IS NOT TO DEFAULT THE UNKNOWN SIDE TO NFL. That would reinstate exactly the
 * cross-sport collision the namespace was added to prevent. Instead a scoring observation
 * publishes both its namespaced key AND a namespace-free one, and a candidate consults the
 * bare key ONLY when it genuinely does not know its own sport. Two events that both name a
 * sport still compare namespaced, so a real NBA/NFL id collision is still kept apart.
 *
 * ⚠ AND THE TEST FOR THIS BLOCK WAS PAPERING OVER IT — it hand-supplied `sport: 'NFL'` on a
 * box-score fixture, a field `detectEvents` only ever sets from `opts.sport`, so the assertion
 * passed on a configuration production cannot produce.
 */
function scoreIdentitiesOf(event: LiveEvent): { namespaced: string; bare: string } {
  const bare = `${event.gameId}|${event.playerId}|${event.type}`
  return { namespaced: `${namespaceOf(event)}|${bare}`, bare }
}

/**
 * One play, one alert: a 25-yard touchdown is a touchdown, not a touchdown plus a 20+ gain.
 *
 * 🛑 THE FIRST VERSION OF THIS FUNCTION DELETED REAL BIG PLAYS AND THIS IS THE CORRECTION.
 * It collapsed on `(gameId, playerId, stat family)` across the whole batch, with no notion of
 * which PLAY each event came from. On the box-score source that is defensible. On the
 * play-by-play source it is simply wrong, and that is the source this pipeline actually runs:
 * `refreshPlayByPlayFeed` notifies on `fresh`, every play discovered since the cursor, so one
 * batch routinely spans a whole drive. A 25-yard run at sequence 40 and a one-yard touchdown at
 * sequence 88 are two plays, both alertable, and the old rule threw the run away — breaking the
 * blueprint's "notify on every gain of at least 20 yards" to fix a duplicate that source never
 * produced.
 *
 * So the collapse is now scoped to a PLAY where the source knows what a play is:
 *
 *   play-by-play  collapse only within one `pbp:${gameId}:${sequence}`. In practice `classify`
 *                 short-circuits on `isTouchdown` and emits one event per play, so this is a
 *                 safety net rather than a working rule — which is exactly what it should have
 *                 been from the start.
 *   box score     collapse a same-family yardage event against a same-tick scoring event, as
 *                 before. This source derives events from cumulative stat deltas and genuinely
 *                 cannot separate two plays inside one poll window.
 *
 * ⚠ THE SOURCES ARE NEVER CROSSED. A play-by-play touchdown cannot suppress a box-score gain
 * or the reverse: they key on different things, and letting one vote on the other reintroduces
 * the bug in a form that only appears when both feeds are live at once.
 *
 * ⚠ THE BOX-SCORE LIMIT REMAINS, STATED RATHER THAN HIDDEN. A 30-yard run and a later short
 * touchdown in the same tick and the same phase still collapse to the touchdown. That is the
 * safe direction to be wrong in — the score is the more important message — and it is precisely
 * what the play-by-play source resolves. Do not "fix" it by widening the window.
 */
export function collapseScoringDuplicates(events: LiveEvent[]): LiveEvent[] {
  /** Plays that scored, from sources that know what a play is. Namespaced by sport. */
  const scoringPlayIds = new Set<string>()
  /** `sport|game|player|scoringStat`, from sources that do not. */
  const scoringStatsWithoutPlayId = new Set<string>()
  /** Scores a play-scoped source has already reported — namespaced AND bare, see above. */
  const scoresWithPlayIdentity = new Set<string>()

  for (const e of events) {
    if (!SCORING_TYPES.has(e.type)) continue
    const playId = playIdentityOf(e)
    if (playId) {
      scoringPlayIds.add(playId)
      const ids = scoreIdentitiesOf(e)
      scoresWithPlayIdentity.add(ids.namespaced)
      scoresWithPlayIdentity.add(ids.bare)
    } else {
      scoringStatsWithoutPlayId.add(`${namespaceOf(e)}|${e.gameId}|${e.playerId}|${e.stat}`)
    }
  }
  if (scoringPlayIds.size === 0 && scoringStatsWithoutPlayId.size === 0) return events

  return events.filter((e) => {
    const playId = playIdentityOf(e)

    /*
     * ── Cross-source: one touchdown, one alert, however many feeds saw it. ──
     *
     * 🛑 BOTH FEEDS CAN REPORT THE SAME SCORE AND THEIR KEYS WILL NEVER MATCH.
     * A play-by-play touchdown keys on `pbp:game:sequence:TYPE`; the box-score detector keys
     * the same touchdown on `game|player|rushing_touchdowns|1`. Nothing about those two strings
     * is comparable, so every dedupe downstream — the engine's cooldown included — treats them
     * as two events and the user's phone buzzes twice for one score.
     *
     * The play-scoped observation wins because it carries real play identity, a description and
     * the full participant list. The box-score one is dropped.
     *
     * ⚠ ONLY THE OBSERVATION WITHOUT A PLAY ID IS EVER DROPPED HERE. Two play-scoped
     * touchdowns by the same player in one batch are two different plays — a second-quarter
     * score and a fourth-quarter score — and both survive, because both have a play id.
     */
    if (SCORING_TYPES.has(e.type)) {
      if (playId) return true
      const ids = scoreIdentitiesOf(e)
      /*
       * An observation that knows its sport compares namespaced; one that does not falls back
       * to the bare key, which is the only way two feeds that disagree about the namespace can
       * recognise the same score. Never the reverse — a known sport is never widened.
       */
      const key = e.sport ? ids.namespaced : ids.bare
      return !scoresWithPlayIdentity.has(key)
    }

    if (e.type !== 'BIG_PLAY') return true

    if (playId) {
      // Play-scoped source: only the SAME play's score can absorb this yardage event.
      return !scoringPlayIds.has(playId)
    }

    const pairedScoringStat = SCORING_STAT_FOR_YARDS[e.stat]
    if (!pairedScoringStat) return true
    return !scoringStatsWithoutPlayId.has(
      `${namespaceOf(e)}|${e.gameId}|${e.playerId}|${pairedScoringStat}`,
    )
  })
}

/**
 * The same play told from the passer's side: "Kirk Cousins 34-yard TD pass to
 * Drake London". A passing touchdown scores for the QB's managers too, and the
 * play event is keyed on the receiver, so without this they heard nothing.
 */
function passerSide(event: LiveEvent): LiveEvent | null {
  if (!event.passerId || !event.passerName) return null
  if (event.type !== 'TOUCHDOWN' && event.type !== 'BIG_PLAY') return null
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

function notificationFor(
  event: LiveEvent,
  userIds: string[],
  side: 'subject' | 'passer',
  impact?: UserImpact,
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
      /*
       * ⚠ CARRIED SO THE COOLDOWN KEY IS NAMESPACED. `notification-engine.buildSourceKey`
       * folds `meta.sport` into the key; without it an NBA game id and an NFL one can produce
       * the same key and silently suppress a real alert. Absent means unknown, not NFL.
       */
      sport: event.sport,
      provider: event.provider,
      gameId: event.gameId,
      playerId: event.playerId,
      playerName: event.playerName,
      team: event.team,
      eventType: event.type,
      stat: event.stat,
      yards: Number.isFinite(event.delta) ? Math.round(event.delta) : null,
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
       * cooldown key — see `buildSourceKey`. That is what stops a 22-yard gain
       * suppressing the touchdown that follows it inside the ten-minute window;
       * removing this field does not break the send — it silently reinstates that bug.
       */
      idempotencyKey: event.idempotencyKey,
      /*
       * Passer / receiver / returner / defender, where the source names them. Only the
       * play-by-play feed supplies this; the box-score detector leaves it undefined, so a
       * reader must treat absence as "not known", never as "one participant".
       */
      participants: event.participants ?? null,
      /*
       * One device notification per play. The dispatcher's default tag is one
       * per category, so a second touchdown would silently replace the first on
       * the phone before anyone read it.
       */
      pushTag: `live-play:${event.idempotencyKey}:${side}`,
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

  const alertable = collapseScoringDuplicates(
    events.filter((e) => {
      if (!ALERTABLE.has(e.type)) return false
      // The correction guard. A stat that went down is a revision, not a play.
      if (typeof e.delta === 'number' && e.delta < 0) return false
      return true
    }),
  )

  if (alertable.length === 0) {
    return { eventsConsidered: events.length, eventsAlertable: 0, notificationsSent: 0, skipped: null }
  }

  const ids = new Set<string>()
  for (const e of alertable) {
    ids.add(e.playerId)
    if (e.passerId) ids.add(e.passerId)
  }
  const [owners, impacts] = await Promise.all([
    ownersByPlayerId([...ids], { startersOnly: true }),
    starterImpactsByPlayerId([...ids]),
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

  const batch: NotificationEvent[] = []
  const enqueue = (event: LiveEvent, userIds: string[], side: 'subject' | 'passer') => {
    const contextual = impacts.get(event.playerId) ?? []
    const withoutContext: string[] = []
    for (const userId of userIds) {
      const impact = contextual.find((row) => row.userId === userId)
      if (impact) batch.push(notificationFor(event, [userId], side, impact))
      else withoutContext.push(userId)
    }
    if (withoutContext.length > 0) batch.push(notificationFor(event, withoutContext, side))
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
