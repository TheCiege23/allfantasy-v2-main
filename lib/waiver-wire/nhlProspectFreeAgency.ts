import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/dynastyFamily'
import {
  FANTRAX_PROSPECT_ID_PREFIX,
  fantraxDisplayName,
  loadNhlFantraxProspects,
  NHL_FANTRAX_PROSPECT_LIMIT,
  NHL_FANTRAX_UNIVERSE_CACHE_KEY,
  parseNhlFantraxUniverse,
  type NhlFantraxProspect,
  type NhlProspectDb,
} from '@/lib/player-identity/nhlFantraxProspects'
import { proTeamCode } from '@/lib/player-identity/proFantraxIdentityPlan'
import { NHL_PROSPECT_SOURCE } from '@/lib/draft-room/nhlProspectPoolRows'
import { getRosterPlayerIds } from './roster-utils'

/**
 * Fantrax-only NHL prospects (AHL, junior, unsigned) in an NHL DYNASTY league's free agency.
 *
 * #3051 put them on the rookie-draft board only. An undrafted prospect then vanished: the waiver
 * pool is `getPlayerPoolForLeague` (SportsPlayer rows — Rolling Insights NHL, NHL-only), so he was
 * not listed, and nothing let an add or a claim name him. This module is the one place that decides,
 * for the free-agent list AND for the add / claim gate, so the two cannot disagree:
 *
 *  - WHO: `loadNhlFantraxProspects` (DB-first: `sportsDataCache['fantrax:nhl-player-universe']` and
 *    `PlayerIdentityMap`, no provider call), minus every id on a roster in the league. A prospect is
 *    a man in no NHL identity row, so no pro can appear twice (the reader's rule, unchanged).
 *  - WHERE: NHL leagues in the dynasty family (`isDynastyFamilyLeague`). A redraft or keeper NHL
 *    league and every other sport are untouched — the list is built and every add is checked exactly
 *    as before.
 *  - THE ID: `fantrax:<fantraxId>`, the same id the draft writes, so `rosterGameLogIdBridge` scores
 *    him once the weekly link attaches him to a Rolling Insights identity, and zero until then.
 *  - VALIDATION: a `fantrax:` id is refused outside NHL dynasty, and inside it unless he is a current
 *    prospect in the stored universe — a made-up id, a stale id, or a man since linked to an NHL
 *    identity (he is then in the pro pool under his Rolling Insights id). An unreadable universe
 *    refuses the `fantrax:` add (fails closed) and leaves the list as it was (no prospects).
 *  - A LINKED PROSPECT: once the weekly link attaches a rostered `fantrax:X` to an identity, that
 *    identity's pro row would read as free (the roster holds `fantrax:X`, not the pro id). Both the
 *    list and the gate treat the identity's ids as rostered.
 *
 * Roster limits, locks, FAAB, holds and the waiver type are not touched here: a prospect passes
 * through every other check in `assertWaiverClaimEligibility` like any player.
 *
 * ⚠ No age, draft year or level exists (contracts/fantrax/GAPS.md F-15), so there is no projection,
 * ADP or rank, and the lists place prospects after real players.
 */

/** The free-agent list carries at most this many before a search; the draft board uses the same cap. */
export const NHL_PROSPECT_FA_LIST_LIMIT = NHL_FANTRAX_PROSPECT_LIMIT

/** A search returns at most this many prospects. */
export const NHL_PROSPECT_FA_SEARCH_LIMIT = 50

export const PROSPECT_NOT_IN_LEAGUE_MESSAGE =
  'This player is unavailable in this league: Fantrax prospects can only be added in NHL dynasty leagues.'
export const PROSPECT_NOT_ON_LIST_MESSAGE =
  'This player is unavailable: he is not a current NHL prospect on the stored Fantrax player list.'
export const PROSPECT_LIST_UNREADABLE_MESSAGE =
  'This prospect is unavailable right now: the stored Fantrax NHL player list could not be read.'
export const LINKED_PROSPECT_ROSTERED_MESSAGE = 'This player is already on another roster in this league.'

export type ProspectFreeAgencyLeague = {
  sport?: string | null
  isDynasty?: boolean | null
  leagueType?: string | null
}

export function offersNhlProspectFreeAgency(league: ProspectFreeAgencyLeague | null | undefined): boolean {
  if (!league) return false
  if (String(league.sport ?? '').trim().toUpperCase() !== 'NHL') return false
  return isDynastyFamilyLeague(league)
}

export function isFantraxProspectId(id: string | null | undefined): boolean {
  const s = String(id ?? '').trim()
  return s.startsWith(FANTRAX_PROSPECT_ID_PREFIX) && s.length > FANTRAX_PROSPECT_ID_PREFIX.length
}

function matchesQuery(p: NhlFantraxProspect, query: string | null | undefined): boolean {
  const q = String(query ?? '').trim().toLowerCase()
  return !q || p.name.toLowerCase().includes(q)
}

export type NhlProspectFreeAgents = {
  prospects: NhlFantraxProspect[]
  /** Prospects on no roster in this league. */
  total: number
}

/** Every free prospect (rule above), optionally filtered by a name search, capped at `limit`. */
export async function loadNhlProspectFreeAgents(
  db: NhlProspectDb,
  opts: { rosteredIds: ReadonlySet<string>; poolNames?: ReadonlySet<string>; query?: string | null; limit?: number },
): Promise<NhlProspectFreeAgents> {
  const loaded = await loadNhlFantraxProspects(db, { poolNames: opts.poolNames, limit: Number.MAX_SAFE_INTEGER })
  const free = loaded.prospects.filter((p) => !opts.rosteredIds.has(p.playerId))
  const matched = free.filter((p) => matchesQuery(p, opts.query))
  const cap = Math.max(0, Math.floor(opts.limit ?? NHL_PROSPECT_FA_LIST_LIMIT))
  return { prospects: matched.slice(0, cap), total: free.length }
}

/** A prospect as the waiver pool's row shape, so the route serializes him like any player. */
export function nhlProspectPoolRow(p: NhlFantraxProspect) {
  return {
    player_id: p.playerId,
    sport_type: 'NHL' as const,
    team_id: null,
    team_abbreviation: p.orgTeam,
    team: p.orgTeam,
    full_name: p.name,
    position: p.position,
    status: null,
    injury_status: null,
    external_source_id: null,
    sleeper_id: null,
    experience: 0,
  }
}

export const NHL_PROSPECT_WIRE_SOURCE = NHL_PROSPECT_SOURCE

/**
 * Name, position and club for a `fantrax:<id>` roster row, from the stored universe — so the
 * `RedraftRosterPlayer` row a free-agent add or a claim award writes says "Tyler Madden, C, MIN"
 * rather than the bare id and 'UNK'. Null when the id is not in the universe or the row is unreadable.
 */
export async function nhlProspectRosterMeta(
  db: { sportsDataCache: NhlProspectDb['sportsDataCache'] },
  playerId: string,
): Promise<{ playerName: string; position: string; team: string | null } | null> {
  if (!isFantraxProspectId(playerId)) return null
  const fantraxId = playerId.trim().slice(FANTRAX_PROSPECT_ID_PREFIX.length)
  const row = await db.sportsDataCache.findUnique({
    where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY },
    select: { data: true, expiresAt: true },
  })
  const hit = parseNhlFantraxUniverse(row?.data)?.rows.find((r) => r[0].trim() === fantraxId)
  if (!hit) return null
  const position = hit[3].toUpperCase().split(/[,/\s]+/).find((p) => ['C', 'LW', 'RW', 'D', 'G'].includes(p)) ?? 'UNK'
  const team = hit[2].trim()
  return { playerName: fantraxDisplayName(hit[1]), position, team: team && team !== '(N/A)' ? proTeamCode('NHL', team) ?? null : null }
}

type LinkDb = {
  playerIdentityMap: {
    findMany(args: {
      where: { sport: string; fantraxId: { in: string[] } }
      select: { id: true; rollingInsightsId: true; sleeperId: true }
    }): Promise<Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>>
  }
}

/** The pro ids of every rostered `fantrax:X` the weekly link has since attached to an NHL identity. */
export async function linkedRosteredProspectIds(db: LinkDb, rosteredIds: Iterable<string>): Promise<Set<string>> {
  const fantraxIds = [...new Set([...rosteredIds].filter(isFantraxProspectId).map((id) => id.slice(FANTRAX_PROSPECT_ID_PREFIX.length)))]
  const out = new Set<string>()
  if (fantraxIds.length === 0) return out
  const rows = await db.playerIdentityMap.findMany({
    where: { sport: 'NHL', fantraxId: { in: fantraxIds } },
    select: { id: true, rollingInsightsId: true, sleeperId: true },
  })
  for (const r of rows) for (const id of [r.id, r.rollingInsightsId, r.sleeperId]) if (id) out.add(String(id))
  return out
}

/**
 * The add / claim gate. Throws a user-facing message; returns quietly for every id it does not own,
 * so a non-`fantrax:` add outside NHL dynasty costs nothing and behaves exactly as before.
 */
export async function assertNhlProspectFreeAgencyAdd(
  db: NhlProspectDb & LinkDb,
  league: ProspectFreeAgencyLeague,
  addPlayerId: string,
  leagueRosterPlayerData: readonly unknown[],
): Promise<void> {
  const addId = String(addPlayerId).trim()
  const offered = offersNhlProspectFreeAgency(league)
  if (isFantraxProspectId(addId)) {
    if (!offered) throw new Error(PROSPECT_NOT_IN_LEAGUE_MESSAGE)
    const loaded = await loadNhlFantraxProspects(db, { limit: Number.MAX_SAFE_INTEGER }).catch(() => null)
    if (!loaded) throw new Error(PROSPECT_LIST_UNREADABLE_MESSAGE)
    if (!loaded.prospects.some((p) => p.playerId === addId)) throw new Error(PROSPECT_NOT_ON_LIST_MESSAGE)
    return
  }
  if (!offered) return
  const rostered = new Set<string>()
  for (const data of leagueRosterPlayerData) for (const id of getRosterPlayerIds(data)) rostered.add(id)
  // A failed read keeps the old behaviour for a pro add; the roster checks above it still ran.
  const linked = await linkedRosteredProspectIds(db, rostered).catch(() => new Set<string>())
  if (linked.has(addId)) throw new Error(LINKED_PROSPECT_ROSTERED_MESSAGE)
}

/*
 * ── AWARD TIME ────────────────────────────────────────────────────────────────────────────────────
 * The gate above runs when a claim is SUBMITTED. A claim then waits for the run, and the weekly
 * Fantrax link can attach the prospect to an NHL identity in between — after which another team may
 * hold the same man under his pro id. So the processor (`lib/waiver-wire/process-engine.ts`) re-runs
 * the rule for every `fantrax:` claim when it is about to award it:
 *
 *  - still a free prospect in the stored universe → award `fantrax:X`, as before;
 *  - linked to exactly one NHL identity, and none of that man's ids is on a roster in the league →
 *    award him under his pro roster id (`rollingInsightsId`, the id the NHL draft pool hands out and
 *    `rosterGameLogIdBridge` scores; the identity id when he has none), so no roster keeps a stale
 *    `fantrax:` id;
 *  - any of his ids rostered, or refused by the rule (outside NHL dynasty, not on the list, a Fantrax
 *    id two identities carry) → the claim fails as an unavailable player does;
 *  - the league row, the identity registry, the pool rows or the universe cannot be read → the claim
 *    fails (closed), as the submit gate does.
 *
 * The reasons are English, like every other reason the processor writes. Their outcome code comes
 * from the processor's own wording rule ("no longer available" → `player_no_longer_available`), so
 * the claim and the manager's "not awarded" notice read like any taken player. No FAAB is held
 * between submit and run (the processor debits only on an award), so a failed claim spends nothing.
 */

export const PROSPECT_AWARD_NOT_IN_LEAGUE_MESSAGE =
  'Player no longer available: Fantrax prospects can only be claimed in NHL dynasty leagues.'
export const PROSPECT_AWARD_NOT_ON_LIST_MESSAGE =
  'Player no longer available: he is not a current NHL prospect on the stored Fantrax player list.'
export const PROSPECT_AWARD_AMBIGUOUS_LINK_MESSAGE =
  'Player no longer available: his Fantrax id is linked to more than one NHL player.'
export const PROSPECT_AWARD_UNREADABLE_MESSAGE =
  'This prospect could not be checked: the stored Fantrax NHL player list could not be read.'
/** The processor's own words for a player already on a roster (process-engine.ts). */
export const AWARD_TAKEN_BY_OTHER_MESSAGE = 'Player no longer available (awarded to another team in this run).'
export const AWARD_TAKEN_BY_SELF_MESSAGE = 'Player no longer available.'

export type NhlProspectAwardDecision =
  | {
      kind: 'award'
      /** The id to put on the roster: the claimed `fantrax:X`, or his pro roster id once linked. */
      playerId: string
      /** Every id the awarded man is known by in this league, so later claims in the run see him taken. */
      aliases: string[]
      /** Set when the award is under a different id than the one claimed. */
      claimedPlayerId?: string
    }
  | { kind: 'fail'; message: string; extra?: Record<string, unknown> }

export type NhlProspectAwardDb = NhlProspectDb &
  LinkDb & {
    sportsPlayer: {
      findMany(args: {
        where: { sport: string; OR: Array<{ externalId: { in: string[] } } | { sleeperId: { in: string[] } }> }
        select: { id: true }
      }): Promise<Array<{ id: string }>>
    }
  }

/**
 * The award-time rule above, for one `fantrax:` claim. `rosteredByPlayer` is the processor's live
 * id → roster map (it includes awards made earlier in the same run). `league` null means the league
 * row could not be read.
 */
export async function resolveNhlProspectClaimAward(
  db: NhlProspectAwardDb,
  league: ProspectFreeAgencyLeague | null,
  claimedPlayerId: string,
  claimingRosterId: string,
  rosteredByPlayer: ReadonlyMap<string, string>,
): Promise<NhlProspectAwardDecision> {
  const addId = String(claimedPlayerId).trim()
  if (!league) return { kind: 'fail', message: PROSPECT_AWARD_UNREADABLE_MESSAGE }
  if (!offersNhlProspectFreeAgency(league)) return { kind: 'fail', message: PROSPECT_AWARD_NOT_IN_LEAGUE_MESSAGE }
  const taken = (ids: Iterable<string>): NhlProspectAwardDecision | null => {
    for (const id of ids) {
      const owner = rosteredByPlayer.get(id)
      if (!owner) continue
      return {
        kind: 'fail',
        message: owner !== claimingRosterId ? AWARD_TAKEN_BY_OTHER_MESSAGE : AWARD_TAKEN_BY_SELF_MESSAGE,
        extra: { competingRosterId: owner },
      }
    }
    return null
  }
  const takenAsClaimed = taken([addId])
  if (takenAsClaimed) return takenAsClaimed

  const fantraxId = addId.slice(FANTRAX_PROSPECT_ID_PREFIX.length)
  const identities = await db.playerIdentityMap
    .findMany({
      where: { sport: 'NHL', fantraxId: { in: [fantraxId] } },
      select: { id: true, rollingInsightsId: true, sleeperId: true },
    })
    .catch(() => null)
  if (!identities) return { kind: 'fail', message: PROSPECT_AWARD_UNREADABLE_MESSAGE }
  const people = [...new Map(identities.map((r) => [r.id, r])).values()]
  // Two identities carrying one Fantrax id: refused, never guessed (the #3051 bridge's rule too).
  if (people.length > 1) return { kind: 'fail', message: PROSPECT_AWARD_AMBIGUOUS_LINK_MESSAGE }

  if (people.length === 1) {
    const person = people[0]
    const providerIds = [person.rollingInsightsId, person.sleeperId].filter((v): v is string => Boolean(v))
    // A free-agent add stores the pool row's own id (`SportsPlayer.id`), a draft its provider id: both count.
    const poolRows =
      providerIds.length === 0
        ? []
        : await db.sportsPlayer
            .findMany({
              where: { sport: 'NHL', OR: [{ externalId: { in: providerIds } }, { sleeperId: { in: providerIds } }] },
              select: { id: true },
            })
            .catch(() => null)
    if (!poolRows) return { kind: 'fail', message: PROSPECT_AWARD_UNREADABLE_MESSAGE }
    const proId = person.rollingInsightsId || person.id
    const aliases = [...new Set([proId, person.id, ...providerIds, ...poolRows.map((r) => r.id), addId].map(String))]
    const takenAsPro = taken(aliases)
    if (takenAsPro) return takenAsPro
    return { kind: 'award', playerId: proId, aliases, claimedPlayerId: addId }
  }

  const loaded = await loadNhlFantraxProspects(db, { limit: Number.MAX_SAFE_INTEGER }).catch(() => null)
  if (!loaded) return { kind: 'fail', message: PROSPECT_AWARD_UNREADABLE_MESSAGE }
  if (!loaded.prospects.some((p) => p.playerId === addId)) return { kind: 'fail', message: PROSPECT_AWARD_NOT_ON_LIST_MESSAGE }
  return { kind: 'award', playerId: addId, aliases: [addId] }
}
