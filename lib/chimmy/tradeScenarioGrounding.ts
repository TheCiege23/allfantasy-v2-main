import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { extractPlayerNameCandidates, splitSides } from '@/lib/chimmy-trade/describedTradeEvaluator'
import { evaluateCanonicalTrade, type CanonicalTradeEvaluation, type EvaluateCanonicalTradeArgs } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  allRosteredIds,
  findRosteredByName,
  indexRosterNames,
  viewerRosterOf,
  type LocatedPlayer,
} from './leagueRosterIndex'
import type {
  ScenarioPlayer,
  TradeScenario,
  TradeScenarioLineup,
  TradeScenarioUnresolvedReason,
} from './tradeScenarioTypes'

/**
 * "What happens to my team if I trade X for Y?" — answered from the asker's own league.
 *
 * Chimmy brief item 8 (scenario comparisons). The engines existed; nothing a chat question could
 * reach produced a before/after. This resolves a described trade against the league's real
 * rosters and runs it through `evaluateCanonicalTrade` — the same evaluator the Trade Center uses —
 * so the answer carries the value on each side and, when it can be computed honestly, the
 * starting lineup before and after.
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE. Every roster in the league is read here, so a
 * caller-supplied id would be a full read of someone else's league. The route passes
 * `leagueSnapshot.id` and nothing else.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSING, and says why. A before/after for a trade nobody proposed is
 * worse than none: a name that matches two rostered players, a side that spans two partner teams,
 * a player who is not on any roster, or a draft pick (not resolved here yet) each return
 * `unresolved` with a reason the prompt states plainly.
 *
 * ⚠ PLAYOFF ODDS ARE NOT COMPUTED, AND THE RESULT SAYS SO. No engine prices a hypothetical trade
 * against real schedules and every other team's real lineup; the forecast sweep derives strength
 * from rankings, not rosters. `playoffOdds.available` is a literal `false` so a renderer cannot
 * mistake absence for a number.
 */

/** A league the size anyone plays; bounds the one name read. */
const MAX_LEAGUE_PLAYER_IDS = 800

export type {
  ReadyTradeScenario,
  ScenarioPlayer,
  TradeScenario,
  TradeScenarioLineup,
  TradeScenarioUnresolvedReason,
} from './tradeScenarioTypes'

export interface TradeScenarioDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  loadPlayerNames: (sport: string, ids: string[]) => Promise<Map<string, { name: string | null; position: string | null }>>
  evaluate: (args: EvaluateCanonicalTradeArgs, deps: { resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null> }) => Promise<CanonicalTradeEvaluation>
}

const defaultDeps: TradeScenarioDeps = {
  resolveWorld: resolveCanonicalWorld,
  loadPlayerNames: (sport, ids) => resolveNames(normalizeToSupportedSport(sport), ids, MAX_LEAGUE_PLAYER_IDS),
  evaluate: evaluateCanonicalTrade,
}

export const PLAYOFF_ODDS_UNAVAILABLE =
  'Playoff odds are not computed for a hypothetical trade: no engine here prices every team\'s real lineup against the real remaining schedule.'

/*
 * A draft pick in the sentence. Picks are priced by the evaluator, but turning "a 2027 1st" into
 * a pick asset needs the original owner and season resolved, which this does not do yet — so a
 * trade that includes one is refused rather than evaluated without it, which would misstate the
 * value on that side.
 */
const ORDINAL_NOT_A_PICK = String.raw`(?![\s-]+(?:place|down|quarter|half|string|team|time|look|and\s+goal))`
const PICK_MENTION = new RegExp(
  [
    // "2027 1st", "2026 second"
    String.raw`\b(?:19|20)\d{2}\s+(?:1st|2nd|3rd|4th|first|second|third|fourth)s?\b`,
    // "first-round pick", "2nd rounder"
    String.raw`\b(?:1st|2nd|3rd|4th|first|second|third|fourth)[\s-]+(?:round(?:er)?s?|picks?)\b`,
    // "and a 1st" — dynasty shorthand; "1st place", "3rd down", "2nd string" are not picks
    String.raw`\b(?:1st|2nd|3rd|4th)s?\b` + ORDINAL_NOT_A_PICK,
    // "and a first" — but NOT a bare "first" ("Bijan for Puka first, or wait?")
    String.raw`\ban?\s+(?:first|second|third|fourth)\b` + ORDINAL_NOT_A_PICK,
    String.raw`\bfirsts\b`,
    String.raw`\b(?:draft\s+)?picks?\b(?!\s*up\b)`,
  ].join('|'),
  'i',
)

type Located = LocatedPlayer

/** True when the message has the shape of a trade between named players. */
export function looksLikeDescribedTrade(message: string): boolean {
  if (!splitSides(message)) return false
  return extractPlayerNameCandidates(message).length >= 2
}

/**
 * Evaluate the trade the message describes, or explain why it cannot be.
 * Returns null when the message is not a described trade at all.
 */
export async function buildTradeScenario(
  args: { message: string; leagueId: string; userId: string },
  deps: TradeScenarioDeps = defaultDeps,
): Promise<TradeScenario | null> {
  const sides = splitSides(args.message)
  if (!sides) return null
  const candidates = extractPlayerNameCandidates(args.message)
  if (candidates.length < 2) return null

  if (PICK_MENTION.test(args.message)) {
    return {
      status: 'unresolved',
      reason: 'includes_picks',
      detail: 'This trade includes a draft pick, and draft picks are not included in scenario comparisons yet.',
    }
  }

  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) {
    return { status: 'unresolved', reason: 'no_league_world', detail: 'The league could not be loaded to compare rosters.' }
  }

  const viewerRoster = viewerRosterOf(world, args.userId)
  if (!viewerRoster) {
    return {
      status: 'unresolved',
      reason: 'no_viewer_roster',
      detail: 'Your team in this league is not claimed or has no synced roster, so there is no "before" to compare.',
    }
  }

  const names = await deps.loadPlayerNames(world.league.sport, allRosteredIds(world)).catch(() => new Map())
  const byName = indexRosterNames(world, names)

  const left: Located[][] = []
  const right: Located[][] = []
  const notRostered: string[] = []
  for (const raw of candidates) {
    const { candidate, hits } = findRosteredByName(byName, raw)
    const inLeft = sides.left.includes(candidate)
    const inRight = sides.right.includes(candidate)
    if (hits.length === 0) {
      /*
       * Over-generated candidates ("Should I", a team name) match nothing and are not players.
       * Only a candidate the ADJACENT side text treats as a trade piece could be a missing player,
       * and that cannot be told apart here — so an unmatched candidate is recorded, and it only
       * decides the outcome if a side ends up empty.
       */
      notRostered.push(candidate)
      continue
    }
    if (inLeft) left.push(hits)
    if (inRight) right.push(hits)
  }

  /*
   * Orientation: the side the viewer GIVES is the one whose players are all on the viewer's
   * roster; the other side must come entirely from ONE other roster. Tried both ways, because
   * "trade X for Y" and "Y for X?" are both how people ask. A name on two rosters (the IDP Josh
   * Allen and the quarterback) is narrowed by which roster that side needs, and refused if that
   * still leaves more than one.
   */
  type Oriented = { give: Located[]; get: Located[]; partnerRosterId: string } | { error: TradeScenarioUnresolvedReason }
  const orient = (giveSide: Located[][], getSide: Located[][]): Oriented => {
    if (giveSide.length === 0 || getSide.length === 0) return { error: 'players_not_rostered' }
    const give: Located[] = []
    for (const hits of giveSide) {
      const mine = hits.filter((h) => h.rosterId === viewerRoster.rosterId)
      if (mine.length !== 1) return { error: mine.length > 1 ? 'ambiguous_player' : 'sides_unclear' }
      give.push(mine[0]!)
    }
    const partnerIds = new Set<string>()
    const get: Located[] = []
    for (const hits of getSide) {
      const theirs = hits.filter((h) => h.rosterId !== viewerRoster.rosterId)
      if (theirs.length === 0) return { error: 'sides_unclear' }
      if (theirs.length > 1) return { error: 'ambiguous_player' }
      get.push(theirs[0]!)
      partnerIds.add(theirs[0]!.rosterId)
    }
    if (partnerIds.size !== 1) return { error: 'multiple_partners' }
    return { give, get, partnerRosterId: [...partnerIds][0]! }
  }

  const forward = orient(left, right)
  const backward = orient(right, left)
  const chosen = 'give' in forward ? forward : 'give' in backward ? backward : null
  if (!chosen) {
    const reason = ('error' in forward ? forward.error : 'sides_unclear') as TradeScenarioUnresolvedReason
    return { status: 'unresolved', reason, detail: describeUnresolved(reason, notRostered) }
  }

  const toAsset = (p: Located, from: string, to: string): TradeAssetSummary => ({
    fromRosterId: from,
    toRosterId: to,
    assetType: 'player',
    playerId: p.playerId,
    itemReference: p.playerId,
    playerName: p.name,
    position: p.position,
    faabAmount: null,
  })
  const assets = [
    ...chosen.give.map((p) => toAsset(p, viewerRoster.rosterId, chosen.partnerRosterId)),
    ...chosen.get.map((p) => toAsset(p, chosen.partnerRosterId, viewerRoster.rosterId)),
  ]

  let evaluation: CanonicalTradeEvaluation
  try {
    evaluation = await deps.evaluate(
      {
        leagueId: args.leagueId,
        proposalId: 'chimmy-scenario',
        proposerRosterId: viewerRoster.rosterId,
        receiverRosterId: chosen.partnerRosterId,
        viewerRosterId: viewerRoster.rosterId,
        assets,
        currentSeason: world.league.season ?? undefined,
        includeRosterImpact: true,
      },
      // The world is already loaded; the evaluator must not load it a second time.
      { resolveWorld: async () => world },
    )
  } catch {
    return {
      status: 'unresolved',
      reason: 'evaluation_failed',
      detail: 'The trade could not be evaluated against this league right now.',
    }
  }

  const partnerTeamId = world.rosters.find((r) => r.rosterId === chosen.partnerRosterId)?.teamId ?? null
  const partnerTeam = world.teams.find((t) => t.teamId === partnerTeamId) ?? null

  const impact = evaluation.rosterImpact ?? null
  const lineup: TradeScenarioLineup | null =
    impact &&
    impact.startingPointsBefore != null &&
    impact.startingPointsAfter != null &&
    impact.startingPointsDelta != null
      ? {
          before: impact.startingPointsBefore,
          after: impact.startingPointsAfter,
          delta: impact.startingPointsDelta,
          unit: impact.unit,
        }
      : null

  const strip = (p: Located): ScenarioPlayer => ({ playerId: p.playerId, name: p.name, position: p.position })
  return {
    kind: 'trade',
    status: 'ready',
    give: chosen.give.map(strip),
    get: chosen.get.map(strip),
    partnerTeamName: partnerTeam?.displayName || partnerTeam?.ownerName || 'the other team',
    value: {
      given: evaluation.valueGiven,
      received: evaluation.valueReceived,
      delta: evaluation.valueDelta,
      grade: evaluation.grade,
      coveragePct: evaluation.coveragePct,
      coverageStatus: evaluation.coverageStatus,
    },
    lineup,
    lineupUnavailable: lineup ? null : impact?.blockedReason ?? 'The starting lineup could not be priced for this league.',
    playoffOdds: { available: false, reason: PLAYOFF_ODDS_UNAVAILABLE },
  }
}

function describeUnresolved(reason: TradeScenarioUnresolvedReason, notRostered: string[]): string {
  switch (reason) {
    case 'players_not_rostered':
      return notRostered.length
        ? `Not every player named is on a roster in this league (${notRostered.slice(0, 4).join(', ')}), so this is not a trade between two teams here.`
        : 'Not every player named is on a roster in this league.'
    case 'ambiguous_player':
      return 'A player name matches more than one rostered player in this league, so the trade is ambiguous.'
    case 'multiple_partners':
      return 'The players you would receive are on more than one team; only two-team trades are compared.'
    default:
      return 'It is not clear which players you would give and which you would get — one side must be on your roster and the other on one other team.'
  }
}

const fmt = (n: number | null, digits = 1) => (n == null ? 'unknown' : n.toFixed(digits))
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`
const unitLabel = (unit: string) => unit.replace(/_/g, ' ')
const list = (ps: ScenarioPlayer[]) => ps.map((p) => (p.position ? `${p.name} (${p.position})` : p.name)).join(', ')

/** The prompt block. Deterministic, so the model repeats numbers rather than inventing them. */
export function renderTradeScenarioBlock(scenario: TradeScenario): string {
  if (scenario.status === 'unresolved') {
    return [
      'TRADE SCENARIO: NOT COMPUTED.',
      scenario.detail,
      'Do not present a before/after comparison for this trade. Say plainly that it was not computed and why.',
    ].join('\n')
  }
  const s = scenario
  const lines = [
    "TRADE SCENARIO (computed from this league's real rosters by the AllFantasy trade evaluator — repeat these numbers, do not estimate your own):",
    `- You give: ${list(s.give)}. You get: ${list(s.get)} from ${s.partnerTeamName}.`,
    `- Value (AllFantasy value scale): you send ${fmt(s.value.given, 0)}, you receive ${fmt(s.value.received, 0)}` +
      (s.value.delta != null ? ` (${signed(s.value.delta, 0)})` : '') +
      (s.value.grade ? `; grade ${s.value.grade}` : '') +
      (s.value.coverageStatus !== 'complete' ? `; value coverage ${s.value.coverageStatus} (${Math.round(s.value.coveragePct)}%)` : '') +
      '.',
    s.lineup
      ? `- Starting lineup (${unitLabel(s.lineup.unit)}): ${fmt(s.lineup.before)} before, ${fmt(s.lineup.after)} after (${signed(s.lineup.delta)}).`
      : `- Starting lineup: not computed — ${s.lineupUnavailable}`,
    `- Playoff odds: not computed. ${s.playoffOdds.reason} Do not estimate them.`,
  ]
  return lines.join('\n')
}
