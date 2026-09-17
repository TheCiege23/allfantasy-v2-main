import 'server-only'

import { getPlayerTradeVisual, type PlayerTradeVisual } from '@/lib/core-app/playerTradeVisual'
import type { SectionState } from '@/lib/core-app/leagueHome'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekPricingDeps,
} from '@/lib/decision-os/trade/leagueWeekPricing'
import { computeRosterImpact, fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { loadPlayerMetadataRows } from '@/lib/decision-os/world/port'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  activePlayerIds,
  allRosteredIds,
  findRosteredByName,
  indexRosterNames,
  viewerRosterOf,
  type LocatedPlayer,
  type PlayerNames,
} from './leagueRosterIndex'
import { decideTradeTarget, type TradeTargetFacts, type TradeTargetLineup, type TradeTargetVerdict } from './tradeTargetDecision'

/**
 * "Should I trade for X?" — the facts, read from the asker's own league, handed to
 * `decideTradeTarget`.
 *
 * It composes what already exists and adds no numbers of its own:
 *   - who has him, found by name on this league's real rosters (`leagueRosterIndex`, the one every
 *     Chimmy scenario uses);
 *   - his price, your team's stance and needs, the package the trade finder would open with and the
 *     engine's grade of it — `getPlayerTradeVisual`, the same read the /core player card shows, so
 *     Chimmy and the card cannot disagree;
 *   - the lineup with and without him, this week, under this league's scoring —
 *     `leagueWeekPricing`, the basis the trade evaluator and the start/sit scenario use.
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE. Every roster in the league is read, and
 * `getPlayerTradeVisual` performs no membership check of its own. The route passes
 * `leagueSnapshot.id` and nothing else.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSING WHO WAS MEANT. A name on two rosters, a name on none, or the
 * asker's own player each come back `unresolved` with a sentence that says so.
 */

/** A league the size anyone plays; bounds the one name read. */
const MAX_LEAGUE_PLAYER_IDS = 800

export type TradeTargetUnresolvedReason =
  | 'no_league_world'
  | 'no_team'
  | 'not_rostered'
  | 'ambiguous'
  | 'already_yours'
  | 'engine_unavailable'

export type TradeTargetResult =
  | { status: 'decided'; verdict: TradeTargetVerdict; leagueName: string; targetName: string }
  | { status: 'unresolved'; reason: TradeTargetUnresolvedReason; detail: string }

export interface TradeTargetDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayerNames: (sport: string, ids: string[]) => Promise<PlayerNames>
  tradeVisual: (leagueId: string, sleeperId: string, userId: string) => Promise<SectionState<PlayerTradeVisual>>
  leagueWeek: LeagueWeekPricingDeps
}

/** `loadPlayerMetadataRows` reads at most this many ids per call. */
const METADATA_BATCH = 200

/**
 * Names for every rostered player in the league.
 *
 * 🛑 NOT `resolveNames`. Measured on staging 2026-09-17 against a real 12-team Sleeper league, the
 * verdict could not find Adam Thielen — rostered in that league — because `resolveNames` caps its
 * fallback read at 120 rows, and that read ORs `externalId` with `sleeperId`: two id spaces that
 * collide (42,031 of 42,032 numeric `externalId`s that are also a Sleeper id are a different person;
 * see `loadPlayerMetadataRows`). A league's worth of ids overflows the cap, and a collision can name
 * the wrong man.
 *
 * `loadPlayerMetadataRows` asks the Sleeper space first and the provider space only for what that left
 * unclaimed. Its rows are indexed here in the same order — every Sleeper id before any provider id — so
 * a provider id that happens to equal somebody's Sleeper id cannot take his name.
 */
export async function loadLeaguePlayerNames(
  sport: string,
  ids: string[],
  loadRows: typeof loadPlayerMetadataRows = loadPlayerMetadataRows,
): Promise<PlayerNames> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_LEAGUE_PLAYER_IDS)
  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += METADATA_BATCH) batches.push(unique.slice(i, i + METADATA_BATCH))
  const rows = (await Promise.all(batches.map((b) => loadRows(normalizeToSupportedSport(sport), b)))).flat()

  const out: PlayerNames = new Map()
  const entry = (r: (typeof rows)[number]) => ({ name: r.name, position: r.position })
  for (const r of rows) {
    if (r.sleeperId && !out.has(r.sleeperId)) out.set(r.sleeperId, entry(r))
    if (r.externalId.startsWith('sleeper:')) {
      const id = r.externalId.slice('sleeper:'.length)
      if (!out.has(id)) out.set(id, entry(r))
    }
  }
  for (const r of rows) {
    if (r.externalId && !r.externalId.startsWith('sleeper:') && !out.has(r.externalId)) {
      out.set(r.externalId, entry(r))
    }
  }
  return out
}

const defaultDeps: TradeTargetDeps = {
  resolveWorld: resolveCanonicalWorld,
  loadPlayerNames: (sport, ids) => loadLeaguePlayerNames(sport, ids),
  tradeVisual: (leagueId, sleeperId, userId) => getPlayerTradeVisual(leagueId, sleeperId, userId),
  leagueWeek: defaultLeagueWeekPricingDeps,
}

/**
 * Who the name means on this league's rosters. A full name is matched exactly (normalised); a single
 * word is matched as a last name, and only when exactly one rostered player carries it.
 */
export function locateTarget(
  byName: Map<string, LocatedPlayer[]>,
  rawName: string,
): { hits: LocatedPlayer[] } {
  const exact = findRosteredByName(byName, rawName).hits
  if (exact.length > 0) return { hits: exact }
  const words = rawName.trim().split(/\s+/)
  if (words.length !== 1) return { hits: [] }
  const last = normalizePlayerName(words[0] ?? '')
  if (!last) return { hits: [] }
  const hits: LocatedPlayer[] = []
  for (const [key, players] of byName) {
    if (key.split(' ').pop() === last) hits.push(...players)
  }
  return { hits }
}

function uniqueByPlayer(hits: LocatedPlayer[]): LocatedPlayer[] {
  return [...new Map(hits.map((h) => [h.playerId, h])).values()]
}

/** His effect on your lineup this week, league-scored — or why it cannot be said. */
async function readLineup(args: {
  world: CanonicalWorld
  activeIds: string[]
  targetId: string
  outgoingIds: string[]
  names: PlayerNames
  deps: LeagueWeekPricingDeps
}): Promise<TradeTargetLineup> {
  const { world, activeIds, targetId, names, deps } = args
  const slots = world.league.rosterSettings.starterSlots
  if (!slots || slots.length === 0) {
    return { status: 'unavailable', detail: "this league's starting lineup slots are not on file" }
  }

  const basis = await leagueWeekBasis(world.league, deps)
  if (isLeagueWeekRefusal(basis)) return { status: 'unavailable', detail: basis.detail }

  // A player on injured reserve or the taxi squad cannot move a lineup, so he is not counted as leaving it.
  const active = new Set(activeIds)
  const outgoing = args.outgoingIds.filter((id) => active.has(id))
  const ids = [...activeIds, targetId]
  const positions = new Map(ids.map((id) => [id, names.get(id)?.position ?? null]))
  const priced = await priceLeagueWeek(basis, ids, positions, deps)
  const toImpact = (id: string): ImpactPlayer =>
    priced.get(id) ?? { playerId: id, position: String(positions.get(id) ?? '').toUpperCase(), projectedPoints: null }

  const roster = activeIds.map(toImpact)
  const incoming = [toImpact(targetId)]
  /*
   * Said in his name. `computeRosterImpact` blocks on an unpriced traded player with a sentence about
   * "traded player(s)", which is right for a proposal and reads oddly for one man the asker named.
   */
  if (incoming[0]?.projectedPoints == null) {
    const who = names.get(targetId)?.name ?? 'he'
    return {
      status: 'unavailable',
      detail: `${who} has no week ${basis.week.week} projection under this league's scoring`,
    }
  }
  const add = computeRosterImpact({ roster, slots, incoming, outgoingPlayerIds: [] })
  if (add.startingPointsDelta == null) {
    return { status: 'unavailable', detail: add.blockedReason ?? 'his lineup effect could not be computed' }
  }

  const before = fillLineup(roster, slots)
  const after = fillLineup([...roster, ...incoming], slots)
  const displaced = before.starterIds.find((id) => !after.starterIds.includes(id)) ?? null
  const replaces = displaced ? names.get(displaced)?.name ?? null : null

  let netGain: number | null = null
  let netBlocked: string | null = null
  if (args.outgoingIds.length > 0) {
    const net = computeRosterImpact({ roster, slots, incoming, outgoingPlayerIds: outgoing })
    if (net.startingPointsDelta == null) {
      const unpriced = outgoing.filter((id) => priced.get(id)?.projectedPoints == null).map((id) => names.get(id)?.name ?? id)
      netBlocked =
        unpriced.length > 0
          ? `${unpriced.join(' and ')} ${unpriced.length === 1 ? 'has' : 'have'} no week ${basis.week.week} projection`
          : (net.blockedReason ?? 'the package could not be priced')
    } else {
      netGain = Math.round(net.startingPointsDelta * 10) / 10
    }
  }

  return {
    status: 'priced',
    week: basis.week.week,
    targetPoints: incoming[0]?.projectedPoints ?? null,
    addGain: Math.round(add.startingPointsDelta * 10) / 10,
    netGain,
    netBlocked,
    replaces,
  }
}

export async function buildTradeTargetVerdict(
  args: { playerName: string; leagueId: string; userId: string },
  deps: TradeTargetDeps = defaultDeps,
): Promise<TradeTargetResult> {
  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) {
    return { status: 'unresolved', reason: 'no_league_world', detail: 'I could not load this league to read its rosters.' }
  }

  const viewer = viewerRosterOf(world, args.userId)
  if (!viewer) {
    return {
      status: 'unresolved',
      reason: 'no_team',
      detail: 'I cannot find your team in this league, so there is no roster to trade from. Claim your team first.',
    }
  }

  const names = await deps.loadPlayerNames(world.league.sport, allRosteredIds(world)).catch(() => new Map() as PlayerNames)
  const byName = indexRosterNames(world, names)
  const hits = uniqueByPlayer(locateTarget(byName, args.playerName).hits)

  if (hits.length === 0) {
    return {
      status: 'unresolved',
      reason: 'not_rostered',
      detail: `I could not find ${args.playerName} on any roster in this league. If he is a free agent, add him off waivers instead of trading for him; if he is rostered, try his full name.`,
    }
  }
  if (hits.length > 1) {
    const which = hits.map((h) => `${h.name}${h.position ? ` (${h.position})` : ''}`).join(', ')
    return {
      status: 'unresolved',
      reason: 'ambiguous',
      detail: `More than one rostered player matches ${args.playerName}: ${which}. Ask again with the full name.`,
    }
  }

  const target = hits[0]!
  if (target.rosterId === viewer.rosterId) {
    return { status: 'unresolved', reason: 'already_yours', detail: `${target.name} is already on your roster in this league.` }
  }

  const visual = await deps.tradeVisual(args.leagueId, target.playerId, args.userId).catch(() => null)
  if (!visual || !visual.available) {
    return {
      status: 'unresolved',
      reason: 'engine_unavailable',
      detail: `I could not price a trade for ${target.name}: ${visual && !visual.available ? visual.reason : 'the trade read failed'}.`,
    }
  }
  const tv = visual.data

  const giveIds = (tv.recommended?.give ?? [])
    .map((a) => (a.kind === 'player' ? a.playerId : null))
    .filter((id): id is string => Boolean(id))
  const lineup = await readLineup({
    world,
    activeIds: activePlayerIds(viewer),
    targetId: target.playerId,
    outgoingIds: giveIds,
    names,
    deps: deps.leagueWeek,
  }).catch((): TradeTargetLineup => ({ status: 'unavailable', detail: 'the lineup read failed' }))

  const myTeam = world.teams.find((t) => t.teamId === viewer.teamId) ?? null

  const facts: TradeTargetFacts = {
    leagueName: tv.leagueName,
    target: {
      name: target.name,
      position: target.position ?? tv.target.position,
      value: tv.target.value,
      trend30Day: tv.target.trend30Day ?? null,
      age: tv.target.age ?? null,
    },
    mode: tv.values.mode,
    you: {
      stance: tv.you.stance,
      record: myTeam?.record ?? null,
      rank: myTeam?.rank ?? null,
      teamCount: world.teams.length || null,
      needs: tv.you.needs,
      surpluses: tv.you.surpluses,
    },
    partner: { teamName: tv.partner.teamName, stance: tv.partner.stance },
    lineup,
    offer: tv.recommended
      ? {
          give: tv.recommended.give.map((a) => ({ name: a.name, position: a.position, value: a.value })),
          giveTotal: tv.recommended.giveTotal,
          receiveTotal: tv.recommended.receiveTotal,
          fairness: tv.recommended.fairness,
        }
      : null,
    grade: tv.grade.available ? { verdict: tv.grade.data.verdict, acceptance: tv.grade.data.acceptance } : null,
    noTrades:
      tv.tradesAllowed === false || tv.bidInstead
        ? { waiverNote: tv.bidInstead?.reason ?? null }
        : null,
  }

  return { status: 'decided', verdict: decideTradeTarget(facts), leagueName: tv.leagueName, targetName: target.name }
}
