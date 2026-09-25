import 'server-only'

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { extractPlayerNameCandidates, splitSides } from '@/lib/chimmy-trade/describedTradeEvaluator'
import { evaluateCanonicalTrade, type CanonicalTradeEvaluation, type EvaluateCanonicalTradeArgs } from '@/lib/decision-os/trade/canonicalEvaluator'
import type { TradeAssetSummary } from '@/lib/decision-os/trade/dco'
import { extractPickMentions, pickLabel, type PickMention } from './tradePickMentions'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
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
 * rosters: the VALUE and the GRADE come from the one trade grader (`lib/decision-os/trade/leagueTradeGrader.ts`)
 * — the same letter the Trade Center, the pending-offer cards and /core Trades give this deal — and
 * `evaluateCanonicalTrade` supplies the starting lineup before and after, when it can be computed
 * honestly.
 *
 * 🛑 THE GRADE USED TO COME FROM THE CANONICAL EVALUATOR, and this header claimed that was "the same
 * evaluator the Trade Center uses". By 2026-09-24 it was not: the canonical grader gives ONE fairness
 * letter for both teams, so Chimmy called a 1.5x deal a C while the Trade Center called it an A.
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
  /** THE grade for the deal, from the viewer's side. */
  grade: (args: { leagueId: string; userId: string; give: GradeInputs; get: GradeInputs }) => Promise<TradeGradeView>
}

const defaultDeps: TradeScenarioDeps = {
  resolveWorld: resolveCanonicalWorld,
  loadPlayerNames: (sport, ids) => resolveNames(normalizeToSupportedSport(sport), ids, MAX_LEAGUE_PLAYER_IDS),
  evaluate: evaluateCanonicalTrade,
  grade: async ({ leagueId, userId, give, get }) =>
    gradeDeal(await createLeagueTradeGrader({ leagueId, userId }).catch(() => null), { give, get, viewerSide: true }),
}

export const PLAYOFF_ODDS_UNAVAILABLE =
  'Playoff odds are not computed for a hypothetical trade: no engine here prices every team\'s real lineup against the real remaining schedule.'

/*
 * A draft pick anywhere in the sentence — the BROAD detector. Parsing into (season, round) is
 * `extractPickMentions`; this stays as its backstop, so a pick the parser could not read makes the
 * trade refuse instead of being evaluated without it (which would misstate that side's value).
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
  /*
   * Picks per SIDE, because a pick belongs to whoever's side of "for" it is written on. A pick counts
   * toward "is this a trade at all", so "my 2027 1st for Puka Nacua" (one name) still qualifies.
   */
  const leftPicks = extractPickMentions(sides.left)
  const rightPicks = extractPickMentions(sides.right)
  const pickCount = leftPicks.picks.length + rightPicks.picks.length
  const mentionsPicks = pickCount > 0 || leftPicks.unclear || rightPicks.unclear || PICK_MENTION.test(args.message)
  if (candidates.length + pickCount < 2) return null

  const world = await deps.resolveWorld(args.leagueId).catch(() => null)
  if (!world) {
    return { status: 'unresolved', reason: 'no_league_world', detail: 'The league could not be loaded to compare rosters.' }
  }

  /*
   * 🛑 PICKS ARE PRICED ONLY WHERE A PICK MARKET EXISTS — A DYNASTY LEAGUE. There the evaluator
   * reads FantasyCalc's own dynasty pick prices, on the same scale as the players. Anywhere else a
   * pick would be priced off a curve in a different currency from the players beside it, so the
   * trade is refused as before rather than graded on a guess.
   */
  if (mentionsPicks) {
    /*
     * ⚠ THE OLD DETECTOR IS KEPT AS A BACKSTOP. If it sees a pick the parser turned into nothing,
     * evaluating would silently drop that asset from its side — so that case is "unclear" too.
     */
    const detectorOnly = pickCount === 0 && !leftPicks.unclear && !rightPicks.unclear
    const refusal = refusePicks(world, leftPicks, detectorOnly ? { ...rightPicks, unclear: true } : rightPicks)
    if (refusal) return refusal
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
  type Oriented =
    | { give: Located[]; get: Located[]; givePicks: PickMention[]; getPicks: PickMention[]; partnerRosterId: string }
    | { error: TradeScenarioUnresolvedReason }
  const orient = (
    giveSide: Located[][],
    getSide: Located[][],
    givePicks: PickMention[],
    getPicks: PickMention[],
  ): Oriented => {
    if (giveSide.length + givePicks.length === 0 || getSide.length + getPicks.length === 0) {
      return { error: 'players_not_rostered' }
    }
    /*
     * The partner is identified by the players you would RECEIVE. With only picks on that side
     * there is no way to know whose picks they are — refused, and the reply asks for a name.
     */
    if (getSide.length === 0) return { error: 'pick_partner_unclear' }
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
    return { give, get, givePicks, getPicks, partnerRosterId: [...partnerIds][0]! }
  }

  const forward = orient(left, right, leftPicks.picks, rightPicks.picks)
  const backward = orient(right, left, rightPicks.picks, leftPicks.picks)
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
  /*
   * ⚠ ASSUMED TO BE THE GIVING TEAM'S OWN PICK, AND THE PROMPT SAYS SO. "My 2027 1st" is almost
   * always that, but a traded-in pick has a different original owner and so a different likely
   * slot. The value is the round AVERAGE either way, which is exactly the uncertainty an unknown
   * slot carries.
   */
  const toPickAsset = (p: PickMention, from: string, to: string): TradeAssetSummary => ({
    fromRosterId: from,
    toRosterId: to,
    assetType: 'draft_pick',
    playerId: null,
    playerName: null,
    faabAmount: null,
    itemReference: `pick:${p.season}:${p.round}:${from}`,
    pickSeason: p.season,
    pickRound: p.round,
    pickOriginalRosterId: from,
    pickLabel: pickLabel(p),
  })
  const assets = [
    ...chosen.give.map((p) => toAsset(p, viewerRoster.rosterId, chosen.partnerRosterId)),
    ...chosen.givePicks.map((p) => toPickAsset(p, viewerRoster.rosterId, chosen.partnerRosterId)),
    ...chosen.get.map((p) => toAsset(p, chosen.partnerRosterId, viewerRoster.rosterId)),
    ...chosen.getPicks.map((p) => toPickAsset(p, chosen.partnerRosterId, viewerRoster.rosterId)),
  ]

  /* Players by name and picks by season/round — what the one grader prices (see `tradeGradeInputs`). */
  const gradeSide = (players: Located[], picks: PickMention[]): GradeInputs => ({
    assets: [
      ...players.map((p) => ({ kind: 'player' as const, name: p.name })),
      ...picks.map((p) => ({ kind: 'pick' as const, year: p.season as number, round: p.round })),
    ],
    unpriceable: [],
  })
  const gradePromise = deps
    .grade({
      leagueId: args.leagueId,
      userId: args.userId,
      give: gradeSide(chosen.give, chosen.givePicks),
      get: gradeSide(chosen.get, chosen.getPicks),
    })
    .catch((): TradeGradeView => ({ graded: false, reason: 'The trade could not be graded just now.', basis: null }))

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

  const grade = await gradePromise
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
  const stripPick = (p: PickMention, owner: string): ScenarioPlayer => ({
    playerId: `pick:${p.season}:${p.round}:${owner}`,
    name: pickLabel(p),
    position: null,
  })
  const tradedPicks = chosen.givePicks.length + chosen.getPicks.length
  return {
    kind: 'trade',
    status: 'ready',
    give: [...chosen.give.map(strip), ...chosen.givePicks.map((p) => stripPick(p, viewerRoster.rosterId))],
    get: [...chosen.get.map(strip), ...chosen.getPicks.map((p) => stripPick(p, chosen.partnerRosterId))],
    partnerTeamName: partnerTeam?.displayName || partnerTeam?.ownerName || 'the other team',
    ...(tradedPicks > 0 ? { picks: tradedPicks } : {}),
    value: grade.graded
      ? {
          given: grade.giveValue,
          received: grade.getValue,
          delta: grade.getValue - grade.giveValue,
          grade: grade.letter,
          coveragePct: 100,
          coverageStatus: 'complete' as const,
          label: grade.label,
          basis: grade.basis,
          withheld: null,
        }
      : {
          given: null,
          received: null,
          delta: null,
          grade: null,
          coveragePct: 0,
          coverageStatus: 'blocked' as const,
          label: null,
          basis: grade.basis,
          withheld: grade.reason,
        },
    lineup,
    lineupWeek: impact?.week ?? null,
    lineupUnavailable: lineup ? null : impact?.blockedReason ?? 'The starting lineup could not be priced for this league.',
    playoffOdds: { available: false, reason: PLAYOFF_ODDS_UNAVAILABLE },
  }
}

/** Why a trade that names picks cannot be evaluated, or null when every pick is usable. */
function refusePicks(
  world: CanonicalWorld,
  left: { picks: PickMention[]; unclear: boolean },
  right: { picks: PickMention[]; unclear: boolean },
): TradeScenario | null {
  if (!world.league.isDynasty) {
    return {
      status: 'unresolved',
      reason: 'includes_picks',
      detail:
        'This trade includes a draft pick. Picks are only compared in dynasty leagues, where they have a market price on the same scale as the players; in this league one would be a guess.',
    }
  }
  if (left.unclear || right.unclear) {
    return {
      status: 'unresolved',
      reason: 'pick_unclear',
      detail: 'A draft pick is mentioned but I could not tell which one — name each pick with its year and round, like "2027 1st".',
    }
  }
  const all = [...left.picks, ...right.picks]
  if (all.some((p) => p.season == null)) {
    return {
      status: 'unresolved',
      reason: 'pick_season_unclear',
      detail: 'A draft pick is named without its year, and picks from different drafts do not price the same — say which year, like "2027 1st".',
    }
  }
  const season = world.league.season
  if (season != null && all.some((p) => (p.season as number) < season)) {
    return {
      status: 'unresolved',
      reason: 'pick_season_past',
      detail: `A draft pick named is from a draft before the ${season} season, so it has already been used.`,
    }
  }
  return null
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
    case 'pick_partner_unclear':
      return 'Everything you would receive is a draft pick, so it is not clear whose picks they are — name at least one player from the other team.'
    default:
      return 'It is not clear which players you would give and which you would get — one side must be on your roster and the other on one other team.'
  }
}

const fmt = (n: number | null, digits = 1) => (n == null ? 'unknown' : n.toFixed(digits))
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`
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
    /*
     * THE grade — the letter the Trade Center and the offer cards give this same deal. Said so in the
     * line, so the model does not present it as a second opinion.
     */
    s.value.grade
      ? `- League value (${s.value.basis ?? "this league's chart"}): you send ${fmt(s.value.given, 0)}, you receive ${fmt(s.value.received, 0)}` +
        (s.value.delta != null ? ` (${signed(s.value.delta, 0)})` : '') +
        `; grade ${s.value.grade}${s.value.label ? ` — ${s.value.label}` : ''}. This is the same grade the Trade Center gives this trade.`
      : `- Grade: NOT GRADED — ${(s.value.withheld ?? "the trade could not be priced on this league's chart").replace(/\.$/, '')}. Do not grade it yourself.`,
    /*
     * The week and the rules are named in the line itself: this is ONE week under the league's own
     * scoring, and a model left to guess would call it a season rate.
     */
    s.lineup
      ? `- Starting lineup, week ${s.lineupWeek ?? '(unknown)'} projections scored under this league's own rules: ${fmt(s.lineup.before)} before, ${fmt(s.lineup.after)} after (${signed(s.lineup.delta)}). This is one week, not the rest of the season — say so.`
      : `- Starting lineup: not computed — ${s.lineupUnavailable}`,
    `- Playoff odds: not computed. ${s.playoffOdds.reason} Do not estimate them.`,
    ...(s.picks
      ? [
          "- Draft picks are valued as the giving team's own pick at that round's average dynasty market price (FantasyCalc) — the exact slot is not known. Say so, and do not quote a slot.",
        ]
      : []),
  ]
  return lines.join('\n')
}
