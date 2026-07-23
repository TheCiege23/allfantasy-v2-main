'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import { PlayerImage } from '@/app/components/PlayerImage'
import type { LeagueTradeHistoryItem } from '@/components/league/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueTradeBlockPanelItem } from '@/components/league/types'
import { projectedLetterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { GradedTrade, TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'
import { ZombieTradePolicyCard } from '@/components/zombie/ZombieTradePolicyCard'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { isNflRedraftCoreDashboardFromUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { shadowDisclosure } from '@/lib/league/write-authority'
import { ProposeTradeModal } from './ProposeTradeModal'
import { LeagueSurfaceState } from '@/components/league/LeagueSurfaceState'

/**
 * The league Trades tab — design-refs/trade-center-handoff, League artboard.
 *
 * Every trade in this league, and the ones with the viewer's name on them:
 *
 *   1. Needs your action — offers waiting on the viewer, provider offers that
 *      can only be answered on the provider, and reviews waiting on the
 *      commissioner.
 *   2. Your trades — active, then completed with the REALIZED grade.
 *   3. League trade log — every trade this league has made, both sides,
 *      both grades, filterable, with an "only mine" toggle.
 *   4. Trade block — what managers have flagged available.
 *
 * Two reads, both existing routes, fetched in parallel and rendered
 * independently: `/api/league/trades-panel` (pending + native offers + block)
 * and `/api/league/trade-grades` (the completed ledger, graded on realized
 * points; the first build of a league walks every season, so the rest of the
 * tab never waits on it).
 *
 * ⚠ A LETTER OR A REASON, NEVER A LETTER AS A FALLBACK. A pending trade has
 * produced nothing, an imported league's ledger cannot be scored, and a trade
 * with picks still pending is provisional. Each renders an em dash with its
 * reason, never a C that reads as "even".
 *
 * ⚠ ACTION BUTTONS STAY GATED ON THE NFL REDRAFT SHELL, as before. That is the
 * league type whose accept / reject / commissioner path is verified end to end
 * (see lib/redraft/tradeSettlement.ts); showing the buttons elsewhere would
 * promise a settlement the engine has not been proven to make.
 */

export type TradesTabProps = {
  league: UserLeague
  teams: LeagueTeamSlot[]
}

type YourTab = 'active' | 'completed'
type LogFilter = 'all' | 'completed' | 'pending'

type PanelResponse = {
  tradeBlock?: LeagueTradeBlockPanelItem[]
  activeTrades?: LeagueTradeHistoryItem[]
  activeCount?: number
  providerPendingCount?: number
  providerLeagueUrl?: string
  pending?: { scanned: boolean; reason: string | null; platform: string; leagueUrl: string | null }
  /** Provider offers in the shape the builder reloads — structured picks, FAAB and player ids. */
  pendingOffers?: BuilderOffer[]
  error?: string
}

export type BuilderOfferAsset = {
  playerId: string | null
  name: string
  position: string | null
  team: string | null
  isPick: boolean
  pickYear: number | null
  pickRound: number | null
  faabAmount: number | null
}

export type BuilderOffer = {
  transactionId: string
  direction: 'incoming' | 'outgoing'
  partnerName: string
  proposedAt: string | null
  /** From the VIEWER's side in both directions: what leaves their roster. */
  give: BuilderOfferAsset[]
  get: BuilderOfferAsset[]
}

type GradesResponse =
  | { supported: false; platform: string }
  | { supported: true; viewerSleeperUserId: string | null; grades: TradeGradesPayload | null; error?: string }
  | { supported: true; graded: false; viewerSleeperUserId: string | null; ledger: ImportedTradeLedgerPayload }

type LedgerState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'unsupported'; platform: string }
  | { kind: 'ungraded'; ledger: ImportedTradeLedgerPayload }
  | { kind: 'graded'; grades: TradeGradesPayload; viewerId: string | null }

/** One side of a row in the league log. */
type LogSide = {
  name: string
  you: boolean
  sends: string
  grade: GradeLetter | null
  /** Shown INSTEAD of a letter — why there is none. */
  gradeWhy: string | null
}

type LogRow = {
  id: string
  kind: 'pending' | 'completed'
  when: string
  sortKey: number
  a: LogSide
  b: LogSide
  extraSides: number
  status: { label: string; tone: 'warn' | 'violet' | 'good' | 'muted' }
  mine: boolean
  /** Viewer-relative direction, only for the viewer's own rows. */
  direction: 'incoming' | 'outgoing' | 'done' | null
}

function watchStorageKey(leagueId: string): string {
  return `af-league-trade-block-watch-${leagueId}`
}

function readWatchSet(leagueId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(watchStorageKey(leagueId))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.map((x) => String(x)))
  } catch {
    return new Set()
  }
}

function shortDisplayName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return full
  if (parts.length === 1) return parts[0] ?? full
  const first = parts[0] ?? ''
  const rest = parts.slice(1).join(' ')
  if (first.length <= 1) return full
  return `${first[0]}. ${rest}`
}

/** Position colour — the same assignment the Core Trade Center rows use. */
function positionAccent(pos: string): { border: string; label: string } {
  const p = pos.toUpperCase()
  if (p === 'QB') return { border: 'border-pink-400/65', label: 'text-pink-300/90' }
  if (p === 'RB') return { border: 'border-emerald-400/65', label: 'text-emerald-300/90' }
  if (p === 'WR') return { border: 'border-sky-400/70', label: 'text-sky-300/90' }
  if (p === 'TE') return { border: 'border-orange-400/65', label: 'text-orange-300/90' }
  if (['DL', 'DE', 'DT', 'NT'].includes(p)) return { border: 'border-amber-500/65', label: 'text-amber-300/90' }
  if (p === 'LB') return { border: 'border-lime-400/55', label: 'text-lime-300/85' }
  if (['DB', 'CB', 'S', 'SS', 'FS'].includes(p)) return { border: 'border-indigo-400/65', label: 'text-indigo-300/90' }
  if (p === 'K') return { border: 'border-yellow-400/55', label: 'text-yellow-200/85' }
  if (p === 'DEF' || p === 'DST') return { border: 'border-slate-400/60', label: 'text-slate-300/90' }
  return { border: 'border-[#ff3d81]/50', label: 'text-[#ff9ec0]/85' }
}

const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  cbs: 'C',
  mfl: 'M',
  fantrax: 'F',
  fleaflicker: 'L',
}
const PLATFORM_TONE: Record<string, string> = {
  sleeper: 'bg-[#1f2a4d] text-[#9fd4ff]',
  espn: 'bg-[#4a1414] text-[#ffb4b4]',
  yahoo: 'bg-[#3a1d55] text-[#dcb4ff]',
  fantrax: 'bg-[#123a2c] text-[#6fe3ad]',
  mfl: 'bg-[#3a2410] text-[#f0b46a]',
}

/** Grade letter colours from the handoff; the tile stays on the letter only. */
const GRADE_TONE: Record<string, { text: string; box: string }> = {
  A: { text: 'text-[#34d399]', box: 'border-[#34d399]/30 bg-[#34d399]/10' },
  B: { text: 'text-[#5eead4]', box: 'border-[#5eead4]/30 bg-[#5eead4]/10' },
  C: { text: 'text-[#fbbf24]', box: 'border-[#fbbf24]/30 bg-[#fbbf24]/10' },
  D: { text: 'text-[#fb923c]', box: 'border-[#fb923c]/30 bg-[#fb923c]/10' },
  F: { text: 'text-[#fb5b78]', box: 'border-[#fb5b78]/30 bg-[#fb5b78]/10' },
}

const STATUS_TONE: Record<LogRow['status']['tone'], string> = {
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  good: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  muted: 'border-white/10 bg-white/[0.04] text-white/50',
}

const EYEBROW = 'font-mono font-bold uppercase tracking-[0.14em]'

/**
 * Reads a numeric league setting out of the ingested settings snapshot —
 * the same key drift lib/core-app/commissionerHub.ts documents: the importer
 * renames Sleeper's `trade_deadline` to `trade_deadline_week`, and Sleeper's
 * own payload is often nested one level down.
 */
function readSetting(settings: unknown, keys: string[]): number | null {
  if (!settings || typeof settings !== 'object') return null
  const bag = settings as Record<string, unknown>
  for (const key of keys) {
    const raw = bag[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw)
  }
  const nested = bag.settings
  if (nested && typeof nested === 'object' && nested !== bag) return readSetting(nested, keys)
  return null
}

function whenLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function joinNames(xs: Array<{ label?: string; name?: string | null }>): string {
  const names = xs.map((x) => x.label ?? x.name ?? '').filter(Boolean)
  return names.length > 0 ? names.join(', ') : '—'
}

function statusOf(t: LeagueTradeHistoryItem): LogRow['status'] {
  const s = t.status ?? 'pending'
  if (s === 'pending_on_sleeper') return { label: 'Pending · on Sleeper', tone: 'warn' }
  if (s === 'awaiting_commissioner') return { label: 'Commissioner review', tone: 'violet' }
  if (s === 'awaiting_votes') return { label: 'League vote', tone: 'violet' }
  if (s === 'accepted' || s === 'scheduled') return { label: 'Accepted · settling', tone: 'good' }
  return { label: 'Pending', tone: 'warn' }
}

/** A native or provider offer, as one row of the league log. */
function rowFromActive(t: LeagueTradeHistoryItem): LogRow {
  const viewerSide = t.direction !== 'complete'
  const sent = joinNames(t.sent)
  const received = joinNames(t.received)
  const why = t.status === 'pending_on_sleeper' ? 'pending on Sleeper' : 'pending'
  if (viewerSide) {
    return {
      id: t.id,
      kind: 'pending',
      when: whenLabel(t.timestamp),
      sortKey: Date.parse(t.timestamp) || 0,
      a: { name: 'You', you: true, sends: sent, grade: null, gradeWhy: why },
      b: { name: t.partnerName, you: false, sends: received, grade: null, gradeWhy: why },
      extraSides: 0,
      status: statusOf(t),
      mine: true,
      /* `viewerSide` already excludes 'complete'; the type does not know that. */
      direction: t.direction === 'complete' ? null : t.direction,
    }
  }
  /* A commissioner's view of two other managers: proposer first. */
  return {
    id: t.id,
    kind: 'pending',
    when: whenLabel(t.timestamp),
    sortKey: Date.parse(t.timestamp) || 0,
    a: { name: t.partnerName, you: false, sends: sent, grade: null, gradeWhy: why },
    b: { name: 'Receiving team', you: false, sends: received, grade: null, gradeWhy: why },
    extraSides: 0,
    status: statusOf(t),
    mine: false,
    direction: null,
  }
}

function sideSends(side: GradedTrade['sides'][number]): string {
  const out = [...side.playersOut.map((p) => p.name), ...side.picksOut.map((p) => p.label)]
  return out.length > 0 ? out.join(', ') : '—'
}

/** A completed, graded trade from the Sleeper ledger, as a log row. */
function rowFromGraded(g: GradedTrade, viewerId: string | null): LogRow {
  const [s0, s1] = g.sides
  const side = (s: GradedTrade['sides'][number] | undefined): LogSide => {
    if (!s) return { name: '—', you: false, sends: '—', grade: null, gradeWhy: 'no side' }
    const you = Boolean(viewerId && s.ownerId === viewerId)
    return {
      name: s.teamName?.trim() || s.managerName,
      you,
      sends: sideSends(s),
      /* Provisional while a pick is unresolved — say so instead of scoring it. */
      grade: g.hasPendingPicks ? null : s.currentGrade,
      gradeWhy: g.hasPendingPicks ? 'picks pending' : null,
    }
  }
  const a = side(s0)
  const b = side(s1)
  const created = Date.parse(g.createdIso) || 0
  return {
    id: g.id,
    kind: 'completed',
    when: `Wk ${g.week} · ${g.season}`,
    sortKey: created,
    a,
    b,
    extraSides: Math.max(0, g.sides.length - 2),
    status: { label: g.tie ? 'Completed · even' : 'Completed', tone: 'good' },
    mine: a.you || b.you || g.sides.some((s) => Boolean(viewerId && s.ownerId === viewerId)),
    direction: a.you || b.you ? 'done' : null,
  }
}

/** A completed trade from an imported (non-Sleeper) ledger — never graded. */
function rowFromImported(t: ImportedTradeLedgerPayload['trades'][number]): LogRow {
  const [s0, s1] = t.sides
  const side = (s: typeof s0 | undefined, other: typeof s0 | undefined): LogSide => ({
    name: s?.managerName ?? '—',
    you: false,
    /* The import records what each side RECEIVED; what it sent is the other side's haul. */
    sends: other ? joinNames(other.received.map((p) => ({ name: p.name ?? 'Unnamed player' }))) : '—',
    grade: null,
    gradeWhy: 'not graded on this platform',
  })
  const created = t.dateIso ? Date.parse(t.dateIso) || 0 : 0
  return {
    id: t.id,
    kind: 'completed',
    when: t.season ? `${t.season}${t.dateIso ? ` · ${whenLabel(t.dateIso)}` : ''}` : t.dateIso ? whenLabel(t.dateIso) : '—',
    sortKey: created,
    a: side(s0, s1),
    b: side(s1, s0),
    extraSides: Math.max(0, t.sides.length - 2),
    status: { label: 'Completed', tone: 'good' },
    mine: false,
    direction: null,
  }
}

function GradeTile({ letter, why, size = 'md' }: { letter: GradeLetter | null; why: string | null; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[12px] rounded-md' : 'h-7 w-7 text-[14px] rounded-lg'
  if (!letter) {
    return (
      <span className="inline-flex items-center gap-1.5" title={why ?? undefined}>
        <span className={`inline-flex items-center justify-center border border-white/10 bg-white/[0.04] font-black text-white/35 ${dim}`}>
          —
        </span>
        {why ? <span className="text-[10px] leading-tight text-white/35">{why}</span> : null}
      </span>
    )
  }
  const tone = GRADE_TONE[letter] ?? GRADE_TONE.C!
  return (
    <span className={`inline-flex items-center justify-center border font-black ${dim} ${tone.text} ${tone.box}`}>
      {letter}
    </span>
  )
}

function StatusChip({ status }: { status: LogRow['status'] }) {
  return (
    <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] ${STATUS_TONE[status.tone]}`}>
      {status.label}
    </span>
  )
}

function YouPill() {
  return (
    <span className="rounded border border-[#ff3d81]/40 bg-[#ff3d81]/10 px-1 py-px font-mono text-[8px] font-bold tracking-[0.08em] text-[#ffb8d1]">
      YOU
    </span>
  )
}


/* ── Pending trade card ───────────────────────────────────────────────────
 *
 * Reads like the provider's own proposal card — proposer first, each
 * manager's assets stacked under their name — with the AllFantasy read on top:
 * what each asset is worth, the projected grade for each side, and which way
 * the deal tilts. That read comes from the existing analyzer and is the whole
 * reason to open this here rather than on the provider.
 *
 * ⚠ THE READ IS OPTIONAL, THE OFFER IS NOT. If the analyzer cannot price the
 * deal (an IDP-only offer, a pick the label did not parse, an outage) the card
 * still shows the trade exactly as proposed and says the read is missing. It
 * never invents a value, and never shows a C that means "no signal".
 */

type AnalyzeAsset =
  | { kind: 'player'; name: string }
  | { kind: 'pick'; year: number; round: number; label: string }
  | { kind: 'faab'; amount: number }

/**
 * Back into the analyzer's vocabulary from display strings.
 *
 * Structured provider offers never come through here (they carry year, round
 * and amount). Native AllFantasy proposals reach the panel as `{ label,
 * sublabel }`, so a pick or a FAAB line has to be read off its label — and a
 * label that does not parse is DROPPED and named, never guessed. A deal
 * analysed short one piece is a different deal, and the card says so.
 */
export function toAnalyzeAssets(
  assets: Array<{ label: string; sublabel: string | null }>,
): { assets: AnalyzeAsset[]; dropped: string[] } {
  const out: AnalyzeAsset[] = []
  const dropped: string[] = []
  for (const a of assets) {
    const label = a.label.trim()
    const sub = (a.sublabel ?? '').trim().toLowerCase()
    const faab = /(?:\$\s*(\d+))|(?:(\d+)\s*faab)/i.exec(label)
    if (faab || sub === 'faab') {
      const amount = Number(faab?.[1] ?? faab?.[2])
      if (Number.isFinite(amount) && amount > 0) out.push({ kind: 'faab', amount })
      else dropped.push(label)
      continue
    }
    const year = /\b(20\d{2})\b/.exec(label)
    const looksLikePick = Boolean(year) || sub === 'draft pick' || /\bpick\b/i.test(label)
    if (looksLikePick) {
      const rest = year ? label.replace(year[0], ' ') : label
      const round =
        /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:round|rd\b)/i.exec(rest) ??
        /\bround\s*(\d{1,2})\b/i.exec(rest) ??
        /\bR(\d{1,2})\b/i.exec(rest) ??
        /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(rest)
      const y = year ? Number(year[1]) : NaN
      const r = round ? Number(round[1]) : NaN
      if (Number.isFinite(y) && Number.isFinite(r) && r >= 1 && r <= 20) {
        out.push({ kind: 'pick', year: y, round: r, label })
      } else {
        dropped.push(label)
      }
      continue
    }
    out.push({ kind: 'player', name: label })
  }
  return { assets: out, dropped }
}

function fromBuilderAssets(assets: BuilderOfferAsset[]): { assets: AnalyzeAsset[]; dropped: string[] } {
  const out: AnalyzeAsset[] = []
  const dropped: string[] = []
  for (const a of assets) {
    if (a.faabAmount != null) out.push({ kind: 'faab', amount: a.faabAmount })
    else if (a.isPick) {
      if (a.pickYear != null && a.pickRound != null) out.push({ kind: 'pick', year: a.pickYear, round: a.pickRound, label: a.name })
      else dropped.push(a.name)
    } else out.push({ kind: 'player', name: a.name })
  }
  return { assets: out, dropped }
}

export type PendingVerdict =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'skipped'; why: string }
  | {
      kind: 'ok'
      fairnessScore: number | null
      fairnessLabel: string
      confidenceLabel: string | null
      degraded: boolean
      /** Letter for the side that SENDS `give` (the viewer, or the proposer), and its mirror. */
      giveGrade: GradeLetter | null
      getGrade: GradeLetter | null
      giveTotal: number | null
      getTotal: number | null
      /** Market value by lower-cased player name, null when the feed could not price one. */
      values: Record<string, number | null>
      dropped: string[]
    }

type AnalyzeResponse = {
  labels?: { fairnessLabel?: string; confidenceLabel?: string }
  fairnessScore?: number
  percentDiff?: number
  degraded?: boolean
  giveTotal?: number | null
  getTotal?: number | null
  players?: { give: Array<{ name: string; marketValue?: number | null }>; get: Array<{ name: string; marketValue?: number | null }> }
  error?: string
}

/** One asset as the card draws it, whichever shape it arrived in. */
type CardAsset = {
  key: string
  name: string
  meta: string | null
  kind: 'player' | 'pick' | 'faab'
  sleeperId: string | null
}

function cardAssetsFromPanel(assets: LeagueTradeHistoryItem['sent']): CardAsset[] {
  return assets.map((a) => {
    const sub = (a.sublabel ?? '').trim()
    const { assets: parsed } = toAnalyzeAssets([{ label: a.label, sublabel: a.sublabel }])
    const kind = parsed[0]?.kind ?? 'player'
    /* Provider rows carry the Sleeper id in front of the index; native rows carry a row id. */
    const idHead = a.id.split(':')[0] ?? ''
    const sleeperId = /^\d{2,}$/.test(idHead) ? idHead : null
    return { key: a.id, name: a.label, meta: sub && sub.toLowerCase() !== 'draft pick' ? sub : null, kind, sleeperId }
  })
}

function cardAssetsFromOffer(assets: BuilderOfferAsset[], prefix: string): CardAsset[] {
  return assets.map((a, i) => ({
    key: `${prefix}-${i}`,
    name: a.name,
    meta: a.faabAmount != null ? 'FAAB' : a.isPick ? null : [a.position, a.team].filter(Boolean).join(' - ') || null,
    kind: a.faabAmount != null ? 'faab' : a.isPick ? 'pick' : 'player',
    sleeperId: a.playerId,
  }))
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase()
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase()
}

function AssetAvatar({ a, sport }: { a: CardAsset; sport: string }) {
  if (a.kind === 'pick') {
    return (
      <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#8f97bd]/20 font-mono text-[9px] font-black tracking-[0.06em] text-[#c3c9e6]">
        PICK
      </span>
    )
  }
  if (a.kind === 'faab') {
    return (
      <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#34d399]/15 font-mono text-[12px] font-black text-[#34d399]">
        $
      </span>
    )
  }
  if (a.sleeperId) {
    return <PlayerImage sleeperId={a.sleeperId} sport={sport} name={a.name} size={32} variant="round" />
  }
  return (
    <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-[10px] font-bold text-white/70">
      {initialsOf(a.name)}
    </span>
  )
}

function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : '—'
}

function ManagerBlock({
  name,
  isYou,
  assets,
  values,
  total,
  grade,
  sport,
}: {
  name: string
  isYou: boolean
  assets: CardAsset[]
  values: Record<string, number | null> | null
  total: number | null | undefined
  grade: GradeLetter | null | undefined
  sport: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#ff3d81]/15 text-[9px] font-black text-[#ffb8d1]">
          {initialsOf(name)}
        </span>
        <span className="text-[13px] font-extrabold text-white">{name}</span>
        {isYou ? <YouPill /> : null}
        <span className={`${EYEBROW} text-[8.5px] text-white/35`}>sends</span>
        <span className="flex-1" />
        {grade ? <GradeTile letter={grade} why={null} size="sm" /> : null}
        {values ? <span className="font-mono text-[11px] font-bold text-[#CBD5E1]">{money(total)}</span> : null}
      </div>
      {assets.length === 0 ? (
        <p className="pl-8 text-[11.5px] italic text-white/35">Nothing</p>
      ) : (
        assets.map((a) => {
          const v = values && a.kind === 'player' ? values[a.name.toLowerCase()] : undefined
          return (
            <div key={a.key} className="flex items-center gap-2.5 rounded-lg border border-[#1E2A42] bg-[#0a1228] px-2.5 py-2">
              <AssetAvatar a={a} sport={sport} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold leading-tight text-white">{a.name}</p>
                {a.meta ? <p className="font-mono text-[10px] text-white/45">{a.meta}</p> : null}
              </div>
              {values ? (
                <span className={`font-mono text-[11.5px] font-bold ${v == null ? 'text-white/30' : 'text-[#CBD5E1]'}`}>
                  {a.kind === 'player' ? money(v) : '—'}
                </span>
              ) : null}
            </div>
          )
        })
      )}
    </div>
  )
}

export function PendingTradeCard(props: {
  trade: LeagueTradeHistoryItem
  offer: BuilderOffer | null
  verdict: PendingVerdict | undefined
  sport: string
  tradeCenterHref: string
  providerUrl: string | null
  canAct: boolean
  busy: boolean
  onAccept: () => void
  onReject: () => void
  onCancel: () => void
  onApprove: () => void
  onVeto: () => void
}) {
  const { trade: t, offer, verdict } = props
  const onSleeper = t.status === 'pending_on_sleeper'
  const review = t.status === 'awaiting_commissioner'
  const commissionerView = t.direction === 'complete'

  /* The viewer's side is `sent`; the partner's is `received`. Proposer goes first, like the provider's card. */
  const youAssets = offer ? cardAssetsFromOffer(offer.give, 'g') : cardAssetsFromPanel(t.sent)
  const themAssets = offer ? cardAssetsFromOffer(offer.get, 'k') : cardAssetsFromPanel(t.received)

  const you = { name: commissionerView ? 'Receiving team' : 'You', isYou: !commissionerView, assets: youAssets }
  const them = { name: t.partnerName, isYou: false, assets: themAssets }
  const proposerFirst = t.direction === 'outgoing' ? [you, them] : [them, you]

  const ok = verdict?.kind === 'ok' ? verdict : null
  const values = ok ? ok.values : null
  const gradeFor = (side: typeof you) => (ok ? (side === you ? ok.giveGrade : ok.getGrade) : null)
  const totalFor = (side: typeof you) => (ok ? (side === you ? ok.giveTotal : ok.getTotal) : null)

  const headline = commissionerView
    ? `${t.partnerName} has proposed a trade`
    : t.direction === 'outgoing'
      ? `You proposed a trade to ${t.partnerName}`
      : `${t.partnerName} has proposed a trade`

  const role = onSleeper
    ? { label: 'On Sleeper · read-only', cls: 'bg-[#1f2a4d] text-[#9fd4ff]' }
    : review
      ? { label: 'Commissioner review', cls: 'bg-violet-400/15 text-violet-200' }
      : t.direction === 'outgoing'
        ? { label: 'Your offer', cls: 'bg-white/[0.06] text-[#CBD5E1]' }
        : { label: 'Offer to you', cls: 'bg-amber-400/15 text-amber-200' }
  const border = onSleeper ? 'border-[#1E2A42]' : review ? 'border-violet-400/35' : t.direction === 'outgoing' ? 'border-[#1E2A42]' : 'border-amber-400/40'

  return (
    <article className={`flex flex-col gap-3 rounded-2xl border bg-[#131929] p-3.5 ${border}`} data-testid="pending-trade-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[#ff3d81]/15 text-[#ffb8d1]" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></svg>
          </span>
          <div>
            <p className="text-[13px] font-extrabold leading-tight text-white">{headline}</p>
            <p className="mt-0.5 text-[10.5px] text-white/40">
              {whenLabel(t.timestamp)}
              {review ? ' · awaiting the commissioner' : ''}
            </p>
          </div>
        </div>
        <span className={`whitespace-nowrap rounded px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.08em] ${role.cls}`}>
          {role.label}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {proposerFirst.map((side) => (
          <ManagerBlock
            key={side.name}
            name={side.name}
            isYou={side.isYou}
            assets={side.assets}
            values={values}
            total={totalFor(side)}
            grade={gradeFor(side)}
            sport={props.sport}
          />
        ))}
      </div>

      {/* ── The AllFantasy read ──────────────────────────────────────── */}
      <div className="rounded-xl border border-[#22d3ee]/25 bg-[#22d3ee]/[0.06] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`${EYEBROW} text-[9px] text-[#67e4f7]`}>AF read</span>
          {!verdict || verdict.kind === 'loading' ? (
            <span className="text-[11.5px] text-white/50">Pricing this deal…</span>
          ) : verdict.kind === 'failed' ? (
            <span className="text-[11.5px] text-white/50">Couldn&rsquo;t price this one just now — the offer above is exactly as proposed.</span>
          ) : verdict.kind === 'skipped' ? (
            <span className="text-[11.5px] text-white/50">{verdict.why}</span>
          ) : (
            <>
              <span className="text-[12.5px] font-bold text-white">{verdict.fairnessLabel}</span>
              {verdict.fairnessScore != null ? (
                <span className="font-mono text-[11px] font-bold text-[#67e4f7]">{Math.round(verdict.fairnessScore)}/100</span>
              ) : null}
              {verdict.confidenceLabel ? <span className="text-[11px] text-white/45">{verdict.confidenceLabel}</span> : null}
            </>
          )}
        </div>
        {ok && ok.degraded ? (
          <p className="mt-1.5 text-[11px] leading-snug text-[#ffd7de]">
            We could not price enough of this deal to stand behind a verdict — an even-looking read here means no signal, not a fair trade.
          </p>
        ) : null}
        {ok && ok.dropped.length > 0 ? (
          <p className="mt-1.5 text-[11px] leading-snug text-white/45">
            Priced without {ok.dropped.join(', ')} — could not be read as a pick or player, so the read is short that piece.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onSleeper ? (
          <>
            {props.providerUrl ? (
              <a
                href={props.providerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-[#22d3ee]/30 bg-[#22d3ee]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#67e4f7]"
              >
                Act on it in Sleeper
              </a>
            ) : null}
            <Link href={props.tradeCenterHref} className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/70">
              Load into builder
            </Link>
          </>
        ) : props.canAct && review ? (
          <>
            <button type="button" disabled={props.busy} onClick={props.onApprove} className="rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50" data-testid="trade-action-commissioner-approve">
              Approve
            </button>
            <button type="button" disabled={props.busy} onClick={props.onVeto} className="rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50" data-testid="trade-action-commissioner-veto">
              Veto
            </button>
          </>
        ) : props.canAct && t.viewerIsReceiver && t.status === 'pending' ? (
          <>
            <button type="button" disabled={props.busy} onClick={props.onAccept} className="rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50" data-testid="trade-action-accept">
              Accept
            </button>
            <button type="button" disabled={props.busy} onClick={props.onReject} className="rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50" data-testid="trade-action-reject">
              Reject
            </button>
          </>
        ) : props.canAct && t.viewerIsProposer && t.status === 'pending' ? (
          <button type="button" disabled={props.busy} onClick={props.onCancel} className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white/70 disabled:opacity-50" data-testid="trade-action-cancel">
            Cancel offer
          </button>
        ) : (
          <StatusChip status={statusOf(t)} />
        )}
        <Link href={props.tradeCenterHref} className="ml-auto text-[11px] font-semibold text-[#67e4f7] hover:text-[#9beefb]">
          Open in Trade Center →
        </Link>
      </div>
    </article>
  )
}


export function TradesTab({ league, teams }: TradesTabProps) {
  const sport = normalizeToSupportedSport(league.sport) ?? 'NFL'
  // Non-null only for imported (SHADOW) leagues, where a trade built here never reaches the
  // partner on their own platform. Drives every "Propose"→"Build a shadow trade" relabel.
  const tradeShadowNotice = useMemo(() => shadowDisclosure(league.platform), [league.platform])
  const [tradeBlock, setTradeBlock] = useState<LeagueTradeBlockPanelItem[]>([])
  const [activeTrades, setActiveTrades] = useState<LeagueTradeHistoryItem[]>([])
  /** Pending trades proposed ON the provider (Sleeper). Read-only in AllFantasy. */
  const [providerPending, setProviderPending] = useState(0)
  const [providerUrl, setProviderUrl] = useState<string | null>(null)
  const [pendingScan, setPendingScan] = useState<PanelResponse['pending'] | null>(null)
  const [pendingOffers, setPendingOffers] = useState<BuilderOffer[]>([])
  const [verdicts, setVerdicts] = useState<Record<string, PendingVerdict>>({})
  /* Which trades have been sent to the analyzer, so StrictMode's double effect does not double the requests. */
  const requested = useRef<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [ledger, setLedger] = useState<LedgerState>({ kind: 'loading' })
  const [watch, setWatch] = useState<Set<string>>(() => readWatchSet(league.id))
  const [proposeOpen, setProposeOpen] = useState(false)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [yourTab, setYourTab] = useState<YourTab>('active')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [onlyMine, setOnlyMine] = useState(false)

  const persistWatch = useCallback(
    (next: Set<string>) => {
      setWatch(next)
      try {
        window.localStorage.setItem(watchStorageKey(league.id), JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
    },
    [league.id],
  )

  const toggleWatch = useCallback(
    (playerId: string) => {
      const next = new Set(watch)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      persistWatch(next)
    },
    [watch, persistWatch],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(league.id)}`, {
        credentials: 'include',
      })
      const data = (await res.json().catch(() => null)) as PanelResponse | null
      if (!res.ok) {
        setErr('Could not load trades.')
        setTradeBlock([])
        setActiveTrades([])
        setProviderPending(0)
        setProviderUrl(null)
        setPendingScan(null)
        setPendingOffers([])
        return
      }
      setTradeBlock(Array.isArray(data?.tradeBlock) ? data.tradeBlock : [])
      setActiveTrades(Array.isArray(data?.activeTrades) ? (data.activeTrades as LeagueTradeHistoryItem[]) : [])
      setProviderPending(typeof data?.providerPendingCount === 'number' ? data.providerPendingCount : 0)
      setProviderUrl(typeof data?.providerLeagueUrl === 'string' ? data.providerLeagueUrl : null)
      setPendingScan(data?.pending && typeof data.pending === 'object' ? data.pending : null)
      setPendingOffers(Array.isArray(data?.pendingOffers) ? data.pendingOffers : [])
    } catch {
      setErr('Could not load trades.')
      setTradeBlock([])
      setActiveTrades([])
      setProviderPending(0)
      setProviderUrl(null)
      setPendingScan(null)
      setPendingOffers([])
    } finally {
      setLoading(false)
    }
  }, [league.id])

  /*
   * The completed ledger, independently of the panel. A payload that does not
   * carry `supported` is not a ledger at all (a proxy error page, a mock) and
   * must not be read as "no trades".
   */
  const loadLedger = useCallback(async () => {
    setLedger({ kind: 'loading' })
    try {
      const res = await fetch(`/api/league/trade-grades?leagueId=${encodeURIComponent(league.id)}`, {
        credentials: 'include',
      })
      const data = (await res.json().catch(() => null)) as GradesResponse | null
      if (!data || typeof data !== 'object' || !('supported' in data)) {
        setLedger({ kind: 'failed' })
        return
      }
      if (data.supported === false) {
        setLedger({ kind: 'unsupported', platform: data.platform })
        return
      }
      if ('graded' in data && data.graded === false) {
        setLedger({ kind: 'ungraded', ledger: data.ledger })
        return
      }
      if ('grades' in data && data.grades) {
        setLedger({ kind: 'graded', grades: data.grades, viewerId: data.viewerSleeperUserId })
        return
      }
      setLedger({ kind: 'failed' })
    } catch {
      setLedger({ kind: 'failed' })
    }
  }, [league.id])

  useEffect(() => {
    void load()
    void loadLedger()
  }, [load, loadLedger])

  const isZombie = String(league.leagueVariant ?? '').toLowerCase() === 'zombie'
  const nflRedraftTradesShell = isNflRedraftCoreDashboardFromUserLeague(league)

  // Phase 4: carry the active league context so the trade flow opens directly for THIS league
  // instead of showing the global league picker.
  const tradeFinderHref = useMemo(
    () => (league?.id ? `/trade-finder?leagueId=${encodeURIComponent(league.id)}` : '/trade-finder'),
    [league?.id],
  )
  const tradeCenterHref = `/core/trades?league=${encodeURIComponent(league.id)}`

  const runTradeAction = useCallback(
    async (tradeId: string, path: 'accept' | 'reject' | 'cancel') => {
      setActionBusyId(tradeId)
      setActionErr(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/${path}`, {
          method: 'POST',
        })
        await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionErr(`We could not ${path} this trade. Nothing was changed. Try again.`)
          return
        }
        await load()
      } catch {
        setActionErr(`Failed to ${path} trade.`)
      } finally {
        setActionBusyId(null)
      }
    },
    [league.id, load],
  )

  const runCommissionerDecision = useCallback(
    async (tradeId: string, decision: 'approve' | 'reject') => {
      setActionBusyId(tradeId)
      setActionErr(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/trades/${encodeURIComponent(tradeId)}/commissioner`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        })
        await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionErr('We could not save that commissioner decision. Nothing was changed. Try again.')
          return
        }
        await load()
      } catch {
        setActionErr('Failed to record commissioner decision.')
      } finally {
        setActionBusyId(null)
      }
    },
    [league.id, load],
  )

  /* ── Derived views ─────────────────────────────────────────────────── */

  const needsAction = useMemo(
    () =>
      activeTrades.filter(
        (t) =>
          (t.viewerIsReceiver && t.status === 'pending') ||
          (t.viewerIsCommissioner && t.status === 'awaiting_commissioner') ||
          (t.status === 'pending_on_sleeper' && t.direction === 'incoming'),
      ),
    [activeTrades],
  )


  const offerById = useMemo(() => {
    const m = new Map<string, BuilderOffer>()
    for (const o of pendingOffers) m.set(`sleeper:${o.transactionId}`, o)
    return m
  }, [pendingOffers])

  /*
   * The AllFantasy read on every pending trade the viewer can see, from the
   * analyzer the Trade Center already posts to. Capped so a league with a
   * pile of open offers does not turn one tab into a request storm (the
   * route rate-limits at 20/min); the rest keep the offer without the read.
   *
   * ⚠ NO NEW API ROUTE. Same `/api/trade-value/analyze`, same input shape.
   */
  const pendingForRead = useMemo(
    () => activeTrades.filter((t) => t.status !== 'accepted' && t.status !== 'scheduled').slice(0, 6),
    [activeTrades],
  )

  useEffect(() => {
    for (const t of pendingForRead) {
      if (requested.current.has(t.id)) continue
      requested.current.add(t.id)

      const offer = offerById.get(t.id) ?? null
      const give = offer ? fromBuilderAssets(offer.give) : toAnalyzeAssets(t.sent)
      const get = offer ? fromBuilderAssets(offer.get) : toAnalyzeAssets(t.received)
      const dropped = [...give.dropped, ...get.dropped]
      if (give.assets.length === 0 && get.assets.length === 0) {
        setVerdicts((prev) => ({ ...prev, [t.id]: { kind: 'skipped', why: 'Nothing in this offer could be priced.' } }))
        continue
      }
      setVerdicts((prev) => ({ ...prev, [t.id]: { kind: 'loading' } }))

      void (async () => {
        try {
          const r = await fetch('/api/trade-value/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sportFilter: 'ALL',
              leagueId: league.id,
              strategy: 'neutral',
              teamContext: 'my_team',
              sideGive: give.assets,
              sideGet: get.assets,
            }),
          })
          const j = (await r.json().catch(() => ({}))) as AnalyzeResponse
          if (!r.ok) {
            setVerdicts((prev) => ({ ...prev, [t.id]: { kind: 'failed' } }))
            return
          }
          const values: Record<string, number | null> = {}
          for (const l of [...(j.players?.give ?? []), ...(j.players?.get ?? [])]) {
            values[l.name.toLowerCase()] = typeof l.marketValue === 'number' ? l.marketValue : null
          }
          const allUnpriced = Object.values(values).length > 0 && Object.values(values).every((v) => v == null)
          const degraded = Boolean(j.degraded) || allUnpriced
          const hasSignal = !degraded
          const pd = typeof j.percentDiff === 'number' ? j.percentDiff : null
          setVerdicts((prev) => ({
            ...prev,
            [t.id]: {
              kind: 'ok',
              fairnessScore: typeof j.fairnessScore === 'number' ? j.fairnessScore : null,
              fairnessLabel: j.labels?.fairnessLabel ?? 'No verdict',
              confidenceLabel: j.labels?.confidenceLabel ?? null,
              degraded,
              giveGrade: projectedLetterFor({ percentDiff: pd, hasSignal }),
              getGrade: projectedLetterFor({ percentDiff: pd != null ? -pd : null, hasSignal }),
              giveTotal: typeof j.giveTotal === 'number' ? j.giveTotal : null,
              getTotal: typeof j.getTotal === 'number' ? j.getTotal : null,
              values,
              dropped,
            },
          }))
        } catch {
          setVerdicts((prev) => ({ ...prev, [t.id]: { kind: 'failed' } }))
        }
      })()
    }
  }, [pendingForRead, offerById, league.id])


  const completedRows = useMemo<LogRow[]>(() => {
    if (ledger.kind === 'graded') return ledger.grades.trades.map((g) => rowFromGraded(g, ledger.viewerId))
    if (ledger.kind === 'ungraded') return ledger.ledger.trades.map(rowFromImported)
    return []
  }, [ledger])

  const pendingRows = useMemo<LogRow[]>(() => activeTrades.map(rowFromActive), [activeTrades])

  const logRows = useMemo(() => {
    const all = [...pendingRows, ...completedRows].sort((x, y) => y.sortKey - x.sortKey)
    return all
      .filter((r) => (logFilter === 'all' ? true : r.kind === logFilter))
      .filter((r) => (onlyMine ? r.mine : true))
  }, [pendingRows, completedRows, logFilter, onlyMine])

  const yourActiveTrades = useMemo(() => activeTrades.filter((t) => t.direction !== 'complete'), [activeTrades])
  const yourActive = useMemo(() => pendingRows.filter((r) => r.mine), [pendingRows])
  const yourCompleted = useMemo(() => completedRows.filter((r) => r.mine), [completedRows])

  const platformKey = String(league.platform ?? '').toLowerCase()
  const platformMark = PLATFORM_MARK[platformKey] ?? (league.name?.charAt(0).toUpperCase() || '·')
  const platformTone = PLATFORM_TONE[platformKey] ?? 'bg-white/[0.06] text-white/70'
  const formatLine = [
    league.sport,
    league.leagueType ? String(league.leagueType).replace(/_/g, ' ') : null,
    league.teamCount ? `${league.teamCount} teams` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const deadlineWeek = readSetting(league.settings, ['trade_deadline_week', 'trade_deadline', 'tradeDeadlineWeek'])
  const deadlineChip =
    deadlineWeek == null ? null : deadlineWeek >= 99 ? 'Trades open all season' : `Deadline · week ${deadlineWeek}`

  const nothingAtAll = !loading && !err && activeTrades.length === 0 && completedRows.length === 0 && ledger.kind !== 'loading'

  const proposeAffordance = nflRedraftTradesShell ? (
    <button
      type="button"
      onClick={() => setProposeOpen(true)}
      className="rounded-lg bg-[#ff3d81]/85 px-3.5 py-2 text-[12px] font-bold text-black hover:bg-[#ff3d81]"
      data-testid="trades-tab-propose-trade"
    >
      Build a trade
    </button>
  ) : (
    <Link
      href={tradeFinderHref}
      className="rounded-lg bg-[#ff3d81]/85 px-3.5 py-2 text-[12px] font-bold text-black hover:bg-[#ff3d81]"
      data-testid="trades-tab-propose-trade"
    >
      Build a trade
    </Link>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-5">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className={`${EYEBROW} text-[10px] text-white/40`}>
            {league.name} · Trades
          </p>
          <h1 className="text-[22px] font-black tracking-tight text-white">Trade Center</h1>
          <p className="max-w-[62ch] text-[12px] leading-relaxed text-[#8B9DB8]">
            Every deal in this league — and the ones with your name on them. Grades are scored against
            this league&rsquo;s own rules, so the same trade grades differently next door.
          </p>
        </div>
        {nflRedraftTradesShell ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                openChimmyWithPrompt({
                  leagueId: league.id,
                  source: 'trade',
                  prompt: `Analyze this trade in ${String(league.name ?? 'League')}: describe assets from trade block or your proposal. Include fairness, team need, rest-of-season value, playoff impact, and risk.`,
                })
              }
              className="rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-violet-100 hover:bg-violet-500/20"
              data-testid="trades-tab-chimmy-analyze"
            >
              AI trade analysis
            </button>
            <button
              type="button"
              onClick={() => setProposeOpen(true)}
              className="rounded-xl border border-[#ff3d81]/35 bg-[#ff3d81]/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#ffd7e5] hover:bg-[#ff3d81]/20"
              data-testid="trades-tab-propose-trade-header"
            >
              {tradeShadowNotice ? 'Build a Shadow Trade' : 'Propose a Trade'}
            </button>
          </div>
        ) : null}
      </div>

      {/* ── League context bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-[#1E2A42] bg-[#131929] px-3.5 py-3">
        <span className={`inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg text-[12px] font-black ${platformTone}`} aria-hidden>
          {platformMark}
        </span>
        <span className="text-[14px] font-extrabold text-white">{league.name}</span>
        {formatLine ? (
          <>
            <span className="h-4 w-px bg-white/15" aria-hidden />
            <span className="text-[12px] text-[#8B9DB8]">{formatLine}</span>
          </>
        ) : null}
        <span className="flex-1" />
        <span className="font-mono text-[11px] font-bold text-[#8B9DB8]">
          {ledger.kind === 'graded' || ledger.kind === 'ungraded'
            ? `${completedRows.length} completed · ${activeTrades.length} pending`
            : `${activeTrades.length} pending`}
        </span>
        {deadlineChip ? (
          <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-amber-200">
            {deadlineChip}
          </span>
        ) : null}
      </div>

      {isZombie ? <ZombieTradePolicyCard leagueId={league.id} /> : null}

      {err ? (
        <LeagueSurfaceState
          kind="error"
          title="Trades unavailable"
          description="We could not load this league's trades. Existing offers were not changed."
          actionLabel="Retry trades"
          onAction={() => void load()}
          compact
          testId="league-trades-error"
        />
      ) : null}

      {loading && !err ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1E2A42] bg-[#131929] py-12">
          <div className="h-10 w-10 animate-pulse rounded-full bg-white/10" />
          <div className="h-3 w-40 rounded bg-white/10" />
          <p className="text-[12px] text-white/40">Reading this league&rsquo;s trades…</p>
        </div>
      ) : null}

      {/* ── Empty ─────────────────────────────────────────────────────── */}
      {nothingAtAll ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1E2A42] bg-[#131929] px-6 py-12 text-center">
          <p className="text-[16px] font-extrabold text-white">No trades in this league yet</p>
          <p className="max-w-md text-[12.5px] leading-relaxed text-[#8B9DB8]">
            Nothing has been proposed or completed this season. Start a deal in the builder, or let the
            finder pick a partner whose roster shape fits yours.
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {proposeAffordance}
            <Link
              href={tradeCenterHref}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-[12px] font-bold text-white/80 hover:border-white/30"
            >
              Find a partner
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── Needs your action ────────────────────────────────────────── */}
      {!loading && !err && needsAction.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className={`${EYEBROW} text-[10px] text-amber-300`}>Needs your action</span>
            <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            <span className="text-[10px] text-white/35">
              Offers waiting on you, and reviews waiting on the commissioner
            </span>
          </div>
          {actionErr ? <p className="text-[12px] text-rose-300">{actionErr}</p> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {needsAction.map((t) => (
              <PendingTradeCard
                key={t.id}
                trade={t}
                offer={offerById.get(t.id) ?? null}
                verdict={verdicts[t.id]}
                sport={sport}
                tradeCenterHref={tradeCenterHref}
                providerUrl={providerUrl}
                canAct={nflRedraftTradesShell}
                busy={actionBusyId === t.id}
                onAccept={() => void runTradeAction(t.id, 'accept')}
                onReject={() => void runTradeAction(t.id, 'reject')}
                onCancel={() => void runTradeAction(t.id, 'cancel')}
                onApprove={() => void runCommissionerDecision(t.id, 'approve')}
                onVeto={() => void runCommissionerDecision(t.id, 'reject')}
              />
            ))}
          </div>
        </section>
      ) : null}


      {/* ── Provider scan honesty ────────────────────────────────────── */}
      {!loading && !err && pendingScan && !pendingScan.scanned ? (
        <p className="text-[11px] text-white/40">
          Pending offers on {pendingScan.platform} are not read here
          {pendingScan.reason ? ` — ${pendingScan.reason}` : ''}. Anything waiting there will not show above.
        </p>
      ) : null}
      {!loading && !err && providerPending > 0 && needsAction.every((t) => t.status !== 'pending_on_sleeper') ? (
        <p className="text-[11px] text-white/40">
          {providerPending} pending {providerPending === 1 ? 'trade' : 'trades'} from Sleeper are yours to answer there
          {providerUrl ? (
            <>
              {' '}
              —{' '}
              <a href={providerUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-200 underline">
                open in Sleeper
              </a>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {/* ── Your trades ──────────────────────────────────────────────── */}
      {!loading && !err && !nothingAtAll ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${EYEBROW} text-[10px] text-white/40`}>Your trades</span>
            <div className="flex gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
              {(['active', 'completed'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setYourTab(k)}
                  className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] font-bold ${
                    yourTab === k ? 'bg-[#ff3d81] text-black' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {k === 'active' ? `Active · ${yourActive.length}` : `Completed · ${yourCompleted.length}`}
                </button>
              ))}
            </div>
            <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            <span className="text-[10px] text-white/35">
              {yourTab === 'active'
                ? 'Offers with your name on them'
                : 'Realized grades — scored on what each side has produced since'}
            </span>
          </div>
          {yourTab === 'active' ? (
            yourActiveTrades.length === 0 ? (
              <p className="rounded-2xl border border-[#1E2A42] bg-[#131929] px-4 py-6 text-center text-[12px] text-white/40">
                Nothing active with your name on it.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {yourActiveTrades.map((t) => (
                  <PendingTradeCard
                    key={t.id}
                    trade={t}
                    offer={offerById.get(t.id) ?? null}
                    verdict={verdicts[t.id]}
                    sport={sport}
                    tradeCenterHref={tradeCenterHref}
                    providerUrl={providerUrl}
                    canAct={nflRedraftTradesShell}
                    busy={actionBusyId === t.id}
                    onAccept={() => void runTradeAction(t.id, 'accept')}
                    onReject={() => void runTradeAction(t.id, 'reject')}
                    onCancel={() => void runTradeAction(t.id, 'cancel')}
                    onApprove={() => void runCommissionerDecision(t.id, 'approve')}
                    onVeto={() => void runCommissionerDecision(t.id, 'reject')}
                  />
                ))}
              </div>
            )
          ) : (
          <div className="overflow-hidden rounded-2xl border border-[#1E2A42] bg-[#131929]">
            {yourCompleted.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-white/40">
                {ledger.kind === 'loading'
                  ? 'Reading completed trades…'
                  : ledger.kind === 'ungraded'
                    ? `Completed trades on ${league.platform ?? 'this platform'} do not say which side was yours.`
                    : ledger.kind === 'unsupported'
                      ? 'Completed trades are not read for this platform yet.'
                      : ledger.kind === 'failed'
                        ? 'Completed trades could not be read just now.'
                        : 'You have not completed a trade in this league.'}
              </p>
            ) : (
              yourCompleted.map((r) => {
                const youA = r.a.you
                const you = youA ? r.a : r.b
                const them = youA ? r.b : r.a
                return (
                  <div
                    key={r.id}
                    className="grid items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 md:grid-cols-[110px_1fr_1fr_150px_130px]"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="self-start rounded bg-white/[0.06] px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-[#CBD5E1]">
                        Done
                      </span>
                      <span className="font-mono text-[10px] text-white/35">{r.when}</span>
                    </div>
                    <div className="min-w-0">
                      <p className={`${EYEBROW} text-[8.5px] text-rose-300`}>You send</p>
                      <p className="mt-0.5 text-[12px] leading-snug text-[#CBD5E1]">{you.sends}</p>
                    </div>
                    <div className="min-w-0">
                      <p className={`${EYEBROW} truncate text-[8.5px] text-emerald-300`}>You get · {them.name}</p>
                      <p className="mt-0.5 text-[12px] leading-snug text-[#CBD5E1]">{them.sends}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <GradeTile letter={you.grade} why={you.gradeWhy} />
                      {you.grade ? <span className="text-[10px] text-white/45">your side</span> : null}
                    </div>
                    <div className="md:justify-self-end">
                      <StatusChip status={r.status} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
          )}
        </section>
      ) : null}

      {/* ── League trade log ─────────────────────────────────────────── */}
      {!loading && !err && !nothingAtAll ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${EYEBROW} text-[10px] text-white/40`}>League trade log</span>
            <div className="flex gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['completed', 'Completed'],
                  ['pending', 'Pending'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLogFilter(k)}
                  className={`rounded-md border px-2.5 py-1.5 text-[10.5px] font-bold ${
                    logFilter === k
                      ? 'border-[#ff3d81] bg-[#ff3d81]/10 text-[#ffb8d1]'
                      : 'border-white/10 bg-[#0a1228] text-white/60 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              aria-pressed={onlyMine}
              className={`flex items-center gap-2 text-[10.5px] font-bold ${onlyMine ? 'text-[#ffb8d1]' : 'text-white/55'}`}
            >
              <span
                className={`relative h-[18px] w-[30px] rounded-full border ${
                  onlyMine ? 'border-[#ff3d81] bg-[#ff3d81]' : 'border-white/15 bg-white/[0.06]'
                }`}
                aria-hidden
              >
                <span
                  className={`absolute top-[2px] h-3 w-3 rounded-full ${onlyMine ? 'left-[14px] bg-black' : 'left-[2px] bg-white/50'}`}
                />
              </span>
              Only mine
            </button>
            <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            <span className="text-[10px] text-white/35">
              {ledger.kind === 'loading'
                ? 'Reading completed trades — the first read of a league can take a minute'
                : ledger.kind === 'unsupported'
                  ? `Completed trades are not read for ${ledger.platform} yet — pending only`
                  : ledger.kind === 'failed'
                    ? 'Completed trades could not be read just now — pending only'
                    : ledger.kind === 'ungraded'
                      ? `${logRows.length} shown · ${league.platform ?? 'this platform'} trades are listed, not graded`
                      : `${logRows.length} shown · grades are realized where every asset could be scored`}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#1E2A42] bg-[#131929]">
            <div className="hidden grid-cols-[56px_1.15fr_1.15fr_140px_120px] gap-3 border-b border-white/[0.06] px-4 py-2 md:grid">
              {['When', 'Side A sends', 'Side B sends', 'Grades A · B', 'Status'].map((h, i) => (
                <span key={h} className={`${EYEBROW} text-[9px] text-white/35 ${i === 4 ? 'text-right' : ''}`}>
                  {h}
                </span>
              ))}
            </div>
            {logRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-white/40">No trades match this filter.</p>
            ) : (
              logRows.map((r) => (
                <div
                  key={r.id}
                  className={`grid gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 md:grid-cols-[56px_1.15fr_1.15fr_140px_120px] md:items-center ${
                    r.mine ? 'bg-[#ff3d81]/[0.035]' : ''
                  }`}
                >
                  <span className="font-mono text-[11px] font-bold text-[#8B9DB8]">{r.when}</span>
                  {[r.a, r.b].map((s, i) => (
                    <div key={i} className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-extrabold text-white">{s.name}</span>
                        {s.you ? <YouPill /> : null}
                        {i === 1 && r.extraSides > 0 ? (
                          <span className="text-[10px] text-white/40">+{r.extraSides} more</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-[#CBD5E1]">{s.sends}</p>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <GradeTile letter={r.a.grade} why={null} size="sm" />
                    <GradeTile letter={r.b.grade} why={null} size="sm" />
                    {!r.a.grade && !r.b.grade && r.a.gradeWhy ? (
                      <span className="max-w-[70px] text-[9.5px] leading-tight text-white/35">{r.a.gradeWhy}</span>
                    ) : null}
                  </div>
                  <div className="md:justify-self-end">
                    <StatusChip status={r.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {/* ── Trade block ──────────────────────────────────────────────── */}
      {!loading && !err ? (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <span className={`${EYEBROW} text-[10px] text-white/40`}>Trade block</span>
            <span className="h-px flex-1 bg-white/[0.07]" aria-hidden />
            <span className="text-[10px] text-white/35">Players managers have flagged available</span>
          </div>
          {tradeBlock.length === 0 ? (
            <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] px-4 py-8 text-center">
              <p className="text-[13px] text-white/45">No players on the trade block yet</p>
              <p className="mt-1.5 text-[11px] text-white/30">
                {league.name} · {teams.length} teams
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {tradeBlock.map((item) => {
                const accent = positionAccent(item.position)
                const teamLine = item.team && item.team.length ? `${item.position} · ${item.team}` : `${item.position} · —`
                const watched = watch.has(item.playerId)
                return (
                  <div
                    key={item.id}
                    className={`relative flex flex-col gap-2 rounded-xl border-2 ${accent.border} bg-[#07071a]/90 p-2.5 shadow-sm`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className={`text-[10px] font-bold leading-tight ${accent.label}`}>{teamLine}</span>
                      <button
                        type="button"
                        onClick={() => toggleWatch(item.playerId)}
                        className={`rounded-full p-1 transition ${
                          watched ? 'text-rose-400' : 'text-white/30 hover:text-rose-400/80'
                        }`}
                        aria-label={watched ? 'Remove from watch' : 'Watch player'}
                      >
                        <Heart className={`h-3.5 w-3.5 ${watched ? 'fill-current' : ''}`} strokeWidth={2} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <PlayerImage
                        sleeperId={item.playerId}
                        sport={sport}
                        name={item.name}
                        position={item.position}
                        size={30}
                        variant="round"
                      />
                      <p className="truncate text-[12px] font-bold leading-tight text-white">
                        {shortDisplayName(item.name)}
                      </p>
                    </div>
                    <p className="truncate text-[10px] text-[#ffb8d1]/45">{item.ownerName}</p>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      {!loading && !err && !nothingAtAll ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-[240px] flex-1 text-[11px] leading-relaxed text-white/35">
            Pending offers from Sleeper are shown for analysis only — AllFantasy can price them, not respond to
            them. AllFantasy proposals accept, reject and counter right here.
          </p>
          {proposeAffordance}
          <Link
            href={tradeCenterHref}
            className="rounded-lg border border-white/15 px-3.5 py-2 text-[12px] font-bold text-white/80 hover:border-white/30"
          >
            Find a partner
          </Link>
        </div>
      ) : null}

      {nflRedraftTradesShell ? (
        <ProposeTradeModal
          open={proposeOpen}
          onClose={() => setProposeOpen(false)}
          leagueId={league.id}
          teams={teams}
          platform={league.platform}
          onSubmitted={() => {
            setProposeOpen(false)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
