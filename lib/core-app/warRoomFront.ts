import type { OutlookLeague, SeasonOutlook, SwingMatchup } from './seasonOutlook'

/**
 * The Front — the War Room's strategist view of every team you run.
 *
 * "The War Room is supposed to be the strategist for the user": for a team that is winning, how to keep
 * winning; for one that is losing, how to turn it around or how to plan the next season (owner's brief,
 * 2026-11-11). This file decides, per league, WHICH of those situations the team is in (its posture)
 * and the few orders that follow from it. It decides nothing about the odds themselves.
 *
 * ── 🛑 NO SECOND MODEL ─────────────────────────────────────────────────
 *
 * Every probability here is Season Outlook's (`getSeasonOutlook`, the seeded simulation of the real
 * remaining schedule). This reads that board; it does not simulate, re-fit or adjust anything. And the
 * posture bands are Season Outlook's own: `onTheBubble` is `25 < playoffPct < 75` there
 * (seasonOutlook.ts summary), so "bubble" here is the same set of leagues that screen calls the bubble.
 * A War Room that called a team a contender while Season Outlook called it a bubble team would be two
 * screens answering one question differently.
 *
 * ── 🛑 YOUR TEAM ONLY — FACTS ABOUT RIVALS, NEVER LABELS ───────────────
 *
 * A posture describes the VIEWER's own team. It is never computed for another manager: Scout's contract
 * (scout.ts, the 2026-09-30 ruling) is that rivals get observable facts, not classifications, and
 * "Team X is a seller" is a classification. An order may NAME a rival only through a fact the outlook
 * already states — this week's opponent in the swing game.
 *
 * ── ⚠ HORIZON IS THE FORMAT, NOT THE RECORD ────────────────────────────
 *
 * Whether a losing season can be turned into next season depends on what carries over. Dynasty, devy,
 * keeper and salary-cap leagues keep players; a redraft league keeps nothing, so "rebuild" advice there
 * would be invented. The redraft long-shot card says so instead of pretending to a plan.
 *
 * Pure and client-safe: the page runs it on the server and hands the screen this small result rather
 * than the outlook board, which is large.
 */

/** Your team's situation in one league. Ordered by how much a decision there is worth, most first. */
export type WarPosture = 'bubble' | 'contender' | 'long_shot' | 'clinched' | 'eliminated' | 'unplaced'

/** Whether rosters carry into next season — decides what a losing team can do about it. */
export type WarHorizon = 'this_season' | 'carries_over'

export type WarOrder =
  /** The one game that moves your playoff odds most, from the outlook's own swing run. */
  | { kind: 'swing_game'; week: number; opponent: string | null; ifWin: number; ifLose: number; clinchOnWin: boolean; href: string }
  /** The outlook's own sentence for what decides it ("Get to 8 wins"). Translated by the screen. */
  | { kind: 'what_decides'; text: string; href: string }
  /** A bye is genuinely in play: your bye odds sit between the bands. */
  | { kind: 'chase_bye'; byePct: number; href: string }
  /** In the field already; what is left to play for is the title. */
  | { kind: 'title_odds'; titlePct: number; href: string }
  /** Season Outlook's per-league panel prices lineup and waiver moves in playoff odds. */
  | { kind: 'priced_moves'; href: string }
  /** The trade deadline is still ahead. `intent` follows the posture. */
  | { kind: 'trade_deadline'; week: number; weeksLeft: number; intent: 'buy' | 'consolidate' | 'sell'; href: string }
  /** A long-shot or finished keeper/dynasty team: what to do with veterans and picks. */
  | { kind: 'build_next_season'; deadlineOpen: boolean; href: string }
  /** A finished or near-finished redraft team: nothing carries over, said plainly. */
  | { kind: 'redraft_nothing_carries'; href: string }
  /**
   * We could not place this team. `why` says which gate stopped it; `reason` is the outlook's own words
   * when it withheld the league (a format it cannot simulate, no schedule on file…).
   */
  | { kind: 'unplaced'; why: 'withheld' | 'no_team' | 'too_few_weeks' | 'not_modelled'; reason: string | null; weeksFitted: number | null; href: string }

export type WarFrontCard = {
  leagueId: string
  leagueName: string
  posture: WarPosture
  horizon: WarHorizon
  /** Format key from the canonical resolver (resolveLeagueCardTypeKey), for the card's format chip. */
  format: string | null
  /** Null for an unplaced team. Percentages as Season Outlook prints them (0–100). */
  odds: { playoff: number; bye: number | null; title: number } | null
  record: { wins: number; losses: number; ties: number } | null
  seed: number | null
  teams: number | null
  weeksRemaining: number | null
  /** At most three, the most decisive first. */
  orders: WarOrder[]
  /** Scout for this league — the rivals, as facts. */
  scoutHref: string
}

export type WarFront = {
  /**
   * False when the outlook itself could not be read. Every card would then be `unplaced`, and 60
   * "could not place" cards would read as 60 findings about your teams rather than one failed read —
   * so the screen says the one thing instead.
   */
  available: boolean
  cards: WarFrontCard[]
  counts: Record<WarPosture, number>
}

/** Formats whose rosters carry into next season. Everything else plans one season at a time. */
const CARRIES_OVER = new Set(['dynasty', 'devy', 'keeper', 'salary_cap'])

/** Season Outlook's bubble band, exclusive at both ends (seasonOutlook.ts `onTheBubble`). */
const BUBBLE_LOW = 25
const BUBBLE_HIGH = 75

/** A bye is "in play" inside the same band — below it you are not getting one, above it you are. */
const BYE_IN_PLAY_LOW = 25
const BYE_IN_PLAY_HIGH = 75

const MAX_ORDERS = 3

const POSTURE_RANK: Record<WarPosture, number> = { bubble: 0, contender: 1, long_shot: 2, clinched: 3, eliminated: 4, unplaced: 5 }

export function horizonOf(format: string | null | undefined): WarHorizon {
  return format && CARRIES_OVER.has(format) ? 'carries_over' : 'this_season'
}

export function postureOf(league: Pick<OutlookLeague, 'you'> | null): WarPosture {
  const you = league?.you
  if (!you || !you.modelled) return 'unplaced'
  if (you.status === 'clinched') return 'clinched'
  if (you.status === 'eliminated') return 'eliminated'
  if (you.playoffPct >= BUBBLE_HIGH) return 'contender'
  if (you.playoffPct > BUBBLE_LOW) return 'bubble'
  return 'long_shot'
}

export type WarFrontLeagueInput = {
  id: string
  name: string
  /** `resolveLeagueCardTypeKey` result. */
  format: string | null
  /** `tradeDeadlineWeek(settings)` — null when trades never close or the league states nothing. */
  tradeDeadlineWeek: number | null
  /** The league row's own current week (the Trade Center's source), for when the outlook states none. */
  currentWeek?: number | null
}

const finiteWeek = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)

/** The current week: the outlook's model period first, then the league row's own. */
function currentWeek(league: OutlookLeague, input: WarFrontLeagueInput): number | null {
  return finiteWeek(league.period) ?? finiteWeek(input.currentWeek)
}

/** Weeks until the deadline, or null when it is past or cannot be placed against the current week. */
function deadlineAhead(deadline: number | null, week: number | null): number | null {
  if (deadline == null || week == null) return null
  return deadline >= week ? deadline - week : null
}

function ordersFor(args: {
  posture: WarPosture
  horizon: WarHorizon
  league: OutlookLeague
  input: WarFrontLeagueInput
  swing: SwingMatchup | null
  hrefs: { outlook: string; trades: string; draft: string }
}): WarOrder[] {
  const { posture, horizon, league, input, swing, hrefs } = args
  const deadline = input.tradeDeadlineWeek
  const you = league.you!
  const weeksToDeadline = deadlineAhead(deadline, currentWeek(league, input))
  const out: WarOrder[] = []
  const swingOrder = (): WarOrder | null =>
    swing && swing.week != null
      ? { kind: 'swing_game', week: swing.week, opponent: swing.opponentName, ifWin: swing.ifWin, ifLose: swing.ifLose, clinchOnWin: swing.clinchOnWin, href: hrefs.outlook }
      : null
  const deadlineOrder = (intent: 'buy' | 'consolidate' | 'sell'): WarOrder | null =>
    deadline != null && weeksToDeadline != null ? { kind: 'trade_deadline', week: deadline, weeksLeft: weeksToDeadline, intent, href: hrefs.trades } : null
  const push = (o: WarOrder | null) => {
    if (o) out.push(o)
  }

  switch (posture) {
    case 'bubble': {
      // Every week is a decision: the game that moves you most, what it takes, then what helps you get there.
      push(swingOrder())
      if (league.whatDecidesIt) push({ kind: 'what_decides', text: league.whatDecidesIt, href: hrefs.outlook })
      push(deadlineOrder('buy'))
      push({ kind: 'priced_moves', href: hrefs.outlook })
      break
    }
    case 'contender': {
      // In the field more often than not: protect it, chase the bye, and turn depth into starters while trades are open.
      if (league.byeTeams > 0 && you.byePct > BYE_IN_PLAY_LOW && you.byePct < BYE_IN_PLAY_HIGH) {
        push({ kind: 'chase_bye', byePct: you.byePct, href: hrefs.outlook })
      }
      push(swingOrder())
      push(deadlineOrder('consolidate'))
      push({ kind: 'priced_moves', href: hrefs.outlook })
      break
    }
    case 'clinched': {
      push({ kind: 'title_odds', titlePct: you.titlePct, href: hrefs.outlook })
      if (league.byeTeams > 0 && you.byePct > BYE_IN_PLAY_LOW && you.byePct < BYE_IN_PLAY_HIGH) {
        push({ kind: 'chase_bye', byePct: you.byePct, href: hrefs.outlook })
      }
      push(deadlineOrder('consolidate'))
      push({ kind: 'priced_moves', href: hrefs.outlook })
      break
    }
    case 'long_shot': {
      // Still alive by arithmetic. Say what a run takes; then the honest fork on the format.
      if (league.whatDecidesIt) push({ kind: 'what_decides', text: league.whatDecidesIt, href: hrefs.outlook })
      if (horizon === 'carries_over') {
        push({ kind: 'build_next_season', deadlineOpen: weeksToDeadline != null, href: hrefs.trades })
        push(deadlineOrder('sell'))
      } else {
        push(swingOrder())
        push({ kind: 'redraft_nothing_carries', href: hrefs.draft })
      }
      break
    }
    case 'eliminated': {
      if (horizon === 'carries_over') {
        push({ kind: 'build_next_season', deadlineOpen: weeksToDeadline != null, href: hrefs.trades })
        push(deadlineOrder('sell'))
      } else {
        push({ kind: 'redraft_nothing_carries', href: hrefs.draft })
      }
      break
    }
    case 'unplaced':
      break
  }
  return out.slice(0, MAX_ORDERS)
}

/**
 * Why a team could not be placed, most specific first. "Not modelled" with no further detail is the
 * honest fallback — the outlook ran but this league is not on its board and nothing says why.
 */
function unplacedOrder(args: {
  league: OutlookLeague | null
  you: OutlookLeague['you']
  withheldReason: string | null
  href: string
}): WarOrder {
  const { league, you, withheldReason, href } = args
  if (withheldReason) return { kind: 'unplaced', why: 'withheld', reason: withheldReason, weeksFitted: null, href }
  if (league && !you) return { kind: 'unplaced', why: 'no_team', reason: null, weeksFitted: null, href }
  if (you && !you.modelled) return { kind: 'unplaced', why: 'too_few_weeks', reason: null, weeksFitted: you.weeksFitted, href }
  return { kind: 'unplaced', why: 'not_modelled', reason: null, weeksFitted: null, href }
}

/** How urgent a card is inside its posture: the closer to a coin flip, the more a decision there is worth. */
function urgency(card: WarFrontCard): number {
  if (!card.odds) return 0
  return Math.abs(card.odds.playoff - 50)
}

/**
 * One card per league you play, in the order a strategist would look at them.
 *
 * ⚠ EVERY LEAGUE GETS A CARD. A league the outlook did not model — withheld for a format it cannot
 * simulate, too few weeks played, your team not identified — is an `unplaced` card carrying the
 * outlook's own reason, never a silent omission. The War Room's league count was already reported as
 * "less leagues than I am actually in" once (2026-11-11).
 */
export function buildWarFront(args: { leagues: WarFrontLeagueInput[]; outlook: SeasonOutlook | null }): WarFront {
  const byId = new Map((args.outlook?.leagues ?? []).map((l) => [l.leagueId, l]))
  const withheld = new Map((args.outlook?.withheld ?? []).map((w) => [w.leagueName, w.reason]))
  const cards: WarFrontCard[] = []

  for (const input of args.leagues) {
    const league = byId.get(input.id) ?? null
    const enc = encodeURIComponent(input.id)
    const hrefs = {
      outlook: league?.href ?? `/core/season-outlook?league=${enc}`,
      // The league's War Room view, at its trade ideas (WarTradeIdeas.tsx) — priced in odds, unlike the Trade Center.
      trades: `/core/war-room?league=${enc}#war-trades`,
      draft: `/core/draft-hq?league=${enc}`,
    }
    const posture = postureOf(league)
    const horizon = horizonOf(input.format)
    const you = league?.you ?? null
    const placed = posture !== 'unplaced' && league && you
    cards.push({
      leagueId: input.id,
      leagueName: league?.leagueName ?? input.name,
      posture,
      horizon,
      format: input.format,
      odds: placed ? { playoff: you.playoffPct, bye: league.byeTeams > 0 ? you.byePct : null, title: you.titlePct } : null,
      record: placed ? { wins: you.wins, losses: you.losses, ties: you.ties ?? 0 } : null,
      seed: placed ? you.seed : null,
      teams: league ? league.teams.length : null,
      weeksRemaining: league ? league.weeksRemaining : null,
      orders: placed
        ? ordersFor({ posture, horizon, league, input, swing: args.outlook?.swingByLeague[input.id] ?? null, hrefs })
        : [unplacedOrder({ league, you, withheldReason: withheld.get(league?.leagueName ?? input.name) ?? null, href: hrefs.outlook })],
      scoutHref: `/core/war-room?league=${enc}`,
    })
  }

  cards.sort(
    (a, b) =>
      POSTURE_RANK[a.posture] - POSTURE_RANK[b.posture] ||
      // Bubble and contender: nearest a coin flip first. Others keep name order.
      (a.posture === 'bubble' || a.posture === 'contender' ? urgency(a) - urgency(b) : 0) ||
      a.leagueName.localeCompare(b.leagueName, undefined, { sensitivity: 'base', numeric: true }),
  )

  const counts: Record<WarPosture, number> = { bubble: 0, contender: 0, long_shot: 0, clinched: 0, eliminated: 0, unplaced: 0 }
  for (const c of cards) counts[c.posture] += 1
  return { available: args.outlook != null, cards, counts }
}
