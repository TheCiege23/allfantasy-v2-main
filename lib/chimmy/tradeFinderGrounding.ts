import 'server-only'

import { leagueContextFor } from '@/lib/core-app/leagueContext'
import { leagueDisplayName } from '@/lib/core-app/leagueHome'
import {
  callerTradeSeat,
  marketContextFor,
  readLeagueTradeRows,
  readTradePlayerRows,
  rosterSlotsOf,
  teamForTradeRoster,
  toDiscoveryPlayers,
  toDiscoveryRoster,
  tradeRosterPlayerIds,
} from '@/lib/core-app/playerTradeVisual'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { TradeFinderGoal } from './tradeFinderAsk'
import { readTradeBlock } from '@/lib/trade-block/importedTradeBlock'
import {
  fairnessFor,
  findPackages,
  findPartners,
  needsSurplus,
  type DiscoveryPlayer,
  type DiscoveryRoster,
  type FairnessBand,
  type PartnerMatch,
  type TradePackage,
} from '@/lib/trade-discovery/redraftTradeDiscovery'
import { tradeBanReason } from '@/lib/league-rules/tradeLegality'
import {
  getMarketValues,
  pickValue,
  playerValue,
  playerValueForLeague,
  type MarketValuesPayload,
} from '@/lib/trade-intel/marketValueService'
import type { TeamStance } from '@/lib/trade-value/types'

/**
 * "Find me a trade" — trade IDEAS across the asker's whole league, for the Chimmy tool loop.
 *
 * Chimmy could grade a trade the user typed (`evaluate_trade`) and answer "should I trade for X?",
 * but it could not look at the other eleven rosters and say who to call. This composes what already
 * ships and adds no numbers of its own:
 *
 *   - every roster and its priced players, read EXACTLY as the /core player card and "should I trade
 *     for X?" read them (`playerTradeVisual`'s exported helpers — one reading of "which roster is
 *     yours" and "what is he worth in this league", not a third);
 *   - who fits whom: `findPartners`, which scores complementary needs and surpluses, team direction
 *     and trade-block listings;
 *   - concrete packages: `findPackages`, which builds give/get offers from your depth and bands their
 *     fairness on those values.
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE. Every roster in the league is read.
 *
 * ⚠ IDEAS, NOT VERDICTS. A package is a starting offer from market value and roster shape. Grading
 * one — lineup before and after under the league's scoring — is `evaluate_trade`'s job, and the
 * block tells the model to offer that rather than to call an idea a win.
 */

/** Ideas returned, one per partner. More than three is a list nobody reads in a chat reply. */
export const MAX_TRADE_IDEAS = 3
/** Partners priced in full when the ask names no position: the best matches, not the whole league. */
const PARTNERS_TO_PRICE = 5
/** Players at the asked-for position priced per partner, highest value first. */
const TARGETS_PER_PARTNER = 3
/** A league the size anyone plays; bounds the one name read. */
const MAX_LEAGUE_PLAYER_IDS = 1200

const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export type TradeFinderPosition = (typeof CORE_POSITIONS)[number]

const POSITION_WORDS: Record<string, TradeFinderPosition> = {
  QB: 'QB',
  QUARTERBACK: 'QB',
  RB: 'RB',
  'RUNNING BACK': 'RB',
  RUNNINGBACK: 'RB',
  WR: 'WR',
  'WIDE RECEIVER': 'WR',
  RECEIVER: 'WR',
  TE: 'TE',
  'TIGHT END': 'TE',
}

/** QB/RB/WR/TE from whatever the model sent, or null — never a guess. */
export function readTradeFinderPosition(raw: unknown): TradeFinderPosition | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toUpperCase().replace(/S$/, '')
  return POSITION_WORDS[key] ?? null
}

/** `position` is `PICK` for a draft pick, named the way `evaluate_trade` reads one ("2027 1st"). */
export type TradeIdeaAsset = { name: string; position: string; value: number | null; onTradeBlock: boolean }


export type TradeIdea = {
  partnerTeam: string
  partnerManager: string | null
  partnerStance: TeamStance
  give: TradeIdeaAsset[]
  get: TradeIdeaAsset[]
  giveTotal: number
  getTotal: number
  fairness: FairnessBand
  /** No missing value, not lopsided: an offer a manager could send as-is. */
  sendable: boolean
  fillsNeed: boolean
  why: string[]
  /** Win-now searches only: each side on the league's redraft (current-season) chart. */
  nowGive?: number | null
  nowGet?: number | null
}

export type TradeFinderResult =
  | {
      status: 'ready'
      leagueName: string
      valuesMode: MarketValuesPayload['mode']
      you: { teamName: string; stance: TeamStance; stanceSettled: boolean; needs: string[]; surpluses: string[] }
      asked: { position: TradeFinderPosition | null; tradeAway: string | null; goal: TradeFinderGoal | null; picks: boolean }
      /** Said beside the ideas whenever picks were asked for: whether they could be used, and the assumption made. */
      pickNote: string | null
      ideas: TradeIdea[]
      /** When `ideas` is empty: why, in a sentence the model can repeat. */
      noIdeasReason: string | null
    }
  | { status: 'unavailable'; reason: string }

export type TradeFinderInput = {
  leagueId: string
  userId: string
  position?: TradeFinderPosition | null
  /** A player the user wants to move, by name, as they said it. */
  tradeAway?: string | null
  goal?: TradeFinderGoal | null
  /** The user offered their own draft picks as part of the package. */
  includePicks?: boolean
}

const BAND_RANK: Record<FairnessBand, number> = {
  balanced: 0,
  'slight edge you': 1,
  'slight edge partner': 2,
  'low confidence': 3,
  lopsided: 4,
}

const OPEN_ROSTER = /^(open-slot|orphan)-/

/** The one player on YOUR roster a name means, or why not. Exact name first, then a unique partial. */
function resolveOwnPlayer(
  players: DiscoveryPlayer[],
  name: string,
): { player: DiscoveryPlayer } | { reason: string } {
  const wanted = normalizePlayerName(name)
  if (!wanted) return { reason: 'no player name was given' }
  const exact = players.filter((p) => normalizePlayerName(p.playerName) === wanted)
  if (exact.length === 1) return { player: exact[0]! }
  const partial = players.filter((p) => normalizePlayerName(p.playerName).includes(wanted))
  if (partial.length === 1) return { player: partial[0]! }
  if (exact.length > 1 || partial.length > 1) {
    const names = [...exact, ...partial].map((p) => p.playerName)
    return { reason: `"${name}" matches more than one player on your roster (${[...new Set(names)].join(', ')})` }
  }
  return { reason: `"${name}" is not on your roster in this league` }
}

function toIdea(
  pkg: TradePackage,
  partner: DiscoveryRoster,
  match: PartnerMatch | undefined,
  myNeeds: string[],
): TradeIdea {
  const block = new Set(partner.blockPlayerIds ?? [])
  const asset = (a: TradePackage['giveAssets'][number]): TradeIdeaAsset => ({
    name: a.playerName ?? 'Unknown player',
    position: a.position ?? '?',
    value: a.value,
    onTradeBlock: Boolean(a.playerId && block.has(a.playerId)),
  })
  const get = pkg.receiveAssets.filter((a) => a.kind === 'player').map(asset)
  const why = [...(match?.matchReasons ?? [])].filter((r) => !/exploratory/i.test(r))
  if (get.some((g) => g.onTradeBlock) && !why.some((r) => /trade block/i.test(r))) {
    why.push('They have him on the trade block')
  }
  return {
    partnerTeam: partner.teamName,
    partnerManager: partner.managerDisplayName ?? null,
    partnerStance: partner.stance,
    give: pkg.giveAssets.filter((a) => a.kind === 'player').map(asset),
    get,
    giveTotal: pkg.myTotalValue,
    getTotal: pkg.partnerTotalValue,
    fairness: pkg.fairnessBand,
    sendable: pkg.canStartProposal,
    fillsNeed: get.some((g) => myNeeds.includes(g.position)),
    why,
  }
}

function rankIdeas(ideas: Array<{ idea: TradeIdea; matchScore: number }>): TradeIdea[] {
  const sorted = [...ideas].sort(
    (a, b) =>
      BAND_RANK[a.idea.fairness] - BAND_RANK[b.idea.fairness] ||
      Number(b.idea.sendable) - Number(a.idea.sendable) ||
      Number(b.idea.fillsNeed) - Number(a.idea.fillsNeed) ||
      b.matchScore - a.matchScore ||
      b.idea.getTotal - a.idea.getTotal,
  )
  /* One idea per partner: three offers to the same manager is one idea written three ways. */
  const seen = new Set<string>()
  const out: TradeIdea[] = []
  for (const { idea } of sorted) {
    if (seen.has(idea.partnerTeam)) continue
    seen.add(idea.partnerTeam)
    out.push(idea)
    if (out.length >= MAX_TRADE_IDEAS) break
  }
  return out
}

const ORDINAL = ['', '1st', '2nd', '3rd'] as const
/** Seasons and rounds a "lesser player plus a pick" package reaches for. Later picks move nothing. */
const PICK_SEASONS = 2
const PICK_ROUNDS = [1, 2, 3] as const
/** Their players priced per partner in a pick / win-now search, best first. */
const NOW_TARGETS_PER_PARTNER = 5

type OwnPick = { name: string; value: number }

/**
 * The user's next two seasons of 1st–3rd round picks, priced at the dynasty chart's round average.
 *
 * ⚠ OWNERSHIP IS ASSUMED, AND THE ANSWER SAYS SO. No reader here knows which picks a team has traded
 * away — `evaluate_trade` makes the same assumption about "my 2027 1st" — so every pick package carries
 * the caveat rather than a silent guess. Named the way `evaluate_trade` parses a pick, so a package can
 * be graded exactly as written.
 */
function ownPicks(values: MarketValuesPayload, currentSeason: number): OwnPick[] {
  const seasons = [...new Set(Object.keys(values.pickByRound).map((k) => Number(k.split(':')[0])))]
    .filter((s) => Number.isInteger(s) && s > currentSeason)
    .sort((a, b) => a - b)
    .slice(0, PICK_SEASONS)
  return seasons.flatMap((season) =>
    PICK_ROUNDS.flatMap((round) => {
      const value = pickValue(values, String(season), round)
      return value == null ? [] : [{ name: `${season} ${ORDINAL[round]}`, value }]
    }),
  )
}

type ScoredIdea = { idea: TradeIdea; matchScore: number; nowGain: number; usesPick: boolean; gap: number }

/**
 * Packages the general finder cannot build: a player plus one of YOUR picks for one of theirs, and —
 * for a win-now ask — only packages that raise your current-season value.
 *
 * Priced on the league's own chart (`value`), so the fairness band means what it means everywhere
 * else in the finder. The win-now test is a SECOND chart (`nowOf`, redraft values): a package that is
 * fair in dynasty value but hands you a lesser player THIS season is exactly the "giving up scoring
 * players for potential players" a contender does not want, and it is dropped rather than ranked low.
 */
function pickAndNowIdeas(args: {
  me: DiscoveryRoster
  others: DiscoveryRoster[]
  matchOf: Map<string, PartnerMatch>
  myNeeds: string[]
  mySurpluses: string[]
  position: TradeFinderPosition | null
  outgoing: DiscoveryPlayer | null
  nowOf: ((playerId: string) => number | null) | null
  picks: OwnPick[]
}): TradeIdea[] {
  const { nowOf, picks } = args
  const now = (p: DiscoveryPlayer) => (nowOf ? nowOf(p.playerId) : null)
  const gives = args.outgoing
    ? [args.outgoing]
    : args.me.players.filter(
        (p) => !p.isLocked && p.value != null && (nowOf ? now(p) != null : args.mySurpluses.includes(p.position)),
      )
  const best: ScoredIdea[] = []
  for (const partner of args.others) {
    const block = new Set(partner.blockPlayerIds ?? [])
    const match = args.matchOf.get(partner.rosterId)
    const targets = partner.players
      .filter(
        (p) =>
          !p.isLocked &&
          p.value != null &&
          (args.position ? p.position === args.position : nowOf || !args.myNeeds.length || args.myNeeds.includes(p.position)) &&
          (!nowOf || now(p) != null),
      )
      .sort((a, b) => (nowOf ? (now(b) ?? 0) - (now(a) ?? 0) : (b.value ?? 0) - (a.value ?? 0)))
      .slice(0, NOW_TARGETS_PER_PARTNER)
    let top: ScoredIdea | null = null
    for (const target of targets) {
      for (const give of gives) {
        const nowGain = nowOf ? (now(target) ?? 0) - (now(give) ?? 0) : 0
        if (nowOf && nowGain <= 0) continue
        for (const pick of [null, ...picks]) {
          const giveTotal = (give.value ?? 0) + (pick?.value ?? 0)
          const getTotal = target.value ?? 0
          const fairness = fairnessFor(getTotal - giveTotal, Math.max(giveTotal, getTotal, 1), false)
          if (fairness === 'lopsided') continue
          const why = [...(match?.matchReasons ?? [])].filter((r) => !/exploratory/i.test(r))
          if (block.has(target.playerId)) why.push('They have him on the trade block')
          if (nowOf) why.push(`Raises your current-season value by ${Math.round(nowGain).toLocaleString('en-US')}`)
          const scored: ScoredIdea = {
            matchScore: match?.matchScore ?? 0,
            nowGain,
            usesPick: pick != null,
            gap: Math.abs(getTotal - giveTotal),
            idea: {
              partnerTeam: partner.teamName,
              partnerManager: partner.managerDisplayName ?? null,
              partnerStance: partner.stance,
              give: [
                { name: give.playerName, position: give.position, value: give.value, onTradeBlock: false },
                ...(pick ? [{ name: pick.name, position: 'PICK', value: pick.value, onTradeBlock: false }] : []),
              ],
              get: [{ name: target.playerName, position: target.position, value: target.value, onTradeBlock: block.has(target.playerId) }],
              giveTotal: Math.round(giveTotal),
              getTotal: Math.round(getTotal),
              fairness,
              sendable: true,
              fillsNeed: args.myNeeds.includes(target.position),
              why,
              ...(nowOf ? { nowGive: now(give), nowGet: now(target) } : {}),
            },
          }
          if (!top || compareScored(scored, top, picks.length > 0) < 0) top = scored
        }
      }
    }
    if (top) best.push(top)
  }
  return best
    .sort((a, b) => compareScored(a, b, picks.length > 0))
    .slice(0, MAX_TRADE_IDEAS)
    .map((s) => s.idea)
}

/** Fairer first; then, when picks were offered, a package that uses one; then the bigger win-now gain. */
function compareScored(a: ScoredIdea, b: ScoredIdea, preferPicks: boolean): number {
  return (
    BAND_RANK[a.idea.fairness] - BAND_RANK[b.idea.fairness] ||
    (preferPicks ? Number(b.usesPick) - Number(a.usesPick) : 0) ||
    b.nowGain - a.nowGain ||
    Number(b.idea.fillsNeed) - Number(a.idea.fillsNeed) ||
    b.matchScore - a.matchScore ||
    a.gap - b.gap
  )
}

export async function buildTradeFinder(input: TradeFinderInput): Promise<TradeFinderResult> {
  const league = await leagueContextFor(input.leagueId, input.userId)
    .league()
    .catch(() => null)
  if (!league) return { status: 'unavailable', reason: 'the league could not be read' }

  /*
   * ⚠ NFL ONLY, AND SAID. Market values exist for NFL players alone; anywhere else every player
   * prices as null and every package bands "low confidence" — a list of ideas that are all guesses.
   */
  const sport = String(league.sport ?? 'NFL').toUpperCase()
  if (sport !== 'NFL') {
    return {
      status: 'unavailable',
      reason: `trade ideas cover NFL leagues for now — AllFantasy holds market values for NFL players only, so a ${sport} package cannot be priced`,
    }
  }

  const rows = await readLeagueTradeRows(input.leagueId)
  const { yours, myRoster } = callerTradeSeat(rows, input.userId)
  if (!myRoster) return { status: 'unavailable', reason: 'you need a claimed team in this league to trade from' }

  const leagueSize = rows.rosters.length || 12
  const marketContext = marketContextFor(league.settings, league.leagueType, leagueSize)

  /*
   * 🛑 A NO-TRADE LEAGUE GETS NO IDEAS — the same check, from the same source, as the player card:
   * the concept catalog. Survivor and guillotine leagues trade; only formats like Survivor All-Stars
   * Guillotine and tournaments forbid it.
   */
  if (tradeBanReason({ leagueType: league.leagueType, isDynasty: marketContext.variant.dynasty, settings: league.settings })) {
    return { status: 'unavailable', reason: 'this league does not allow trades' }
  }

  const values = await getMarketValues(marketContext).catch(() => null)
  if (!values) {
    return { status: 'unavailable', reason: 'no market values are loaded for this league’s format yet, so no package can be priced' }
  }

  const tradable = rows.rosters.filter((r) => r.platformUserId && !OPEN_ROSTER.test(r.platformUserId))
  const ids = [...new Set(tradable.flatMap(tradeRosterPlayerIds))].slice(0, MAX_LEAGUE_PLAYER_IDS)
  const byId = await readTradePlayerRows(ids, sport)
  const leagueScoring = marketContext.scoring.settings
  const shape = { leagueSize, rosterSlots: rosterSlotsOf(league.settings) }

  /* A trade-block listing makes a partner likelier to deal; an unreadable block just means no boost. */
  const block = await readTradeBlock(input.leagueId).catch(() => null)
  const listed = new Set((block?.listings ?? []).map((l) => l.sleeperId))

  const side = (roster: (typeof tradable)[number], fallbackName: string): DiscoveryRoster => {
    const r = toDiscoveryRoster(
      teamForTradeRoster(rows.teams, roster),
      roster.platformUserId,
      toDiscoveryPlayers(roster, byId, values, leagueScoring),
      fallbackName,
      shape,
    )
    return { ...r, blockPlayerIds: r.players.filter((p) => listed.has(p.playerId)).map((p) => p.playerId) }
  }

  const me = side(myRoster, 'Your team')
  const others = tradable
    .filter((r) => r.platformUserId !== myRoster.platformUserId)
    .map((r) => side(r, 'Another manager'))
    .filter((r) => r.players.length > 0)

  const matches = findPartners({ myRoster: me, otherRosters: others, sport: 'NFL', hasNativeBlock: listed.size > 0 })
  const matchOf = new Map(matches.map((m) => [m.rosterId, m]))
  /* The same count `findPartners` and `findPackages` use, so "thin at" and the offers agree. */
  const { needs: myNeeds, surpluses: mySurpluses } = needsSurplus(me.players)

  const position = input.position ?? null
  let outgoing: DiscoveryPlayer | null = null
  if (input.tradeAway) {
    const found = resolveOwnPlayer(me.players, input.tradeAway)
    if ('reason' in found) return { status: 'unavailable', reason: found.reason }
    outgoing = found.player
  }

  /*
   * 🛑 "WIN NOW USING MY DRAFT PICKS" USED TO GET PLAYER-FOR-PLAYER SWAPS PRICED ON THE DYNASTY CHART
   * (owner's Versuz league, 2026-10-31): Javonte Williams for Bucky Irving, Sam LaPorta for Bo Nix —
   * "balanced" in dynasty value, and every one a step DOWN this season, with no pick in any of them.
   * The general finder below takes neither a goal nor a pick, so both are handled here instead.
   */
  const goal = input.goal ?? null
  let picks: OwnPick[] = []
  let pickNote: string | null = null
  if (input.includePicks) {
    if (values.mode !== 'dynasty') {
      pickNote = 'draft picks have no market price on this league’s chart, so these packages are players only'
    } else {
      const currentSeason = Number(league.season) || new Date().getUTCFullYear()
      picks = ownPicks(values, currentSeason)
      pickNote = picks.length
        ? `pick values are round averages (exact draft slots unknown), and each package assumes you still own that pick yourself — check before sending`
        : 'no future draft pick prices are loaded for this league’s format, so these packages are players only'
    }
  }
  let nowOf: ((playerId: string) => number | null) | null = null
  if (goal === 'win_now') {
    // A redraft league's chart already IS the current-season chart.
    const nowValues =
      values.mode === 'redraft'
        ? values
        : await getMarketValues({ ...marketContext, variant: { ...marketContext.variant, dynasty: false, keeper: false } }).catch(() => null)
    if (!nowValues || nowValues.mode !== 'redraft') {
      return {
        status: 'unavailable',
        reason: 'no current-season values are loaded for this league’s format, so a win-now package cannot be told apart from a future one',
      }
    }
    nowOf = (id) => playerValueForLeague(nowValues, id, leagueScoring)?.adjusted ?? playerValue(nowValues, id)
  }
  const asked = { position, tradeAway: outgoing?.playerName ?? null, goal, picks: Boolean(input.includePicks) }
  const you = {
    teamName: yours?.teamName ?? me.teamName,
    stance: me.stance,
    stanceSettled: me.stanceSettled ?? true,
    needs: myNeeds,
    surpluses: mySurpluses,
  }

  if (nowOf || picks.length) {
    const ideas = pickAndNowIdeas({ me, others, matchOf, myNeeds, mySurpluses, position, outgoing, nowOf, picks })
    return {
      status: 'ready',
      leagueName: leagueDisplayName(league.name),
      valuesMode: values.mode,
      you,
      asked,
      pickNote,
      ideas,
      noIdeasReason: ideas.length
        ? null
        : nowOf
          ? `no team has a ${position ?? 'player'} who would raise your current-season value in a package inside the fairness band${picks.length ? ', even with one of your picks added' : ''}`
          : 'no team has a player at a position you need that one of your depth players plus a pick reaches inside the fairness band',
    }
  }

  const candidates: Array<{ idea: TradeIdea; matchScore: number }> = []
  const add = (partner: DiscoveryRoster, pkgs: TradePackage[]) => {
    const match = matchOf.get(partner.rosterId)
    for (const pkg of pkgs) {
      if (!pkg.receiveAssets.some((a) => a.kind === 'player') || !pkg.giveAssets.some((a) => a.kind === 'player')) continue
      candidates.push({ idea: toIdea(pkg, partner, match, myNeeds), matchScore: match?.matchScore ?? 0 })
    }
  }
  const base = { myRoster: me, sport: 'NFL', faabSupported: false, draftPickTrading: false } as const

  if (position) {
    /*
     * A position ask prices THEIR players at that position one by one — the same call the player card
     * makes for a named target — because the general search only offers what fills a need or comes
     * from their depth, and "find me a running back" is a need the user just told us about. Every
     * package is built around one named target, so every idea brings back a player at that position.
     */
    for (const partner of others) {
      const targets = partner.players
        .filter((p) => p.position === position && p.value != null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .slice(0, TARGETS_PER_PARTNER)
      for (const target of targets) {
        add(
          partner,
          findPackages({ ...base, partnerRoster: partner, targetPlayerId: target.playerId, outgoingPlayerId: outgoing?.playerId ?? null, max: 1 }),
        )
      }
    }
  } else {
    /* Shopping one player: every team is a possible buyer. Otherwise: the best-matched few. */
    const partners = outgoing
      ? others
      : matches
          .slice(0, PARTNERS_TO_PRICE)
          .map((m) => others.find((o) => o.rosterId === m.rosterId))
          .filter((o): o is DiscoveryRoster => Boolean(o))
    for (const partner of partners) {
      add(partner, findPackages({ ...base, partnerRoster: partner, outgoingPlayerId: outgoing?.playerId ?? null, max: 2 }))
    }
  }

  const ideas = rankIdeas(candidates)
  let noIdeasReason: string | null = null
  if (!ideas.length) {
    if (!outgoing && !mySurpluses.length) {
      noIdeasReason =
        'you have no depth beyond your starters at QB, RB, WR or TE, so any trade would weaken your lineup — ' +
        'name a player you are willing to move and I can search for that'
    } else if (position) {
      noIdeasReason = `no ${position} in this league came back in a package your roster can afford from its depth`
    } else if (outgoing) {
      noIdeasReason = `no team in this league has a need that ${outgoing.playerName} fills and something you need in return`
    } else {
      noIdeasReason = 'no team in this league has both a need your depth fills and depth where you are thin'
    }
  }

  return {
    status: 'ready',
    leagueName: leagueDisplayName(league.name),
    valuesMode: values.mode,
    you,
    asked,
    pickNote,
    ideas,
    noIdeasReason,
  }
}

const STANCE_WORDS: Record<TeamStance, string> = {
  contender: 'contending',
  rebuilder: 'rebuilding',
  middle: 'in the middle of the pack',
}

const fmt = (n: number | null) => (n == null ? 'no value' : Math.round(n).toLocaleString('en-US'))
const listAssets = (assets: TradeIdeaAsset[]) =>
  assets.map((a) => `${a.name} (${a.position}, ${fmt(a.value)})${a.onTradeBlock ? ' — on their trade block' : ''}`).join(' + ')

const FAIRNESS_WORDS: Record<FairnessBand, string> = {
  balanced: 'balanced',
  'slight edge you': 'a slight edge to you',
  'slight edge partner': 'a slight edge to them — easier to get accepted',
  lopsided: 'lopsided — would need a sweetener',
  'low confidence': 'unpriced for at least one player, so treat the balance as unknown',
}

/** The tool result: prose the model repeats from, with every number it may use written out. */
export function renderTradeFinderBlock(result: TradeFinderResult): string {
  if (result.status === 'unavailable') {
    return `TRADE IDEAS: none — ${result.reason}. Say that in one sentence. Do not suggest trades from general knowledge.`
  }
  const lines: string[] = []
  lines.push(`TRADE IDEAS — ${result.leagueName}`)
  lines.push(
    `Built from every roster in this league and AllFantasy market values for its format (${result.valuesMode}; values on a 0–10,000 scale). ` +
      'These are opening offers from roster shape and value, not verdicts.',
  )
  const you = result.you
  const stance = you.stanceSettled ? STANCE_WORDS[you.stance] : 'too early in the season to call contending or rebuilding'
  lines.push(
    `Your team (${you.teamName}): ${stance}. ` +
      `Thin at: ${you.needs.length ? you.needs.join(', ') : 'nothing'}. ` +
      `Depth to deal from: ${you.surpluses.length ? you.surpluses.join(', ') : 'none'}.`,
  )
  if (result.asked.position) lines.push(`Asked for: a ${result.asked.position}.`)
  if (result.asked.tradeAway) lines.push(`Shopping: ${result.asked.tradeAway}.`)
  if (result.asked.goal === 'win_now') {
    lines.push(
      'Asked for: WIN NOW. Every package below raises the current-season value of what the user holds, read off the ' +
        'league’s redraft chart; packages that trade a better player this season for a younger one were dropped.',
    )
  }
  if (result.asked.picks) lines.push(`Draft picks: offered by the user — ${result.pickNote ?? 'see each package'}.`)

  if (!result.ideas.length) {
    lines.push(`No trade ideas: ${result.noIdeasReason ?? 'nothing fit both sides'}. Say so plainly; do not invent a trade.`)
    return lines.join('\n')
  }

  result.ideas.forEach((idea, i) => {
    lines.push('')
    lines.push(
      `${i + 1}. With ${idea.partnerTeam}${idea.partnerManager ? ` (${idea.partnerManager})` : ''}, a team ${STANCE_WORDS[idea.partnerStance]}`,
    )
    lines.push(`   You give: ${listAssets(idea.give)}`)
    lines.push(`   You get: ${listAssets(idea.get)}`)
    lines.push(`   Value: you give ${fmt(idea.giveTotal)}, you get ${fmt(idea.getTotal)} — ${FAIRNESS_WORDS[idea.fairness]}`)
    if (idea.nowGive !== undefined) {
      lines.push(`   This season (redraft chart): you give ${fmt(idea.nowGive ?? null)}, you get ${fmt(idea.nowGet ?? null)}`)
    }
    if (idea.why.length) lines.push(`   Why it works for both: ${idea.why.join('; ')}`)
  })
  lines.push('')
  lines.push(
    'Rules: present these ideas with the names and numbers above and no others. Lead with the first. ' +
      'Do not call any of them a win or a lock — offer to grade one with evaluate_trade, which shows the ' +
      'lineup before and after under this league\'s scoring. A pick is written as evaluate_trade reads it ("2027 1st"); ' +
      'to try a different pick (a 2nd or 3rd instead of a 1st), grade that version with evaluate_trade rather than guessing its value.',
  )
  return lines.join('\n')
}

export async function buildTradeFinderContext(input: TradeFinderInput): Promise<string> {
  return renderTradeFinderBlock(await buildTradeFinder(input))
}
