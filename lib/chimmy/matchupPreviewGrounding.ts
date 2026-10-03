import 'server-only'

import { prisma } from '@/lib/prisma'
import { getWeekBoard, type WeekBoard, type WeekMatchup, type EliminationWeek } from '@/lib/core-app/weekBoard'
import { COIN_FLIP_POINTS } from '@/lib/core-app/weekBoardRules'
import { listMemberLeagues } from './tools/leagueByName'
import { settleSentence, type EliminationSettle } from '@/lib/core-app/eliminationSettle'
import { loadEliminationSettle } from '@/lib/core-app/eliminationSettleLoader'
import { getRailMatchups, type RailSideProjection } from '@/lib/core-app/railMatchups'

/**
 * "How does my matchup look this week?" — from the same Week board the /core matchup screens render.
 *
 * `getWeekBoard` already fits each team's weekly scoring from its completed weeks and turns two fits
 * into a win probability, labels thin samples as FORM rather than a projection, reads the all-time
 * rivalry and handles guillotine weeks with a cut line instead of an invented opponent. None of it was
 * reachable from Chimmy. This wraps it; it computes nothing of its own, so the chat cannot disagree
 * with the screen beside it.
 *
 * ⚠ THE PROJECTION IS TEAM-LEVEL. It is each side's fitted weekly average, not this week's player
 * projections — the block says so, and points the model at `optimize_my_lineup` for player-level
 * numbers on the caller's own side.
 *
 * 🛑 LEAGUES COME ONLY FROM THE CONTEXT OR `listMemberLeagues`. Never from the model.
 */

const MAX_CROSS_LEAGUES = 30

export interface MatchupPreviewDeps {
  loadLeagues: (ids: string[]) => Promise<Parameters<typeof getWeekBoard>[1]>
  listLeagueIds: (userId: string) => Promise<string[]>
  getBoard: typeof getWeekBoard
  /**
   * Whether an elimination week is already DECIDED for the user, from whose games have finished
   * (`eliminationSettle.ts`). Optional: without it the line is the score and margin alone, as before.
   */
  loadSettle?: (e: EliminationWeek) => Promise<EliminationSettle | null>
  /**
   * THIS week's LINEUP projections per league — the player projections summed over each side's set
   * lineup: AllFantasy's own engine (AF) and the provider's (API), both under the league's rules. The
   * same totals the league rail draws (`getRailMatchups`). Optional: without it the block is the
   * team-level week model alone, exactly as before.
   */
  loadLineupProjections?: (
    userId: string,
    leagues: Parameters<typeof getWeekBoard>[1],
  ) => Promise<ReadonlyMap<string, LineupProjectionPair>>
}

/** One league's lineup projections, with the week they describe. */
export type LineupProjectionPair = {
  season: number
  week: number
  /** True in an elimination week, where there is no opponent side. */
  unpaired: boolean
  you: RailSideProjection | null
  them: RailSideProjection | null
  /** The week the projection feed actually served; a fallback week is never presented as this one. */
  projectionWeek: { season: string; week: number } | null
}

/** How many elimination leagues get a settle read in the all-leagues view. Four queries each. */
const MAX_SETTLE_READS = 10

const defaultDeps: MatchupPreviewDeps = {
  loadLeagues: async (ids) => {
    const rows = await prisma.league.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, platform: true, platformLeagueId: true, leagueType: true },
    })
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      platform: String(l.platform ?? ''),
      platformLeagueId: l.platformLeagueId ?? null,
      leagueType: l.leagueType ?? null,
    }))
  },
  listLeagueIds: async (userId) => {
    const leagues = await listMemberLeagues(userId)
    const latest = leagues.reduce((max, l) => Math.max(max, Number(l.season) || 0), 0)
    return leagues.filter((l) => Number(l.season) === latest).map((l) => l.id)
  },
  getBoard: getWeekBoard,
  /*
   * `getWeekBoard` already reads the verdict for the board (`EliminationWeek.settle`), so the chat
   * repeats the screen's answer and does not query twice. Only a week it did not read (over its
   * cap) is read here.
   */
  loadSettle: (e) =>
    e.settle !== undefined
      ? Promise.resolve(e.settle)
      : e.yourScore == null
        ? Promise.resolve(null)
        : loadEliminationSettle({ platformLeagueId: e.platformLeagueId, season: e.season, week: e.week, yourRosterId: e.yourRosterId }),
  loadLineupProjections: async (userId, leagues) => {
    const rail = await getRailMatchups(
      userId,
      leagues.map((l) => ({
        id: l.id,
        platformLeagueId: l.platformLeagueId ?? null,
        elimination: /guillotine|survivor/i.test(String(l.leagueType ?? '')),
      })),
    )
    return new Map(
      Object.values(rail.byLeague).map((m) => [
        m.leagueId,
        {
          season: m.season,
          week: m.week,
          unpaired: m.unpaired,
          you: m.yourProjection,
          them: m.opponentProjection,
          projectionWeek: rail.projectionWeek,
        },
      ]),
    )
  },
}

/**
 * One side's total for one source, with its coverage when partial — or null when that source priced
 * nobody on the side. AF is the engine's total; API is the provider's line under the league's rules.
 */
function sideTotal(p: RailSideProjection | null | undefined, kind: 'af' | 'api'): string | null {
  if (!p) return null
  const value = kind === 'af' ? p.afEngine ?? null : p.afProjected
  if (value == null) return null
  const from = kind === 'af' ? p.afEngineFrom ?? 0 : p.pricedFrom
  return from < p.starterCount ? `${value.toFixed(1)} (from ${from} of ${p.starterCount} starters)` : value.toFixed(1)
}

/**
 * "This week's lineup projections" for one matchup, or '' when there is nothing honest to add.
 *
 * ⚠ ONLY FOR THE SAME WEEK. The rail's feed can fall back to another week when this one is not
 * published; a total for the wrong week beside this week's matchup would read as this week's.
 */
function lineupSentence(season: number, week: number, pair: LineupProjectionPair | undefined, elimination: boolean): string {
  if (!pair || pair.season !== season || pair.week !== week) return ''
  if (!pair.projectionWeek || Number(pair.projectionWeek.season) !== season || pair.projectionWeek.week !== week) return ''
  const afYou = sideTotal(pair.you, 'af')
  const apiYou = sideTotal(pair.you, 'api')
  if (!afYou && !apiYou) return ''
  if (elimination || pair.unpaired) {
    const parts = [
      afYou ? `AF (AllFantasy's own engine) ${afYou}` : null,
      apiYou ? `Sleeper (Sleeper's own projection) ${apiYou}` : null,
    ].filter(Boolean)
    return ` This week's lineup projection for their team (player projections summed over the lineup as set, under this league's rules): ${parts.join('; ')}.`
  }
  const afThem = sideTotal(pair.them, 'af')
  const apiThem = sideTotal(pair.them, 'api')
  const parts = [
    afYou || afThem ? `AF (AllFantasy's own engine) them ${afYou ?? 'not available'} vs opponent ${afThem ?? 'not available'}` : null,
    apiYou || apiThem ? `Sleeper (Sleeper's own projection) them ${apiYou ?? 'not available'} vs opponent ${apiThem ?? 'not available'}` : null,
  ].filter(Boolean)
  return (
    ` This week's LINEUP projections (player projections summed over the lineups as set, under this league's rules — a different measure from the team averages above): ${parts.join('; ')}.` +
    ' Quote both sources, each labelled; do not average them or turn them into a win probability.'
  )
}

const pts = (n: number) => n.toFixed(1)
const pct = (p: number) => `${Math.round(p * 100)}%`

function matchupLine(m: WeekMatchup, pair?: LineupProjectionPair): string {
  return matchupLineBase(m) + lineupSentence(m.season, m.week, pair, false)
}

function matchupLineBase(m: WeekMatchup): string {
  const vs = m.opponent.name ?? 'an unnamed opponent'
  if (m.projection) {
    const p = m.projection
    const lean =
      Math.abs(p.margin) <= COIN_FLIP_POINTS
        ? 'a coin flip'
        : p.margin > 0
          ? `favoured by ${pts(p.margin)}`
          : `underdog by ${pts(-p.margin)}`
    return (
      `${m.leagueName}, week ${m.week} vs ${vs}: ${lean} — win probability ${pct(p.winProbability)} ` +
      `(their team averages ${pts(p.you)} a week, the opponent ${pts(p.them)}; fitted from ${m.yourSampleWeeks} completed week(s)).`
    )
  }
  if (m.form) {
    const f = m.form
    return (
      `${m.leagueName}, week ${m.week} vs ${vs}: too few weeks to project. FORM only (not a forecast, no win probability): ` +
      `they have averaged ${pts(f.you)}, the opponent ${pts(f.them)}, over ${f.weeks} week(s).`
    )
  }
  return `${m.leagueName}, week ${m.week} vs ${vs}: neither side has a scored week yet, so nothing is projected. Say so.`
}

function eliminationLine(e: EliminationWeek, settle?: EliminationSettle | null, pair?: LineupProjectionPair): string {
  if (e.yourScore == null) {
    return (
      `${e.leagueName} (elimination format), week ${e.week}: they have not scored yet this week; the lowest score is eliminated.` +
      lineupSentence(e.season, e.week, pair, true)
    )
  }
  return (
    `${e.leagueName} (elimination format), week ${e.week}: ${pts(e.yourScore)} points, ranked ${e.rank ?? '?'} of ${e.fieldSize}, ` +
    (e.onTheBlock
      ? '🚨 CURRENTLY THE LOWEST SCORE — on the chopping block.'
      : `${e.margin != null ? pts(e.margin) : '?'} points clear of the cut line (${e.cutLine != null ? pts(e.cutLine) : '?'}).`) +
    /*
     * 🛑 WITHOUT THIS, A DECIDED WEEK READ AS A CLOSE ONE. On 2026-09-28 every starter of the user
     * and of the team in last had finished, and the answer still said "you'd need a collapse".
     */
    (settle ? ` ${settleSentence(settle)}` : '')
  )
}

async function settleFor(e: EliminationWeek, deps: MatchupPreviewDeps): Promise<EliminationSettle | null> {
  if (!deps.loadSettle) return null
  return deps.loadSettle(e).catch(() => null)
}

function leagueBlock(
  board: WeekBoard,
  leagueId: string,
  settle: EliminationSettle | null = null,
  lineups: ReadonlyMap<string, LineupProjectionPair> | null = null,
): string | null {
  const lb = board.leagueBoard
  const elimination = board.eliminationWeeks.find((e) => e.leagueId === leagueId)
  if (elimination) {
    return ['THIS WEEK (computed by AllFantasy from real scores — repeat, do not estimate):', `- ${eliminationLine(elimination, settle, lineups?.get(leagueId))}`].join('\n')
  }
  if (!lb || lb.leagueId !== leagueId) return null

  const lines: string[] = [
    `THIS WEEK in ${lb.leagueName} (week ${lb.week}), from AllFantasy's week model — team-level averages, not player projections. Repeat these numbers:`,
  ]
  if (!lb.yours) {
    lines.push('- They have no game this week (a bye, or their team is not matched). Say so.')
  } else {
    lines.push(`- ${matchupLine(lb.yours, lineups?.get(lb.yours.leagueId))}`)
    const recYou = lb.yourRosterId ? lb.records[lb.yourRosterId] : undefined
    const recThem = lb.records[lb.yours.opponent.rosterId]
    if (recYou || recThem) {
      lines.push(
        `- Records: them ${recYou ? `${recYou.wins}-${recYou.losses}` : 'no games yet'}, opponent ${recThem ? `${recThem.wins}-${recThem.losses}` : 'no games yet'}.`,
      )
    }
    if (lb.rivalry) {
      const r = lb.rivalry
      lines.push(
        `- All-time vs this opponent: ${r.wins}-${r.losses} in ${r.meetings} meeting(s), average margin ${r.averageMargin >= 0 ? '+' : ''}${pts(r.averageMargin)}.`,
      )
    } else {
      lines.push('- They have never played this opponent before (first meeting on file).')
    }
  }
  const sidelines = lb.sidelines.filter((s) => s.aWinProbability != null).slice(0, 8)
  if (sidelines.length) {
    lines.push(
      `- Other games in the league: ${sidelines
        .map((s) => `${s.a.name ?? 'team'} vs ${s.b.name ?? 'team'} (${s.a.name ?? 'first'} ${pct(s.aWinProbability as number)})`)
        .join('; ')}.`,
    )
  }
  lines.push(`- Model: ${board.model.basis}`)
  lines.push('- For player-level numbers on their own side (who to start, projected lineup total), call optimize_my_lineup.')
  return lines.join('\n')
}

function crossLeagueBlock(
  board: WeekBoard,
  settles: ReadonlyMap<string, EliminationSettle | null> = new Map(),
  lineups: ReadonlyMap<string, LineupProjectionPair> | null = null,
): string {
  const line = (m: WeekMatchup) => matchupLine(m, lineups?.get(m.leagueId))
  const all = [...board.coinFlips, ...board.leaning, ...board.unprojected]
  const lines: string[] = [
    `THIS WEEK ACROSS THEIR LEAGUES (week ${board.week ?? '?'}), from AllFantasy's week model — repeat these numbers:`,
  ]
  if (board.coinFlips.length) {
    lines.push(`- Coin flips (within ${COIN_FLIP_POINTS} pts) — where a lineup call matters most:`)
    for (const m of board.coinFlips) lines.push(`  • ${line(m)}`)
  }
  const favoured = board.leaning.filter((m) => (m.projection?.margin ?? 0) > 0)
  const underdog = board.leaning.filter((m) => (m.projection?.margin ?? 0) < 0)
  if (favoured.length) {
    lines.push('- Favoured:')
    for (const m of favoured) lines.push(`  • ${line(m)}`)
  }
  if (underdog.length) {
    lines.push('- Underdog:')
    for (const m of underdog) lines.push(`  • ${line(m)}`)
  }
  if (board.unprojected.length) {
    lines.push('- Not projected yet:')
    for (const m of board.unprojected) lines.push(`  • ${line(m)}`)
  }
  for (const e of board.eliminationWeeks) lines.push(`- ${eliminationLine(e, settles.get(e.leagueId), lineups?.get(e.leagueId))}`)
  if (all.length === 0 && board.eliminationWeeks.length === 0) {
    lines.push('- No matchups are scheduled for them this week in any synced league. Say so.')
  }
  if (board.withoutSchedule > 0) lines.push(`- ${board.withoutSchedule} league(s) carry no schedule for this week.`)
  lines.push(`- Model: ${board.model.basis}`)
  return lines.join('\n')
}

/** One single-league read's settle verdict, handed to the chat as DATA (the answer's SAFE / OUT chip). */
export type MatchupSettleRun = { leagueId: string; settle: EliminationSettle | null }

export async function buildMatchupPreviewContext(
  args: {
    leagueId: string | null
    userId: string
    /**
     * Called once per SINGLE-league read with the settle verdict the block was written from — null for
     * a league with no elimination week or no settle read, so a later read can clear an earlier one.
     * Never called for the all-leagues view: one chip cannot speak for several leagues.
     */
    onSettle?: (run: MatchupSettleRun) => void
  },
  deps: MatchupPreviewDeps = defaultDeps,
): Promise<string> {
  try {
    const ids = args.leagueId ? [args.leagueId] : (await deps.listLeagueIds(args.userId)).slice(0, MAX_CROSS_LEAGUES)
    if (ids.length === 0) return 'This user has no current-season leagues on file, so there is no matchup to read. Say so.'
    const leagues = await deps.loadLeagues(ids)
    if (leagues.length === 0) return 'The league could not be read, so no matchup is available. Say so; do not describe one.'

    const board = await deps.getBoard(args.userId, leagues, args.leagueId)
    if (board.week == null) {
      return 'No completed or scheduled weeks are on file for their league(s) yet, so there is no matchup to preview. Say so; do not invent an opponent.'
    }
    /* This week's lineup projections (AF and API). A failed read costs those lines only. */
    const lineups = deps.loadLineupProjections
      ? await deps.loadLineupProjections(args.userId, leagues).catch(() => null)
      : null
    if (args.leagueId) {
      const elimination = board.eliminationWeeks.find((e) => e.leagueId === args.leagueId)
      const settle = elimination ? await settleFor(elimination, deps) : null
      /* The SAME object the sentence below is written from — the chip and the prose are one read. */
      try {
        args.onSettle?.({ leagueId: args.leagueId, settle })
      } catch {
        /* A collector that throws must not cost the user the matchup. */
      }
      return (
        leagueBlock(board, args.leagueId, settle, lineups) ??
        'This league has no matchup on file for the current week (not synced, or the season has not started). Say so; do not invent an opponent.'
      )
    }
    const settled = await Promise.all(
      board.eliminationWeeks.slice(0, MAX_SETTLE_READS).map(async (e) => [e.leagueId, await settleFor(e, deps)] as const),
    )
    return crossLeagueBlock(board, new Map(settled), lineups)
  } catch {
    return 'The matchup preview failed to load. Say that you could not read it rather than answering as though you had.'
  }
}
