import type { LineupOptimization, OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { preferenceMuteReason, type ChimmyAlertPreferenceMuteReason } from './ChimmyAlertSuppressionEngine'
import { chimmyChatHref, pushSetupEmailLine, type ProactiveFrom } from './proactiveLinks'
import type { ChimmyAlertUserPreferences } from './types'

/**
 * CHIMMY'S LINEUP CHECK — Chimmy messages you first (owner's call 2026-09-24: "start on chimmy
 * messaging users first").
 *
 * Until now every Chimmy answer waited to be asked. The one question almost every manager has on a
 * Sunday morning — "is my lineup right?" — only got answered for the people who remembered to ask
 * it. So before the week's main slate kicks off, Chimmy runs the lineup optimizer over each of your
 * NFL leagues and, when something is actually wrong, tells you once.
 *
 * This module is the pure half: what counts as "wrong", when the message goes, and what it says.
 * `runLineupCheck.ts` does the reading and sending.
 *
 * ── 🛑 ONLY WHAT YOU CAN STILL FIX ─────────────────────────────────────────────────────────────
 * A player whose game has kicked off is locked on every platform. Telling someone to bench a
 * Thursday-night starter on Sunday morning is advice they cannot take, so every flagged player and
 * every suggested move must be UNLOCKED. The optimizer does not model locks (it says so), so a
 * suggestion touching a locked player is dropped whole rather than half-applied: its list of moves
 * is one decision, and removing one side changes what the other side should be.
 *
 * ── 🛑 ONLY WHAT IS WORTH AN INTERRUPTION ──────────────────────────────────────────────────────
 * An empty slot, a starter with no projection (bye, ruled out, released), a starter ruled out, or a
 * reshuffle worth PROACTIVE_MIN_GAIN or more. The optimizer's own noise floor (0.5) is right for an
 * answer someone asked for and wrong for a message nobody did: a 0.8-point swap is a coin flip, and
 * a notification about a coin flip teaches people to ignore the next one.
 *
 * ── NOTHING INVENTED ───────────────────────────────────────────────────────────────────────────
 * Every name, number and designation in the message is one the optimizer returned. The copy adds
 * voice, never facts.
 */

/** A reshuffle must be worth this many projected points before Chimmy interrupts anyone with it. */
export const PROACTIVE_MIN_GAIN = 3

/**
 * The window before the main slate: open from 4h before its first kickoff to 1h before. The sweep
 * runs every 15 minutes, so the first run inside it sends; the last hour is left alone because a
 * message then arrives too late to act on for anyone not already looking.
 */
export const LINEUP_CHECK_OPENS_BEFORE_MS = 4 * 60 * 60 * 1000
export const LINEUP_CHECK_CLOSES_BEFORE_MS = 60 * 60 * 1000

/** The question the link puts in Chimmy's box — the same words as the drawer's quick prompt. */
export const LINEUP_CHECK_PROMPT = 'Set my best lineup for this week'

type ReadyOptimization = Extract<LineupOptimization, { status: 'ready' }>

export type LineupIssue =
  | { kind: 'empty_slots'; count: number }
  | { kind: 'no_projection'; player: OptimizerPlayer }
  | { kind: 'ruled_out'; player: OptimizerPlayer }
  /** `gain` is null when a current starter has no projection, so the total cannot be compared. */
  | { kind: 'reshuffle'; gain: number | null; start: OptimizerPlayer[]; bench: OptimizerPlayer[] }

export type LeagueLineupCheck = {
  leagueId: string
  leagueName: string
  week: number
  issues: LineupIssue[]
}

/* ── When ─────────────────────────────────────────────────────────────────────────────────────── */

export type ScheduledGame = { homeTeam: string; awayTeam: string; startTime: Date }

/**
 * The week's main slate: the kickoff time the most games share, earliest on a tie.
 *
 * ⚠ NOT THE WEEK'S FIRST KICKOFF. That is Thursday night, before Friday's injury reports, and a
 * check sent then would miss most of what it exists to catch. Counting rows works across provider
 * duplicates because every provider carries every game, so each slate is multiplied alike.
 */
export function mainSlateKickoff(games: readonly ScheduledGame[]): Date | null {
  const counts = new Map<number, number>()
  for (const g of games) {
    const t = g.startTime?.getTime()
    if (t == null || !Number.isFinite(t)) continue
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [t, n] of counts) {
    if (best == null || n > counts.get(best)! || (n === counts.get(best)! && t < best)) best = t
  }
  return best == null ? null : new Date(best)
}

export type LineupCheckWindow = 'early' | 'open' | 'closed'

export function lineupCheckWindow(mainSlate: Date, now: Date): LineupCheckWindow {
  const until = mainSlate.getTime() - now.getTime()
  if (until > LINEUP_CHECK_OPENS_BEFORE_MS) return 'early'
  if (until < LINEUP_CHECK_CLOSES_BEFORE_MS) return 'closed'
  return 'open'
}

/** Each team's first kickoff this week, by canonical abbreviation. Providers spell teams both ways. */
export function teamKickoffs(games: readonly ScheduledGame[]): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const g of games) {
    if (!g.startTime) continue
    for (const raw of [g.homeTeam, g.awayTeam]) {
      const team = normalizeTeamAbbrev(raw)
      if (!team) continue
      const seen = out.get(team)
      if (!seen || g.startTime.getTime() < seen.getTime()) out.set(team, g.startTime)
    }
  }
  return out
}

/**
 * Locked once his team's game has kicked off. No team, or a team with no game this week (a bye),
 * is not locked — the same fail-open rule as the redraft lineup-lock engine.
 */
export function isLockedAt(kickoffs: ReadonlyMap<string, Date>, now: Date) {
  return (p: Pick<OptimizerPlayer, 'team'>): boolean => {
    const team = normalizeTeamAbbrev(p.team)
    const kickoff = team ? kickoffs.get(team) : undefined
    return kickoff != null && now.getTime() >= kickoff.getTime()
  }
}

/* ── What ─────────────────────────────────────────────────────────────────────────────────────── */

/** What is wrong with one league's lineup that its manager can still fix. Empty when nothing is. */
export function findLineupIssues(
  result: LineupOptimization,
  isLocked: (p: OptimizerPlayer) => boolean,
): LineupIssue[] {
  // With no lineup from the platform there is nothing to be wrong about — only a lineup to build.
  if (result.status !== 'ready' || !result.current.known) return []
  const r: ReadyOptimization = result
  const open = (p: OptimizerPlayer) => !isLocked(p)
  const issues: LineupIssue[] = []

  if (r.current.emptySlots > 0) issues.push({ kind: 'empty_slots', count: r.current.emptySlots })

  const unpriced = new Set(r.unpricedStarters.map((p) => p.playerId))
  for (const p of r.unpricedStarters) if (open(p)) issues.push({ kind: 'no_projection', player: p })
  for (const p of r.injuredStarters) {
    if (!unpriced.has(p.playerId) && isRuledOut(p.injury) && open(p)) issues.push({ kind: 'ruled_out', player: p })
  }

  const moves = [...r.startInstead, ...r.benchInstead]
  const worthIt =
    r.gain != null
      ? r.gain >= PROACTIVE_MIN_GAIN
      : // No total to compare only because a starter is unpriced — the fix for him is the point.
        r.unpricedStarters.some(open)
  if (r.startInstead.length > 0 && worthIt && moves.every(open)) {
    issues.push({ kind: 'reshuffle', gain: r.gain, start: r.startInstead, bench: r.benchInstead })
  }
  return issues
}

/**
 * Problems, not sentences. Each empty slot, each starter with no projection, each starter ruled out
 * counts once. A reshuffle counts only when it is the whole story — a pure upgrade. When it sits
 * beside a problem it is that problem's REMEDY ("Reed has no projection… start Shaheed over Reed"),
 * and counting both would tell someone they have two things to fix when they have one.
 */
export function countFixes(leagues: readonly LeagueLineupCheck[]): number {
  return leagues.reduce((total, l) => {
    const problems = l.issues.reduce(
      (n, i) => n + (i.kind === 'empty_slots' ? i.count : i.kind === 'reshuffle' ? 0 : 1),
      0,
    )
    return total + (problems > 0 ? problems : l.issues.some((i) => i.kind === 'reshuffle') ? 1 : 0)
  }, 0)
}

/* ── Whether you asked not to hear it ─────────────────────────────────────────────────────────── */

/** The alert type, as the Chimmy alert controls name types they can mute. */
export const LINEUP_CHECK_ALERT_TYPE = 'lineup_check'

/**
 * The Chimmy alert controls in Settings mute by CLASS ("Lineup"), by type, or per league — read
 * through the alert engine's own rule, so this cannot drift from what the panel promises. With no
 * `leagueId` it answers for the user as a whole; with one, for that league. The notification
 * category is a separate, additional switch the dispatcher checks on its own.
 */
export function lineupCheckMutedBy(
  prefs: ChimmyAlertUserPreferences | null | undefined,
  leagueId?: string | null,
): ChimmyAlertPreferenceMuteReason | null {
  return preferenceMuteReason({ class: 'lineup', type: LINEUP_CHECK_ALERT_TYPE, leagueId: leagueId ?? null }, prefs)
}

/* ── Where it lands ───────────────────────────────────────────────────────────────────────────── */

/** `chimmy-lineup-check:<season>-w<week>` — one per user per week; the dispatcher appends `:<userId>`. */
export function lineupCheckDedupeKey(season: string | number, week: number): string {
  return `chimmy-lineup-check:${season}-w${week}`
}

/**
 * Opens Chimmy in that league with the lineup question already typed — one tap to send — tagged
 * with where it was opened from (bell/phone by default, the email passes its own), so an open can
 * be counted: see `proactiveLinks.ts`.
 */
export function lineupCheckHref(leagueId: string, from: ProactiveFrom = 'lineup_check'): string {
  return chimmyChatHref({ prompt: LINEUP_CHECK_PROMPT, leagueId, from })
}

/* ── What it says ─────────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)

function who(p: OptimizerPlayer): string {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}

function names(ps: readonly OptimizerPlayer[]): string {
  const n = ps.map((p) => p.name)
  return n.length <= 2 ? n.join(' and ') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/** One sentence per issue, in the order a manager should fix them. */
export function describeIssue(issue: LineupIssue, week: number): string {
  switch (issue.kind) {
    case 'empty_slots':
      return issue.count === 1 ? 'A starting spot is empty.' : `${issue.count} starting spots are empty.`
    case 'no_projection':
      return `${who(issue.player)} is starting with no week ${week} projection — a bye, ruled out, or released.`
    case 'ruled_out':
      return `${who(issue.player)} is starting but listed ${issue.player.injury}.`
    case 'reshuffle': {
      const gain = issue.gain != null ? ` (+${fmt(issue.gain)} projected pts)` : ''
      if (issue.start.length === 1 && issue.bench.length === 1) {
        return `Start ${issue.start[0]!.name} over ${issue.bench[0]!.name}${gain}.`
      }
      const bench = issue.bench.length > 0 ? `, bench ${names(issue.bench)}` : ''
      return `Start ${names(issue.start)}${bench}${gain}.`
    }
  }
}

const RANK: Record<LineupIssue['kind'], number> = { empty_slots: 0, no_projection: 1, ruled_out: 2, reshuffle: 3 }
const ordered = (issues: readonly LineupIssue[]) => [...issues].sort((a, b) => RANK[a.kind] - RANK[b.kind])

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Long league names would push the count out of a phone banner. */
function shortName(name: string): string {
  const t = name.trim() || 'your league'
  return t.length > 32 ? `${t.slice(0, 31)}…` : t
}

export type LineupCheckMessage = {
  title: string
  /** Plain text for the bell and the phone. Capped; the email carries everything. */
  body: string
  actionHref: string
  email: { subject: string; html: string }
}

const BODY_MAX = 300

export function renderLineupCheck(
  leagues: readonly LeagueLineupCheck[],
  opts: { baseUrl?: string | null } = {},
): LineupCheckMessage | null {
  const withIssues = leagues.filter((l) => l.issues.length > 0)
  if (withIssues.length === 0) return null
  const fixes = countFixes(withIssues)
  const week = withIssues[0]!.week

  const title =
    withIssues.length === 1
      ? `Chimmy's lineup check: ${plural(fixes, 'fix', 'fixes')} for ${shortName(withIssues[0]!.leagueName)}`
      : `Chimmy's lineup check: ${plural(fixes, 'fix', 'fixes')} across ${withIssues.length} leagues`

  const leagueLine = (l: LeagueLineupCheck) =>
    `${shortName(l.leagueName)}: ${ordered(l.issues).map((i) => describeIssue(i, l.week)).join(' ')}`
  let body = withIssues.map(leagueLine).join('\n')
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`

  const actionHref = lineupCheckHref(withIssues[0]!.leagueId)
  const base = opts.baseUrl ?? ''

  const blocks = withIssues
    .map((l) => {
      const lines = ordered(l.issues)
        .map((i) => `<div style="margin:0 0 6px 0;color:#d4d4d8">• ${escapeHtml(describeIssue(i, l.week))}</div>`)
        .join('')
      const ask = `<a href="${escapeHtml(`${base}${lineupCheckHref(l.leagueId, 'lineup_check_email')}`)}" style="color:#ffffff;font-weight:700;text-decoration:underline">Ask Chimmy to set this lineup →</a>`
      return `<div style="margin:0 0 16px 0">
  <div style="font-size:15px;font-weight:800;color:#ffffff;margin:0 0 6px 0">${escapeHtml(l.leagueName.trim() || 'Your league')}</div>
  ${lines}
  <div style="margin-top:4px">${ask}</div>
</div>`
    })
    .join('')

  const html = renderDigestEmail({
    eyebrow: `Chimmy · Week ${week} lineup check`,
    title:
      fixes === 1
        ? 'I found one thing to fix before kickoff'
        : `I found ${fixes} things to fix before kickoff`,
    sub: "Your lineups against this week's projections, scored under each league's own rules. Players whose games have started are left alone.",
    bodyHtml: blocks + pushSetupEmailLine(escapeHtml(base)),
    cta: { href: `${base}${lineupCheckHref(withIssues[0]!.leagueId, 'lineup_check_email')}`, label: 'Open Chimmy' },
    baseUrl: opts.baseUrl ?? null,
  })

  return { title, body, actionHref, email: { subject: title, html } }
}
