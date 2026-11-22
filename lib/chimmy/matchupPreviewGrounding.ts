import 'server-only'

import { prisma } from '@/lib/prisma'
import { getWeekBoard, type WeekBoard, type WeekMatchup, type EliminationWeek } from '@/lib/core-app/weekBoard'
import { COIN_FLIP_POINTS } from '@/lib/core-app/weekBoardRules'
import { listMemberLeagues } from './tools/leagueByName'
import { settleSentence, type EliminationSettle } from '@/lib/core-app/eliminationSettle'
import { loadEliminationSettle } from '@/lib/core-app/eliminationSettleLoader'
import { getRailMatchups, type RailSideProjection } from '@/lib/core-app/railMatchups'
import { rosterLabel } from '@/lib/core-app/managerName'
import { nativeWeeklyLeague } from '@/lib/core-app/weeklyCapabilities'

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
  /**
   * The user's game in the week AFTER a finished board week. The board stays on a final week until
   * the platform advances its marker (Sleeper: Wednesday), so without this the chat could only point
   * at other tools for who is next. Optional: without it the block says the next week is not on file.
   */
  loadNextGame?: (args: NextGameQuery) => Promise<NextGame | null>
  /**
   * The same, for the all-leagues view: one batched read for every league whose board week is final,
   * keyed by AllFantasy league id. The cross-league board carries no roster id of the user's, so the
   * reader resolves it from their claimed team — exactly how the board decides which side is theirs.
   */
  loadNextGames?: (userId: string, items: NextGamesItem[]) => Promise<ReadonlyMap<string, NextGame>>
}

export type NextGamesItem = Omit<NextGameQuery, 'yourRosterId'>

export type NextGameQuery = {
  league: Parameters<typeof getWeekBoard>[1][number]
  season: number
  week: number
  yourRosterId: string
}
export type NextGame = { week: number; opponentRosterId: string; opponentName: string }

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

/**
 * The stored schedule for the very next week: the user's row, paired on `matchupId` — the same
 * pairing the board and the season simulator use. Exactly two rows or nothing: an unpaired week
 * (a bye, a playoff week they are not in, a schedule not synced yet) is not an opponent.
 * AllFantasy-hosted leagues keep their schedule elsewhere and are skipped.
 */
export async function loadNextGameFromSchedule({ league, season, week, yourRosterId }: NextGameQuery): Promise<NextGame | null> {
  if (!league.platformLeagueId || nativeWeeklyLeague(league)) return null
  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId: league.platformLeagueId, seasonYear: season, week: week + 1, matchupId: { not: null } },
    select: { rosterId: true, matchupId: true },
  })
  const opponent = pairedOpponent(rows, yourRosterId)
  if (!opponent) return null
  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId: league.id, externalId: opponent.rosterId },
    select: { teamName: true, ownerName: true },
  })
  return { week: week + 1, opponentRosterId: opponent.rosterId, opponentName: rosterLabel([team?.teamName, team?.ownerName], opponent.rosterId) }
}

/** The one row sharing the user's `matchupId` — or nothing unless the pairing is exactly two rows. */
function pairedOpponent<R extends { rosterId: string; matchupId: number | null }>(rows: readonly R[], yourRosterId: string): R | undefined {
  const mine = rows.find((r) => r.rosterId === yourRosterId)
  const pair = mine ? rows.filter((r) => r.matchupId === mine.matchupId) : []
  return pair.length === 2 ? pair.find((r) => r.rosterId !== yourRosterId) : undefined
}

/**
 * `loadNextGameFromSchedule` for many leagues at once: three reads in all, whatever the league count.
 * A league with no claimed team, two claimed teams, or no clean pairing is simply absent.
 */
export async function loadNextGamesFromSchedule(userId: string, items: readonly NextGamesItem[]): Promise<Map<string, NextGame>> {
  const out = new Map<string, NextGame>()
  const wanted = items.filter((i) => i.league.platformLeagueId && !nativeWeeklyLeague(i.league))
  if (wanted.length === 0) return out
  const claimed = await prisma.leagueTeam.findMany({
    where: { leagueId: { in: wanted.map((i) => i.league.id) }, claimedByUserId: userId },
    select: { leagueId: true, externalId: true },
  })
  const mineByLeague = new Map<string, string | null>()
  for (const t of claimed) {
    if (!t.externalId) continue
    // Two claimed teams in one league is ambiguous, not a choice to make here.
    mineByLeague.set(t.leagueId, mineByLeague.has(t.leagueId) ? null : t.externalId)
  }
  const ready = wanted.filter((i) => mineByLeague.get(i.league.id))
  if (ready.length === 0) return out
  const rows = await prisma.weeklyMatchup.findMany({
    where: { matchupId: { not: null }, OR: ready.map((i) => ({ leagueId: i.league.platformLeagueId!, seasonYear: i.season, week: i.week + 1 })) },
    select: { leagueId: true, seasonYear: true, week: true, rosterId: true, matchupId: true },
  })
  const found: Array<{ item: NextGamesItem; opponentRosterId: string }> = []
  for (const item of ready) {
    const weekRows = rows.filter((r) => r.leagueId === item.league.platformLeagueId && r.seasonYear === item.season && r.week === item.week + 1)
    const opponent = pairedOpponent(weekRows, mineByLeague.get(item.league.id)!)
    if (opponent) found.push({ item, opponentRosterId: opponent.rosterId })
  }
  if (found.length === 0) return out
  const teams = await prisma.leagueTeam.findMany({
    where: { OR: found.map((f) => ({ leagueId: f.item.league.id, externalId: f.opponentRosterId })) },
    select: { leagueId: true, externalId: true, teamName: true, ownerName: true },
  })
  for (const { item, opponentRosterId } of found) {
    const team = teams.find((t) => t.leagueId === item.league.id && t.externalId === opponentRosterId)
    out.set(item.league.id, { week: item.week + 1, opponentRosterId, opponentName: rosterLabel([team?.teamName, team?.ownerName], opponentRosterId) })
  }
  return out
}

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
  loadNextGame: (q) => loadNextGameFromSchedule(q),
  loadNextGames: (userId, items) => loadNextGamesFromSchedule(userId, items),
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
  // Full-week lineup totals beside a scoreboard read as points still to come.
  return matchupLineBase(m) + (m.live ? '' : lineupSentence(m.season, m.week, pair, false))
}

/**
 * 🛑 ONCE POINTS EXIST, THE SCOREBOARD — NEVER THE PRE-GAME PROBABILITY. `WeekMatchup.live` says the
 * surfaces stop showing it, and this tool kept printing it. Production 2026-10-06, HailShiva: week 4
 * was already WON 135.5–129.9 and Chimmy said "underdog by 28.4, 29% win probability", while the
 * optimizer and the season simulator had moved on to week 5 — so it told the user it could not tell
 * which week was live. A FINAL week here means the board has not advanced yet, not that it is next.
 */
function scoreboardLine(m: WeekMatchup, live: NonNullable<WeekMatchup['live']>, vs: string): string {
  const score = `${pts(live.you)}–${pts(live.them)}`
  if (live.final) {
    const result = live.margin > 0 ? `they WON ${score}` : live.margin < 0 ? `they LOST ${score}` : `a TIE, ${score}`
    return (
      `${m.leagueName}, week ${m.week} vs ${vs}: FINAL — ${result}. This game is decided: give no win probability or projection for it ` +
      'and do not present it as upcoming. The board has not moved to the next week yet; optimize_my_lineup and get_playoff_outlook ' +
      'look ahead to it, so a later week from those tools is their next game, not a conflict.'
    )
  }
  const state = live.margin > 0 ? `ahead by ${pts(live.margin)}` : live.margin < 0 ? `behind by ${pts(-live.margin)}` : 'level'
  return (
    `${m.leagueName}, week ${m.week} vs ${vs}: IN PROGRESS (not final) — they have ${pts(live.you)}, the opponent ${pts(live.them)}, ${state}. ` +
    'The pre-game win probability no longer applies and is not given; describe the scoreboard.'
  )
}

function matchupLineBase(m: WeekMatchup): string {
  const vs = m.opponent.name ?? 'an unnamed opponent'
  if (m.live) return scoreboardLine(m, m.live, vs)
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
  next: NextGame | null = null,
): string | null {
  const lb = board.leagueBoard
  const elimination = board.eliminationWeeks.find((e) => e.leagueId === leagueId)
  if (elimination) {
    return ['THIS WEEK (computed by AllFantasy from real scores — repeat, do not estimate):', `- ${eliminationLine(elimination, settle, lineups?.get(leagueId))}`].join('\n')
  }
  if (!lb || lb.leagueId !== leagueId) return null

  const live = lb.yours?.live
  const lines: string[] = [
    live
      ? `WEEK ${lb.week} in ${lb.leagueName} (${live.final ? 'FINAL' : 'in progress'}), from the scoreboard on file. Repeat these numbers:`
      : `THIS WEEK in ${lb.leagueName} (week ${lb.week}), from AllFantasy's week model — team-level averages, not player projections. Repeat these numbers:`,
  ]
  // An odd-team league's extra matchup (lib/redraft/oddTeamExtraMatchupRules.ts): the leftover team's
  // game this week, or a second one for the chosen team. Real, recorded, and to be repeated as is.
  const extra = lb.extraMatchup ?? null
  if (!lb.yours && extra) {
    lines.push(`- ${extra.line}. This is their game this week, in place of a bye; repeat the team and the scores as given.`)
  } else if (!lb.yours) {
    lines.push('- They have no game this week (a bye, or their team is not matched). Say so.')
  } else {
    if (extra) lines.push(`- Also this week: ${extra.line}.`)
    lines.push(`- ${matchupLine(lb.yours, lineups?.get(lb.yours.leagueId))}`)
    if (lb.yours.live?.final) {
      const rec = next ? lb.records[next.opponentRosterId] : undefined
      lines.push(
        next
          ? `- Their NEXT game: week ${next.week} vs ${next.opponentName}${rec ? ` (${rec.wins}-${rec.losses})` : ''}, from the stored schedule. ` +
              'The board has not advanced to it yet, so it has no win probability here: for its odds call get_playoff_outlook, for the lineup optimize_my_lineup.'
          : `- Week ${lb.week + 1}'s opponent is not on file yet (not synced, a bye, or past the regular season). Do not name one.`,
      )
    }
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
        `- All-time vs this opponent: ${r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties} (W-L-T)` : `${r.wins}-${r.losses}`} in ${r.meetings} meeting(s), average margin ${r.averageMargin >= 0 ? '+' : ''}${pts(r.averageMargin)}.`,
      )
    } else {
      lines.push('- They have never played this opponent before (first meeting on file).')
    }
  }
  // Pre-game odds for the rest of a finished week describe games already played.
  const sidelines = live?.final ? [] : lb.sidelines.filter((s) => s.aWinProbability != null).slice(0, 8)
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
  nexts: ReadonlyMap<string, NextGame> | null = null,
): string {
  const line = (m: WeekMatchup) => matchupLine(m, lineups?.get(m.leagueId)) + (m.live?.final ? nextSentence(m, nexts?.get(m.leagueId)) : '')
  const all = [...board.coinFlips, ...board.leaning, ...board.unprojected]
  // The board buckets on the pre-game projection; a game with points goes under the scoreboard instead.
  const unscored = (list: WeekMatchup[]) => list.filter((m) => !m.live)
  const scored = all.filter((m) => m.live)
  const coinFlips = unscored(board.coinFlips)
  const lines: string[] = [
    `THIS WEEK ACROSS THEIR LEAGUES (week ${board.week ?? '?'}), from AllFantasy's week model — repeat these numbers:`,
  ]
  if (scored.length) {
    lines.push('- Already scoring (the scoreboard, not a forecast):')
    for (const m of scored) lines.push(`  • ${line(m)}`)
  }
  if (coinFlips.length) {
    lines.push(`- Coin flips (within ${COIN_FLIP_POINTS} pts) — where a lineup call matters most:`)
    for (const m of coinFlips) lines.push(`  • ${line(m)}`)
  }
  const favoured = unscored(board.leaning).filter((m) => (m.projection?.margin ?? 0) > 0)
  const underdog = unscored(board.leaning).filter((m) => (m.projection?.margin ?? 0) < 0)
  if (favoured.length) {
    lines.push('- Favoured:')
    for (const m of favoured) lines.push(`  • ${line(m)}`)
  }
  if (underdog.length) {
    lines.push('- Underdog:')
    for (const m of underdog) lines.push(`  • ${line(m)}`)
  }
  const unprojected = unscored(board.unprojected)
  if (unprojected.length) {
    lines.push('- Not projected yet:')
    for (const m of unprojected) lines.push(`  • ${line(m)}`)
  }
  for (const e of board.eliminationWeeks) lines.push(`- ${eliminationLine(e, settles.get(e.leagueId), lineups?.get(e.leagueId))}`)
  if (all.length === 0 && board.eliminationWeeks.length === 0) {
    lines.push('- No matchups are scheduled for them this week in any synced league. Say so.')
  }
  if (board.withoutSchedule > 0) lines.push(`- ${board.withoutSchedule} league(s) carry no schedule for this week.`)
  lines.push(`- Model: ${board.model.basis}`)
  return lines.join('\n')
}

/** The next-game clause after a FINAL line in the all-leagues view. Never a guessed opponent. */
function nextSentence(m: WeekMatchup, next: NextGame | undefined): string {
  return next && next.week === m.week + 1
    ? ` NEXT: week ${next.week} vs ${next.opponentName} (from the stored schedule; no win probability for it here).`
    : ` Week ${m.week + 1}'s opponent is not on file yet; do not name one.`
}

/** Every league whose board week is FINAL, in one batched read. A failed read names nobody. */
async function nextGamesFor(
  userId: string,
  board: WeekBoard,
  leagues: Parameters<typeof getWeekBoard>[1],
  deps: MatchupPreviewDeps,
): Promise<ReadonlyMap<string, NextGame> | null> {
  if (!deps.loadNextGames) return null
  const items = [...board.coinFlips, ...board.leaning, ...board.unprojected].flatMap((m) => {
    const league = m.live?.final ? leagues.find((l) => l.id === m.leagueId) : undefined
    return league ? [{ league, season: m.season, week: m.week }] : []
  })
  if (items.length === 0) return null
  return deps.loadNextGames(userId, items).catch(() => null)
}

/** Only for a FINISHED board week — the one case where the board's own game is no longer next. */
async function nextGameFor(
  board: WeekBoard,
  leagues: Parameters<typeof getWeekBoard>[1],
  deps: MatchupPreviewDeps,
): Promise<NextGame | null> {
  const lb = board.leagueBoard
  const league = lb ? leagues.find((l) => l.id === lb.leagueId) : undefined
  if (!deps.loadNextGame || !lb?.yours?.live?.final || !lb.yourRosterId || !league) return null
  return deps.loadNextGame({ league, season: lb.season, week: lb.week, yourRosterId: lb.yourRosterId }).catch(() => null)
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
      const next = await nextGameFor(board, leagues, deps)
      return (
        leagueBlock(board, args.leagueId, settle, lineups, next) ??
        'This league has no matchup on file for the current week (not synced, or the season has not started). Say so; do not invent an opponent.'
      )
    }
    const settled = await Promise.all(
      board.eliminationWeeks.slice(0, MAX_SETTLE_READS).map(async (e) => [e.leagueId, await settleFor(e, deps)] as const),
    )
    const nexts = await nextGamesFor(args.userId, board, leagues, deps)
    return crossLeagueBlock(board, new Map(settled), lineups, nexts)
  } catch {
    return 'The matchup preview failed to load. Say that you could not read it rather than answering as though you had.'
  }
}
