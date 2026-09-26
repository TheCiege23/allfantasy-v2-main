import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type {
  GradedTrade,
  TradePickAsset,
  TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'
// Type-only: the grade is computed by the caller, never here. This module renders.
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import {
  LEAGUE_TYPE_DECIDES_GRADES,
  LEAGUE_TYPE_GRADES_EXPLAINER,
  leagueTypeSourceText,
  type LeagueTypeBasis,
} from '@/lib/league/leagueTypeGrading'
// Type-only for the same reason: the scanner is `server-only`.
import type { PendingTradeAsset } from '@/lib/provider-trades/scanPendingSleeperTrades'

/**
 * The trade emails — "your league just traded" and "a trade is waiting on you".
 *
 * 🛑 THE LETTER IS THE APP'S LETTER, AND THIS MODULE COMPUTES NONE (Guap, 2026-09-25: "the trade
 * emails need to match the grade from the system"). Both builders take a `TradeGradeView` the caller
 * produced with the SAME function the app runs for the same deal, on the RECIPIENT'S OWN copy of the
 * league:
 *   - a completed trade: `oneGradeForCompletedTrade(<recipient's row>, …)`, as /core Trades and the
 *     home band do;
 *   - an offer: `gradeDeal(createLeagueTradeGrader({ leagueId: <row>, userId }), viewerSide: true)`,
 *     as the /core Trades inbox does.
 *
 * Until 2026-09-25 the completed email was a second grader. It priced the deal on whichever copy of
 * the league `findFirst` returned (one Sleeper league is one row per importer), so a manager read
 * B (+24%) in the inbox and A (+25%) in the app for the same trade; it printed an "uncertainty" from
 * a blended value no screen uses, labelled market letters "projected on 2025 production", and
 * explained them with the realized-POINTS scale (A ≥ 100 net), which is a different grade entirely.
 * All of that is gone. What remains is the one grade, the values it was taken on, and the league type
 * it was priced under.
 *
 * Email HTML rules: tables not flex, inline styles only, solid hex (Outlook's Word engine drops rgba),
 * 640px max, no external assets, and no named HTML entities in the source — ` ` / `·` are
 * written as characters, because an entity escaped twice reaches the reader as literal text.
 */

// Nocturne dark — the family `lib/notifications/designedEmail.ts` and the draft emails share.
const BG = '#0b0b0f'
const CARD = '#15151c'
const CARD_RAISED = '#1b1b24'
const BORDER = '#262631'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const GOT_ACCENT = '#4ade80'
const ASK_ACCENT = '#fbbf24'
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

const GRADE_COLORS: Record<GradeLetter, { bg: string; fg: string }> = {
  A: { bg: '#123524', fg: '#4ade80' },
  B: { bg: '#0f2f3d', fg: '#38bdf8' },
  C: { bg: '#2a2416', fg: '#fbbf24' },
  D: { bg: '#33200f', fg: '#fb923c' },
  F: { bg: '#331417', fg: '#f87171' },
}
const NO_GRADE_COLORS = { bg: '#1f1f27', fg: '#a1a1aa' }

/*
 * What each letter means for the side holding it. Read off the letter, so it cannot disagree with it;
 * worded about the DEAL, because the same line sits under a manager who is not the reader.
 */
const LETTER_WORDS: Record<GradeLetter, string> = {
  A: 'Clear win on value',
  B: 'Came out ahead',
  C: 'Even on value',
  D: 'Gave up some value',
  F: 'Clear overpay',
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The season the realized engine graded — seasonNets[0]. */
function gradedSeason(side: TradeSideGrade): string | null {
  return side.seasonNets[0]?.season ?? null
}

export type SideMath = {
  season: string | null
  got: number
  gave: number
  net: number
  partial: boolean
}

/** Realized fantasy points each way for one side. Kept for `hasNoSignal`; no email prints it. */
export function sideMath(side: TradeSideGrade): SideMath {
  const season = gradedSeason(side)
  const credited = (players: TradeSideGrade['playersIn'], picks: TradePickAsset[]) =>
    season == null
      ? 0
      : players.reduce((acc, a) => acc + (a.creditedBySeason[season] ?? 0), 0) +
        picks.reduce((acc, p) => acc + (p.resolved?.creditedBySeason[season] ?? 0), 0)
  const got = credited(side.playersIn, side.picksIn)
  const gave = credited(side.playersOut, side.picksOut)
  return {
    season,
    got: Math.round(got * 10) / 10,
    gave: Math.round(gave * 10) / 10,
    net: Math.round((got - gave) * 10) / 10,
    partial: side.seasonNets[0]?.partial ?? false,
  }
}

/** True when not a single point has been credited to anybody in the trade. */
export function hasNoSignal(trade: GradedTrade): boolean {
  return trade.sides.every((side) => {
    const m = sideMath(side)
    return m.got === 0 && m.gave === 0
  })
}

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** "+25%" / "−25%" / "Dead even" — the gap from one side's view, with a real minus sign. */
function gapText(pct: number): string {
  if (pct === 0) return 'Dead even'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% value`
}

/** The same gap, short enough for a half-width column on a phone: "+25%" / "−25%" / "Even". */
function gapShort(pct: number): string {
  if (pct === 0) return 'Even'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

function pickName(pick: TradePickAsset): string {
  return Number.isFinite(pick.round) && pick.round > 0 ? `${pick.season} ${ordinal(pick.round)} round pick` : pick.label
}

function pickDetail(pick: TradePickAsset): string {
  if (pick.rerouted) return 'Traded again before the draft'
  if (pick.resolved?.name) return `Drafted: ${pick.resolved.name}`
  return 'Draft pick'
}

type Line = { name: string; detail: string | null; value: number | null }

/** One side's received assets, in the order the grader priced them (players, then picks). */
function receivedLines(side: TradeSideGrade, values: ReadonlyArray<number | null> | null): Line[] {
  const lines: Line[] = [
    ...side.playersIn.map((p) => ({ name: p.name, detail: p.position, value: null as number | null })),
    ...side.picksIn.map((p) => ({ name: pickName(p), detail: pickDetail(p), value: null as number | null })),
  ]
  // Index-aligned only when the counts agree; a mismatch prints names without values, never shifted ones.
  if (values && values.length === lines.length) lines.forEach((l, i) => (l.value = values[i] ?? null))
  return lines
}

function chip(letter: GradeLetter | null, size = 40): string {
  const colors = letter ? GRADE_COLORS[letter] : NO_GRADE_COLORS
  const fontSize = Math.round(size * 0.55)
  return (
    `<div style="width:${size}px;height:${size}px;line-height:${size}px;background:${colors.bg};color:${colors.fg};` +
    `border-radius:${Math.round(size / 4)}px;font-size:${fontSize}px;font-weight:800;text-align:center">${letter ?? '–'}</div>`
  )
}

function eyebrow(text: string, color = FAINT): string {
  return `<div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${color};font-weight:700">${escapeHtml(text)}</div>`
}

function assetTable(lines: Line[], total: number | null): string {
  const rows = (lines.length === 0 ? [{ name: 'Nothing', detail: null, value: null }] : lines).map(
    (l) =>
      `<tr><td style="padding:5px 0;font-size:13px;line-height:1.35;color:${TEXT};font-weight:600">${escapeHtml(l.name)}` +
      (l.detail ? `<div style="font-size:11px;font-weight:400;color:${FAINT};margin-top:1px">${escapeHtml(l.detail)}</div>` : '') +
      `</td><td align="right" valign="top" style="padding:5px 0 5px 8px;font-size:13px;color:${MUTED};white-space:nowrap">` +
      `${l.value == null ? '' : escapeHtml(fmtValue(l.value))}</td></tr>`,
  )
  const totalRow =
    total == null
      ? ''
      : `<tr><td style="padding:7px 0 0 0;border-top:1px solid ${BORDER};font-size:11px;color:${FAINT};text-transform:uppercase;letter-spacing:0.08em;font-weight:700">Total</td>` +
        `<td align="right" style="padding:7px 0 0 8px;border-top:1px solid ${BORDER};font-size:13px;color:${TEXT};font-weight:800;white-space:nowrap">${escapeHtml(fmtValue(total))}</td></tr>`
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:6px">${rows.join('')}${totalRow}</table>`
}

type SideView = {
  side: TradeSideGrade
  letter: GradeLetter | null
  /** The gap from THIS side's view, whole percent. Null when there is no grade. */
  pct: number | null
  lines: Line[]
  total: number | null
  isViewer: boolean
}

/**
 * Each side's letter and received values, read off ONE grade taken from side one's view: side one
 * holds `letter` and receives the `get` lines; side two holds the mirror and receives `give`.
 */
function sideViews(trade: GradedTrade, grade: TradeGradeView | null, viewerOwnerId: string | null): SideView[] {
  const g = grade && grade.graded && trade.sides.length === 2 ? grade : null
  const valuesOf = (side: 'give' | 'get') => (g ? g.lines.filter((l) => l.side === side).map((l) => l.leagueValue) : null)
  return trade.sides.map((side, i) => ({
    side,
    letter: g ? (i === 0 ? g.letter : g.partnerLetter) : null,
    pct: g ? (i === 0 ? g.percentDiff : -g.percentDiff) : null,
    lines: receivedLines(side, i === 0 ? valuesOf('get') : valuesOf('give')),
    total: g ? (i === 0 ? g.getValue : g.giveValue) : null,
    isViewer: Boolean(viewerOwnerId) && side.ownerId != null && String(side.ownerId) === String(viewerOwnerId),
  }))
}

function youPill(): string {
  return `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:6px;background:${GOT_ACCENT};color:#0b0b0f;font-size:9px;font-weight:800;letter-spacing:0.08em;vertical-align:2px">YOU</span>`
}

function sideColumn(view: SideView): string {
  const { side } = view
  const verdict =
    view.letter && view.pct != null
      ? `<div style="font-size:18px;font-weight:800;color:${GRADE_COLORS[view.letter].fg};white-space:nowrap">${escapeHtml(gapShort(view.pct))}</div>` +
        `<div style="font-size:11px;color:${MUTED};margin-top:2px">${escapeHtml(LETTER_WORDS[view.letter])}</div>`
      : `<div style="font-size:13px;font-weight:700;color:${MUTED}">Not graded</div>`
  return (
    `<div style="font-size:14px;font-weight:800;color:${TEXT};line-height:1.3">${escapeHtml(side.managerName)}${view.isViewer ? youPill() : ''}</div>` +
    (side.teamName && side.teamName !== side.managerName
      ? `<div style="font-size:11px;color:${FAINT};margin-top:1px">${escapeHtml(side.teamName)}</div>`
      : '') +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:12px"><tr>` +
    `<td valign="middle">${chip(view.letter)}</td>` +
    `<td valign="middle" style="padding-left:12px">${verdict}</td>` +
    `</tr></table>` +
    `<div style="margin-top:16px">${eyebrow('Receives', GOT_ACCENT)}</div>` +
    assetTable(view.lines, view.total)
  )
}

/** Two sides side by side; any other count (a three-team deal) one per row. */
function sidesCard(views: SideView[]): string {
  const cell = (view: SideView, last: boolean, width: string) =>
    `<td width="${width}" valign="top" style="padding:18px 16px;${last ? '' : `border-right:1px solid ${BORDER};`}${view.isViewer ? `background:${CARD_RAISED};` : ''}">${sideColumn(view)}</td>`
  const body =
    views.length === 2
      ? `<tr>${cell(views[0]!, false, '50%')}${cell(views[1]!, true, '50%')}</tr>`
      : views
          .map(
            (v, i) =>
              `<tr><td valign="top" style="padding:18px 16px;${i > 0 ? `border-top:1px solid ${BORDER};` : ''}${v.isViewer ? `background:${CARD_RAISED};` : ''}">${sideColumn(v)}</td></tr>`,
          )
          .join('')
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;border-collapse:separate;overflow:hidden">${body}</table>`
}

function card(inner: string, accent: string | null = null): string {
  return (
    `<tr><td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};` +
    `${accent ? `border-left:3px solid ${accent};` : ''}border-radius:14px">${inner}</td></tr>` +
    `<tr><td style="height:12px"></td></tr>`
  )
}

/**
 * The league type the grade was priced under, and — unless someone confirmed it — the ask to.
 *
 * ⚠ THIS IS THE ONE PLACE THE EMAIL ASKS FOR SOMETHING (Guap, 2026-09-25: the manager must be told how
 * much their league type matters). Same words and same `#league-type` anchor as the app's
 * `LeagueTypeGradeNote`, so the inbox and the screen make one request, not two.
 */
function leagueTypeCard(basis: LeagueTypeBasis | null | undefined, confirmUrl: string | null): string {
  if (!basis) return ''
  const heading = `${eyebrow('League type')}<div style="font-size:14px;font-weight:700;color:${TEXT};margin-top:4px">${escapeHtml(basis.label)}<span style="font-size:12px;font-weight:400;color:${FAINT}"> · ${escapeHtml(leagueTypeSourceText(basis))}</span></div>`
  if (basis.source === 'confirmed') return card(heading)
  const link = confirmUrl
    ? `<div style="margin-top:10px"><a href="${escapeHtml(confirmUrl)}" style="color:${ASK_ACCENT};font-size:13px;font-weight:700;text-decoration:underline">Confirm your league type</a></div>`
    : ''
  return card(
    heading +
      `<div style="font-size:12.5px;line-height:1.6;color:${MUTED};margin-top:8px">${escapeHtml(LEAGUE_TYPE_DECIDES_GRADES)} ${escapeHtml(LEAGUE_TYPE_GRADES_EXPLAINER)}</div>` +
      link,
    ASK_ACCENT,
  )
}

/** Hidden inbox preview text. Without it the client previews the first visible words — the eyebrow. */
function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};font-size:1px;line-height:1px">${escapeHtml(text)}</div>`
}

function cta(href: string, label: string, note: string | null = null): string {
  return (
    `<tr><td align="center" style="padding:10px 0 6px 0">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;font-size:14px;padding:13px 22px;border-radius:12px">${escapeHtml(label)}</a>` +
    (note ? `<div style="font-size:11px;color:${FAINT};margin-top:9px;line-height:1.5">${note}</div>` : '') +
    `</td></tr>`
  )
}

/**
 * The footer, including the PER-LEAGUE mute. At 61 leagues a global unsubscribe is not a real choice:
 * silencing one noisy league should not cost every trade email a manager actually wants. The mute link
 * lands on the notifications settings page with the league in the query; there is no one-click
 * per-user-per-league endpoint yet.
 */
function emailFooter(params: {
  baseUrl: string
  leagueName: string
  leagueId: string | null
  /** Signed global unsubscribe URL. Omitted when we cannot mint one. */
  unsubscribeUrl: string | null
}): string {
  const muteHref = params.leagueId
    ? `${params.baseUrl}/settings?tab=notifications&league=${encodeURIComponent(params.leagueId)}`
    : `${params.baseUrl}/settings?tab=notifications`
  const link = (href: string, text: string) =>
    `<a href="${escapeHtml(href)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(text)}</a>`
  return `
<tr>
  <td style="padding-top:16px;border-top:1px solid ${BORDER};color:${FAINT};font-size:11px;line-height:1.7">
    AllFantasy.ai<br>
    ${link(muteHref, `Mute ${params.leagueName}`)}
     ·
    ${link(`${params.baseUrl}/settings?tab=notifications`, 'Change preferences')}
    ${params.unsubscribeUrl ? ` · ${link(params.unsubscribeUrl, 'Unsubscribe from all')}` : ''}
  </td>
</tr>`
}

function shell(args: { preheader: string; eyebrow: string; title: string; sub: string | null; rows: string; footer: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
${preheader(args.preheader)}
<div style="background:${BG};padding:24px 12px;font-family:${FONT};color:${TEXT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
    <tr>
      <td style="padding-bottom:16px">
        <div style="font-size:12px;font-weight:800;color:${TEXT};letter-spacing:0.02em;margin-bottom:14px">AllFantasy</div>
        ${eyebrow(args.eyebrow)}
        <div style="font-size:22px;font-weight:800;color:${TEXT};margin-top:5px;line-height:1.25">${escapeHtml(args.title)}</div>
        ${args.sub ? `<div style="font-size:13px;color:${MUTED};margin-top:4px;line-height:1.5">${escapeHtml(args.sub)}</div>` : ''}
      </td>
    </tr>
    ${args.rows}
    ${args.footer}
  </table>
</div>
</body>
</html>`
}

export type TradeGradeEmail = { subject: string; html: string }

/** Up to four names from the deal for the subject line, players first. */
function dealNames(trade: GradedTrade): string {
  const names: string[] = []
  for (const side of trade.sides) for (const p of side.playersIn) if (p.name && !names.includes(p.name)) names.push(p.name)
  for (const side of trade.sides) {
    for (const p of side.picksIn) {
      const n = Number.isFinite(p.round) && p.round > 0 ? `${p.season} ${ordinal(p.round)}` : p.label
      if (!names.includes(n)) names.push(n)
    }
  }
  if (names.length === 0) return ''
  const shown = names.slice(0, 4)
  const extra = names.length - shown.length
  return `${shown.join(', ')}${extra > 0 ? ` +${extra}` : ''}`
}

/**
 * "Your league just traded" — the one grade, for the recipient's copy of the league.
 *
 * ⚠ THE GRADE IS SIDE ONE'S VIEW OF THE DEAL (`oneGradeForCompletedTrade`): side one holds `letter`
 * and receives the `get` lines, side two holds `partnerLetter` — the exact mirror — and receives
 * `give`. A null or withheld grade prints no letter at all and says why, never a neutral one.
 */
export function buildTradeGradeEmail(params: {
  leagueName: string
  trade: GradedTrade
  ledgerUrl: string
  /** THE grade for this recipient's copy of the league. Null when it could not be computed. */
  grade: TradeGradeView | null
  /**
   * ⚠ "completed" vs "offered" is the news in the subject line, and a manager at 61 leagues reads the
   * subject instead of opening the mail — so a deal still awaiting their answer must never be called
   * completed. Defaults to 'complete'; open offers normally go through `buildPendingTradeOfferEmail`.
   */
  status?: 'complete' | 'pending'
  /** The league type the grade was priced under. Defaults to the one the grade carries. */
  leagueType?: LeagueTypeBasis | null
  /** The recipient's Sleeper user id; their side is marked "You" and shown first. */
  viewerOwnerId?: string | null
  /** The recipient's league-type control (`/core?league=<row>#league-type`). */
  confirmUrl?: string | null
  /** Absolute origin for the footer. Falls back to the ledger URL's origin. */
  baseUrl?: string
  /** Powers the per-league mute link. */
  leagueId?: string | null
  /** Signed global unsubscribe URL. Omit and that link is left out. */
  unsubscribeUrl?: string | null
}): TradeGradeEmail {
  const { leagueName, trade, ledgerUrl, grade } = params
  const baseUrl = params.baseUrl ?? (() => {
    try {
      return new URL(ledgerUrl).origin
    } catch {
      return ''
    }
  })()
  const graded = grade && grade.graded && trade.sides.length === 2 ? grade : null
  const views = sideViews(trade, grade, params.viewerOwnerId ?? null)
  // The reader's side first: the email is about their deal before it is about anyone else's.
  const ordered = [...views].sort((a, b) => Number(b.isViewer) - Number(a.isViewer))
  const viewer = views.find((v) => v.isViewer) ?? null
  const leagueType = params.leagueType ?? grade?.leagueType ?? null

  const names = dealNames(trade)
  const namePart = names ? ` — ${names}` : ''
  const letters = graded
    ? ordered.map((v) => `${v.isViewer ? 'you' : v.side.managerName} ${v.letter}`).join(', ')
    : 'not graded'
  const verb = params.status === 'pending' ? 'offered' : 'completed'
  const subject = `Trade ${verb} in ${leagueName} — ${letters}${namePart}`

  const withheldReason = graded
    ? null
    : grade && !grade.graded
      ? grade.reason
      : trade.sides.length !== 2
        ? 'Only two-team trades are graded — one value gap cannot give three teams a letter each.'
        : 'This league’s values could not be loaded just now.'
  const basis = (graded?.basis || grade?.basis || '').trim()
  const summary = graded
    ? ordered.map((v) => `${v.isViewer ? 'You' : v.side.managerName}: ${v.letter} (${gapText(v.pct ?? 0)})`).join(' · ')
    : `Not graded: ${withheldReason}`

  const hasPicks = trade.sides.some((s) => s.picksIn.length > 0)
  const how = graded
    ? `Each side is graded on what it received against what it sent, on ${basis ? `${basis} ` : 'this league’s '}values as of today — the same grade AllFantasy shows for this trade. Roster fit is not counted: both teams already hold the result.` +
      (hasPicks ? ' Picks are valued on where they are expected to land, so a bad season by the team that owes one moves this grade.' : '')
    : `${withheldReason} No letter is shown rather than one drawn from part of the deal.`

  const rows =
    `<tr><td>${sidesCard(ordered)}</td></tr><tr><td style="height:12px"></td></tr>` +
    card(`${eyebrow(graded ? 'How this is graded' : 'Why there is no grade')}<div style="font-size:13px;line-height:1.6;color:${MUTED};margin-top:6px">${escapeHtml(how)}</div>`) +
    leagueTypeCard(leagueType, params.confirmUrl ?? null) +
    cta(ledgerUrl, 'See the trade in AllFantasy', escapeHtml('Every asset, and the value behind each letter.'))

  const weekPart = Number.isFinite(trade.week) && trade.week > 0 ? ` · week ${trade.week}` : ''
  const html = shell({
    preheader: summary,
    eyebrow: `Trade ${verb} · ${trade.season}${weekPart}`,
    title: leagueName,
    sub: viewer && viewer.letter ? `Your side graded ${viewer.letter} — ${LETTER_WORDS[viewer.letter].toLowerCase()}.` : null,
    rows,
    footer: emailFooter({ baseUrl, leagueName, leagueId: params.leagueId ?? null, unsubscribeUrl: params.unsubscribeUrl ?? null }),
  })
  return { subject, html }
}

/**
 * A Sleeper trade OFFER still waiting on the recipient.
 *
 * 🛑 NOT `buildTradeGradeEmail` WITH A PENDING FLAG. That builder takes a trade from the graded
 * ledger, which reads COMPLETED trades only, so an offer is never in it; the offer is built from the
 * feed row and says only what the feed can prove.
 *
 * ⚠ THE GRADE IS THE ONE THE /core TRADES INBOX SHOWS FOR THIS OFFER — `gradeDeal` on the
 * recipient's own league row with `viewerSide: true`, so it is from their side and counts their roster
 * need exactly as the screen does. Optional: without it the email carries the swap and sends the
 * manager to the read, as it always did.
 *
 * ⚠ AND NO "ACCEPT" BUTTON. Sleeper's API has no write endpoint; the only honest action is a link to
 * Sleeper's own trade screen, labelled as such.
 */
export function buildPendingTradeOfferEmail(params: {
  leagueName: string
  /** Display name of whoever proposed it, or null when Sleeper did not say. */
  proposerName: string | null
  youGet: PendingTradeAsset[]
  youGive: PendingTradeAsset[]
  /** The recipient's OWN league page for this offer. */
  reviewUrl: string
  /** Sleeper's trade screen, only when the link is verified. */
  sleeperUrl?: string | null
  /** THE grade for this offer from the recipient's side (`give` = what they send). */
  grade?: TradeGradeView | null
  /** The league type the grade was priced under. Defaults to the one the grade carries. */
  leagueType?: LeagueTypeBasis | null
  /** The recipient's league-type control (`/core?league=<row>#league-type`). */
  confirmUrl?: string | null
  baseUrl: string
  leagueId?: string | null
  unsubscribeUrl?: string | null
}): TradeGradeEmail {
  const { leagueName } = params
  const names = (assets: PendingTradeAsset[]) => {
    const shown = assets.slice(0, 3).map((a) => a.playerName)
    const extra = assets.length - shown.length
    return shown.length > 0 ? `${shown.join(', ')}${extra > 0 ? ` +${extra}` : ''}` : 'nothing'
  }
  const who = params.proposerName?.trim() || 'Another manager'
  const g = params.grade && params.grade.graded ? params.grade : null
  const subject = `Trade offer in ${leagueName} — ${g ? `${g.letter} for you: ` : ''}you get ${names(params.youGet)} for ${names(params.youGive)}`

  const linesOf = (assets: PendingTradeAsset[], side: 'give' | 'get'): Line[] => {
    const values = g ? g.lines.filter((l) => l.side === side).map((l) => l.leagueValue) : null
    const lines = assets.map((a) => ({
      name: a.playerName,
      detail: a.isPick ? 'Draft pick' : a.faabAmount != null ? 'FAAB' : [a.position, a.team].filter((v) => v && v !== '—').join(' · ') || null,
      value: null as number | null,
    }))
    if (values && values.length === lines.length) lines.forEach((l, i) => (l.value = values[i] ?? null))
    return lines
  }
  const cell = (label: string, accent: string, lines: Line[], total: number | null, divider: boolean) =>
    `<td width="50%" valign="top" style="padding:16px;${divider ? `border-right:1px solid ${BORDER};` : ''}">${eyebrow(label, accent)}${assetTable(lines, total)}</td>`
  const swap =
    `<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;border-collapse:separate"><tr>` +
    cell('You get', GOT_ACCENT, linesOf(params.youGet, 'get'), g ? g.getValue : null, true) +
    cell('You give', MUTED, linesOf(params.youGive, 'give'), g ? g.giveValue : null, false) +
    `</tr></table></td></tr><tr><td style="height:12px"></td></tr>`

  const verdict = g
    ? `<tr><td style="padding:16px;background:${CARD};border:1px solid ${BORDER};border-radius:16px">` +
      `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td valign="middle">${chip(g.letter, 48)}</td>` +
      `<td valign="middle" style="padding-left:14px">${eyebrow('Our read, from your side')}` +
      `<div style="font-size:17px;font-weight:800;color:${GRADE_COLORS[g.letter].fg};margin-top:3px">${escapeHtml(g.label)} · ${escapeHtml(gapText(g.percentDiff))}</div></td></tr></table>` +
      `<div style="font-size:13px;line-height:1.6;color:${MUTED};margin-top:12px">${escapeHtml(g.recommendation)}</div>` +
      `<div style="font-size:11px;line-height:1.5;color:${FAINT};margin-top:6px">${escapeHtml(`On ${g.basis ? `${g.basis} ` : 'this league’s '}values as of today${g.needApplied ? ', counting how it fits your roster' : ''}; values at email time. The site uses the same evaluator with the latest data. Realized fantasy points after a completed trade are a separate result.`)}</div>` +
      `</td></tr><tr><td style="height:12px"></td></tr>`
    : params.grade && !params.grade.graded
      ? card(`${eyebrow('Not graded')}<div style="font-size:13px;line-height:1.6;color:${MUTED};margin-top:6px">${escapeHtml(params.grade.reason)}</div>`)
      : ''

  const leagueType = params.leagueType ?? params.grade?.leagueType ?? null
  const sleeperNote =
    (params.sleeperUrl
      ? `<a href="${escapeHtml(params.sleeperUrl)}" style="color:${MUTED};text-decoration:underline;font-size:12px">Answer it in Sleeper</a><br>`
      : '') + escapeHtml('AllFantasy can’t accept or decline a Sleeper trade. You answer it in Sleeper.')

  const html = shell({
    preheader: g
      ? `${g.letter} for you (${gapText(g.percentDiff)}) — you get ${names(params.youGet)} for ${names(params.youGive)}.`
      : `You get ${names(params.youGet)} for ${names(params.youGive)}.`,
    eyebrow: 'Trade offer · waiting on you',
    title: leagueName,
    sub: `${who} sent you an offer on Sleeper.`,
    rows: verdict + swap + leagueTypeCard(leagueType, params.confirmUrl ?? null) + cta(params.reviewUrl, 'See our read on this offer', sleeperNote),
    footer: emailFooter({ baseUrl: params.baseUrl, leagueName, leagueId: params.leagueId ?? null, unsubscribeUrl: params.unsubscribeUrl ?? null }),
  })
  return { subject, html }
}
