import type { WaiverBoardRow, WaiverPlayer } from '@/lib/core-app/waiversBoard'
import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'
import { preferenceMuteReason, type ChimmyAlertPreferenceMuteReason } from './ChimmyAlertSuppressionEngine'
import type { ScheduledGame } from './lineupCheck'
import { chimmyChatHref, pushSetupEmailLine, type ProactiveFrom } from './proactiveLinks'
import type { ChimmyAlertUserPreferences } from './types'

/**
 * CHIMMY'S WAIVER CHECK — the second weekly message (owner's call 2026-09-24: "start on 1 and 2").
 *
 * On Tuesday, once last week is played and the projection feed has moved to the week ahead,
 * Chimmy tells each manager the best pickup on each of their wires — when it is worth a claim.
 *
 * The numbers are the /core Waivers board's (`getWaiversBoard`), not new maths: the best player
 * nobody in the league rosters, against the weakest bench player we can price, both scored under
 * that league's own rules for the coming week. No model call, so it costs nothing to run for every
 * manager, and every figure in the message is one that screen would show.
 *
 * ── 🛑 ONLY A REAL SWAP, ONLY WHEN IT IS WORTH A CLAIM ─────────────────────────────────────────
 *   - a DROP must be priced. The board also reports a gross figure when no bench player could be
 *     priced; "add him" with nothing to drop is not a move anyone can make on a full roster;
 *   - the net gain must reach WAIVER_CHECK_MIN_GAIN projected points for the week. Less than that
 *     is inside projection noise, and a Tuesday message about noise teaches people to ignore
 *     Tuesday messages.
 *
 * ── WHAT IT CANNOT KNOW, AND SAYS ──────────────────────────────────────────────────────────────
 * Unrostered is not the same as claimable, and rosters are as of the last sync — the email says
 * both, and its link asks Chimmy to price the exact move, which re-reads the league first.
 *
 * ── WHEN ───────────────────────────────────────────────────────────────────────────────────────
 * No league's real waiver day is on file (`LeagueWaiverSettings` timing is our creation default,
 * and no Sleeper import carries `waiver_day_of_week` — measured 2026-09-24). So the window is keyed
 * on the SCHEDULE: from 60h to 12h before the coming week's first kickoff — Tuesday midday ET for
 * a Thursday opener — and never while last week is still being played.
 */

/** A swap must gain this many projected points for the week before Chimmy messages about it. */
export const WAIVER_CHECK_MIN_GAIN = 2
/** Leagues named in one message; the rest are a tap away on the Waivers board. */
export const WAIVER_CHECK_MAX_LEAGUES = 5

export const WAIVER_CHECK_OPENS_BEFORE_MS = 60 * 60 * 60 * 1000
export const WAIVER_CHECK_CLOSES_BEFORE_MS = 12 * 60 * 60 * 1000
/** Last week's final game must have kicked off at least this long ago — it is over, not in play. */
export const LAST_WEEK_SETTLED_AFTER_MS = 4 * 60 * 60 * 1000

/** The alert type, as the Chimmy alert controls name types they can mute. */
export const WAIVER_CHECK_ALERT_TYPE = 'waiver_check'

/* ── When ─────────────────────────────────────────────────────────────────────────────────────── */

export function firstKickoff(games: readonly ScheduledGame[]): Date | null {
  let first: number | null = null
  for (const g of games) {
    const t = g.startTime?.getTime()
    if (t == null || !Number.isFinite(t)) continue
    if (first == null || t < first) first = t
  }
  return first == null ? null : new Date(first)
}

export function lastKickoff(games: readonly ScheduledGame[]): Date | null {
  let last: number | null = null
  for (const g of games) {
    const t = g.startTime?.getTime()
    if (t == null || !Number.isFinite(t)) continue
    if (last == null || t > last) last = t
  }
  return last == null ? null : new Date(last)
}

export type WaiverCheckWindow = 'early' | 'open' | 'closed'

export function waiverCheckWindow(args: {
  /** The coming week's first kickoff. */
  firstKickoff: Date
  /** Last week's final kickoff, when known. */
  previousLastKickoff: Date | null
  now: Date
}): WaiverCheckWindow {
  const until = args.firstKickoff.getTime() - args.now.getTime()
  if (until > WAIVER_CHECK_OPENS_BEFORE_MS) return 'early'
  if (until < WAIVER_CHECK_CLOSES_BEFORE_MS) return 'closed'
  const prev = args.previousLastKickoff
  if (prev && args.now.getTime() < prev.getTime() + LAST_WEEK_SETTLED_AFTER_MS) return 'early'
  return 'open'
}

/* ── What ─────────────────────────────────────────────────────────────────────────────────────── */

export type WaiverPick = {
  leagueId: string
  leagueName: string
  week: number
  add: WaiverPlayer
  drop: WaiverPlayer
  netGain: number
  faabRemaining: number | null
}

/** The board's rows worth a message: a priced swap, gaining enough, best first, capped. */
export function selectWaiverPicks(
  rows: readonly WaiverBoardRow[],
  week: number,
  opts: { minGain?: number; max?: number } = {},
): WaiverPick[] {
  const minGain = opts.minGain ?? WAIVER_CHECK_MIN_GAIN
  const max = opts.max ?? WAIVER_CHECK_MAX_LEAGUES
  return rows
    .filter((r): r is WaiverBoardRow & { drop: WaiverPlayer } => r.drop != null && Number.isFinite(r.netGain) && r.netGain >= minGain)
    .sort((a, b) => b.netGain - a.netGain || (a.leagueId < b.leagueId ? -1 : 1))
    .slice(0, max)
    .map((r) => ({
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      week,
      add: r.add,
      drop: r.drop,
      netGain: r.netGain,
      faabRemaining: r.faabRemaining,
    }))
}

/* ── Whether you asked not to hear it ─────────────────────────────────────────────────────────── */

/** The Chimmy alert controls' Waivers class, the type, or a league — the engine's own rule. */
export function waiverCheckMutedBy(
  prefs: ChimmyAlertUserPreferences | null | undefined,
  leagueId?: string | null,
): ChimmyAlertPreferenceMuteReason | null {
  return preferenceMuteReason({ class: 'waiver', type: WAIVER_CHECK_ALERT_TYPE, leagueId: leagueId ?? null }, prefs)
}

/* ── Where it lands ───────────────────────────────────────────────────────────────────────────── */

/** `chimmy-waiver-check:<season>-w<week>` — one per user per week; the dispatcher appends `:<userId>`. */
export function waiverCheckDedupeKey(season: string | number, week: number): string {
  return `chimmy-waiver-check:${season}-w${week}`
}

/** The exact move, asked of Chimmy — which prices it against the lineup after re-reading the league. */
export function waiverCheckPrompt(pick: Pick<WaiverPick, 'add' | 'drop'>): string {
  return `Should I pick up ${pick.add.name} and drop ${pick.drop.name}?`
}

export function waiverCheckHref(pick: WaiverPick, from: ProactiveFrom = 'waiver_check'): string {
  return chimmyChatHref({ prompt: waiverCheckPrompt(pick), leagueId: pick.leagueId, from })
}

/** The Waivers board, opened on that league — the full wire, not just Chimmy's pick. */
export function waiverBoardHref(leagueId: string): string {
  return `/core/waivers?league=${encodeURIComponent(leagueId)}`
}

/* ── What it says ─────────────────────────────────────────────────────────────────────────────── */

const fmt = (n: number) => n.toFixed(1)

function who(p: WaiverPlayer): string {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}

function shortName(name: string): string {
  const t = name.trim() || 'your league'
  return t.length > 32 ? `${t.slice(0, 31)}…` : t
}

/** "add X (RB, PIT), drop Y — +4.3 projected pts in week 4 · $57 FAAB left." */
export function describePick(p: WaiverPick): string {
  const faab = p.faabRemaining != null ? ` · $${p.faabRemaining} FAAB left` : ''
  return `add ${who(p.add)}, drop ${p.drop.name} — +${fmt(p.netGain)} projected pts in week ${p.week}${faab}.`
}

export type WaiverCheckMessage = {
  title: string
  body: string
  actionHref: string
  email: { subject: string; html: string }
}

const BODY_MAX = 300

export function renderWaiverCheck(
  picks: readonly WaiverPick[],
  opts: { baseUrl?: string | null } = {},
): WaiverCheckMessage | null {
  if (picks.length === 0) return null
  const top = picks[0]!
  const week = top.week

  const title =
    picks.length === 1
      ? `Chimmy's waiver pick for ${shortName(top.leagueName)}: ${top.add.name} (+${fmt(top.netGain)} pts)`
      : `Chimmy's waiver picks: ${picks.length} upgrades across your leagues`

  let body = picks.map((p) => `${shortName(p.leagueName)}: ${describePick(p)}`).join('\n')
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`

  const base = opts.baseUrl ?? ''
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(`${base}${href}`)}" style="color:#ffffff;font-weight:700;text-decoration:underline">${escapeHtml(label)}</a>`

  const blocks = picks
    .map((p) => {
      const faab = p.faabRemaining != null ? ` · $${p.faabRemaining} FAAB left` : ''
      return `<div style="margin:0 0 16px 0">
  <div style="font-size:15px;font-weight:800;color:#ffffff;margin:0 0 6px 0">${escapeHtml(p.leagueName.trim() || 'Your league')}</div>
  <div style="margin:0 0 4px 0;color:#d4d4d8">Add <strong style="color:#ffffff">${escapeHtml(who(p.add))}</strong> — ${fmt(p.add.projected)} pts</div>
  <div style="margin:0 0 4px 0;color:#d4d4d8">Drop ${escapeHtml(who(p.drop))} — ${fmt(p.drop.projected)} pts</div>
  <div style="margin:0 0 6px 0;color:#a1a1aa">+${fmt(p.netGain)} projected pts in week ${p.week}${escapeHtml(faab)}</div>
  <div>${link(waiverCheckHref(p, 'waiver_check_email'), 'Ask Chimmy about this move →')} &nbsp; ${link(waiverBoardHref(p.leagueId), 'See the whole wire')}</div>
</div>`
    })
    .join('')

  const html = renderDigestEmail({
    eyebrow: `Chimmy · Week ${week} waiver check`,
    title: picks.length === 1 ? 'One pickup worth a claim' : `${picks.length} pickups worth a claim`,
    sub:
      "The best player nobody rosters in each league, against your weakest bench player we can price — both scored under that league's rules for the week ahead. Rosters as of the last sync, and unrostered isn't always claimable: if he's gone, ask me for the next one.",
    bodyHtml: blocks + pushSetupEmailLine(escapeHtml(base)),
    cta: { href: `${base}${waiverCheckHref(top, 'waiver_check_email')}`, label: 'Ask Chimmy' },
    baseUrl: opts.baseUrl ?? null,
  })

  return { title, body, actionHref: waiverCheckHref(top), email: { subject: title, html } }
}
