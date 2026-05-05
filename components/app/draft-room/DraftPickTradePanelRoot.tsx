'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Scale,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import type {
  ProposalSummary,
  AiReviewState,
  InventoryPick,
  DraftPickTradeSuggestion,
  DraftPickTradeSuggestionKind,
  StructuredTradeAnalysis,
} from './DraftPickTradePanel'

type ManagerEntry = { slot: number; rosterId: string; displayName: string }

/** Shared field chrome — premium inputs aligned with draft room panels */
const FIELD_SELECT =
  'mt-2 w-full min-h-[48px] rounded-xl border border-white/[0.14] bg-[linear-gradient(180deg,rgba(0,0,0,0.55),rgba(0,0,0,0.35))] px-4 py-3 text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition ' +
  'placeholder:text-white/35 focus:border-cyan-400/45 focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-40'

function formatPickLabel(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`
}

function formatOfferAge(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 45_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function initialsFromDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function verdictChipClass(verdict: string): string {
  const v = verdict.toLowerCase()
  if (v === 'accept') return 'border-emerald-400/45 bg-emerald-500/18 text-emerald-100'
  if (v === 'reject') return 'border-rose-400/45 bg-rose-500/14 text-rose-100'
  if (v === 'counter') return 'border-amber-400/45 bg-amber-500/14 text-amber-100'
  return 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100'
}

function structuredFairnessLabel(label: StructuredTradeAnalysis['fairnessLabel']): string {
  switch (label) {
    case 'strong_value':
      return 'Strong value'
    case 'slight_edge_you':
      return 'Slight edge · you'
    case 'slight_edge_them':
      return 'Slight edge · them'
    case 'overpay':
      return 'Likely overpay'
    default:
      return 'Balanced'
  }
}

function structuredGuidanceTone(tone: StructuredTradeAnalysis['guidanceTone']): string {
  switch (tone) {
    case 'good_move':
      return 'Solid move'
    case 'risky_move':
      return 'Risky'
    default:
      return 'Okay'
  }
}

function PickSummaryChip({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'emerald' | 'violet'
}) {
  const ring =
    accent === 'emerald'
      ? 'border-emerald-400/30 bg-emerald-500/[0.09] shadow-[0_0_24px_rgba(16,185,129,0.12)]'
      : 'border-violet-400/30 bg-violet-500/[0.09] shadow-[0_0_24px_rgba(139,92,246,0.12)]'
  return (
    <div className={`rounded-2xl border px-4 py-3 ${ring}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tracking-tight text-white">{value}</p>
    </div>
  )
}

export type DraftPickTradePanelRootProps = {
  className: string
  presentationVariant?: 'default' | 'redraft_snake'
  leagueName?: string
  tradesLocked: boolean
  pickTradeEnabled: boolean
  draftSessionStatus: string
  loading: boolean
  inventoryLoading: boolean
  inventory: { mine: InventoryPick[]; byRosterId: Record<string, InventoryPick[]>; draftInProgress: boolean } | null
  currentUserRosterId: string | null
  onClose: () => void
  showOfferForm: boolean
  setShowOfferForm: (v: boolean) => void
  offerSending: boolean
  offerError: string | null
  offerGiveRound: number
  offerReceiveRound: number
  offerReceiverRosterId: string
  setOfferGiveRound: (n: number) => void
  setOfferReceiveRound: (n: number) => void
  setOfferReceiverRosterId: (s: string) => void
  setOfferError: (s: string | null) => void
  mySlot: number | null
  partnerSlot: number | null
  otherManagers: ManagerEntry[]
  slotOrder: ManagerEntry[]
  handleSubmitOffer: () => void
  offerValid: boolean
  validGiveRounds: number[]
  validReceiveRounds: number[]
  proposals: ProposalSummary[]
  pendingForMe: ProposalSummary[]
  pendingFromMe: ProposalSummary[]
  reviewId: string | null
  setReviewId: (id: string | null) => void
  aiReview: AiReviewState
  setAiReview: (v: AiReviewState) => void
  aiLoading: boolean
  respondLoading: string | null
  cancelLoading: string | null
  handleAiReview: (proposalId: string) => void
  handleRespond: (proposalId: string, action: 'accept' | 'reject' | 'counter') => void
  handleCancelProposal: (proposalId: string) => void
  rounds: number
  teamCount: number
  builderAnalysis: AiReviewState
  analyzeLoading: boolean
  analyzeBuilder: () => void
  suggestions: DraftPickTradeSuggestion[]
  suggestionsEmptyReason: string | null
  suggestLoading: boolean
  fetchSuggestions: (kind: DraftPickTradeSuggestionKind) => void
  applySuggestion: (s: DraftPickTradeSuggestion) => void
  lastSuggestionKind: DraftPickTradeSuggestionKind | null
  suggestionMeta: {
    aiUsed?: boolean
    source?: string | null
    notes?: string | null
    reasonCode?: string | null
  } | null
  tradeAiPremium: boolean
  /** League rule for the timer when an on-clock pick changes hands. Surfaces a small banner in the composer. */
  onClockTradeTimerBehavior?: 'inherit_remaining' | 'reset_timer'
}

export function DraftPickTradePanelRoot(props: DraftPickTradePanelRootProps) {
  const {
    className,
    presentationVariant = 'default',
    leagueName,
    tradesLocked,
    pickTradeEnabled,
    draftSessionStatus,
    loading,
    inventoryLoading,
    inventory,
    currentUserRosterId,
    onClose,
    showOfferForm,
    setShowOfferForm,
    offerSending,
    offerError,
    offerGiveRound,
    offerReceiveRound,
    offerReceiverRosterId,
    setOfferGiveRound,
    setOfferReceiveRound,
    setOfferReceiverRosterId,
    setOfferError,
    mySlot,
    partnerSlot,
    otherManagers,
    handleSubmitOffer,
    offerValid,
    validGiveRounds,
    validReceiveRounds,
    proposals: _proposals,
    pendingForMe,
    pendingFromMe,
    reviewId,
    setReviewId,
    aiReview,
    setAiReview,
    aiLoading,
    respondLoading,
    cancelLoading,
    handleAiReview,
    handleRespond,
    handleCancelProposal,
    rounds,
    teamCount,
    builderAnalysis,
    analyzeLoading,
    analyzeBuilder,
    suggestions,
    suggestionsEmptyReason,
    suggestLoading,
    fetchSuggestions,
    applySuggestion,
    lastSuggestionKind,
    suggestionMeta,
    tradeAiPremium,
    onClockTradeTimerBehavior = 'inherit_remaining',
  } = props

  const rs = presentationVariant === 'redraft_snake'
  const [mainTab, setMainTab] = useState<'compose' | 'offers'>('compose')
  const [partnerQuery, setPartnerQuery] = useState('')
  const [partnerMenuOpen, setPartnerMenuOpen] = useState(false)
  const [suggestNotesOpen, setSuggestNotesOpen] = useState(false)
  const [analyzerDetailOpen, setAnalyzerDetailOpen] = useState(true)
  const partnerRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!partnerMenuOpen) return
    const close = (e: MouseEvent) => {
      if (partnerRootRef.current && !partnerRootRef.current.contains(e.target as Node)) {
        setPartnerMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [partnerMenuOpen])

  const filteredPartners = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase()
    if (!q) return otherManagers
    return otherManagers.filter((m) => m.displayName.toLowerCase().includes(q))
  }, [otherManagers, partnerQuery])

  const partnerLabel =
    offerReceiverRosterId && otherManagers.find((m) => m.rosterId === offerReceiverRosterId)?.displayName

  const selectedPartner = offerReceiverRosterId
    ? otherManagers.find((m) => m.rosterId === offerReceiverRosterId)
    : null

  const lockReason = !pickTradeEnabled
    ? 'Pick trades are turned off in league draft settings.'
    : draftSessionStatus !== 'in_progress'
      ? `Trades are only available during a live draft (current: ${draftSessionStatus.replace(/_/g, ' ')}).`
      : inventory && !inventory.draftInProgress
        ? 'Draft session is not active.'
        : null

  const composeGuidance = (() => {
    if (tradesLocked || !showOfferForm) return null
    if (!offerReceiverRosterId) return 'Select a trade partner to see their picks and finish your offer.'
    if (validGiveRounds.length === 0) return 'No tradable pick found on your slot — it may already be used or unavailable.'
    if (validReceiveRounds.length === 0)
      return 'Your partner has no eligible pick on their slot for this swap right now.'
    if (!offerValid) return 'Choose valid rounds on both sides to enable Send offer.'
    return null
  })()

  const giveChip =
    mySlot != null && validGiveRounds.includes(offerGiveRound)
      ? formatPickLabel(offerGiveRound, mySlot)
      : '—'
  const receiveChip =
    partnerSlot != null && validReceiveRounds.includes(offerReceiveRound)
      ? formatPickLabel(offerReceiveRound, partnerSlot)
      : '—'

  const surface = rs
    ? 'border-cyan-400/35 bg-[linear-gradient(165deg,rgba(10,26,42,0.98),rgba(5,12,24,0.99))] shadow-[0_40px_120px_rgba(8,145,178,0.14)]'
    : 'border-white/[0.12] bg-[linear-gradient(165deg,#0d1829,#070f1c)] shadow-[0_40px_100px_rgba(0,0,0,0.55)]'

  return (
    <div
      className={`relative ${className} ${surface} ring-1 ring-white/[0.06]`}
      data-testid="draft-pick-trade-panel-root"
    >
      <div
        className={`pointer-events-none absolute inset-0 rounded-[inherit] ${
          rs
            ? 'bg-[radial-gradient(ellipse_90%_50%_at_50%_-10%,rgba(34,211,238,0.11),transparent_55%)]'
            : 'bg-[radial-gradient(ellipse_90%_45%_at_50%_-8%,rgba(139,92,246,0.09),transparent_50%)]'
        }`}
        aria-hidden
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <header
          className={`shrink-0 border-b px-6 py-5 ${
            rs ? 'border-cyan-500/15 bg-black/30' : 'border-white/[0.08] bg-black/35'
          }`}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-80" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                    rs
                      ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-200'
                      : 'border-violet-400/35 bg-violet-500/12 text-violet-200'
                  }`}
                >
                  <ArrowLeftRight className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white sm:text-[1.35rem]">Draft pick trades</h2>
                  <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-white/55">
                    Create or review pick trade offers during the draft. Swaps use live board ownership — offers your league
                    can actually process.
                  </p>
                </div>
              </div>
              {leagueName ? (
                <p className="mt-3 truncate text-sm font-medium text-white/78" title={leagueName}>
                  {leagueName}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="group shrink-0 rounded-2xl border border-white/15 bg-black/45 p-3 text-white/70 shadow-lg transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45"
              aria-label="Close draft trades"
            >
              <X className="h-5 w-5 transition group-active:scale-95" />
            </button>
          </div>

          {lockReason ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/35 bg-[linear-gradient(90deg,rgba(251,191,36,0.12),rgba(15,23,42,0.65))] px-4 py-3 text-[13px] leading-snug text-amber-50"
              role="status"
            >
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200/90" />
              <span>{lockReason}</span>
            </div>
          ) : null}

          <div className="mt-5 flex gap-1.5 rounded-2xl border border-white/[0.08] bg-black/40 p-1.5 shadow-inner">
            <button
              type="button"
              onClick={() => setMainTab('compose')}
              className={`relative flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                mainTab === 'compose'
                  ? rs
                    ? 'bg-[linear-gradient(135deg,rgba(34,211,238,0.22),rgba(15,23,42,0.9))] text-cyan-50 shadow-[0_8px_32px_rgba(34,211,238,0.15)]'
                    : 'bg-white/[0.12] text-white shadow-inner'
                  : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'
              }`}
            >
              Compose offer
            </button>
            <button
              type="button"
              onClick={() => setMainTab('offers')}
              className={`relative flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                mainTab === 'offers'
                  ? rs
                    ? 'bg-[linear-gradient(135deg,rgba(34,211,238,0.22),rgba(15,23,42,0.9))] text-cyan-50 shadow-[0_8px_32px_rgba(34,211,238,0.15)]'
                    : 'bg-white/[0.12] text-white shadow-inner'
                  : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                Pending offers
                {pendingForMe.length + pendingFromMe.length > 0 ? (
                  <span className="rounded-full border border-violet-400/35 bg-violet-500/25 px-2 py-0.5 text-[11px] font-bold tabular-nums text-violet-50">
                    {pendingForMe.length + pendingFromMe.length}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
          {!currentUserRosterId ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-14 text-center">
              <p className="text-base font-medium text-white/75">No roster in this draft</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-white/48">Join the league with a team to propose pick trades.</p>
            </div>
          ) : mainTab === 'compose' ? (
            <div className="mx-auto flex max-w-5xl flex-col gap-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowOfferForm(!showOfferForm)
                    setOfferError(null)
                  }}
                  data-testid="draft-trade-offer-toggle"
                  className={`inline-flex min-h-[48px] items-center gap-2.5 rounded-2xl border px-5 py-3 text-sm font-semibold transition ${
                    rs
                      ? 'border-cyan-400/45 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25'
                      : 'border-violet-400/40 bg-violet-500/14 text-violet-50 hover:bg-violet-500/22'
                  }`}
                >
                  <Send className="h-4 w-4 shrink-0" />
                  {showOfferForm ? 'Hide composer' : 'New offer'}
                </button>
                {(inventoryLoading || inventory == null) && (
                  <span className="inline-flex items-center gap-2 text-[12px] text-white/50">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400/80" />
                    Syncing pick inventory…
                  </span>
                )}
              </div>

              {showOfferForm ? (
                <>
                  <section
                    className={`rounded-3xl border p-6 sm:p-8 ${
                      rs ? 'border-white/[0.1] bg-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'border-white/[0.08] bg-black/32'
                    }`}
                  >
                    <div className="mb-8 flex flex-col gap-2 border-b border-white/[0.06] pb-6">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Trade builder</p>
                      <h3 className="text-lg font-bold text-white">Build a two-way pick swap</h3>
                      <p className="max-w-2xl text-sm text-white/52">
                        You give a pick from your draft slot; they give a pick from theirs. Labels use{' '}
                        <span className="font-mono text-white/70">round.slot</span> (e.g. 3.07).
                      </p>
                      {/* On-clock pick-trade timer rule banner — Slice-1 setting visualized so users
                          see the rule before submitting a trade involving the active pick. */}
                      <div
                        data-testid="trade-builder-onclock-timer-banner"
                        className={`mt-2 inline-flex max-w-2xl items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${
                          onClockTradeTimerBehavior === 'reset_timer'
                            ? 'border-amber-400/35 bg-amber-500/10 text-amber-100'
                            : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">
                          On-clock rule
                        </span>
                        <span>
                          {onClockTradeTimerBehavior === 'reset_timer'
                            ? 'Trading the on-the-clock pick resets the timer for the new owner.'
                            : 'Trading the on-the-clock pick keeps the remaining time — the new owner inherits it.'}
                        </span>
                      </div>
                    </div>

                    <div className="grid items-stretch gap-6 xl:grid-cols-[1fr_auto_1fr] xl:gap-4">
                      {/* Your side */}
                      <div className="flex flex-col gap-5 rounded-3xl border border-emerald-400/20 bg-[linear-gradient(160deg,rgba(16,185,129,0.08),rgba(0,0,0,0.2))] p-5 sm:p-6">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.45)]" />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/85">
                            You give
                          </span>
                        </div>
                        <PickSummaryChip label="Your draft slot" value={mySlot != null ? `#${mySlot}` : '—'} accent="emerald" />
                        <div>
                          <label className="block text-[12px] font-semibold text-white/72">Round</label>
                          <select
                            value={validGiveRounds.includes(offerGiveRound) ? offerGiveRound : ''}
                            onChange={(e) => setOfferGiveRound(Number(e.target.value))}
                            disabled={tradesLocked || validGiveRounds.length === 0}
                            data-testid="draft-trade-offer-give-round"
                            className={FIELD_SELECT}
                          >
                            {validGiveRounds.length === 0 ? (
                              <option value="">No tradable picks</option>
                            ) : (
                              validGiveRounds.map((r) => (
                                <option key={r} value={r}>
                                  Round {r} — pick {formatPickLabel(r, mySlot ?? 0)}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-black/30 px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Preview</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-emerald-100/95">{giveChip}</p>
                        </div>
                      </div>

                      {/* Exchange */}
                      <div className="flex flex-col items-center justify-center gap-2 py-4 xl:py-0">
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                            rs
                              ? 'border-cyan-400/35 bg-cyan-500/15 text-cyan-200'
                              : 'border-white/15 bg-white/[0.06] text-white/70'
                          }`}
                          aria-hidden
                        >
                          <ArrowLeftRight className="h-7 w-7" />
                        </div>
                        <p className="hidden text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35 xl:block">
                          Exchange
                        </p>
                      </div>

                      {/* Their side */}
                      <div className="flex flex-col gap-5 rounded-3xl border border-violet-400/22 bg-[linear-gradient(160deg,rgba(139,92,246,0.1),rgba(0,0,0,0.2))] p-5 sm:p-6">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_14px_rgba(167,139,250,0.45)]" />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200/85">
                            You receive
                          </span>
                        </div>

                        <div ref={partnerRootRef} className="relative">
                          <label className="block text-[12px] font-semibold text-white/72">Trade partner</label>
                          <button
                            type="button"
                            className={`mt-2 flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-white/[0.14] bg-black/50 px-4 py-3 text-left text-[15px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 disabled:opacity-45`}
                            disabled={tradesLocked}
                            onClick={() => setPartnerMenuOpen((o) => !o)}
                            data-testid="draft-trade-offer-receiver"
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              {selectedPartner ? (
                                <span
                                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold ${
                                    rs
                                      ? 'border-cyan-400/35 bg-cyan-500/15 text-cyan-100'
                                      : 'border-violet-400/35 bg-violet-500/15 text-violet-100'
                                  }`}
                                >
                                  {initialsFromDisplayName(selectedPartner.displayName)}
                                </span>
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-white/35">
                                  ?
                                </span>
                              )}
                              <span className="truncate">{partnerLabel || 'Choose a manager…'}</span>
                            </span>
                            <ChevronDown
                              className={`h-5 w-5 shrink-0 text-white/45 transition ${partnerMenuOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {partnerMenuOpen ? (
                            <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#080f1c] shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
                              <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-3">
                                <Search className="h-4 w-4 shrink-0 text-white/40" />
                                <input
                                  type="text"
                                  value={partnerQuery}
                                  onChange={(e) => setPartnerQuery(e.target.value)}
                                  placeholder="Search managers…"
                                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                                />
                              </div>
                              <div className="max-h-56 overflow-y-auto overscroll-contain py-2">
                                {filteredPartners.map((m) => (
                                  <button
                                    key={m.rosterId}
                                    type="button"
                                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.06]"
                                    onClick={() => {
                                      setOfferReceiverRosterId(m.rosterId)
                                      setPartnerMenuOpen(false)
                                      setPartnerQuery('')
                                      setOfferError(null)
                                    }}
                                  >
                                    <span
                                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold ${
                                        rs
                                          ? 'border-cyan-400/30 bg-cyan-500/12 text-cyan-100'
                                          : 'border-violet-400/30 bg-violet-500/12 text-violet-100'
                                      }`}
                                    >
                                      {initialsFromDisplayName(m.displayName)}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-semibold text-white">{m.displayName}</span>
                                      <span className="mt-0.5 block font-mono text-[11px] text-white/45">Slot {m.slot}</span>
                                    </span>
                                  </button>
                                ))}
                                {filteredPartners.length === 0 ? (
                                  <p className="px-4 py-6 text-center text-sm text-white/45">No matches.</p>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <PickSummaryChip
                          label="Their draft slot"
                          value={partnerSlot != null ? `#${partnerSlot}` : '—'}
                          accent="violet"
                        />

                        <div>
                          <label className="block text-[12px] font-semibold text-white/72">Round</label>
                          <select
                            value={validReceiveRounds.includes(offerReceiveRound) ? offerReceiveRound : ''}
                            onChange={(e) => setOfferReceiveRound(Number(e.target.value))}
                            disabled={tradesLocked || !offerReceiverRosterId || validReceiveRounds.length === 0}
                            data-testid="draft-trade-offer-receive-round"
                            className={FIELD_SELECT}
                          >
                            {!offerReceiverRosterId ? (
                              <option value="">Select partner first</option>
                            ) : validReceiveRounds.length === 0 ? (
                              <option value="">No tradable picks</option>
                            ) : (
                              validReceiveRounds.map((r) => (
                                <option key={r} value={r}>
                                  Round {r} — pick {formatPickLabel(r, partnerSlot ?? 0)}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-black/30 px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Preview</p>
                          <p className="mt-1 font-mono text-2xl font-bold text-violet-100/95">{receiveChip}</p>
                        </div>
                      </div>
                    </div>

                    {composeGuidance && !offerError ? (
                      <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed text-white/55">
                        {composeGuidance}
                      </div>
                    ) : null}

                    {offerError ? (
                      <div
                        className="mt-6 rounded-2xl border border-rose-400/40 bg-rose-500/[0.12] px-4 py-3 text-[13px] text-rose-50"
                        role="alert"
                      >
                        {offerError}
                      </div>
                    ) : null}

                    <div className="mt-8 flex flex-col gap-4 border-t border-white/[0.08] pt-8 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void handleSubmitOffer()}
                          disabled={offerSending || !offerValid}
                          data-testid="draft-trade-send-offer"
                          className={`inline-flex min-h-[52px] min-w-[160px] items-center justify-center gap-2 rounded-2xl px-8 text-base font-bold text-white shadow-[0_16px_48px_rgba(0,0,0,0.35)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 disabled:pointer-events-none disabled:opacity-40 ${
                            rs
                              ? 'border border-cyan-400/45 bg-[linear-gradient(135deg,rgba(6,182,212,0.45),rgba(109,40,217,0.35))]'
                              : 'border border-emerald-400/40 bg-[linear-gradient(135deg,rgba(16,185,129,0.45),rgba(6,95,70,0.35))]'
                          }`}
                        >
                          {offerSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                          {offerSending ? 'Sending…' : 'Send offer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowOfferForm(false)
                            setOfferError(null)
                          }}
                          data-testid="draft-trade-cancel-offer"
                          className="inline-flex min-h-[52px] items-center justify-center rounded-2xl border border-white/[0.12] px-6 text-sm font-semibold text-white/80 transition hover:bg-white/[0.06]"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-[12px] leading-relaxed text-white/42 sm:max-w-xs sm:text-right">
                        {teamCount} teams · {rounds} rounds
                      </p>
                    </div>
                  </section>

                  {/* AI blocks — structured “rails” */}
                  <div className="grid gap-6 lg:grid-cols-2">
                    <section
                      className={`relative overflow-hidden rounded-3xl border p-6 ${
                        rs
                          ? 'border-violet-400/25 bg-violet-950/20 shadow-[inset_1px_0_0_rgba(167,139,250,0.25)]'
                          : 'border-violet-400/18 bg-violet-950/14'
                      }`}
                    >
                      <div className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-full bg-gradient-to-b from-violet-400/50 to-fuchsia-500/30" />
                      <div className="pl-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Sparkles className="h-5 w-5 text-violet-300" />
                          <h3 className="text-base font-bold text-white">AI Trade Suggestor</h3>
                          <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">
                            Live inventory
                          </span>
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-white/48">
                          Ranked swaps validated against live ownership; AF Pro adds AI ranking and rationale. Choose a partner first.
                        </p>
                        {!tradeAiPremium ? (
                          <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-snug text-amber-100/90">
                            AF Pro unlocks AI-ranked rationales for suggestions. You still get valid deterministic swaps.
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={suggestLoading || tradesLocked || !offerReceiverRosterId}
                            onClick={() => void fetchSuggestions('move_up')}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/14 px-4 py-2.5 text-xs font-bold text-emerald-50 transition hover:bg-emerald-500/22 disabled:opacity-45"
                          >
                            <ArrowUp className="h-4 w-4" />
                            Move up
                          </button>
                          <button
                            type="button"
                            disabled={suggestLoading || tradesLocked || !offerReceiverRosterId}
                            onClick={() => void fetchSuggestions('move_down')}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/14 px-4 py-2.5 text-xs font-bold text-sky-50 transition hover:bg-sky-500/22 disabled:opacity-45"
                          >
                            <ArrowDown className="h-4 w-4" />
                            Move down
                          </button>
                          <button
                            type="button"
                            disabled={suggestLoading || tradesLocked || !offerReceiverRosterId}
                            onClick={() => void fetchSuggestions('fair')}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-500/14 px-4 py-2.5 text-xs font-bold text-violet-50 transition hover:bg-violet-500/22 disabled:opacity-45"
                          >
                            <Scale className="h-4 w-4" />
                            Fair swap
                          </button>
                          <button
                            type="button"
                            disabled={
                              suggestLoading || tradesLocked || !offerReceiverRosterId || mySlot == null || !validGiveRounds.length
                            }
                            onClick={() => void fetchSuggestions('best_for_pick')}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/14 px-4 py-2.5 text-xs font-bold text-fuchsia-50 transition hover:bg-fuchsia-500/22 disabled:opacity-45"
                          >
                            <Zap className="h-4 w-4" />
                            For my pick
                          </button>
                          <button
                            type="button"
                            disabled={
                              suggestLoading ||
                              tradesLocked ||
                              !offerReceiverRosterId ||
                              lastSuggestionKind == null
                            }
                            onClick={() => lastSuggestionKind && void fetchSuggestions(lastSuggestionKind)}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/18 bg-white/[0.06] px-4 py-2.5 text-xs font-bold text-white/85 transition hover:bg-white/[0.1] disabled:opacity-45"
                          >
                            Regenerate
                          </button>
                          {suggestionMeta?.notes ? (
                            <button
                              type="button"
                              onClick={() => setSuggestNotesOpen((v) => !v)}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/14 bg-black/30 px-4 py-2.5 text-xs font-bold text-white/75 transition hover:bg-white/[0.06]"
                            >
                              Explain board
                            </button>
                          ) : null}
                        </div>
                        {suggestNotesOpen && suggestionMeta?.notes ? (
                          <p className="mt-3 rounded-xl border border-white/[0.08] bg-black/35 px-3 py-2 text-[12px] leading-relaxed text-white/65">
                            {suggestionMeta.notes}
                          </p>
                        ) : null}
                        {suggestionMeta ? (
                          <p className="mt-2 text-[11px] text-white/38">
                            {suggestionMeta.aiUsed ? 'AI-ranked' : 'Deterministic'}{' '}
                            {suggestionMeta.source ? `· ${suggestionMeta.source}` : ''}
                            {suggestionMeta.reasonCode ? ` · ${suggestionMeta.reasonCode}` : ''}
                          </p>
                        ) : null}
                        {suggestLoading ? (
                          <p className="mt-4 flex items-center gap-2 text-sm text-white/55">
                            <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                            Finding suggestions…
                          </p>
                        ) : null}
                        {!suggestLoading && suggestions.length === 0 && suggestionsEmptyReason ? (
                          <p className="mt-4 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2 text-[13px] text-white/50">
                            {suggestionsEmptyReason}
                          </p>
                        ) : null}
                        {suggestions.length > 0 ? (
                          <ul className="mt-4 space-y-3">
                            {suggestions.map((s) => (
                              <li
                                key={s.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-black/35 px-4 py-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs font-bold text-white">
                                      {formatPickLabel(s.giveRound, s.giveSlot)}
                                    </span>
                                    <ArrowLeftRight className="h-3.5 w-3.5 text-white/35" />
                                    <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs font-bold text-white">
                                      {formatPickLabel(s.receiveRound, s.receiveSlot)}
                                    </span>
                                    {s.aiEnhanced ? (
                                      <span className="rounded-md border border-violet-400/35 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100/95">
                                        AI
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-2 text-[12px] leading-snug text-white/48">{s.rationale}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => applySuggestion(s)}
                                  className="shrink-0 rounded-xl border border-cyan-400/40 bg-cyan-500/18 px-4 py-2 text-xs font-bold text-cyan-50 transition hover:bg-cyan-500/28"
                                >
                                  Apply
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </section>

                    <section
                      className={`relative overflow-hidden rounded-3xl border p-6 ${
                        rs
                          ? 'border-cyan-400/28 bg-cyan-950/18 shadow-[inset_1px_0_0_rgba(34,211,238,0.28)]'
                          : 'border-cyan-400/15 bg-cyan-950/12'
                      }`}
                    >
                      <div className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-full bg-gradient-to-b from-cyan-400/55 to-blue-600/35" />
                      <div className="pl-4">
                        <div className="flex items-center gap-2">
                          <Zap className="h-5 w-5 text-cyan-300" />
                          <h3 className="text-base font-bold text-white">AI Trade Analyzer</h3>
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-white/48">
                          Deterministic capital bands plus AF Pro AI summary when entitled—grounded in live picks on the board.
                        </p>
                        {!tradeAiPremium ? (
                          <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-snug text-amber-100/90">
                            Upgrade to AF Pro for AI narrative on this analyzer. Structured fairness chips below still run for
                            everyone.
                          </p>
                        ) : null}
                          <button
                            type="button"
                            disabled={analyzeLoading || !offerValid}
                            onClick={() => void analyzeBuilder()}
                          className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-2xl border border-cyan-400/45 bg-cyan-500/18 px-6 text-sm font-bold text-cyan-50 shadow-[0_12px_40px_rgba(34,211,238,0.12)] transition hover:bg-cyan-500/26 disabled:opacity-45"
                        >
                          {analyzeLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                          {analyzeLoading ? 'Analyzing…' : 'Analyze this trade'}
                        </button>

                        {builderAnalysis ? (
                          <div className="mt-5 rounded-2xl border border-white/[0.1] bg-black/40 p-5">
                            <button
                              type="button"
                              onClick={() => setAnalyzerDetailOpen((v) => !v)}
                              className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 text-left text-[12px] font-semibold text-white/75 transition hover:bg-white/[0.04]"
                            >
                              <span>Verdict detail</span>
                              <ChevronDown className={`h-4 w-4 shrink-0 transition ${analyzerDetailOpen ? 'rotate-180' : ''}`} />
                            </button>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${verdictChipClass(builderAnalysis.verdict)}`}
                              >
                                {builderAnalysis.verdict}
                              </span>
                              {builderAnalysis.executionMode ? (
                                <span className="text-[11px] text-white/45">{builderAnalysis.executionMode}</span>
                              ) : null}
                              {builderAnalysis.structuredAnalysis ? (
                                <>
                                  <span className="rounded-full border border-white/14 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-white/80">
                                    {structuredFairnessLabel(builderAnalysis.structuredAnalysis.fairnessLabel)}
                                  </span>
                                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/12 px-3 py-1 text-[11px] font-semibold text-cyan-50/95">
                                    {structuredGuidanceTone(builderAnalysis.structuredAnalysis.guidanceTone)}
                                  </span>
                                  <span className="text-[11px] text-white/45">
                                    Δ overall{' '}
                                    {builderAnalysis.structuredAnalysis.overallDelta != null
                                      ? builderAnalysis.structuredAnalysis.overallDelta
                                      : '—'}
                                  </span>
                                </>
                              ) : null}
                              {builderAnalysis.aiConfidence != null ? (
                                <span className="text-[11px] text-white/45">
                                  Confidence {(builderAnalysis.aiConfidence * 100).toFixed(0)}%
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-4 text-[15px] leading-relaxed text-white/88">{builderAnalysis.summary}</p>
                            {analyzerDetailOpen ? (
                              <>
                                {builderAnalysis.reasons.length > 0 ? (
                                  <ul className="mt-4 space-y-2 text-[14px] leading-snug text-white/72">
                                    {builderAnalysis.reasons.map((r, i) => (
                                      <li key={i} className="flex gap-2">
                                        <span className="text-cyan-400/75">•</span>
                                        <span>{r}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                                {builderAnalysis.counterReasons.length > 0 ? (
                                  <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-4 py-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-amber-200/95">Counter angles</p>
                                    <ul className="mt-2 space-y-1 text-[13px] text-amber-100/88">
                                      {builderAnalysis.counterReasons.map((r, i) => (
                                        <li key={i}>{r}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {builderAnalysis.suggestedCounterPackage ? (
                                  <p className="mt-4 text-[13px] leading-relaxed text-cyan-100/90">{builderAnalysis.suggestedCounterPackage}</p>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-white/[0.12] bg-black/25 px-8 py-16 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/35">
                    <Send className="h-7 w-7" />
                  </div>
                  <p className="mt-6 text-base font-semibold text-white/78">Open the composer to build an offer</p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/48">
                    Use <span className="font-semibold text-white/65">New offer</span>, or start from a pick on the draft board to
                    pre-fill rounds.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <OffersTab
              rs={rs}
              loading={loading}
              pendingForMe={pendingForMe}
              pendingFromMe={pendingFromMe}
              reviewId={reviewId}
              setReviewId={setReviewId}
              aiReview={aiReview}
              setAiReview={setAiReview}
              aiLoading={aiLoading}
              respondLoading={respondLoading}
              cancelLoading={cancelLoading}
              handleAiReview={handleAiReview}
              handleRespond={handleRespond}
              handleCancelProposal={handleCancelProposal}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function OffersTab(props: {
  rs: boolean
  loading: boolean
  pendingForMe: ProposalSummary[]
  pendingFromMe: ProposalSummary[]
  reviewId: string | null
  setReviewId: (id: string | null) => void
  aiReview: AiReviewState
  setAiReview: (v: AiReviewState) => void
  aiLoading: boolean
  respondLoading: string | null
  cancelLoading: string | null
  handleAiReview: (proposalId: string) => void
  handleRespond: (proposalId: string, action: 'accept' | 'reject' | 'counter') => void
  handleCancelProposal: (proposalId: string) => void
}) {
  const {
    rs,
    loading,
    pendingForMe,
    pendingFromMe,
    reviewId,
    setReviewId,
    aiReview,
    setAiReview,
    aiLoading,
    respondLoading,
    cancelLoading,
    handleAiReview,
    handleRespond,
    handleCancelProposal,
  } = props

  const empty = !loading && pendingForMe.length === 0 && pendingFromMe.length === 0

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/[0.08] bg-black/30 px-8 py-14">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400/80" />
          <p className="text-sm font-medium text-white/65">Loading offers…</p>
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-3xl border border-white/[0.1] bg-[linear-gradient(145deg,rgba(255,255,255,0.05),transparent)] px-8 py-16 text-center shadow-inner">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/40">
            <Sparkles className="h-8 w-8 text-white/25" />
          </div>
          <p className="mt-6 text-lg font-bold text-white/85">Nothing pending yet</p>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/48">
            Incoming and outgoing offers show here with pick chips and actions — switch to Compose to send your first swap.
          </p>
        </div>
      ) : null}

      {pendingForMe.length > 0 ? (
        <div>
          <SectionHeading
            dotClass="bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.5)]"
            title="Needs your answer"
            subtitle={`${pendingForMe.length} incoming`}
          />
          <div className="mt-5 space-y-5">
            {pendingForMe.map((p) => (
              <OfferCard
                key={p.id}
                variant="incoming"
                rs={rs}
                proposal={p}
                reviewId={reviewId}
                setReviewId={setReviewId}
                aiReview={reviewId === p.id ? aiReview : null}
                setAiReview={setAiReview}
                aiLoading={aiLoading && reviewId === p.id}
                respondLoading={respondLoading}
                onAiReview={() => void handleAiReview(p.id)}
                onRespond={(action) => void handleRespond(p.id, action)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {pendingFromMe.length > 0 ? (
        <div>
          <SectionHeading
            dotClass="bg-violet-400 shadow-[0_0_14px_rgba(167,139,250,0.45)]"
            title="Waiting on them"
            subtitle={`${pendingFromMe.length} sent`}
          />
          <div className="mt-5 space-y-5">
            {pendingFromMe.map((p) => (
              <SentOfferCard key={p.id} proposal={p} rs={rs} cancelLoading={cancelLoading === p.id} onWithdraw={() => void handleCancelProposal(p.id)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SectionHeading(props: { dotClass: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] pb-4">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${props.dotClass}`} />
        <div>
          <h4 className="text-base font-bold text-white">{props.title}</h4>
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/40">{props.subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function SentOfferCard(props: {
  proposal: ProposalSummary
  rs: boolean
  cancelLoading: boolean
  onWithdraw: () => void
}) {
  const { proposal: p, rs, cancelLoading, onWithdraw } = props
  return (
    <div
      className={`rounded-3xl border p-6 transition ${
        rs ? 'border-violet-400/22 bg-[linear-gradient(145deg,rgba(139,92,246,0.08),rgba(0,0,0,0.25))]' : 'border-white/[0.08] bg-black/35'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex rounded-full border border-violet-400/35 bg-violet-500/18 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-100">
            Pending · Sent
          </span>
          <p className="mt-4 text-lg font-bold text-white">
            To <span className="text-white/95">{p.receiverName ?? 'Manager'}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PickFlowChip label="You give" value={formatPickLabel(p.giveRound, p.giveSlot)} variant="give" />
            <ArrowLeftRight className="h-4 w-4 text-white/25" />
            <PickFlowChip label="They give" value={formatPickLabel(p.receiveRound, p.receiveSlot)} variant="receive" />
          </div>
          <p className="mt-4 text-[13px] text-white/45">
            Sent {formatOfferAge(p.createdAt)}
            <span className="mx-2 text-white/25">·</span>
            <span className="font-mono text-[12px] text-white/35">{new Date(p.createdAt).toLocaleString()}</span>
          </p>
        </div>
        <button
          type="button"
          disabled={cancelLoading}
          onClick={onWithdraw}
          className="shrink-0 rounded-2xl border border-white/[0.12] px-5 py-2.5 text-sm font-bold text-white/85 transition hover:bg-white/[0.06] disabled:opacity-45"
        >
          {cancelLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Withdraw'}
        </button>
      </div>
    </div>
  )
}

function PickFlowChip(props: { label: string; value: string; variant: 'give' | 'receive' }) {
  const border =
    props.variant === 'give'
      ? 'border-emerald-400/35 bg-emerald-500/[0.1]'
      : 'border-violet-400/35 bg-violet-500/[0.1]'
  return (
    <div className={`rounded-2xl border px-4 py-3 ${border}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">{props.label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-white">{props.value}</p>
    </div>
  )
}

function OfferCard(props: {
  variant: 'incoming'
  rs: boolean
  proposal: ProposalSummary
  reviewId: string | null
  setReviewId: (id: string | null) => void
  aiReview: AiReviewState
  setAiReview: (v: AiReviewState) => void
  aiLoading: boolean
  respondLoading: string | null
  onAiReview: () => void
  onRespond: (action: 'accept' | 'reject' | 'counter') => void
}) {
  const { rs, proposal: p, reviewId, setReviewId, aiReview, setAiReview, aiLoading, respondLoading, onAiReview, onRespond } =
    props

  return (
    <div
      className={`rounded-3xl border p-6 sm:p-8 ${
        rs
          ? 'border-emerald-400/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.09),rgba(0,0,0,0.28))]'
          : 'border-emerald-400/18 bg-emerald-950/10'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="inline-flex rounded-full border border-emerald-400/40 bg-emerald-500/18 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-100">
            Incoming
          </span>
          <p className="mt-4 text-lg font-bold text-white">
            From <span className="text-emerald-100/95">{p.proposerName ?? 'Manager'}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PickFlowChip label="They give" value={formatPickLabel(p.giveRound, p.giveSlot)} variant="give" />
            <ArrowLeftRight className="h-4 w-4 text-white/25" />
            <PickFlowChip label="You give" value={formatPickLabel(p.receiveRound, p.receiveSlot)} variant="receive" />
          </div>
          <p className="mt-4 text-[13px] text-white/45">
            Received {formatOfferAge(p.createdAt)}
            <span className="mx-2 text-white/25">·</span>
            <span className="font-mono text-[12px] text-white/35">{new Date(p.createdAt).toLocaleString()}</span>
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setReviewId(p.id)
            setAiReview(null)
          }}
          data-testid={`draft-trade-review-${p.id}`}
          className="rounded-2xl border border-white/[0.12] px-5 py-2.5 text-sm font-bold text-white/88 transition hover:bg-white/[0.06]"
        >
          Details
        </button>
        <button
          type="button"
          onClick={onAiReview}
          disabled={aiLoading}
          data-testid={`draft-trade-ai-review-${p.id}`}
          className="inline-flex items-center gap-2 rounded-2xl border border-violet-400/45 bg-violet-500/18 px-5 py-2.5 text-sm font-bold text-violet-50 transition hover:bg-violet-500/28 disabled:opacity-45"
        >
          <Sparkles className="h-4 w-4" />
          {aiLoading ? '…' : 'AI analyze'}
        </button>
      </div>

      {reviewId === p.id ? (
        <div className="mt-6 border-t border-white/[0.08] pt-6" data-testid={`draft-trade-review-panel-${p.id}`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">Private review</p>
          {aiReview ? (
            <div className="mt-4 rounded-2xl border border-white/[0.1] bg-black/45 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-block rounded-full border px-3 py-1 text-[11px] font-bold uppercase ${verdictChipClass(aiReview.verdict)}`}>
                  {aiReview.verdict}
                </span>
                {aiReview.structuredAnalysis ? (
                  <>
                    <span className="rounded-full border border-white/14 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-white/80">
                      {structuredFairnessLabel(aiReview.structuredAnalysis.fairnessLabel)}
                    </span>
                    <span className="rounded-full border border-cyan-400/25 bg-cyan-500/12 px-3 py-1 text-[11px] font-semibold text-cyan-50/95">
                      {structuredGuidanceTone(aiReview.structuredAnalysis.guidanceTone)}
                    </span>
                    <span className="text-[11px] text-white/45">
                      Δ overall{' '}
                      {aiReview.structuredAnalysis.overallDelta != null ? aiReview.structuredAnalysis.overallDelta : '—'}
                    </span>
                  </>
                ) : null}
                {aiReview.aiConfidence != null ? (
                  <span className="text-[11px] text-white/45">Confidence {(aiReview.aiConfidence * 100).toFixed(0)}%</span>
                ) : null}
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-white/88">{aiReview.summary}</p>
              {aiReview.reasons.length > 0 ? (
                <ul className="mt-4 space-y-2 text-[14px] text-white/72">
                  {aiReview.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
              {aiReview.counterReasons.length > 0 ? (
                <div className="mt-4 rounded-xl border border-amber-400/28 bg-amber-500/[0.08] px-4 py-3 text-[13px] text-amber-100/88">
                  <p className="font-bold text-amber-200">Counter ideas</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {aiReview.counterReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aiReview.declineReasons.length > 0 ? (
                <div className="mt-4 rounded-xl border border-rose-400/28 bg-rose-500/[0.08] px-4 py-3 text-[13px] text-rose-100/88">
                  <p className="font-bold text-rose-200">Pass reasons</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {aiReview.declineReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aiReview.suggestedCounterPackage ? (
                <p className="mt-5 text-[13px] leading-relaxed text-cyan-100/90">{aiReview.suggestedCounterPackage}</p>
              ) : null}
            </div>
          ) : (
            !aiLoading && <p className="mt-3 text-sm text-white/45">Run AI analyze for a structured verdict.</p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onRespond('accept')}
              disabled={respondLoading === p.id}
              data-testid={`draft-trade-accept-${p.id}`}
              className="inline-flex min-h-[48px] min-w-[120px] items-center justify-center rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-45"
            >
              {respondLoading === p.id ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => onRespond('reject')}
              disabled={respondLoading === p.id}
              data-testid={`draft-trade-reject-${p.id}`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-rose-400/45 px-6 text-sm font-bold text-rose-100 transition hover:bg-rose-500/15 disabled:opacity-45"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => onRespond('counter')}
              disabled={respondLoading === p.id}
              data-testid={`draft-trade-counter-${p.id}`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-amber-400/45 px-6 text-sm font-bold text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-45"
            >
              Counter
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
