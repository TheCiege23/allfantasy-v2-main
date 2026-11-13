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
 */
import 'server-only'
import { routeTextCall } from '@/lib/ai/providerRouter'
import type { DemoLeagueView } from './types'

const MAX_QUESTION_CHARS = 500

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

/** Plain-text league brief built only from anonymized fields. */
function demoLeagueBrief(view: DemoLeagueView): string {
  const name = new Map(view.teams.map((t) => [t.slot, `${t.teamName} (manager ${t.managerName})`]))
  const short = new Map(view.teams.map((t) => [t.slot, t.teamName]))
  const lines: string[] = []
  const s = view.settings
  lines.push(`League: ${view.leagueName}. ${s.teamCount} teams, ${s.sport} ${s.season}${s.scoringLabel ? `, ${s.scoringLabel}` : ''}${s.isDynasty ? ', dynasty' : ''}.`)
  if (view.currentWeek != null) lines.push(`Current week: ${view.currentWeek}.`)
  lines.push('Standings:')
  for (const r of view.standings) lines.push(`  ${r.rank}. ${name.get(r.slot)} — ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}, ${r.pointsFor} PF, ${r.pointsAgainst} PA`)
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

const SYSTEM = [
  'You are Chimmy, the AllFantasy assistant, answering questions inside a PUBLIC DEMO league.',
  'Every team and manager name in the brief is a fictional demo alias. You do not know, and must never guess or invent, any real person\'s name, username or email behind them. If asked who really runs a team, say the demo league is anonymized.',
  'Use only the league brief below plus general, widely known fantasy-sports knowledge about the real players named in it. If the brief does not contain something, say so.',
  'You cannot change rosters, make trades or send messages — the demo is read-only. Keep answers under 180 words.',
].join(' ')

export async function askDemoChimmy(view: DemoLeagueView, question: string): Promise<{ ok: true; answer: string } | { ok: false; reason: 'empty' | 'unavailable' }> {
  const q = question.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS)
  if (!q) return { ok: false, reason: 'empty' }
  const result = await routeTextCall({
    messages: [
      { role: 'system', content: `${SYSTEM}\n\n--- DEMO LEAGUE BRIEF ---\n${demoLeagueBrief(view)}` },
      { role: 'user', content: q },
    ],
    maxTokens: 400,
    temperature: 0.4,
    skipCache: true,
    profile: 'cheap',
    feature: 'demo_league_chimmy',
    userId: null,
    leagueId: null,
  })
  if (!result.ok) return { ok: false, reason: 'unavailable' }
  return { ok: true, answer: result.text.trim() }
}
