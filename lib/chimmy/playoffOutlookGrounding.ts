import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  getSeasonOutlook,
  type LeagueInput,
  type OddsRange,
  type OutlookLeague,
  type OutlookTeam,
  type SeasonOutlook,
  type SwingMatchup,
} from '@/lib/core-app/seasonOutlook'
import { listMemberLeagues } from './tools/leagueByName'

/**
 * "Am I making the playoffs?" — answered by the Season Outlook simulator, not by a model's guess.
 *
 * ── 🛑 THE ENGINE EXISTED; CHIMMY TOLD USERS IT DID NOT ──────────────────────────────────────────
 * `lib/core-app/seasonOutlook.ts` plays every league's REAL remaining schedule out 10,000 times from
 * each team's fitted weekly scoring, with the league's own playoff field and byes, and stores the run.
 * It powers the /core Season Outlook screen. Meanwhile every Chimmy scenario card printed "Playoff
 * odds are not computed", and the tool loop had no way to reach the simulator at all — so the one
 * question a subscriber most wants answered in November was the one Chimmy could only shrug at.
 *
 * This wraps `getSeasonOutlook` for Chimmy. It does not fit, simulate or cache anything itself: a
 * second model would disagree with the screen the user can open beside the chat.
 *
 * ── TWO SHAPES ──────────────────────────────────────────────────────────────────────────────────
 *   - A league in scope: that league in full, with the focus block (drivers, moves that raise your
 *     odds, roster durability) and the swing game ("win and you are at X%, lose and you are at Y%").
 *   - No league in scope: every current league of the caller's, one line each, plus the priorities
 *     and the week that matters most. This is the "how am I doing everywhere" question.
 *
 * 🛑 THE LEAGUE ID MUST BE THE MEMBERSHIP-PROVEN ONE (`ctx.leagueId`). The cross-league shape reads
 * leagues only through `listMemberLeagues`, never from anything the model supplied.
 *
 * ⚠ BOUNDED IN TIME. The simulator runs inside the request when no stored run matches, so the call
 * races a timer and says so in words when it loses — never a half answer.
 *
 * ⚠ THE ONE WRITE ON THIS PATH IS THE SIMULATOR'S OWN CACHE. `getSeasonOutlook` stores a fresh run
 * in `sportsDataCache` under the league's sim key (`writeLeagueSims`), exactly as the Season Outlook
 * screen does on a page view — a derived, expiring result keyed on its own inputs, which the next
 * reader reuses. It touches no league, roster or user row, and the model cannot shape what is written.
 */

/** Well inside the tool loop's whole-turn budget; a stored run returns in well under a second. */
const OUTLOOK_TIMEOUT_MS = 30_000

/** Cross-league: enough for a heavy player, bounded so one question cannot simulate sixty leagues. */
const MAX_CROSS_LEAGUES = 20

/** Rows of the league table shown. Enough to see the bubble in any league size anyone plays. */
const TABLE_ROWS = 14

export interface PlayoffOutlookDeps {
  loadLeagues: (ids: string[]) => Promise<LeagueInput[]>
  listLeagueIds: (userId: string) => Promise<string[]>
  getOutlook: (userId: string, leagues: LeagueInput[], focusLeagueId: string | null) => Promise<SeasonOutlook>
  timeoutMs: number
}

const defaultDeps: PlayoffOutlookDeps = {
  loadLeagues: async (ids) => {
    const rows = await prisma.league.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true, sport: true, season: true },
    })
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      platform: String(l.platform ?? ''),
      platformLeagueId: l.platformLeagueId ?? null,
      settings: l.settings ?? null,
      sport: l.sport ? String(l.sport) : null,
    }))
  },
  /*
   * The CURRENT season's leagues only: a finished season has no remaining schedule to simulate, and
   * a league imported once per season would otherwise appear twice.
   */
  listLeagueIds: async (userId) => {
    const leagues = await listMemberLeagues(userId)
    const latest = leagues.reduce((max, l) => Math.max(max, Number(l.season) || 0), 0)
    return leagues.filter((l) => Number(l.season) === latest).map((l) => l.id)
  },
  getOutlook: (userId, leagues, focusLeagueId) => getSeasonOutlook(userId, leagues, focusLeagueId),
  timeoutMs: OUTLOOK_TIMEOUT_MS,
}

const TIMED_OUT = Symbol('timed-out')

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const pct = (n: number) => `${n < 1 && n > 0 ? '<1' : n > 99 && n < 100 ? '>99' : Math.round(n)}%`
const range = (r: OddsRange | null | undefined) => (r ? ` (range ${Math.round(r.lo)}–${Math.round(r.hi)}%)` : '')
const record = (t: Pick<OutlookTeam, 'wins' | 'losses'>) => `${t.wins}-${t.losses}`
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function statusLine(t: OutlookTeam): string | null {
  if (t.status === 'clinched') return 'CLINCHED a playoff spot by arithmetic.'
  if (t.status === 'eliminated') return 'ELIMINATED from playoff contention by arithmetic.'
  return null
}

function swingLines(s: SwingMatchup | undefined): string[] {
  if (!s) return []
  const vs = s.opponentName ? ` vs ${s.opponentName}` : ''
  const out = [
    `- THIS WEEK (week ${s.week}${vs}): win → ${pct(s.ifWin)} playoff odds; lose → ${pct(s.ifLose)} (a ${Math.round(s.swing)}-point swing).`,
  ]
  if (s.clinchOnWin) out.push('- A win essentially clinches a spot. Say "win and you are in".')
  if (s.helpIfLose.length > 0) {
    out.push(`- If they lose, the teams whose misses help them most: ${s.helpIfLose.join(', ')} — "root against" these.`)
  } else if (s.ifLose < s.ifWin) {
    out.push('- If they lose, no single other result rescues them — it comes down to their own games.')
  }
  return out
}

function leagueBlock(league: OutlookLeague, swing: SwingMatchup | undefined): string {
  const you = league.you
  const lines: Array<string | null> = [
    `PLAYOFF OUTLOOK — ${league.leagueName} (${league.season}, ${league.weeksRemaining} week(s) of regular season left, ` +
      `${league.playoffTeams}-team playoff field${league.byeTeams > 0 ? `, ${league.byeTeams} bye(s)` : ''}). ` +
      `Computed by AllFantasy's season simulator — repeat these numbers, never estimate your own:`,
  ]

  if (!you) {
    lines.push("- The user's own team is not identified in this league (not claimed), so there are no odds FOR THEM. Say so; you may describe the league table.")
  } else if (!you.modelled) {
    lines.push(`- Their team (${you.name ?? 'unnamed'}, ${record(you)}) has too few completed weeks to model, so no odds are given for it. Say so.`)
  } else {
    lines.push(
      `- Their team: ${you.name ?? 'their team'}, ${record(you)}, ${you.pointsFor.toFixed(1)} points for, currently the ${ordinal(you.seed)} seed of ${league.teams.length}.`,
      statusLine(you) ? `- ${statusLine(you)}` : null,
      `- Playoff odds ${pct(you.playoffPct)}${range(you.range?.playoff)}; ` +
        (league.byeTeams > 0 ? `first-round bye ${pct(you.byePct)}${range(you.range?.bye)}; ` : '') +
        `championship ${pct(you.titlePct)}${range(you.range?.title)}.`,
      `- What decides it: ${league.whatDecidesIt}`,
    )
    const m = league.milestones
    if (m) {
      const bits = [
        m.projectedWins != null ? `most likely finish ${m.projectedWins}-${m.totalGames - m.projectedWins}` : null,
        m.winsForLikely != null ? `${m.winsForLikely} wins gets them in more often than not` : null,
        m.winsForSafe != null ? `${m.winsForSafe} wins is safe (9 in 10)` : null,
        m.cutWinsMedian != null
          ? `the last playoff team usually finishes with ${m.cutWinsMedian} wins` +
            (m.cutPointsMedian != null ? ` and about ${Math.round(m.cutPointsMedian)} points for` : '')
          : null,
      ].filter(Boolean)
      if (bits.length) lines.push(`- Magic numbers: ${bits.join('; ')}.`)
    }
    const sched = you.schedule
    if (sched?.remainingRank != null) {
      lines.push(
        `- Remaining schedule: ${ordinal(sched.remainingRank)} hardest in the league` +
          (sched.pastRank != null ? ` (their schedule so far was ${ordinal(sched.pastRank)} hardest)` : '') +
          '.',
      )
    }
    if (you.expectedWins != null) {
      const luck = you.wins - you.expectedWins
      if (Math.abs(luck) >= 1) {
        lines.push(
          `- Luck: their weekly scores would have earned about ${you.expectedWins.toFixed(1)} wins against the whole league; they have ${you.wins} — ${luck > 0 ? 'running lucky' : 'running unlucky'} by ${Math.abs(luck).toFixed(1)}.`,
        )
      }
    }
  }

  lines.push(...swingLines(swing))

  const focus = league.focus
  if (focus) {
    const drivers = focus.drivers.filter((d) => Math.abs(d.impact) >= 1).slice(0, 4)
    if (drivers.length) {
      lines.push(
        `- What is moving their odds: ${drivers
          .map((d) => `${d.label} (${d.spread ? '±' : d.impact > 0 ? '+' : ''}${Math.round(d.impact)} pts) — ${d.detail}`)
          .join(' | ')}`,
      )
    }
    const moves = focus.moves.slice(0, 4)
    if (moves.length) {
      lines.push(
        `- Moves that raise their odds (simulated): ${moves
          .map(
            (mv) =>
              `${mv.title}: ${mv.detail} (+${mv.pointsPerWeek.toFixed(1)} pts/week, playoff odds ${mv.playoffDelta >= 0 ? '+' : ''}${mv.playoffDelta.toFixed(1)}, title ${mv.titleDelta >= 0 ? '+' : ''}${mv.titleDelta.toFixed(1)})`,
          )
          .join(' | ')}`,
      )
    }
    const d = focus.durability
    if (d?.flags?.length) lines.push(`- Roster risks: ${d.flags.slice(0, 4).join(' | ')}`)
  }

  const shown = league.teams.slice(0, TABLE_ROWS)
  lines.push(
    `- League table by current seed (record, playoff odds): ${shown
      .map(
        (t) =>
          `${t.seed}. ${t.name ?? 'unnamed team'}${t.isYou ? ' (THEM)' : ''} ${record(t)} ${t.modelled ? pct(t.playoffPct) : 'not modelled'}${t.status ? ` [${t.status}]` : ''}`,
      )
      .join('; ')}${league.teams.length > shown.length ? ` (+${league.teams.length - shown.length} more)` : ''}.`,
  )

  const a = league.assumptions
  lines.push(
    `- Basis: ${a.iterations.toLocaleString()} simulations of the real remaining schedule (${a.remainingGames} games); tiebreak ${a.tiebreak} ` +
      `Playoff field ${a.playoffTeams.value} (${a.playoffTeams.source}). Run at ${a.computedAt}.`,
  )
  if (a.missing.length) lines.push(`- Not modelled: ${a.missing.join('; ')}. Say so if the answer depends on it.`)
  lines.push(`- Full outlook screen: /core/season-outlook?league=${encodeURIComponent(league.leagueId)}`)
  return lines.filter(Boolean).join('\n')
}

function crossLeagueBlock(outlook: SeasonOutlook): string {
  const withYou = outlook.leagues.filter((l) => l.you && l.you.modelled)
  const lines: string[] = [
    `PLAYOFF OUTLOOK ACROSS ${outlook.leagues.length} LEAGUE(S) (AllFantasy season simulator — repeat these numbers, never estimate):`,
  ]
  const s = outlook.summary
  lines.push(
    `- Summary: likely playoffs in ${s.makingPlayoffs}, clinched ${s.clinched}, on the bubble ${s.onTheBubble}` +
      (s.bestTitle ? `; best title shot ${pct(s.bestTitle.pct)} in ${s.bestTitle.leagueName}` : '') +
      '.',
  )
  for (const l of withYou.slice(0, MAX_CROSS_LEAGUES)) {
    const y = l.you!
    lines.push(
      `- ${l.leagueName}: ${record(y)}, ${ordinal(y.seed)} seed, playoffs ${pct(y.playoffPct)}, title ${pct(y.titlePct)}` +
        (y.status ? ` [${y.status}]` : '') +
        ` — ${l.whatDecidesIt}`,
    )
  }
  const notYou = outlook.leagues.filter((l) => !l.you || !l.you.modelled)
  if (notYou.length) {
    lines.push(`- No odds for them in: ${notYou.map((l) => l.leagueName).join(', ')} (team not claimed, or too few weeks played).`)
  }
  if (outlook.weekThatMatters) {
    const w = outlook.weekThatMatters
    lines.push(
      `- The game that matters most this week: ${w.leagueName}, week ${w.week}${w.opponentName ? ` vs ${w.opponentName}` : ''} — win ${pct(w.ifWin)}, lose ${pct(w.ifLose)}.`,
    )
  }
  if (outlook.priorities.length) {
    lines.push(`- Where attention is worth spending: ${outlook.priorities.map((p) => `${p.leagueName}: ${p.reason}`).join(' | ')}`)
  }
  if (outlook.withheld.length) {
    lines.push(`- Not simulated: ${outlook.withheld.map((w) => `${w.leagueName} (${w.reason})`).join('; ')}.`)
  }
  lines.push(`- Basis: ${outlook.basis}`)
  lines.push('- For one league in depth (swing game, moves that raise the odds), select it with find_league_by_name and call this tool again.')
  return lines.join('\n')
}

/**
 * The tool entry point. Prose for the model, never a throw: a failure comes back as a sentence that
 * says nothing was computed.
 */
export async function buildPlayoffOutlookContext(
  args: { leagueId: string | null; userId: string },
  deps: PlayoffOutlookDeps = defaultDeps,
): Promise<string> {
  try {
    const ids = args.leagueId ? [args.leagueId] : (await deps.listLeagueIds(args.userId)).slice(0, MAX_CROSS_LEAGUES)
    if (ids.length === 0) {
      return 'This user has no current-season leagues on file, so there is nothing to simulate. Say so; do not estimate odds.'
    }
    const leagues = await deps.loadLeagues(ids)
    if (leagues.length === 0) {
      return 'The league could not be read, so no playoff odds were computed. Say so; do not estimate them.'
    }

    const outlook = await withTimeout(deps.getOutlook(args.userId, leagues, args.leagueId), deps.timeoutMs)
    if (outlook === TIMED_OUT) {
      return 'The season simulation did not finish in time, so NO odds were computed this turn. Say so and suggest the Season Outlook screen or asking again in a minute; do not estimate odds.'
    }

    if (args.leagueId) {
      const league = outlook.leagues.find((l) => l.leagueId === args.leagueId)
      if (!league) {
        const why = outlook.withheld[0]?.reason
        return [
          'PLAYOFF OUTLOOK: NOT COMPUTED for this league.',
          why ? `Reason: ${why}` : 'The league has no synced schedule the simulator can play out.',
          'Say plainly that no odds were computed and why. Do NOT estimate playoff odds or a magic number.',
        ].join('\n')
      }
      return leagueBlock(league, outlook.swingByLeague[league.leagueId])
    }

    if (outlook.leagues.length === 0) {
      const why = outlook.withheld.map((w) => `${w.leagueName}: ${w.reason}`).join('; ')
      return [
        'PLAYOFF OUTLOOK: no league could be simulated.',
        why ? `Reasons: ${why}.` : 'None of their leagues has a synced schedule.',
        'Say so; do not estimate odds.',
      ].join('\n')
    }
    return crossLeagueBlock(outlook)
  } catch {
    return 'The playoff simulation failed to run. Say that you could not compute odds rather than answering as though you had.'
  }
}
