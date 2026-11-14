'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'

/**
 * Decision OS in the draft room: the `manager.draft.pick` decision for this manager's next pick.
 *
 * The four contract answers, the live pick rules' verdicts on the top choice, and the alternatives.
 * It refetches when `refreshKey` changes (the room passes the current overall + status), so it
 * follows the board without polling. Read-only: drafting stays with the manager.
 */

type Verdict = { rule: string; verdict: 'legal' | 'illegal' | 'temporarily_illegal' | 'requires_approval'; message: string }
type Action = {
  rank: number
  playerName: string
  position: string
  team: string | null
  adp: number | null
  reason: string
  confidence: number
}
export type DraftDecisionPayload = {
  decisionId: string
  fourAnswers: { what_happened: string; why_it_matters: string; how_confident: string; what_to_do: string }
  recommendedActions: Action[]
  ruleVerdicts: Verdict[]
  confidence: number
  dataCompleteness: number
  uncertaintySources: string[]
  forOverall: number | null
  /** The specifics of THIS draft (2026-11-14): scoring window, position run, teams ahead. */
  context?: { scoringWindow: string | null; run: string | null; teamsAhead: string | null }
}

type AuctionPrice = { playerName: string; position: string; team: string | null; marketPrice: number; yourPrice: number; surplus: number; reason: string }
export type DraftAuctionPayload = {
  maxLegalBid: number
  budgetEdge: number | null
  nominated: (AuctionPrice & { currentBid: number | null; verdict: 'bid' | 'let_go' | 'cannot_afford'; bidUpTo: number }) | null
  targets: AuctionPrice[]
  nominate: AuctionPrice | null
  summary: string
  caveats: string[]
  scoringWindowInsight: string | null
}

/** Reasons the route gives when there is no decision to make. The card stays out of the way. */
const SILENT_REASONS = new Set(['no_draft', 'no_roster', 'auction_unsupported'])

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; decision: DraftDecisionPayload }
  | { kind: 'auction'; auction: DraftAuctionPayload }
  | { kind: 'hidden' }
  | { kind: 'error'; message: string }

function band(confidence: number): string {
  return confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
}

function verdictTone(v: Verdict['verdict']): string {
  if (v === 'legal') return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
  if (v === 'illegal') return 'border-rose-400/40 bg-rose-500/12 text-rose-100'
  return 'border-amber-400/35 bg-amber-500/12 text-amber-100'
}

export function DraftDecisionOsCard({ leagueId, refreshKey }: { leagueId: string; refreshKey: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [manualKey, setManualKey] = useState(0)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setState((prev) => (prev.kind === 'ready' || prev.kind === 'auction' ? prev : { kind: 'loading' }))
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/decision`, { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as {
        decision?: DraftDecisionPayload
        auction?: DraftAuctionPayload
        reason?: string
        error?: string
      }
      if (request !== requestRef.current) return
      if (res.ok && body.auction) setState({ kind: 'auction', auction: body.auction })
      else if (res.ok && body.decision) setState({ kind: 'ready', decision: body.decision })
      else if (res.status === 401 || res.status === 403 || (body.reason && SILENT_REASONS.has(body.reason))) {
        setState({ kind: 'hidden' })
      }
      else setState({ kind: 'error', message: body.error ?? 'Decision OS could not read this draft.' })
    } catch {
      if (request === requestRef.current) setState({ kind: 'error', message: 'Decision OS could not be reached.' })
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load, refreshKey, manualKey])

  if (state.kind === 'hidden') return null

  const decision = state.kind === 'ready' ? state.decision : null
  const top = decision?.recommendedActions[0] ?? null
  const blocking = decision?.ruleVerdicts.filter((v) => v.verdict !== 'legal') ?? []

  return (
    <section
      className="mb-2 rounded-xl border border-indigo-400/30 bg-[linear-gradient(155deg,rgba(99,102,241,0.14),rgba(15,23,42,0.95))] p-2.5"
      data-testid="draft-decision-os-card"
      aria-label="Decision OS"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-indigo-200" aria-hidden />
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-100/90">Decision OS</p>
          {decision ? (
            <span
              className="rounded-full border border-white/15 bg-black/25 px-1.5 py-0.5 text-[11px] font-semibold text-white/80"
              data-testid="draft-decision-os-confidence"
            >
              {band(decision.confidence)} · {decision.confidence}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setManualKey((k) => k + 1)}
          disabled={state.kind === 'loading'}
          className="rounded border border-white/15 bg-black/20 p-1 text-white/70 hover:bg-white/10 disabled:opacity-50"
          aria-label="Refresh decision"
          data-testid="draft-decision-os-refresh"
        >
          <RefreshCw className={`h-3 w-3 ${state.kind === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {state.kind === 'auction' ? (
        <AuctionView auction={state.auction} />
      ) : state.kind === 'loading' ? (
        <p className="mt-2 text-[11px] text-white/55">Reading the board…</p>
      ) : state.kind === 'error' ? (
        <p className="mt-2 text-[11px] text-amber-200/90" data-testid="draft-decision-os-error">
          {state.message}
        </p>
      ) : decision ? (
        <div className="mt-2 space-y-1.5 text-[11px] leading-snug">
          <p className="font-semibold text-white" data-testid="draft-decision-os-what-to-do">
            {decision.fourAnswers.what_to_do}
          </p>
          <p className="text-white/75">{decision.fourAnswers.what_happened}</p>
          {top ? <p className="text-white/65">{decision.fourAnswers.why_it_matters}</p> : null}
          <p className="text-white/50">{decision.fourAnswers.how_confident}</p>

          <div className="flex flex-wrap gap-1 pt-0.5" data-testid="draft-decision-os-verdicts">
            {(blocking.length > 0 ? blocking : decision.ruleVerdicts).map((v) => (
              <span key={v.rule} className={`rounded border px-1.5 py-0.5 text-[11px] ${verdictTone(v.verdict)}`} title={v.rule}>
                {v.message}
              </span>
            ))}
          </div>

          <DraftContextLines context={decision.context} />

          {decision.recommendedActions.length > 1 ? (
            <ol className="space-y-0.5 border-t border-white/10 pt-1.5" data-testid="draft-decision-os-alternatives">
              {decision.recommendedActions.slice(1).map((a) => (
                <li key={`${a.rank}-${a.playerName}`} className="text-white/70">
                  <span className="text-white/45">{a.rank}.</span>{' '}
                  <span className="font-medium text-white/90">{a.playerName}</span>{' '}
                  <span className="text-white/50">
                    ({a.position}
                    {a.team ? ` · ${a.team}` : ''})
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          <p className="text-[11px] text-white/40">
            Inputs {decision.dataCompleteness}% complete · ranked by the same engine as your draft helper
          </p>
        </div>
      ) : null}
    </section>
  )
}

/** This draft's specifics, said once each: scoring window, a position run, the teams picking before you. */
function DraftContextLines({ context }: { context?: DraftDecisionPayload['context'] }) {
  const lines = [context?.scoringWindow, context?.run, context?.teamsAhead].filter((l): l is string => Boolean(l))
  if (lines.length === 0) return null
  return (
    <ul className="space-y-0.5 border-t border-white/10 pt-1.5" data-testid="draft-decision-os-context">
      {lines.map((line) => (
        <li key={line} className="text-white/75">
          {line}
        </li>
      ))}
    </ul>
  )
}

function money(n: number): string {
  return `$${n}`
}

function AuctionView({ auction }: { auction: DraftAuctionPayload }) {
  const n = auction.nominated
  return (
    <div className="mt-2 space-y-1.5 text-[11px] leading-snug" data-testid="draft-decision-os-auction">
      <p className="font-semibold text-white" data-testid="draft-decision-os-auction-summary">
        {auction.summary}
      </p>
      {n ? (
        <p className="text-white/70">
          {n.playerName} ({n.position}
          {n.team ? ` · ${n.team}` : ''}): your price {money(n.yourPrice)} · market ~{money(n.marketPrice)}
          {n.currentBid != null ? ` · current bid ${money(n.currentBid)}` : ''} — {n.reason}
        </p>
      ) : null}
      <p className="text-white/55">
        Max legal bid {money(auction.maxLegalBid)}
        {auction.budgetEdge != null
          ? ` · ${auction.budgetEdge >= 1 ? 'more' : 'less'} money per open spot than the room average (${auction.budgetEdge}x)`
          : ''}
      </p>
      {auction.scoringWindowInsight ? <p className="text-white/70">{auction.scoringWindowInsight}</p> : null}
      {auction.targets.length > 0 ? (
        <ol className="space-y-0.5 border-t border-white/10 pt-1.5" data-testid="draft-decision-os-auction-targets">
          {auction.targets.map((t) => (
            <li key={t.playerName} className="text-white/70">
              <span className="font-medium text-white/90">{t.playerName}</span> <span className="text-white/50">({t.position})</span> — worth ~
              {money(t.yourPrice)} to you, ~{money(t.marketPrice)} at market
            </li>
          ))}
        </ol>
      ) : null}
      {auction.nominate ? (
        <p className="text-white/65">
          To nominate: {auction.nominate.playerName} ({auction.nominate.position}) — the room values him more than your roster does.
        </p>
      ) : null}
      {auction.caveats.length > 0 ? <p className="text-[11px] text-white/40">{auction.caveats.join(' ')}</p> : null}
    </div>
  )
}
