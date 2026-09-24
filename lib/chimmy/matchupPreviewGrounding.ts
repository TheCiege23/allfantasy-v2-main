import 'server-only'

import { prisma } from '@/lib/prisma'
import { getWeekBoard, type WeekBoard, type WeekMatchup, type EliminationWeek } from '@/lib/core-app/weekBoard'
import { COIN_FLIP_POINTS } from '@/lib/core-app/weekBoardRules'
import { listMemberLeagues } from './tools/leagueByName'

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
}

const pts = (n: number) => n.toFixed(1)
const pct = (p: number) => `${Math.round(p * 100)}%`

function matchupLine(m: WeekMatchup): string {
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

function eliminationLine(e: EliminationWeek): string {
  if (e.yourScore == null) {
    return `${e.leagueName} (elimination format), week ${e.week}: they have not scored yet this week; the lowest score is eliminated.`
  }
  return (
    `${e.leagueName} (elimination format), week ${e.week}: ${pts(e.yourScore)} points, ranked ${e.rank ?? '?'} of ${e.fieldSize}, ` +
    (e.onTheBlock
      ? '🚨 CURRENTLY THE LOWEST SCORE — on the chopping block.'
      : `${e.margin != null ? pts(e.margin) : '?'} points clear of the cut line (${e.cutLine != null ? pts(e.cutLine) : '?'}).`)
  )
}

function leagueBlock(board: WeekBoard, leagueId: string): string | null {
  const lb = board.leagueBoard
  const elimination = board.eliminationWeeks.find((e) => e.leagueId === leagueId)
  if (elimination) {
    return ['THIS WEEK (computed by AllFantasy from real scores — repeat, do not estimate):', `- ${eliminationLine(elimination)}`].join('\n')
  }
  if (!lb || lb.leagueId !== leagueId) return null

  const lines: string[] = [
    `THIS WEEK in ${lb.leagueName} (week ${lb.week}), from AllFantasy's week model — team-level averages, not player projections. Repeat these numbers:`,
  ]
  if (!lb.yours) {
    lines.push('- They have no game this week (a bye, or their team is not matched). Say so.')
  } else {
    lines.push(`- ${matchupLine(lb.yours)}`)
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

function crossLeagueBlock(board: WeekBoard): string {
  const all = [...board.coinFlips, ...board.leaning, ...board.unprojected]
  const lines: string[] = [
    `THIS WEEK ACROSS THEIR LEAGUES (week ${board.week ?? '?'}), from AllFantasy's week model — repeat these numbers:`,
  ]
  if (board.coinFlips.length) {
    lines.push(`- Coin flips (within ${COIN_FLIP_POINTS} pts) — where a lineup call matters most:`)
    for (const m of board.coinFlips) lines.push(`  • ${matchupLine(m)}`)
  }
  const favoured = board.leaning.filter((m) => (m.projection?.margin ?? 0) > 0)
  const underdog = board.leaning.filter((m) => (m.projection?.margin ?? 0) < 0)
  if (favoured.length) {
    lines.push('- Favoured:')
    for (const m of favoured) lines.push(`  • ${matchupLine(m)}`)
  }
  if (underdog.length) {
    lines.push('- Underdog:')
    for (const m of underdog) lines.push(`  • ${matchupLine(m)}`)
  }
  if (board.unprojected.length) {
    lines.push('- Not projected yet:')
    for (const m of board.unprojected) lines.push(`  • ${matchupLine(m)}`)
  }
  for (const e of board.eliminationWeeks) lines.push(`- ${eliminationLine(e)}`)
  if (all.length === 0 && board.eliminationWeeks.length === 0) {
    lines.push('- No matchups are scheduled for them this week in any synced league. Say so.')
  }
  if (board.withoutSchedule > 0) lines.push(`- ${board.withoutSchedule} league(s) carry no schedule for this week.`)
  lines.push(`- Model: ${board.model.basis}`)
  return lines.join('\n')
}

export async function buildMatchupPreviewContext(
  args: { leagueId: string | null; userId: string },
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
    if (args.leagueId) {
      return (
        leagueBlock(board, args.leagueId) ??
        'This league has no matchup on file for the current week (not synced, or the season has not started). Say so; do not invent an opponent.'
      )
    }
    return crossLeagueBlock(board)
  } catch {
    return 'The matchup preview failed to load. Say that you could not read it rather than answering as though you had.'
  }
}
