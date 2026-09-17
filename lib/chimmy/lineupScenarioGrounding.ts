import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { extractPlayerNameCandidates } from '@/lib/chimmy-trade/describedTradeEvaluator'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekBasis,
  type LeagueWeekPricingDeps,
  type LeagueWeekRefusal,
} from '@/lib/decision-os/trade/leagueWeekPricing'
import {
  computeRosterImpact,
  DEFAULT_SLOT_ELIGIBILITY,
  fillLineup,
  type ImpactPlayer,
} from '@/lib/decision-os/trade/rosterImpact'
import type { WaiverClaimRecommendation } from '@/lib/decision-os/waiver/decision'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld, RosterFacts } from '@/lib/decision-os/world/facts'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  activePlayerIds,
  allRosteredIds,
  findRosteredByName,
  indexRosterNames,
  nameVariants,
  viewerRosterOf,
  type LocatedPlayer,
  type PlayerNames,
} from './leagueRosterIndex'
import {
  LEAGUE_WEEK_UNIT,
  type ReadyStartSitScenario,
  type ReadyWaiverScenario,
  type ScenarioPlayer,
  type ScenarioWeek,
  type StartSitOption,
  type StartSitScenario,
  type StartSitScenarioUnresolvedReason,
  type TradeScenarioLineup,
  type WaiverScenario,
  type WaiverScenarioUnresolvedReason,
} from './tradeScenarioTypes'

/**
 * Scenario comparisons beyond trades (Chimmy brief item 8, user decision 2026-09-16): a waiver
 * add/drop and a start/sit, each answered from the asker's own league.
 *
 * ── 🛑 THIS WEEK, UNDER THIS LEAGUE'S RULES — NOT THE TRADE CARD'S PER-GAME FIGURE ───────────────
 * The trade scenario prices lineups with `AFProjectionSnapshot.afProjection`, which is written in
 * ONE format, full PPR, whatever the league scores (`AF_SNAPSHOT_SCORING_FORMAT`). A first cut of
 * these two kinds reused it, and would have compared a receiver with a back in full PPR for a
 * half-PPR league: measured on staging 2026-09-16, 21 of 225 Sleeper leagues score receptions at
 * 0.5 or 0, and 138 carry a TE premium. The user's standing decision for exactly this case is to
 * REFUSE rather than print a generic number under a "your league" label (league-view scoring audit,
 * #949). So these two re-score the week's vendor component line under the league's own rulebook —
 * the basis My Team and the matchup tabs use — and refuse when the league has no rules. The pricing
 * itself lives in `lib/decision-os/trade/leagueWeekPricing.ts`, shared with the trade evaluator's
 * lineup impact (which moved onto this basis 2026-09-17), so the kinds cannot drift apart.
 *
 * ⚠ ONE WEEK, AND THAT IS THE RIGHT UNIT FOR A START/SIT. For a waiver add it is only part of the
 * answer, and the prompt and card both say so.
 *
 * ⚠ NFL ONLY. `latestProjectionWeek` and the weekly feed are NFL's; every other sport refuses by name.
 *
 * Both reuse the Trade Center's lineup maths (`fillLineup`, `computeRosterImpact`).
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE. Every roster in the league is read here.
 *
 * ⚠ REFUSE RATHER THAN GUESS, AND SAY WHY. A name that matches two players, a free agent nothing
 * projects, a drop who is not on your roster — each returns `unresolved` with a reason the prompt
 * states plainly, instead of a before/after for a move nobody described.
 *
 * ⚠ WHAT IS NOT MODELLED IS NAMED, NOT OMITTED: weather, injury news after the last sync, whether a
 * game has locked, whether a claim succeeds, FAAB competition, weeks after this one, playoff odds.
 */

const MAX_LEAGUE_PLAYER_IDS = 800
/** The same bound Chimmy's player-projection tool searches a week's feed with; one week holds ~1,000. */
const NAME_SEARCH_CAP = 2500

export const PLAYOFF_ODDS_UNAVAILABLE_MOVE =
  'Playoff odds are not computed for a hypothetical move: no engine here prices every team\'s real lineup against the real remaining schedule.'

export type WeekPlayer = { playerId: string; name: string; position: string | null }

export interface LineupScenarioDeps extends LeagueWeekPricingDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayerNames: (sport: string, ids: string[]) => Promise<PlayerNames>
  /**
   * Players in that week's feed whose name normalizes to `name` — the only way to reach a free agent.
   * `complete` is false when the feed could not be searched in full, so "no match" is not a finding.
   */
  findWeekPlayersByName: (args: { week: ScenarioWeek; name: string }) => Promise<{ players: WeekPlayer[]; complete: boolean }>
}

const statsOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const defaultDeps: LineupScenarioDeps = {
  ...defaultLeagueWeekPricingDeps,
  resolveWorld: resolveCanonicalWorld,
  loadPlayerNames: (sport, ids) => resolveNames(normalizeToSupportedSport(sport), ids, MAX_LEAGUE_PLAYER_IDS),
  findWeekPlayersByName: async ({ week, name }) => {
    const target = normalizePlayerName(name)
    if (!target) return { players: [], complete: true }
    const rows = await prisma.fantasyProjection.findMany({
      where: { season: week.season, week: week.week, source: { not: 'allfantasy' } },
      select: { playerId: true, stats: true },
      take: NAME_SEARCH_CAP,
    })
    const players: WeekPlayer[] = []
    for (const row of rows) {
      const stats = statsOf(row.stats)
      const rowName = typeof stats.name === 'string' ? stats.name : ''
      if (!rowName || normalizePlayerName(rowName) !== target) continue
      players.push({ playerId: row.playerId, name: rowName, position: typeof stats.position === 'string' ? stats.position : null })
    }
    return { players, complete: rows.length < NAME_SEARCH_CAP }
  },
}

/* ── Detection ─────────────────────────────────────────────────────────────────────────────── */

const START_SIT_WORDS = /\b(?:start|starting|sit|sitting|bench|flex|play)\b/i
const CHOICE_WORDS = /\b(?:or|vs\.?|versus|over|instead\s+of)\b/i
const VERB = /\b(add|adding|pick\s*up|picking\s+up|grab|claim|stream|drop|dropping|cut|cutting|release|releasing|waive|for)\b/gi
const ADD_WORDS = new Set(['add', 'adding', 'pickup', 'pick up', 'picking up', 'grab', 'claim', 'stream'])
const DROP_WORDS = new Set(['drop', 'dropping', 'cut', 'cutting', 'release', 'releasing', 'waive'])

/** A start/sit question: start/sit wording, a choice word, and at least two names. */
export function looksLikeStartSit(message: string): boolean {
  return START_SIT_WORDS.test(message) && CHOICE_WORDS.test(message) && extractPlayerNameCandidates(message).length >= 2
}

/** A waiver move: an add or drop verb. Names are optional — the engine's top claim can stand in. */
export function looksLikeWaiverMove(message: string): boolean {
  return /\b(?:add|adding|pick\s*up|picking\s+up|grab|claim|stream|drop|dropping|cut|release|waive|waiver|wire)\b/i.test(message)
}

type Role = 'add' | 'drop'

/**
 * Which named player is being added and which dropped, by the verb nearest before each name. `for`
 * swaps roles: "drop Y for X" adds X, "add X for Y" drops Y. A name with no verb before it ("Should
 * I …") is not part of the move.
 */
export function parseWaiverMove(message: string): { add: string[]; drop: string[] } {
  const verbs: Array<{ index: number; role: Role | 'for' }> = []
  for (const m of message.matchAll(VERB)) {
    const word = m[1]!.toLowerCase().replace(/\s+/g, ' ')
    const role: Role | 'for' | null = word === 'for' ? 'for' : ADD_WORDS.has(word) ? 'add' : DROP_WORDS.has(word) ? 'drop' : null
    if (role) verbs.push({ index: m.index ?? 0, role })
  }
  const out = { add: [] as string[], drop: [] as string[] }
  for (const candidate of extractPlayerNameCandidates(message)) {
    const at = message.indexOf(candidate)
    let role: Role | null = null
    for (const v of verbs) {
      if (v.index > at) break
      role = v.role === 'for' ? (role === 'drop' ? 'add' : role === 'add' ? 'drop' : null) : v.role
    }
    if (role) out[role].push(candidate)
  }
  return out
}

/* ── Shared loading ────────────────────────────────────────────────────────────────────────── */

type Loaded = {
  world: CanonicalWorld
  roster: RosterFacts
  byName: Map<string, LocatedPlayer[]>
  names: PlayerNames
}

async function loadLeague(
  args: { leagueId: string; userId: string },
  deps: LineupScenarioDeps,
): Promise<Loaded | 'no_league_world' | 'no_viewer_roster'> {
  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) return 'no_league_world'
  const roster = viewerRosterOf(world, args.userId)
  if (!roster) return 'no_viewer_roster'
  const names = await deps.loadPlayerNames(world.league.sport, allRosteredIds(world)).catch(() => new Map() as PlayerNames)
  return { world, roster, byName: indexRosterNames(world, names), names }
}

type WeekBasis = LeagueWeekBasis
type WeekRefusal = LeagueWeekRefusal

/** The league's rulebook and the feed's week — or why neither kind can price anything here, as a sentence. */
async function weekBasis(world: CanonicalWorld, deps: LineupScenarioDeps): Promise<WeekBasis | WeekRefusal> {
  const basis = await leagueWeekBasis(world.league, deps)
  if (!isLeagueWeekRefusal(basis)) return basis
  return { refuse: basis.refuse, detail: `No lineup numbers: ${basis.detail}.` }
}

const round2 = (n: number) => Math.round(n * 100) / 100

const priceWeek = (basis: WeekBasis, ids: string[], positions: ReadonlyMap<string, string | null>, deps: LineupScenarioDeps) =>
  priceLeagueWeek(basis, ids, positions, deps)

const lineupFrom = (before: number | null, after: number | null, delta: number | null): TradeScenarioLineup | null =>
  before != null && after != null && delta != null
    ? { before: round2(before), after: round2(after), delta: round2(delta), unit: LEAGUE_WEEK_UNIT }
    : null

const noLeaguePoints = (week: ScenarioWeek) =>
  `No player on your roster has a week ${week.week} projection that this league's rules can score.`

/* ── Start / sit ───────────────────────────────────────────────────────────────────────────── */

const startSitUnresolved = (reason: StartSitScenarioUnresolvedReason, detail: string): StartSitScenario => ({
  kind: 'start_sit',
  status: 'unresolved',
  reason,
  detail,
})

/**
 * The best starting total with `forced` in a starting slot, or null when no slot takes them.
 *
 * 🛑 "THE BEST LINEUP WITHOUT THE OTHER OPTION" IS NOT THIS. Benching B can start a third player in
 * B's place, so that total says nothing about starting A — and in a "neither starts" case it does not
 * start A at all. Forcing A into each slot it can fill, and filling the rest greedily, measures the
 * choice that was asked about.
 */
function bestLineupStarting(forced: ImpactPlayer, pool: readonly ImpactPlayer[], slots: readonly string[]): number | null {
  const position = forced.position.toUpperCase()
  const rest = pool.filter((p) => p.playerId !== forced.playerId)
  let best: number | null = null
  for (let i = 0; i < slots.length; i += 1) {
    if (!DEFAULT_SLOT_ELIGIBILITY[slots[i]!.toUpperCase()]?.includes(position)) continue
    const total = fillLineup(rest, [...slots.slice(0, i), ...slots.slice(i + 1)]).points + (forced.projectedPoints as number)
    if (best == null || total > best) best = total
  }
  return best == null ? null : round2(best)
}

/**
 * "Start A or B?" for two players on the asker's roster. Null when the message is not that question.
 */
export async function buildStartSitScenario(
  args: { message: string; leagueId: string; userId: string },
  deps: LineupScenarioDeps = defaultDeps,
): Promise<StartSitScenario | null> {
  if (!looksLikeStartSit(args.message)) return null
  const loaded = await loadLeague(args, deps)
  if (loaded === 'no_league_world') return startSitUnresolved('no_league_world', 'The league could not be loaded to compare lineups.')
  if (loaded === 'no_viewer_roster') {
    return startSitUnresolved('no_viewer_roster', 'Your team in this league is not claimed or has no synced roster.')
  }
  const { world, roster, byName, names } = loaded

  const mine: LocatedPlayer[] = []
  let namedElsewhere = 0
  for (const raw of extractPlayerNameCandidates(args.message)) {
    const { hits } = findRosteredByName(byName, raw)
    if (hits.length === 0) continue
    const onMine = hits.filter((h) => h.rosterId === roster.rosterId)
    if (onMine.length > 1) return startSitUnresolved('ambiguous_player', 'A name matches more than one player on your roster.')
    if (onMine.length === 0) {
      namedElsewhere += 1
      continue
    }
    if (!mine.some((p) => p.playerId === onMine[0]!.playerId)) mine.push(onMine[0]!)
  }
  // More than two of yours is a different question ("who of these three?"), not guessed at.
  if (mine.length > 2) return null
  if (mine.length !== 2) {
    // Not a two-player choice on this roster. Only say so when real players were named.
    if (mine.length + namedElsewhere < 2) return null
    return startSitUnresolved('players_not_on_roster', 'Both players have to be on your roster to compare starting them.')
  }

  const active = activePlayerIds(roster)
  const inactive = mine.filter((p) => !active.includes(p.playerId))
  if (inactive.length > 0) {
    return startSitUnresolved(
      'players_not_on_roster',
      `${inactive.map((p) => p.name).join(' and ')} ${inactive.length > 1 ? 'are' : 'is'} on injured reserve or the taxi squad, so cannot start.`,
    )
  }

  const slots = world.league.rosterSettings.starterSlots
  if (!slots || slots.length === 0) {
    return startSitUnresolved('unknown_slots', "This league's starting lineup slots are not on file, so no lineup can be built.")
  }

  const basis = await weekBasis(world, deps)
  if ('refuse' in basis) return startSitUnresolved(basis.refuse, basis.detail)

  const priced = await priceWeek(basis, active, new Map(active.map((id) => [id, names.get(id)?.position ?? null])), deps)
  const players = active.map((id) => priced.get(id)!)
  if (players.every((p) => p.projectedPoints == null)) return startSitUnresolved('no_league_projections', noLeaguePoints(basis.week))

  const [a, b] = mine as [LocatedPlayer, LocatedPlayer]
  const pa = priced.get(a.playerId)!
  const pb = priced.get(b.playerId)!
  const unpriced = [pa, pb].filter((p) => p.projectedPoints == null)
  if (unpriced.length > 0) {
    const who = unpriced.map((p) => (p === pa ? a.name : b.name)).join(' and ')
    return startSitUnresolved(
      'unpriced_player',
      `${who} has no week ${basis.week.week} projection that this league's rules can score, so the two cannot be compared.`,
    )
  }

  const best = fillLineup(players, slots)
  if (best.unknownSlots.length > 0) {
    return startSitUnresolved('unknown_slots', `The lineup has slots this model cannot fill: ${best.unknownSlots.join(', ')}.`)
  }
  const ifA = bestLineupStarting(pa, players.filter((p) => p.playerId !== b.playerId), slots)
  const ifB = bestLineupStarting(pb, players.filter((p) => p.playerId !== a.playerId), slots)
  if (ifA == null || ifB == null) {
    const who = [ifA == null ? a.name : null, ifB == null ? b.name : null].filter(Boolean).join(' and ')
    return startSitUnresolved('no_starting_slot', `${who} has no starting slot in this league's lineup.`)
  }

  const option = (p: LocatedPlayer, ip: ImpactPlayer, ifStarted: number): StartSitOption => ({
    playerId: p.playerId,
    name: p.name,
    position: p.position ?? (ip.position || null),
    points: ip.projectedPoints as number,
    inBestLineup: best.starterIds.includes(p.playerId),
    lineupIfStarted: ifStarted,
  })
  const optA = option(a, pa, ifA)
  const optB = option(b, pb, ifB)
  const contested = optA.inBestLineup !== optB.inBestLineup
  const pick = contested ? (optA.inBestLineup ? optA : optB) : null
  const other = pick === optA ? optB : optA

  const scenario: ReadyStartSitScenario = {
    kind: 'start_sit',
    status: 'ready',
    options: [optA, optB],
    unit: LEAGUE_WEEK_UNIT,
    week: basis.week,
    contested,
    startPlayerId: pick?.playerId ?? null,
    delta: pick ? round2(pick.lineupIfStarted - other.lineupIfStarted) : null,
    unpricedExcluded: players.filter((p) => p.projectedPoints == null).length,
    unfilledSlots: best.unfilledSlots,
    playoffOdds: { available: false, reason: PLAYOFF_ODDS_UNAVAILABLE_MOVE },
  }
  return scenario
}

/* ── Waiver add / drop ─────────────────────────────────────────────────────────────────────── */

const waiverUnresolved = (reason: WaiverScenarioUnresolvedReason, detail: string): WaiverScenario => ({
  kind: 'waiver',
  status: 'unresolved',
  reason,
  detail,
})

/**
 * "Add X (and drop Y)?" — or, when no player is named, the waiver engine's top claim. Null when the
 * message is not a waiver move, or names more than one player to add or drop (not guessed).
 */
export async function buildWaiverScenario(
  args: {
    message: string
    leagueId: string
    userId: string
    /** The engine's claims for this turn, only when its grounding packet was actually used. */
    engineClaims?: readonly WaiverClaimRecommendation[] | null
  },
  deps: LineupScenarioDeps = defaultDeps,
): Promise<WaiverScenario | null> {
  if (!looksLikeWaiverMove(args.message)) return null
  const move = parseWaiverMove(args.message)
  if (move.add.length > 1 || move.drop.length > 1) return null

  let addName: string | null = move.add[0] ?? null
  let dropName: string | null = move.drop[0] ?? null
  let source: ReadyWaiverScenario['source'] = 'named'
  let engine: ReadyWaiverScenario['engine'] = null
  if (!addName) {
    const top = [...(args.engineClaims ?? [])]
      .filter((c) => c && c.addPlayerName?.trim())
      .sort((x, y) => (x.priorityRank ?? Number.POSITIVE_INFINITY) - (y.priorityRank ?? Number.POSITIVE_INFINITY))[0]
    if (!top) return null
    addName = top.addPlayerName.trim()
    dropName = dropName ?? top.dropPlayerName?.trim() ?? null
    source = 'engine_top_claim'
    engine = { compositeScore: top.compositeScore ?? null, faabBid: top.faabBid ?? null }
  }

  const loaded = await loadLeague(args, deps)
  if (loaded === 'no_league_world') return waiverUnresolved('no_league_world', 'The league could not be loaded to compare lineups.')
  if (loaded === 'no_viewer_roster') {
    return waiverUnresolved('no_viewer_roster', 'Your team in this league is not claimed or has no synced roster.')
  }
  const { world, roster, byName, names } = loaded

  const basis = await weekBasis(world, deps)
  if ('refuse' in basis) return waiverUnresolved(basis.refuse, basis.detail)
  const weekNo = basis.week.week

  // The add: nobody in this league may already roster a player by that name…
  if (findRosteredByName(byName, addName).hits.length > 0) {
    return waiverUnresolved('add_rostered', `${addName} is already on a roster in this league, so cannot be added.`)
  }
  let found: { players: WeekPlayer[]; complete: boolean } = { players: [], complete: true }
  for (const variant of nameVariants(addName)) {
    found = await deps
      .findWeekPlayersByName({ week: basis.week, name: variant })
      .catch(() => ({ players: [], complete: false }))
    if (found.players.length > 0) {
      addName = variant
      break
    }
  }
  if (found.players.length === 0) {
    return waiverUnresolved(
      'add_not_found',
      found.complete
        ? `No week ${weekNo} projection matches a player named ${addName}, so the add cannot be priced.`
        : `The week ${weekNo} projection feed could not be searched in full for ${addName}, so the add was not priced.`,
    )
  }
  if (found.players.length > 1) {
    return waiverUnresolved('ambiguous_player', `More than one player is named ${addName}; say which one.`)
  }
  const fa = found.players[0]!
  // …and nobody may roster that player by id either, whatever name the roster sync stored.
  if (allRosteredIds(world).includes(fa.playerId)) {
    return waiverUnresolved('add_rostered', `${fa.name} is already on a roster in this league, so cannot be added.`)
  }

  // The drop: must be on YOUR roster.
  let drop: LocatedPlayer | null = null
  if (dropName) {
    const onMine = findRosteredByName(byName, dropName).hits.filter((h) => h.rosterId === roster.rosterId)
    if (onMine.length === 0) {
      return waiverUnresolved('drop_not_on_roster', `${dropName} is not on your roster, so cannot be dropped.`)
    }
    if (onMine.length > 1) return waiverUnresolved('ambiguous_player', `More than one player on your roster is named ${dropName}.`)
    drop = onMine[0]!
  }

  const active = activePlayerIds(roster)
  const positions = new Map<string, string | null>(active.map((id) => [id, names.get(id)?.position ?? null]))
  positions.set(fa.playerId, fa.position)
  const priced = await priceWeek(basis, [...active, fa.playerId], positions, deps)
  const players = active.map((id) => priced.get(id)!)
  if (players.every((p) => p.projectedPoints == null)) return waiverUnresolved('no_league_projections', noLeaguePoints(basis.week))
  const incoming = priced.get(fa.playerId)!

  const slots = world.league.rosterSettings.starterSlots
  // Dropping a reserved player changes nobody's lineup, so only an active drop is subtracted.
  const activeDrop = drop != null && active.includes(drop.playerId) ? priced.get(drop.playerId)! : null
  const noPoints = (name: string) => `${name} has no week ${weekNo} projection that this league's rules can score.`
  let lineup: TradeScenarioLineup | null = null
  let lineupUnavailable: string | null = null
  let unfilledSlots: string[] = []
  if (!slots || slots.length === 0) {
    lineupUnavailable = "This league's starting lineup slots are not on file."
  } else if (incoming.projectedPoints == null) {
    lineupUnavailable = noPoints(fa.name)
  } else if (activeDrop && activeDrop.projectedPoints == null) {
    lineupUnavailable = noPoints(drop!.name)
  } else {
    const impact = computeRosterImpact({
      roster: players,
      slots,
      incoming: [incoming],
      outgoingPlayerIds: activeDrop ? [activeDrop.playerId] : [],
    })
    lineup = lineupFrom(impact.startingPointsBefore, impact.startingPointsAfter, impact.startingPointsDelta)
    lineupUnavailable = lineup ? null : impact.blockedReason ?? 'The starting lineup could not be priced.'
    if (lineup) unfilledSlots = fillLineup(players, slots).unfilledSlots
  }

  const scenario: ReadyWaiverScenario = {
    kind: 'waiver',
    status: 'ready',
    add: { playerId: fa.playerId, name: fa.name, position: fa.position, points: incoming.projectedPoints },
    drop: drop
      ? { playerId: drop.playerId, name: drop.name, position: drop.position, points: priced.get(drop.playerId)?.projectedPoints ?? null }
      : null,
    week: basis.week,
    source,
    lineup,
    lineupUnavailable,
    engine,
    rosterRoomUnchecked: drop == null,
    unfilledSlots,
    playoffOdds: { available: false, reason: PLAYOFF_ODDS_UNAVAILABLE_MOVE },
  }
  return scenario
}

/* ── Prompt blocks ─────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
const who = (p: ScenarioPlayer) => (p.position ? `${p.name} (${p.position})` : p.name)
const basisLine = (label: string, week: ScenarioWeek) =>
  `${label} (computed from this league's real roster, with week ${week.week} projections scored under this league's own rules — repeat these numbers, do not estimate your own):`
const unfilledLine = (slots: string[]) =>
  slots.length > 0
    ? `- Every total leaves out ${slots.join(', ')}: no player who can fill ${slots.length === 1 ? 'that slot' : 'those slots'} has a projection under these rules.`
    : null

export function renderWaiverScenarioBlock(scenario: WaiverScenario): string {
  if (scenario.status === 'unresolved') {
    return [
      'WAIVER SCENARIO: NOT COMPUTED.',
      scenario.detail,
      'Do not present a before/after comparison for this move. Say plainly that it was not computed and why.',
    ].join('\n')
  }
  const s = scenario
  const wk = s.week.week
  const pts = (p: { points: number | null }) =>
    p.points == null ? `no week ${wk} projection under this league's rules` : `${fmt(p.points)} points in week ${wk}`
  return [
    basisLine('WAIVER SCENARIO', s.week),
    `- Add: ${who(s.add)}, ${pts(s.add)}.` +
      (s.drop ? ` Drop: ${who(s.drop)}, ${pts(s.drop)}.` : ' No drop named — whether the roster has room was NOT checked.'),
    s.lineup
      ? `- Starting lineup, week ${wk}: ${fmt(s.lineup.before)} before, ${fmt(s.lineup.after)} after (${signed(s.lineup.delta)}).`
      : `- Starting lineup: not computed — ${s.lineupUnavailable}`,
    unfilledLine(s.unfilledSlots),
    s.source === 'engine_top_claim'
      ? `- This is the AllFantasy waiver engine's top claim for them` +
        (s.engine?.compositeScore != null ? ` (engine score ${Math.round(s.engine.compositeScore)}/100` : ' (') +
        (s.engine?.faabBid != null ? `, suggested bid $${s.engine.faabBid})` : ')') +
        '; they did not name it.'
      : '- This is the move they named.',
    `- This is ONE week. An add is usually a longer decision, and the weeks after this one are not in these numbers — say so.`,
    `- Not modelled: whether the claim succeeds, FAAB competition, and playoff odds. ${s.playoffOdds.reason} Do not estimate them.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderStartSitScenarioBlock(scenario: StartSitScenario): string {
  if (scenario.status === 'unresolved') {
    return [
      'START/SIT SCENARIO: NOT COMPUTED.',
      scenario.detail,
      'Do not present lineup numbers for this choice. Say plainly that it was not computed and why.',
    ].join('\n')
  }
  const s = scenario
  const wk = s.week.week
  const [a, b] = s.options
  const line = (o: StartSitOption) =>
    `${who(o)}: ${fmt(o.points)} points in week ${wk} — ${o.inBestLineup ? 'IN' : 'not in'} your best lineup.`
  const verdict = s.contested
    ? (() => {
        const pick = s.options.find((o) => o.playerId === s.startPlayerId)!
        const other = s.options.find((o) => o.playerId !== s.startPlayerId)!
        return `- Start ${pick.name}: your best lineup scores ${fmt(pick.lineupIfStarted)}; starting ${other.name} instead scores ${fmt(other.lineupIfStarted)} (${signed(-(s.delta ?? 0))}).`
      })()
    : a.inBestLineup && b.inBestLineup
      ? '- Both are in your best lineup, so this does not force a choice between them: start both.'
      : `- Neither is in your best lineup. Starting ${a.name} scores ${fmt(a.lineupIfStarted)}; starting ${b.name} scores ${fmt(b.lineupIfStarted)}.`
  return [
    basisLine('START/SIT SCENARIO', s.week),
    `- ${line(a)}`,
    `- ${line(b)}`,
    verdict,
    unfilledLine(s.unfilledSlots),
    s.unpricedExcluded > 0
      ? `- ${s.unpricedExcluded} active rostered player(s) have no week ${wk} projection under these rules and were left out of the lineup maths.`
      : null,
    '- Not modelled: weather, injury news after the last sync, and whether either game has already locked. Say so if the answer depends on them.',
  ]
    .filter(Boolean)
    .join('\n')
}
