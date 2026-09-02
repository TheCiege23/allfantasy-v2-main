'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import { PlayerImage } from '@/app/components/PlayerImage'
import type { LeagueTradeHistoryItem } from '@/components/league/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueTradeBlockPanelItem } from '@/components/league/types'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { GradedTrade, TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { ImportedTradeLedgerPayload } from '@/lib/trade-intel/importedTradeLedgerService'
import { ZombieTradePolicyCard } from '@/components/zombie/ZombieTradePolicyCard'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { isNflRedraftCoreDashboardFromUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
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
  error?: string
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

export function TradesTab({ league, teams }: TradesTabProps) {
  const sport = normalizeToSupportedSport(league.sport) ?? 'NFL'
  const [tradeBlock, setTradeBlock] = useState<LeagueTradeBlockPanelItem[]>([])
  const [activeTrades, setActiveTrades] = useState<LeagueTradeHistoryItem[]>([])
  /** Pending trades proposed ON the provider (Sleeper). Read-only in AllFantasy. */
  const [providerPending, setProviderPending] = useState(0)
  const [providerUrl, setProviderUrl] = useState<string | null>(null)
  const [pendingScan, setPendingScan] = useState<PanelResponse['pending'] | null>(null)
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
        return
      }
      setTradeBlock(Array.isArray(data?.tradeBlock) ? data.tradeBlock : [])
      setActiveTrades(Array.isArray(data?.activeTrades) ? (data.activeTrades as LeagueTradeHistoryItem[]) : [])
      setProviderPending(typeof data?.providerPendingCount === 'number' ? data.providerPendingCount : 0)
      setProviderUrl(typeof data?.providerLeagueUrl === 'string' ? data.providerLeagueUrl : null)
      setPendingScan(data?.pending && typeof data.pending === 'object' ? data.pending : null)
    } catch {
      setErr('Could not load trades.')
      setTradeBlock([])
      setActiveTrades([])
      setProviderPending(0)
      setProviderUrl(null)
      setPendingScan(null)
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

  const yourActive = useMemo(() => pendingRows.filter((r) => r.mine), [pendingRows])
  const yourCompleted = useMemo(() => completedRows.filter((r) => r.mine), [completedRows])
  const yourRows = yourTab === 'active' ? yourActive : yourCompleted

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
              Propose a Trade
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
            {needsAction.map((t) => {
              const onSleeper = t.status === 'pending_on_sleeper'
              const review = t.status === 'awaiting_commissioner'
              const role = onSleeper
                ? { label: 'On Sleeper · read-only', cls: 'bg-[#1f2a4d] text-[#9fd4ff]' }
                : review
                  ? { label: 'Commissioner review', cls: 'bg-violet-400/15 text-violet-200' }
                  : { label: 'Offer to you', cls: 'bg-amber-400/15 text-amber-200' }
              const border = onSleeper ? 'border-[#1E2A42]' : review ? 'border-violet-400/35' : 'border-amber-400/40'
              const busy = actionBusyId === t.id
              return (
                <article key={t.id} className={`flex flex-col gap-2.5 rounded-2xl border bg-[#131929] p-3.5 ${border}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.08em] ${role.cls}`}>
                      {role.label}
                    </span>
                    <span className="text-[10.5px] text-white/35">{whenLabel(t.timestamp)}</span>
                  </div>
                  <div className="text-[14px] font-extrabold text-white">{t.partnerName}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-[#1E2A42] bg-[#0a1228] px-2.5 py-2">
                      <p className={`${EYEBROW} text-[8.5px] text-rose-300`}>{t.direction === 'complete' ? 'They send' : 'You send'}</p>
                      <p className="mt-1 text-[11.5px] leading-snug text-[#CBD5E1]">{joinNames(t.sent)}</p>
                    </div>
                    <div className="rounded-lg border border-[#1E2A42] bg-[#0a1228] px-2.5 py-2">
                      <p className={`${EYEBROW} text-[8.5px] text-emerald-300`}>{t.direction === 'complete' ? 'They get' : 'You get'}</p>
                      <p className="mt-1 text-[11.5px] leading-snug text-[#CBD5E1]">{joinNames(t.received)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {onSleeper ? (
                      <>
                        {/*
                          Not an accept button. Sleeper's public API has no write
                          endpoint, so the only truthful action is to send the
                          manager where the offer lives.
                        */}
                        {providerUrl ? (
                          <a
                            href={providerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-[#22d3ee]/30 bg-[#22d3ee]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#67e4f7]"
                          >
                            Act on it in Sleeper
                          </a>
                        ) : null}
                        <Link
                          href={tradeCenterHref}
                          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/70"
                        >
                          Load into builder
                        </Link>
                      </>
                    ) : nflRedraftTradesShell ? (
                      review ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runCommissionerDecision(t.id, 'approve')}
                            className="rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                            data-testid="trade-action-commissioner-approve"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runCommissionerDecision(t.id, 'reject')}
                            className="rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50"
                            data-testid="trade-action-commissioner-veto"
                          >
                            Veto
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runTradeAction(t.id, 'accept')}
                            className="rounded-lg border border-emerald-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                            data-testid="trade-action-accept"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runTradeAction(t.id, 'reject')}
                            className="rounded-lg border border-rose-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 disabled:opacity-50"
                            data-testid="trade-action-reject"
                          >
                            Reject
                          </button>
                        </>
                      )
                    ) : (
                      <span className="text-[11px] text-white/45">
                        {review ? 'Awaiting the commissioner’s decision.' : 'Waiting on your answer.'}
                      </span>
                    )}
                    <Link href={tradeCenterHref} className="ml-auto text-[11px] font-semibold text-[#67e4f7] hover:text-[#9beefb]">
                      Price it in the Trade Center →
                    </Link>
                  </div>
                </article>
              )
            })}
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
          <div className="overflow-hidden rounded-2xl border border-[#1E2A42] bg-[#131929]">
            {yourRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-white/40">
                {yourTab === 'active'
                  ? 'Nothing active with your name on it.'
                  : ledger.kind === 'loading'
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
              yourRows.map((r) => {
                const youA = r.a.you
                const you = youA ? r.a : r.b
                const them = youA ? r.b : r.a
                const dir =
                  r.direction === 'incoming'
                    ? { label: 'Incoming', cls: 'bg-emerald-400/12 text-emerald-300' }
                    : r.direction === 'outgoing'
                      ? { label: 'Outgoing', cls: 'bg-amber-400/12 text-amber-200' }
                      : { label: 'Done', cls: 'bg-white/[0.06] text-[#CBD5E1]' }
                return (
                  <div
                    key={r.id}
                    className="grid items-center gap-3 border-b border-white/[0.06] px-4 py-3 last:border-b-0 md:grid-cols-[110px_1fr_1fr_150px_130px]"
                  >
                    <div className="flex flex-col gap-1">
                      <span className={`self-start rounded px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] ${dir.cls}`}>
                        {dir.label}
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
          onSubmitted={() => {
            setProposeOpen(false)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
