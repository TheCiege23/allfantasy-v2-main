/**
 * Demo Chimmy: answers questions about the demo league using ONLY the anonymized view.
 *
 * Deliberately not the real Chimmy pipeline. That pipeline grounds on the viewer's
 * leagues, memory, portfolio and tools — every one of which would either need an
 * account or reach real data. Here the model is handed a compact text rendering of the
 * already-anonymized DemoLeagueView and nothing else, with no tools, so there is no
 * path by which a real name can enter its context. The answer is still passed through
 * the redactor (see the route), which also catches a visitor pasting a real name in.
 *
 * Spend: a public endpoint that calls a model needs a ceiling nobody has to remember to
 * set. Per-IP limits live in the route; this module adds a per-process daily cap
 * (DEMO_CHIMMY_DAILY_CAP, default 300) on top of the platform-wide spend guard that
 * every provider call already passes through.
 *
 * ⚠ 2026-11-15, TESTER REPORT: "Who's the best team in the league and why?" got a team name
 * and nothing else; the breakdown (including that the standings leader was not the top scorer)
 * only came after a follow-up. Three causes, all fixed here:
 *   1. The prompt asked for "under 180 words" and nothing about WHY, so a one-line answer obeyed it.
 *   2. The brief had raw standings only — no ranks, no recent form, no schedule luck — so the
 *      model had to do the arithmetic to find the interesting part, and usually did not.
 *      Those facts are now computed here and handed over as KEY FACTS.
 *   3. `maxTokens: 400` on the `cheap` profile, whose models may spend tokens reasoning before
 *      they write. Answers came back short or cut off. Now 900, with cut-off detection.
 */
import 'server-only'
import { routeTextCallWithRetry, describeRouterFailure } from '@/lib/ai/routeTextCallWithRetry'
import { findPlayerByName } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { settingsFor } from './trade'
import type { DemoLeagueView } from './types'

const MAX_QUESTION_CHARS = 500
const MAX_HISTORY_TURNS = 3
const MAX_HISTORY_ANSWER_CHARS = 1200
const MAX_CONTINUE_CHARS = 2400

/** Room for a short answer plus whatever a reasoning-capable `cheap` model spends first. */
const DEMO_CHIMMY_MAX_TOKENS = 900
/** Per provider. The router's 12 s default is tight for a reasoning model writing 200 words. */
const DEMO_CHIMMY_PROVIDER_TIMEOUT_MS = 15_000

let day = ''
let usedToday = 0

function dailyCap(): number {
  const n = Number(process.env.DEMO_CHIMMY_DAILY_CAP)
  return Number.isFinite(n) && n >= 0 ? n : 300
}

export function takeDemoChimmyBudget(now = new Date()): boolean {
  const d = now.toISOString().slice(0, 10)
  if (d !== day) {
    day = d
    usedToday = 0
  }
  if (usedToday >= dailyCap()) return false
  usedToday += 1
  return true
}

// ── Derived facts ───────────────────────────────────────────────────────────────────

type TeamFacts = {
  slot: number
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  pfRank: number
  /** 1 = faced the MOST points (toughest luck). */
  paRank: number
  weeksScored: number
  avgPerWeek: number | null
  last3: number[]
  last3Avg: number | null
  trend: 'up' | 'down' | 'steady' | null
  allPlayWins: number
  allPlayLosses: number
  allPlayTies: number
  /** Actual wins minus the wins an average schedule would have given. + = lucky. */
  luck: number | null
  starterValue: number | null
  starterValueRank: number | null
}

const r1 = (n: number) => Math.round(n * 10) / 10

function rankBy<T>(items: T[], value: (t: T) => number, slot: (t: T) => number): Map<number, number> {
  const sorted = [...items].sort((a, b) => value(b) - value(a))
  return new Map(sorted.map((t, i) => [slot(t), i + 1]))
}

/**
 * Every number the model needs to explain a call, computed rather than left to the model:
 * PF/PA ranks, scoring average, last-three-weeks form, all-play record and schedule luck.
 * Pure — exported for tests.
 */
export function computeDemoTeamFacts(view: DemoLeagueView, starterValues?: Map<number, number> | null): TeamFacts[] {
  const pfRank = rankBy(view.standings, (s) => s.pointsFor, (s) => s.slot)
  const paRank = rankBy(view.standings, (s) => s.pointsAgainst, (s) => s.slot)
  const valueRank = starterValues && starterValues.size > 0
    ? rankBy([...starterValues.entries()], ([, v]) => v, ([slot]) => slot)
    : null

  const weeks = view.weeklyScores ?? []
  return view.standings.map((s) => {
    const mine = weeks
      .map((w) => w.scores.find((x) => x.slot === s.slot)?.points)
      .filter((p): p is number => typeof p === 'number')
    let apW = 0
    let apL = 0
    let apT = 0
    for (const w of weeks) {
      const me = w.scores.find((x) => x.slot === s.slot)
      if (!me) continue
      for (const other of w.scores) {
        if (other.slot === s.slot) continue
        if (me.points > other.points) apW += 1
        else if (me.points < other.points) apL += 1
        else apT += 1
      }
    }
    const apGames = apW + apL + apT
    const games = s.wins + s.losses + s.ties
    const luck = apGames > 0 && games > 0 ? r1(s.wins + s.ties / 2 - ((apW + apT / 2) / apGames) * games) : null
    const avg = mine.length ? r1(mine.reduce((a, b) => a + b, 0) / mine.length) : null
    const last3 = mine.slice(-3)
    const last3Avg = last3.length ? r1(last3.reduce((a, b) => a + b, 0) / last3.length) : null
    // A trend needs a season to compare against: at least two weeks before the last three.
    const trend = avg != null && last3Avg != null && mine.length >= 5
      ? last3Avg > avg * 1.05 ? 'up' : last3Avg < avg * 0.95 ? 'down' : 'steady'
      : null
    return {
      slot: s.slot, rank: s.rank, wins: s.wins, losses: s.losses, ties: s.ties,
      pointsFor: s.pointsFor, pointsAgainst: s.pointsAgainst,
      pfRank: pfRank.get(s.slot) ?? s.rank, paRank: paRank.get(s.slot) ?? s.rank,
      weeksScored: mine.length, avgPerWeek: avg, last3, last3Avg, trend,
      allPlayWins: apW, allPlayLosses: apL, allPlayTies: apT, luck,
      starterValue: starterValues?.get(s.slot) ?? null,
      starterValueRank: valueRank?.get(s.slot) ?? null,
    }
  })
}

const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`
const ord = (n: number) => `#${n}`

/** Plain-text league brief built only from anonymized fields. Pure — exported for tests. */
export function buildDemoLeagueBrief(view: DemoLeagueView, starterValues?: Map<number, number> | null): string {
  const name = new Map(view.teams.map((t) => [t.slot, `${t.teamName} (manager ${t.managerName})`]))
  const short = new Map(view.teams.map((t) => [t.slot, t.teamName]))
  const teamCount = view.standings.length
  const lines: string[] = []
  const s = view.settings
  lines.push(`League: ${view.leagueName}. ${s.teamCount} teams, ${s.sport} ${s.season}${s.scoringLabel ? `, ${s.scoringLabel}` : ''}${s.isDynasty ? ', dynasty' : ''}${s.playoffTeams ? `, ${s.playoffTeams} playoff teams` : ''}.`)
  if (view.currentWeek != null) lines.push(`Current week: ${view.currentWeek}. Completed weeks with scores: ${view.weeklyScores?.length ?? 0}.`)

  const facts = computeDemoTeamFacts(view, starterValues)

  lines.push(`Standings (ranked by record; PF/PA rank out of ${teamCount}, PA #1 = faced the most points):`)
  for (const f of facts) {
    const parts = [
      record(f.wins, f.losses, f.ties),
      `PF ${f.pointsFor} (${ord(f.pfRank)})`,
      `PA ${f.pointsAgainst} (${ord(f.paRank)})`,
    ]
    if (f.avgPerWeek != null) parts.push(`avg ${f.avgPerWeek}/wk`)
    if (f.last3.length) parts.push(`last ${f.last3.length}: ${f.last3.join(', ')}${f.trend ? ` (trend ${f.trend})` : ''}`)
    if (f.allPlayWins + f.allPlayLosses + f.allPlayTies > 0) {
      parts.push(`all-play ${record(f.allPlayWins, f.allPlayLosses, f.allPlayTies)}`)
      if (f.luck != null) parts.push(`schedule luck ${f.luck > 0 ? '+' : ''}${f.luck} wins`)
    }
    if (f.starterValue != null && f.starterValueRank != null) parts.push(`starting-lineup market value ${f.starterValue} (${ord(f.starterValueRank)})`)
    lines.push(`  ${f.rank}. ${name.get(f.slot)} — ${parts.join(', ')}`)
  }

  // KEY FACTS: the comparisons the model would otherwise have to work out, stated outright.
  const key: string[] = []
  const leader = facts[0]
  const topScorer = [...facts].sort((a, b) => b.pointsFor - a.pointsFor)[0]
  if (leader && topScorer) {
    key.push(`Best record: ${short.get(leader.slot)} (${record(leader.wins, leader.losses, leader.ties)}). Most points scored: ${short.get(topScorer.slot)} (${topScorer.pointsFor} PF).`)
    if (leader.slot !== topScorer.slot) {
      key.push(`SURPRISE: the standings leader is NOT the top-scoring team — ${short.get(leader.slot)} is ${ord(leader.pfRank)} in points for.`)
    }
  }
  const withAllPlay = facts.filter((f) => f.allPlayWins + f.allPlayLosses + f.allPlayTies > 0)
  if (withAllPlay.length) {
    const pct = (f: TeamFacts) => (f.allPlayWins + f.allPlayTies / 2) / (f.allPlayWins + f.allPlayLosses + f.allPlayTies)
    const bestAp = [...withAllPlay].sort((a, b) => pct(b) - pct(a))[0]!
    key.push(`Best all-play record (how they'd do playing every team every week, schedule removed): ${short.get(bestAp.slot)} ${record(bestAp.allPlayWins, bestAp.allPlayLosses, bestAp.allPlayTies)}.`)
    const lucky = withAllPlay.filter((f) => f.luck != null).sort((a, b) => (b.luck ?? 0) - (a.luck ?? 0))
    const luckiest = lucky[0]
    const unluckiest = lucky[lucky.length - 1]
    if (luckiest && (luckiest.luck ?? 0) >= 1) key.push(`Luckiest schedule: ${short.get(luckiest.slot)} (${luckiest.luck! > 0 ? '+' : ''}${luckiest.luck} wins more than their scoring earns).`)
    if (unluckiest && (unluckiest.luck ?? 0) <= -1) key.push(`Unluckiest schedule: ${short.get(unluckiest.slot)} (${unluckiest.luck} wins).`)
  }
  const withForm = facts.filter((f) => f.last3Avg != null && f.last3.length >= 3)
  if (withForm.length >= 2) {
    const hottest = [...withForm].sort((a, b) => b.last3Avg! - a.last3Avg!)[0]!
    const coldest = [...withForm].sort((a, b) => a.last3Avg! - b.last3Avg!)[0]!
    key.push(`Hottest last 3 weeks: ${short.get(hottest.slot)} (avg ${hottest.last3Avg}). Coldest: ${short.get(coldest.slot)} (avg ${coldest.last3Avg}).`)
    const climb = (f: TeamFacts) => (f.trend ? f.last3Avg! - f.avgPerWeek! : 0)
    const riser = [...withForm].sort((a, b) => climb(b) - climb(a))[0]!
    if (riser.trend === 'up') key.push(`Biggest climb: ${short.get(riser.slot)} (last 3 avg ${riser.last3Avg} vs ${riser.avgPerWeek} for the season).`)
  }
  const strongest = facts.find((f) => f.starterValueRank === 1)
  if (strongest) key.push(`Strongest starting lineup by market value: ${short.get(strongest.slot)}.`)
  if (key.length) {
    lines.push('KEY FACTS (pre-computed from the numbers above):')
    for (const k of key) lines.push(`  - ${k}`)
  }

  if (view.matchups.length) {
    lines.push(`This week's matchups (${view.matchups[0]!.status}):`)
    for (const m of view.matchups) lines.push(`  ${short.get(m.home.slot)} ${m.home.points} vs ${m.away ? `${short.get(m.away.slot)} ${m.away.points}` : 'bye'}`)
  }
  lines.push('Rosters (starters | bench):')
  for (const r of view.rosters) {
    const fmt = (ps: typeof r.starters) => ps.map((p) => `${p.name}${p.position ? ` ${p.position}` : ''}`).join(', ')
    lines.push(`  ${short.get(r.slot)}: ${fmt(r.starters)} | ${fmt(r.bench)}`)
  }
  if (view.trades.length) {
    lines.push('Recent trades:')
    for (const t of view.trades.slice(0, 10)) {
      lines.push(`  ${t.date}: ` + t.sides.map((sd) => `${short.get(sd.slot)} got ${sd.received.map((a) => a.name).join(', ') || 'nothing listed'}`).join('; '))
    }
  }
  if (view.health) lines.push(`League health: ${view.health.score}/100 (${view.health.status}). ${view.health.summary}`)
  return lines.join('\n')
}

/**
 * Market value of each team's STARTERS, from the same chart the demo trade evaluator uses.
 * NFL only. Best-effort: anything slow or failing just leaves the line out of the brief.
 */
async function starterValuesFor(view: DemoLeagueView): Promise<Map<number, number> | null> {
  if (view.settings.sport !== 'NFL' || view.rosters.length === 0) return null
  try {
    const players = await Promise.race([
      getFantasyCalcValuesDbFirst(settingsFor(view)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500)),
    ])
    if (!players || players.length === 0) return null
    const out = new Map<number, number>()
    for (const r of view.rosters) {
      let total = 0
      for (const p of r.starters) total += findPlayerByName(players, p.name, { position: p.position, team: p.team })?.value ?? 0
      out.set(r.slot, Math.round(total))
    }
    return [...out.values()].some((v) => v > 0) ? out : null
  } catch {
    return null
  }
}

// ── Prompt ──────────────────────────────────────────────────────────────────────────

/** Exported so tests can pin the answer-shape rules. */
export const DEMO_CHIMMY_SYSTEM = [
  'You are Chimmy, the AllFantasy assistant, answering questions inside a PUBLIC DEMO league.',
  'Every team and manager name in the brief is a fictional demo alias. You do not know, and must never guess or invent, any real person\'s name, username or email behind them. If asked who really runs a team, say the demo league is anonymized.',
  'Use only the league brief below plus general, widely known fantasy-sports knowledge about the real players named in it. Quote numbers exactly as the brief gives them. If the brief does not contain something, say so.',
  'You cannot change rosters, make trades or send messages — the demo is read-only.',
  '\n\nHOW TO ANSWER:',
  '- Lead with the answer in ONE sentence.',
  '- EVALUATIVE QUESTIONS — best or worst team, who won a trade, who to start, who is overrated or underrated, who is the favorite, who is in trouble — ALWAYS include the reasoning in this same first reply. Never answer with only a name. After the one-sentence answer, give 2 to 4 short bullets, each naming a specific number or fact from the brief: record, points for and against with their ranks, all-play record and schedule luck, recent weekly scores and trend, starting-lineup strength.',
  '- If KEY FACTS or the numbers show something surprising — the standings leader is not the top scorer, a team is winning on schedule luck, a hot or cold streak — say it in one line.',
  '- For factual lookups (a score, a roster, a trade), just answer; no bullets needed.',
  '- Concise: no greeting, no restating the question, no filler, no closing pleasantries. Stay under 170 words.',
].join('\n')

export type DemoChimmyTurn = { q: string; a: string }

export type AskDemoChimmyOptions = {
  /** The last few exchanges in this visitor's session, already scrubbed by the route. */
  history?: DemoChimmyTurn[]
  /** The cut-off answer to finish, when the visitor tapped "continue". Already scrubbed. */
  continueFrom?: string | null
  /** Injected in tests. */
  starterValues?: Map<number, number> | null
}

export type AskDemoChimmyResult =
  | { ok: true; answer: string; truncated: boolean }
  | { ok: false; reason: 'empty' | 'unavailable'; retryable: boolean }

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * The user message. Earlier turns go INSIDE it rather than as separate chat messages because the
 * router's Anthropic and DeepSeek adapters keep only the last user message — separate turns would
 * silently vanish on two of the four providers.
 */
export function buildDemoChimmyUserMessage(question: string, opts: Pick<AskDemoChimmyOptions, 'history' | 'continueFrom'> = {}): string {
  const parts: string[] = []
  const history = (opts.history ?? []).slice(-MAX_HISTORY_TURNS).filter((t) => t.q.trim() && t.a.trim())
  if (history.length) {
    parts.push('EARLIER IN THIS CONVERSATION (context only — answer the current question):')
    for (const t of history) parts.push(`Q: ${clip(t.q, MAX_QUESTION_CHARS)}\nA: ${clip(t.a, MAX_HISTORY_ANSWER_CHARS)}`)
    parts.push('')
  }
  const partial = opts.continueFrom ? clip(opts.continueFrom, MAX_CONTINUE_CHARS) : ''
  if (partial) {
    parts.push('Your previous answer to the question below was cut off. This is what you already wrote:')
    parts.push(`"""${partial}"""`)
    parts.push('Continue from exactly where it stopped. Do not repeat anything already written and do not start over; finish the answer.')
    parts.push(`QUESTION: ${question}`)
  } else {
    parts.push(`CURRENT QUESTION: ${question}`)
  }
  return parts.join('\n')
}

export async function askDemoChimmy(view: DemoLeagueView, question: string, opts: AskDemoChimmyOptions = {}): Promise<AskDemoChimmyResult> {
  const q = clip(question, MAX_QUESTION_CHARS)
  if (!q) return { ok: false, reason: 'empty', retryable: false }
  const starterValues = opts.starterValues !== undefined ? opts.starterValues : await starterValuesFor(view)

  const { result, attempts, elapsedMs } = await routeTextCallWithRetry(
    {
      messages: [
        { role: 'system', content: `${DEMO_CHIMMY_SYSTEM}\n\n--- DEMO LEAGUE BRIEF ---\n${buildDemoLeagueBrief(view, starterValues)}` },
        { role: 'user', content: buildDemoChimmyUserMessage(q, opts) },
      ],
      maxTokens: DEMO_CHIMMY_MAX_TOKENS,
      temperature: 0.4,
      skipCache: true,
      profile: 'cheap',
      timeoutMs: DEMO_CHIMMY_PROVIDER_TIMEOUT_MS,
      feature: 'demo_league_chimmy',
      userId: null,
      leagueId: null,
    },
    { label: 'demo-chimmy', retries: 2, budgetMs: 25_000 },
  )

  if (!result.ok) {
    // Reason codes only: no question, no answer, no league data.
    console.error('[demo-chimmy] unavailable after retries', { attempts, elapsedMs, reason: describeRouterFailure(result.failure) })
    return { ok: false, reason: 'unavailable', retryable: result.failure?.retryable ?? true }
  }
  const truncated = Boolean(result.truncated)
  if (truncated) {
    console.warn('[demo-chimmy] answer cut off at the token limit', { provider: result.provider, model: result.model, attempts, maxTokens: DEMO_CHIMMY_MAX_TOKENS })
  }
  return { ok: true, answer: result.text.trim(), truncated }
}
