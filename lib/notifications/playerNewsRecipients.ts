import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * Who should hear about a piece of player news — resolved from IDENTITY, never from a name
 * fragment, and never from an id whose namespace we cannot name.
 *
 * 🛑 THE BUG THIS REPLACES BROADCAST ON AN EMPTY STRING. The pending-news dispatcher matched
 * recipients with:
 *
 *     prisma.redraftRosterPlayer.findMany({
 *       where: { playerName: { contains: row.playerName, mode: 'insensitive' }, droppedAt: null },
 *       take: 500,
 *     })
 *
 * Three separate failures live in those two lines, and the third is the one that matters:
 *
 *   1. `contains` is a SUBSTRING. "Josh Allen" matches the Bills quarterback and the Jaguars
 *      edge rusher; "Will" matches a hundred people.
 *   2. There is no sport, no team and no season predicate, so an NCAAB player's news reaches an
 *      NFL roster row and a roster from a finished season is as eligible as a live one.
 *   3. `contains: ''` MATCHES EVERY ROW. `lib/workers/x-news-ingestion.ts` explicitly permits an
 *      unattributed headline and stores an empty player name, so an item with nobody attached
 *      selected the first 500 roster rows in the table and notified their owners. Reproduced
 *      against a mocked store; no production misdelivery was measured, and the input is
 *      reachable.
 *
 * The rules here, in order:
 *
 *   - An empty or unattributable subject resolves to NOBODY and is HELD. Never broadcast.
 *   - Identity is resolved inside ONE sport, through `PlayerIdentityMap`.
 *   - An id is only ever matched inside the namespace it belongs to. See
 *     `resolvePlayerNewsIdentity` — fanning a bare id across every provider column is itself a
 *     way to select the wrong athlete.
 *   - More than one candidate is AMBIGUOUS and is also held. Picking the first row is how a
 *     duplicate-name group notifies the wrong manager, and this repo already records 178 NFL
 *     duplicate groups that must not be merged.
 *   - Ownership is CURRENT ownership: not dropped, active native season, current imported
 *     season.
 *
 * ⚠ THIS IS THE NEWS RESOLVER AND IT IS NOT YET THE SHARED LIVE-ALERT RESOLVER.
 * `lib/live/bigPlayNotifier.ts` keeps its own ownership query on purpose: live alerts have
 * audience scopes this module does not model — starters by default, the FULL roster for best
 * ball, watchlists, and the per-participant audiences a passing touchdown needs. Material news
 * is a full-roster event, so "everyone who rosters them" is the correct and complete answer
 * HERE and would be wrong there. Unifying the two requires those scopes to exist first.
 */

/** The news item, reduced to the fields that decide who hears about it. */
export type PlayerNewsSubject = {
  sport: string | null | undefined
  /**
   * `PlayerNewsRecord.playerId`.
   *
   * ⚠ THIS IS A `PlayerIdentityMap.id`, NOT A PROVIDER ID, AND THAT IS AN ESTABLISHED CONTRACT.
   * `lib/player-identity/resolveNewsPlayer.ts` builds its index from `PlayerIdentityMap.id`,
   * and `lib/workers/news-importer.ts` says so in its own comment: "The canonical id WINS over
   * any provider id already present … the provider value uses a foreign namespace and is not
   * joinable to our players." A provider value can still survive on an unresolved row, which is
   * why the lookup below verifies rather than assumes.
   */
  playerId?: string | null
  playerName: string | null | undefined
  /** Corroborating evidence only — used to narrow an ambiguous name, never to select on its own. */
  team?: string | null
}

export type ResolvedPlayerIdentity = {
  identityId: string
  sport: string
  canonicalName: string
  currentTeam: string | null
  sleeperId: string | null
  rollingInsightsId: string | null
  apiSportsId: string | null
  espnId: string | null
  fantraxId: string | null
  mflId: string | null
  fleaflickerId: string | null
  cfbdId: string | null
  fantasyCalcId: string | null
}

export type PlayerNewsHoldReason =
  | 'empty-identity'
  | 'no-identity-row'
  | 'ambiguous-identity'
  | 'conflicting-evidence'

export type PlayerNewsIdentityResolution =
  | { status: 'resolved'; identity: ResolvedPlayerIdentity }
  | { status: 'held'; reason: PlayerNewsHoldReason; candidates: number }

const IDENTITY_SELECT = {
  id: true,
  sport: true,
  canonicalName: true,
  currentTeam: true,
  sleeperId: true,
  rollingInsightsId: true,
  apiSportsId: true,
  espnId: true,
  fantraxId: true,
  mflId: true,
  fleaflickerId: true,
  cfbdId: true,
  fantasyCalcId: true,
} as const

function toIdentity(r: Record<string, unknown>, fallbackName: string): ResolvedPlayerIdentity {
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null)
  return {
    identityId: String(r.id),
    sport: String(r.sport),
    canonicalName: s('canonicalName') ?? fallbackName,
    currentTeam: s('currentTeam'),
    sleeperId: s('sleeperId'),
    rollingInsightsId: s('rollingInsightsId'),
    apiSportsId: s('apiSportsId'),
    espnId: s('espnId'),
    fantraxId: s('fantraxId'),
    mflId: s('mflId'),
    fleaflickerId: s('fleaflickerId'),
    cfbdId: s('cfbdId'),
    fantasyCalcId: s('fantasyCalcId'),
  }
}

/** `null` when the team is absent or unusable — never an empty-string key. */
function teamKey(team: string | null | undefined): string | null {
  const t = String(team ?? '').trim().toUpperCase()
  return t && t !== 'FA' && t !== 'N/A' ? t : null
}

/**
 * Resolve a news subject to exactly one canonical athlete, inside one sport.
 *
 * 🛑 THE ID IS LOOKED UP IN ITS OWN NAMESPACE, NOT FANNED ACROSS EVERY PROVIDER COLUMN.
 *
 * An earlier version of this function matched `playerId` with
 * `OR: [{ sleeperId }, { rollingInsightsId }, { apiSportsId }, { espnId }, …]`. That is a way to
 * select the WRONG ATHLETE, not a way to be thorough: these are independent id spaces of small
 * integers, so Sleeper `4984` and a Rolling Insights `4984` are different people, and an OR
 * matches whichever row happens to carry that number in any column. Inside one sport it is if
 * anything MORE likely to collide, because the same athletes are enumerated repeatedly.
 *
 * `PlayerNewsRecord.playerId` has a known namespace — it is a `PlayerIdentityMap.id`, written
 * by `resolveNewsPlayer` and asserted by `news-importer`'s own comment — so it is looked up as
 * a primary key. That is exact, and it cannot collide.
 *
 * Everything else falls back to the sport-scoped NORMALIZED NAME, which is an indexed column
 * lookup rather than a substring scan, with `team` used only to narrow an ambiguous group.
 *
 * ⚠ EVIDENCE THAT DISAGREES IS HELD, NOT RECONCILED. If the id resolves to an athlete whose
 * canonical name does not match the name on the news row, we have two claims about who this is
 * and no basis to prefer either. Choosing silently is how a manager is told about somebody
 * else's player.
 */
export async function resolvePlayerNewsIdentity(
  subject: PlayerNewsSubject,
): Promise<PlayerNewsIdentityResolution> {
  const sport = String(subject.sport ?? '').trim()
  const rawName = String(subject.playerName ?? '').trim()
  const rawId = String(subject.playerId ?? '').trim()

  /*
   * 🛑 THE GUARD THAT HAD TO EXIST. Everything below queries; this returns before any query
   * runs. A subject with no sport, or with neither an id nor a name, cannot be resolved to an
   * athlete by any means, and the previous code's answer to it was "everyone".
   */
  if (!sport || (!rawName && !rawId)) {
    return { status: 'held', reason: 'empty-identity', candidates: 0 }
  }

  // Case-insensitive because the news writers store 'nfl' and the identity map stores 'NFL'.
  // Comparing them raw silently resolves nothing at all.
  const sportFilter = { equals: sport, mode: 'insensitive' as const }

  if (rawId) {
    const byId = await prisma.playerIdentityMap
      .findFirst({ where: { id: rawId, sport: sportFilter }, select: IDENTITY_SELECT })
      .catch(() => null)

    if (byId) {
      const identity = toIdentity(byId as Record<string, unknown>, rawName)
      /*
       * The id resolved. If the row also carries a name, it must agree with the news row's
       * name — a disagreement means the canonical id and the headline are describing different
       * people, and neither is authoritative enough to overrule the other.
       */
      if (rawName && normalizePlayerName(identity.canonicalName) !== normalizePlayerName(rawName)) {
        return { status: 'held', reason: 'conflicting-evidence', candidates: 1 }
      }
      return { status: 'resolved', identity }
    }
    /*
     * The id did not resolve as a canonical id. It is therefore a foreign-namespace leftover
     * from an unresolved ingestion row, and it is NOT retried against provider columns — see
     * the note above. Fall through to the name.
     */
  }

  if (!rawName) return { status: 'held', reason: 'no-identity-row', candidates: 0 }

  const normalized = normalizePlayerName(rawName)
  if (!normalized) return { status: 'held', reason: 'empty-identity', candidates: 0 }

  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { sport: sportFilter, normalizedName: normalized },
      select: IDENTITY_SELECT,
      // Five is enough to answer "is this ambiguous?" without paging a duplicate group.
      take: 5,
    })
    .catch(() => [] as Array<Record<string, unknown>>)

  if (rows.length === 0) return { status: 'held', reason: 'no-identity-row', candidates: 0 }
  if (rows.length === 1) {
    return { status: 'resolved', identity: toIdentity(rows[0] as Record<string, unknown>, rawName) }
  }

  /*
   * Ambiguous by name. Team is corroborating evidence and may narrow it to one — but ONLY to
   * one. Narrowing to two is still ambiguous, and narrowing to zero means the team we were
   * given contradicts every candidate, which is weaker evidence than no team at all.
   *
   * ⚠ NEVER "PICK THE FIRST". Two athletes with the same normalized name in one sport is a real
   * and common state here — 178 NFL duplicate groups are recorded as deliberately unmerged —
   * and choosing between them on no evidence notifies a manager about somebody else's player.
   * Holding is visible in the counters; a wrong send is not.
   */
  const wantedTeam = teamKey(subject.team)
  if (wantedTeam) {
    const narrowed = rows.filter(
      (r) => teamKey((r as { currentTeam?: string | null }).currentTeam) === wantedTeam,
    )
    if (narrowed.length === 1) {
      return {
        status: 'resolved',
        identity: toIdentity(narrowed[0] as Record<string, unknown>, rawName),
      }
    }
  }

  return { status: 'held', reason: 'ambiguous-identity', candidates: rows.length }
}

export type PlayerNewsRecipients = {
  /** AF user id → every league of theirs in which they currently roster the athlete. */
  byUser: Map<string, string[]>
  /** Native redraft roster rows that matched. */
  nativeMatches: number
  /** Imported roster rows that matched and resolved to an AF user. */
  importedLinked: number
  /** Imported roster rows that matched the athlete but whose team has no linked AF account. */
  importedUnlinked: number
  /**
   * Platforms whose ATHLETE id-space this identity carries no id for, so their rosters were not
   * searched at all. Reported rather than silently treated as "nobody rosters them".
   */
  unsearchedPlatforms: string[]
  /**
   * A query failed. The audience below is INCOMPLETE, not empty — treat it as retryable.
   *
   * ⚠ NEVER READ AN EMPTY `byUser` AS "NOBODY ROSTERS THEM" WITHOUT CHECKING THIS. Every query
   * in this resolver fails open so that one subsystem being down does not stop the others; that
   * is only safe because this flag exists to stop the caller drawing a permanent conclusion
   * from it.
   */
  degraded: boolean
  /**
   * At least one roster store was actually queried.
   *
   * `false` means the identity carried no id in any namespace we know how to search, so an
   * empty audience says nothing about who rosters this athlete — the identity sync back-filling
   * a `sleeperId` later will change the answer.
   */
  searchedAnything: boolean
}

/**
 * Imported platforms whose ATHLETE ids we can match, and the identity column that holds them.
 *
 * ⚠ YAHOO IS ABSENT AND THAT IS A DATA GAP, NOT AN OVERSIGHT. `PlayerIdentityMap` has no Yahoo
 * player-id column at all, so a Yahoo roster's player ids cannot be matched to a canonical
 * athlete by any means available here. Yahoo rosters are therefore never searched, and that is
 * reported in `unsearchedPlatforms` rather than being indistinguishable from "no Yahoo manager
 * rosters this player".
 */
const IMPORTED_PLATFORM_ID_FIELD: Record<string, keyof ResolvedPlayerIdentity> = {
  sleeper: 'sleeperId',
  espn: 'espnId',
  fantrax: 'fantraxId',
  mfl: 'mflId',
  fleaflicker: 'fleaflickerId',
}

/** Every platform this module knows how to look at, including the ones it cannot map. */
const KNOWN_IMPORT_PLATFORMS = ['sleeper', 'espn', 'fantrax', 'mfl', 'fleaflicker', 'yahoo']

/**
 * Season statuses that mean the season is OVER.
 *
 * 🛑 THIS WAS `status: 'active'` AND IT EXCLUDED EVERY IMPORTED LEAGUE.
 *
 * `'active'` is written by exactly one place — `lib/redraft/finalizeDraftToRedraftSeason.ts` —
 * i.e. an AF-native league that has completed its draft here. Imported leagues materialize as
 * `'in_season'` (`lib/league-import/canonicalSeasonMaterialization.ts`:
 * `league.status === 'complete' ? 'complete' : 'in_season'`), Sleeper passes its own
 * `pre_draft | drafting | in_season | complete` straight through, and `RedraftSeason.status`
 * defaults to `'setup'`. `lib/league-import/seasonPlacement.ts` records a measured distribution
 * with `in_season 60`.
 *
 * So filtering FOR `'active'` silently answered "nobody rosters this player" for the entire
 * imported population — and the caller stamps that answer terminally.
 *
 * ⚠ EXPRESSED AS AN EXCLUSION, NOT AN ALLOW-LIST, ON PURPOSE. The status vocabulary comes from
 * four platforms plus our own writers and it will grow; an allow-list silently drops each new
 * value, which is exactly how this bug happened. Naming only the terminal state means an
 * unrecognised status errs toward notifying, which is the recoverable direction.
 *
 * ⚠ `lib/live/bigPlayNotifier.ts` HAS THE IDENTICAL DEFECT and is deliberately NOT changed here
 * — live-play recipients are a different audience with different scopes, and widening who gets
 * a Sunday push is a product decision, not a drive-by. It needs the same fix.
 */
export const FINISHED_SEASON_STATUSES: readonly string[] = ['complete', 'completed', 'archived']

type ImportedRosterRow = {
  leagueId: string
  platformUserId: string
  playerData: unknown
  /** `Roster.redraftRosterId` → the AF-native roster this imported team is linked to. */
  redraftOwnerId: string | null
}

/**
 * Does this stored roster blob hold that player id?
 *
 * 🛑 THREE SHAPES ARE IN PRODUCTION AND A READER THAT KNOWS ONE SERVES A THIRD OF THE LEAGUES.
 *
 *   bare array        `["11560", "4984"]`          — what `lib/league-sync-core.ts` writes
 *   players key       `{ players: ["11560"] }`     — what several other writers wrap it in
 *   object entries    `[{ playerId: "11560" }]`    — and `player_id`, and `id`
 *
 * The third is the one JSONB containment cannot express, which is why this confirmation runs in
 * JS over a deliberately over-selecting SQL pre-filter rather than trusting `@>` alone.
 */
export function importedRosterHoldsPlayer(playerData: unknown, playerId: string): boolean {
  const list = Array.isArray(playerData)
    ? playerData
    : Array.isArray((playerData as { players?: unknown })?.players)
      ? (playerData as { players: unknown[] }).players
      : []
  for (const entry of list) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      if (String(entry) === playerId) return true
      continue
    }
    if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>
      const id = o.playerId ?? o.player_id ?? o.id
      if (id != null && String(id) === playerId) return true
    }
  }
  return false
}

/** Sleeper co-managers, where the stored roster blob preserved them. */
function coOwnerIdsFrom(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const raw = playerData as { co_owners?: unknown; coOwners?: unknown }
  const list = Array.isArray(raw.co_owners)
    ? raw.co_owners
    : Array.isArray(raw.coOwners)
      ? raw.coOwners
      : []
  return list.map((v) => String(v)).filter((v) => v.trim() !== '')
}

export type ResolveRecipientsOptions = {
  /**
   * Restrict imported leagues to this season. Defaults to the newest season present for that
   * platform and sport, which is what "current" means for data we did not author.
   */
  season?: number
}

/**
 * Everyone who currently rosters this athlete, with the leagues it affects for each of them.
 *
 * ⚠ "CURRENTLY" IS FOUR PREDICATES AND EACH ONE WAS MISSING. `droppedAt: null` excludes a
 * player a manager cut last week; the native season filter EXCLUDES FINISHED statuses (it does
 * not require `'active'` — requiring that excluded every imported league, see
 * `FINISHED_SEASON_STATUSES`); the imported query is pinned to the current IMPORTED season; and
 * the sport scope stops an NCAAB news item reaching an NFL roster row that happens to hold the
 * same numeric id.
 */
export async function resolvePlayerNewsRecipients(
  identity: ResolvedPlayerIdentity,
  options: ResolveRecipientsOptions = {},
): Promise<PlayerNewsRecipients> {
  const byUser = new Map<string, Set<string>>()
  const add = (userId: string, leagueId: string) => {
    if (!userId || !leagueId) return
    const set = byUser.get(userId) ?? new Set<string>()
    set.add(leagueId)
    byUser.set(userId, set)
  }

  let nativeMatches = 0
  let importedLinked = 0
  let importedUnlinked = 0
  const unsearchedPlatforms: string[] = []
  /*
   * 🛑 AN EMPTY AUDIENCE HAS THREE CAUSES AND THE CALLER STAMPED ALL THREE PERMANENTLY.
   *
   *   nobody rosters them   → genuinely terminal
   *   we never looked       → the identity carries no id in any namespace we can search
   *   a query failed        → transient
   *
   * The old return said only "empty", so `dispatchPendingPlayerNewsNotifications` recorded
   * `no-roster` — a TERMINAL outcome — for all three. One statement timeout permanently dropped
   * a notification for a widely-rostered player, and a story whose identity was missing its
   * `sleeperId` could never be reconsidered after the sync back-filled it twenty minutes later.
   */
  let degraded = false
  let searchedAnything = false

  // ── Native redraft rosters ────────────────────────────────────────────────
  /*
   * ⚠ NATIVE ROSTERS ARE KEYED ON SLEEPER IDS, WITH CFBD/FANTRAX FOR COLLEGE. This is a
   * deliberately NARROW list, not every column on the identity row: a native roster row's
   * `playerId` comes from the draft pool, and matching it against ids from provider spaces the
   * pool never uses re-opens the collision this module exists to close. Measured context: 0 of
   * 73,883 NCAAF `SportsPlayer` rows carry a `sleeperId`, which is why the college ids are here
   * at all.
   */
  const nativeIds = [identity.sleeperId, identity.cfbdId, identity.fantraxId].filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  )

  if (nativeIds.length > 0) {
    searchedAnything = true
    /*
     * Extracted so the row type comes from Prisma's own inference over the `select`. Annotating
     * the variable by hand instead makes TypeScript resolve the overload against the full model
     * and the assignment stops type-checking.
     */
    const fetchNativeOwners = () =>
      prisma.redraftRosterPlayer.findMany({
        where: {
          playerId: { in: nativeIds },
          droppedAt: null,
          sport: { equals: identity.sport, mode: 'insensitive' },
          roster: { season: { status: { notIn: [...FINISHED_SEASON_STATUSES] } } },
        },
        select: { roster: { select: { ownerId: true, leagueId: true } } },
        take: 500,
      })

    let nativeRows: Awaited<ReturnType<typeof fetchNativeOwners>> = []
    try {
      nativeRows = await fetchNativeOwners()
    } catch {
      /*
       * ⚠ A FAILED QUERY IS NOT AN EMPTY ROSTER, AND THE OLD `.catch(() => [])` SAID IT WAS.
       * The caller stamps `no-roster` terminally, so one statement timeout permanently dropped a
       * notification for a widely-rostered player. `degraded` is what lets the caller tell the
       * two apart and retry instead.
       */
      degraded = true
      nativeRows = []
    }

    for (const row of nativeRows) {
      const ownerId = row.roster?.ownerId
      const leagueId = row.roster?.leagueId
      if (!ownerId || !leagueId) continue
      nativeMatches++
      add(ownerId, leagueId)
    }
  }

  // ── Imported rosters ──────────────────────────────────────────────────────
  for (const platform of KNOWN_IMPORT_PLATFORMS) {
    const field = IMPORTED_PLATFORM_ID_FIELD[platform]
    const platformPlayerId = field ? identity[field] : null

    if (typeof platformPlayerId !== 'string' || platformPlayerId.trim() === '') {
      // No id in this platform's namespace — its rosters are NOT searched, and saying so is the
      // point. "Nobody found" and "never looked" are different answers.
      unsearchedPlatforms.push(platform)
      continue
    }

    searchedAnything = true

    /*
     * ⚠ SEASON IS PINNED PER LEAGUE LINEAGE, NOT GLOBALLY.
     *
     * 🛑 This was `MAX(l2.season) WHERE platform = $1 AND sport = $2` — the newest season
     * anywhere in the table for that platform and sport. `League.season` defaults to 2026 and
     * Sleeper leagues roll over early, so ONE league row at 2027 pinned the predicate to 2027
     * and excluded every other league — the entire active population — with no signal at all:
     * an id was present so the platform was not recorded as unsearched, the audience came back
     * empty, and the caller stamped `no-roster` terminally.
     *
     * `leagues` is one row per (user, platform, platformLeagueId, season) — that is its unique
     * key — so the current season OF A GIVEN LEAGUE is the max over rows sharing the first
     * three. Correlating the subquery to `l` is what makes it a per-league answer.
     */
    const SEASON_PIN = `l.season = COALESCE(
                  $4::int,
                  (SELECT MAX(l2.season) FROM leagues l2
                    WHERE l2."platformLeagueId" = l."platformLeagueId"
                      AND lower(l2.platform) = lower(l.platform)
                      AND l2."userId" = l."userId")
                )`

    const SELECT_HEAD = `SELECT r."leagueId",
                r."platformUserId",
                r."playerData",
                rr."ownerId" AS "redraftOwnerId"
           FROM rosters r
           JOIN leagues l ON l.id = r."leagueId"
           LEFT JOIN redraft_rosters rr ON rr.id = r."redraftRosterId"
          WHERE lower(l.platform) = $1
            AND l.sport::text = $2
            AND ${SEASON_PIN}`

    let rosters: ImportedRosterRow[] = []
    try {
      /*
       * 🛑 ONE QUERY WITH AN OR, AND SPLITTING IT INTO TWO WAS A CORRECTNESS BUG.
       *
       * The split ran containment first and the `jsonb_path_exists` branch only when containment
       * returned NOTHING. But the three stored shapes are per-LEAGUE, not per-athlete: Sleeper
       * league A can store `["11560", …]` while league B stores `[{ playerId: "11560" }]`.
       * Containment matched A, `rosters.length === 1`, the fallback never ran, and league B's
       * manager was never in `byUser` — then the row settled `'delivered'` and was stamped
       * terminally, so the miss was silent and permanent. A single OR returns both, which is
       * what it did before the split.
       *
       * ⚠ THE SPLIT ALSO BOUND A PARAMETER ITS SQL NEVER REFERENCED. The fallback passed five
       * arguments while naming only $1, $2, $4 and $5, leaving $3 with no inferable type.
       * Collapsing to one statement that uses all five removes that class of bug rather than
       * patching this instance of it.
       *
       * ⚠ THE PERFORMANCE CONCERN THE SPLIT WAS MEANT TO ADDRESS IS REAL AND IS KNOWINGLY
       * RE-ACCEPTED. `$.**` is a recursive wildcard no index can serve, so Postgres evaluates it
       * for every roster row the containment branches miss. That cost is worth paying to not
       * silently drop a manager; making it cheap needs a normalised roster-player table or a
       * generated column, not a reordering that changes the answer.
       */
      rosters = await prisma.$queryRawUnsafe<ImportedRosterRow[]>(
        `${SELECT_HEAD}
            AND (
                  r."playerData" @> $3::jsonb
               OR r."playerData"->'players' @> $3::jsonb
               OR jsonb_path_exists(r."playerData", '$.** ? (@ == $v || @ == $n)',
                                    jsonb_build_object('v', $5::text, 'n', $6::numeric))
            )
          LIMIT 500`,
        platform,
        identity.sport.toUpperCase(),
        JSON.stringify([platformPlayerId]),
        options.season ?? null,
        platformPlayerId,
        /*
         * 🛑 THE SAME ID AS A NUMBER, BECAUSE JSONB IS TYPE-STRICT AND SOME WRITERS STORE IT
         * THAT WAY.
         *
         * A roster holding `{"players":[{"id":11560}]}` was matched by NONE of the three
         * branches: `@> '["11560"]'` does not match a numeric `11560`, and the jsonpath
         * comparison `@ == $v` with `$v` bound as text is false against a JSON number. The
         * owner was silently dropped and the row stamped `'delivered'`.
         *
         * ⚠ AND A GREEN UNIT TEST CONCEALED IT. `importedRosterHoldsPlayer({players:[{id:11560}]},
         * '11560')` is true — the JS confirmer handles the shape perfectly — but the SQL never
         * returned that row for it to confirm. The test called the helper directly, so it proved
         * something true and irrelevant. Non-numeric ids (Yahoo keys, Fantrax slugs) cast to
         * NULL, and `@ == NULL` is Unknown, so this branch simply never fires for them.
         */
        /^\d+$/.test(platformPlayerId) ? platformPlayerId : null,
      )
    } catch {
      /*
       * Imported resolution is additive: a failure here must not stop native managers being
       * told, and must never become a name-match fallback. But it is NOT "nobody rosters him"
       * either — `degraded` is what stops the caller stamping that permanently.
       */
      degraded = true
      rosters = []
    }

    if (rosters.length === 0) continue

    type Candidate = { leagueId: string; platformIds: string[]; redraftOwnerId: string | null }
    const candidates: Candidate[] = []
    const platformIds = new Set<string>()

    for (const r of rosters) {
      if (!importedRosterHoldsPlayer(r.playerData, platformPlayerId)) continue
      const holders = [r.platformUserId, ...coOwnerIdsFrom(r.playerData)].filter(Boolean)
      for (const holder of holders) platformIds.add(holder)
      candidates.push({
        leagueId: r.leagueId,
        platformIds: holders,
        redraftOwnerId: r.redraftOwnerId ?? null,
      })
    }
    if (candidates.length === 0) continue

    /*
     * 🛑 THE SLEEPER-USER-ID BRANCH IS GATED ON THE SLEEPER PLATFORM, AND IT WAS NOT.
     *
     * The `OR` below used to run for EVERY platform in the loop. `Roster.platformUserId` is a
     * user id only on Sleeper; on ESPN, Fantrax, MFL and Fleaflicker it is a TEAM identifier.
     * So a Fleaflicker team id of "864213" that happened to equal some unrelated AF user's
     * `sleeperUserId` resolved to that person, and they were notified about a player in a
     * league they have no connection to — counted as `importedLinked`, so it read as success.
     * These are independent id spaces of short numeric strings; collisions are not exotic.
     *
     * The comment further down already stated this rule. The code did not enforce it.
     */
    const platformIdList = [...platformIds]
    const profileWhere =
      platform === 'sleeper'
        ? { OR: [{ sleeperUserId: { in: platformIdList } }, { userId: { in: platformIdList } }] }
        : // Every other platform: the only thing `platformUserId` can legitimately be is one of
          // our own uuids (measured: 23 imported rosters carry one). A team id resolves to
          // nobody here, by design — `Roster.redraftRosterId` is the supported link for those.
          { userId: { in: platformIdList } }

    let profiles: Array<{ userId: string; sleeperUserId: string | null }> = []
    if (platformIdList.length) {
      try {
        profiles = await prisma.userProfile.findMany({
          where: profileWhere,
          select: { userId: true, sleeperUserId: true },
        })
      } catch {
        degraded = true
        profiles = []
      }
    }

    const afUserIdByPlatformId = new Map<string, string>()
    for (const p of profiles) {
      if (platform === 'sleeper' && p.sleeperUserId) {
        afUserIdByPlatformId.set(p.sleeperUserId, p.userId)
      }
      // A measured 23 imported rosters carry an AF uuid in `platformUserId` rather than a
      // platform id. That branch is real; confirming it against `user_profiles` is what keeps
      // it from becoming "assume any unrecognised string is a user id".
      afUserIdByPlatformId.set(p.userId, p.userId)
    }

    for (const candidate of candidates) {
      /*
       * 🛑 THREE WAYS TO REACH A PERSON, AND NONE OF THEM GUESSES FROM A TEAM ID.
       *
       *   1. `Roster.redraftRosterId` → `RedraftRoster.ownerId`. A real foreign key to an AF
       *      user, and the ONLY person-link that works for a platform whose `platformUserId` is
       *      a team identifier rather than a user — ESPN, Fantrax and Yahoo all are. Measured at
       *      84.5% coverage (2,721 of 3,222 rosters).
       *   2. `UserProfile.sleeperUserId` — Sleeper's `platformUserId` genuinely is a user id.
       *   3. `platformUserId` that is already an AF uuid, confirmed against `user_profiles`.
       *
       * An ESPN team id resolves through none of these unless (1) links it, and that is the
       * correct outcome: a team identifier does not name a person, and inventing one from it
       * would notify whoever we guessed.
       */
      const resolved = new Set<string>()
      if (candidate.redraftOwnerId) resolved.add(candidate.redraftOwnerId)
      for (const id of candidate.platformIds) {
        const userId = afUserIdByPlatformId.get(id)
        if (userId) resolved.add(userId)
      }

      if (resolved.size === 0) {
        importedUnlinked++
        continue
      }
      for (const userId of resolved) {
        importedLinked++
        add(userId, candidate.leagueId)
      }
    }
  }

  return {
    byUser: new Map([...byUser].map(([userId, leagues]) => [userId, [...leagues]])),
    nativeMatches,
    importedLinked,
    importedUnlinked,
    unsearchedPlatforms,
    degraded,
    searchedAnything,
  }
}
