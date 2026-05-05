'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { DraftPickTradePanelRoot } from './DraftPickTradePanelRoot'
import { useEntitlements } from '@/hooks/useEntitlements'

export type ProposalSummary = {
  id: string
  proposerRosterId: string
  receiverRosterId: string
  giveRound: number
  giveSlot: number
  receiveRound: number
  receiveSlot: number
  proposerName?: string | null
  receiverName?: string | null
  status: string
  createdAt: string
}

export type StructuredTradeAnalysis = {
  overallDelta: number | null
  moveDirection: 'up' | 'down' | 'neutral'
  fairnessBand: 'favorable' | 'balanced' | 'costly'
  guidanceTone: 'good_move' | 'okay_move' | 'risky_move'
  fairnessLabel:
    | 'strong_value'
    | 'slight_edge_you'
    | 'neutral'
    | 'slight_edge_them'
    | 'overpay'
}

export type AiReviewState = {
  verdict: string
  reasons: string[]
  declineReasons: string[]
  counterReasons: string[]
  summary: string
  suggestedCounterPackage?: string | null
  privateAiDmSent?: boolean
  executionMode?: string | null
  structuredAnalysis?: StructuredTradeAnalysis | null
  aiConfidence?: number | null
} | null

export type InventoryPick = { overall: number; round: number; slot: number }

export type DraftPickTradeSuggestion = {
  id: string
  suggestionKind: string
  giveRound: number
  giveSlot: number
  receiveRound: number
  receiveSlot: number
  rationale: string
  aiEnhanced?: boolean
}

export type DraftPickTradeSuggestionKind = 'fair' | 'move_up' | 'move_down' | 'best_for_pick'

export type DraftPickTradePanelProps = {
  leagueId: string
  /** Draft session id (telemetry / parity with callers). */
  sessionId?: string
  leagueName?: string
  /** Draft session status — pick trades only apply while live. */
  draftSessionStatus?: string
  /** From league draft UI settings; disables composer when false. */
  pickTradeEnabled?: boolean
  presentationVariant?: 'default' | 'redraft_snake'
  slotOrder: { slot: number; rosterId: string; displayName: string }[]
  teamCount: number
  rounds: number
  currentUserRosterId: string | null
  onClose: () => void
  onTradeAccepted?: (updatedSession?: unknown) => void
  tradePanelGeneration?: number
  initialTradeDraft?: {
    giveRound?: number
    receiveRound?: number
    receiverRosterId?: string
  } | null
  /** Bump when draft board / traded picks advance so traded UI can invalidate AI caches. */
  draftStateFingerprint?: string
  /** League rule for the timer when an on-clock pick changes hands mid-draft. */
  onClockTradeTimerBehavior?: 'inherit_remaining' | 'reset_timer'
}

export function DraftPickTradePanel({
  leagueId,
  leagueName,
  draftSessionStatus = 'in_progress',
  pickTradeEnabled = true,
  presentationVariant = 'default',
  slotOrder,
  teamCount,
  rounds,
  currentUserRosterId,
  onClose,
  onTradeAccepted,
  tradePanelGeneration = 0,
  initialTradeDraft = null,
  draftStateFingerprint,
  onClockTradeTimerBehavior = 'inherit_remaining',
}: DraftPickTradePanelProps) {
  const { canUse } = useEntitlements()
  const tradeAiPremium = canUse('pro_trade_ai')
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [aiReview, setAiReview] = useState<AiReviewState>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [respondLoading, setRespondLoading] = useState<string | null>(null)
  const [cancelLoading, setCancelLoading] = useState<string | null>(null)
  const [showOfferForm, setShowOfferForm] = useState(false)
  const [offerSending, setOfferSending] = useState(false)
  const [offerGiveRound, setOfferGiveRound] = useState(1)
  const [offerReceiveRound, setOfferReceiveRound] = useState(1)
  const [offerReceiverRosterId, setOfferReceiverRosterId] = useState('')
  const [offerError, setOfferError] = useState<string | null>(null)

  const [inventory, setInventory] = useState<{
    mine: InventoryPick[]
    byRosterId: Record<string, InventoryPick[]>
    draftInProgress: boolean
  } | null>(null)
  const [inventoryLoading, setInventoryLoading] = useState(false)

  const [builderAnalysis, setBuilderAnalysis] = useState<AiReviewState>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)

  const [suggestions, setSuggestions] = useState<DraftPickTradeSuggestion[]>([])
  const [suggestionsEmptyReason, setSuggestionsEmptyReason] = useState<string | null>(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [lastSuggestionKind, setLastSuggestionKind] = useState<DraftPickTradeSuggestionKind | null>(null)
  const [suggestionMeta, setSuggestionMeta] = useState<{
    aiUsed?: boolean
    source?: string | null
    notes?: string | null
    reasonCode?: string | null
  } | null>(null)

  const fingerprintRef = useRef<string | undefined>(undefined)
  const analyzeSeqRef = useRef(0)
  const suggestSeqRef = useRef(0)
  const reviewSeqRef = useRef(0)

  const mySlot = currentUserRosterId ? slotOrder.find((e) => e.rosterId === currentUserRosterId)?.slot : null
  const otherManagers = slotOrder.filter((e) => e.rosterId !== currentUserRosterId)

  const tradesLocked =
    !pickTradeEnabled ||
    draftSessionStatus !== 'in_progress' ||
    Boolean(inventory && !inventory.draftInProgress)

  const fetchProposals = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.proposals)) setProposals(data.proposals)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  const fetchInventory = useCallback(async () => {
    if (!leagueId) return
    setInventoryLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-builder/inventory`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setInventory({
          mine: Array.isArray(data.mine) ? data.mine : [],
          byRosterId: data.byRosterId && typeof data.byRosterId === 'object' ? data.byRosterId : {},
          draftInProgress: data.draftInProgress !== false,
        })
      } else {
        setInventory(null)
      }
    } catch {
      setInventory(null)
    } finally {
      setInventoryLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void fetchProposals()
    void fetchInventory()
  }, [fetchProposals, fetchInventory])

  useEffect(() => {
    if (!draftStateFingerprint) return
    if (fingerprintRef.current === undefined) {
      fingerprintRef.current = draftStateFingerprint
      return
    }
    if (fingerprintRef.current !== draftStateFingerprint) {
      fingerprintRef.current = draftStateFingerprint
      suggestSeqRef.current++
      analyzeSeqRef.current++
      reviewSeqRef.current++
      setSuggestions([])
      setSuggestionsEmptyReason(null)
      setSuggestionMeta(null)
      setLastSuggestionKind(null)
      setBuilderAnalysis(null)
      void fetchInventory()
    }
  }, [draftStateFingerprint, fetchInventory])

  useEffect(() => {
    if (tradePanelGeneration === 0) return
    if (!initialTradeDraft) {
      setOfferGiveRound(1)
      setOfferReceiveRound(1)
      setOfferReceiverRosterId('')
      setOfferError(null)
      setShowOfferForm(false)
      return
    }
    const g = initialTradeDraft.giveRound
    const r = initialTradeDraft.receiveRound
    const recv = initialTradeDraft.receiverRosterId
    if (typeof g === 'number') setOfferGiveRound(Math.min(Math.max(1, g), Math.max(1, rounds)))
    if (typeof r === 'number') setOfferReceiveRound(Math.min(Math.max(1, r), Math.max(1, rounds)))
    if (typeof recv === 'string') setOfferReceiverRosterId(recv)
    setOfferError(null)
    setShowOfferForm(true)
  }, [tradePanelGeneration, initialTradeDraft, rounds])

  const partnerSlot =
    offerReceiverRosterId ? slotOrder.find((e) => e.rosterId === offerReceiverRosterId)?.slot ?? null : null

  useEffect(() => {
    setBuilderAnalysis(null)
  }, [offerGiveRound, offerReceiveRound, offerReceiverRosterId, mySlot, partnerSlot])

  const validGiveRounds = useMemo(() => {
    if (!inventory || mySlot == null) return []
    const s = new Set<number>()
    for (const p of inventory.mine) {
      if (p.slot === mySlot) s.add(p.round)
    }
    return [...s].sort((a, b) => a - b)
  }, [inventory, mySlot])

  const validReceiveRounds = useMemo(() => {
    if (!inventory || !offerReceiverRosterId || partnerSlot == null) return []
    const theirs = inventory.byRosterId[offerReceiverRosterId] ?? []
    const s = new Set<number>()
    for (const p of theirs) {
      if (p.slot === partnerSlot) s.add(p.round)
    }
    return [...s].sort((a, b) => a - b)
  }, [inventory, offerReceiverRosterId, partnerSlot])

  useEffect(() => {
    if (validGiveRounds.length === 0) return
    if (!validGiveRounds.includes(offerGiveRound)) setOfferGiveRound(validGiveRounds[0])
  }, [validGiveRounds, offerGiveRound])

  useEffect(() => {
    if (validReceiveRounds.length === 0) return
    if (!validReceiveRounds.includes(offerReceiveRound)) setOfferReceiveRound(validReceiveRounds[0])
  }, [validReceiveRounds, offerReceiveRound])

  const offerValid =
    Boolean(currentUserRosterId) &&
    Boolean(offerReceiverRosterId) &&
    mySlot != null &&
    partnerSlot != null &&
    validGiveRounds.includes(offerGiveRound) &&
    validReceiveRounds.includes(offerReceiveRound) &&
    !tradesLocked

  const handleAiReview = useCallback(
    async (proposalId: string) => {
      const seq = ++reviewSeqRef.current
      setAiLoading(true)
      setAiReview(null)
      setReviewId(proposalId)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals/${encodeURIComponent(proposalId)}/review`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ includeAiExplanation: tradeAiPremium }),
          }
        )
        const data = await res.json().catch(() => ({}))
        if (seq !== reviewSeqRef.current) return
        if (res.ok && data.ok) {
          const suggestedCounterPackage =
            typeof data.suggestedCounterPackage === 'string'
              ? data.suggestedCounterPackage
              : typeof data.privateAiDmCounterSuggestion === 'string'
                ? data.privateAiDmCounterSuggestion
                : null
          const sa = data.structuredAnalysis
          setAiReview({
            verdict: data.verdict ?? 'accept',
            reasons: Array.isArray(data.reasons) ? data.reasons : [],
            declineReasons: Array.isArray(data.declineReasons) ? data.declineReasons : [],
            counterReasons: Array.isArray(data.counterReasons) ? data.counterReasons : [],
            summary: typeof data.summary === 'string' ? data.summary : '',
            suggestedCounterPackage,
            privateAiDmSent: Boolean(data.privateAiDmSent),
            executionMode: typeof data?.execution?.mode === 'string' ? data.execution.mode : null,
            structuredAnalysis:
              sa &&
              typeof sa === 'object' &&
              typeof sa.moveDirection === 'string' &&
              typeof sa.fairnessBand === 'string'
                ? (sa as StructuredTradeAnalysis)
                : null,
            aiConfidence: typeof data.aiConfidence === 'number' ? data.aiConfidence : null,
          })
        } else if (seq === reviewSeqRef.current) {
          setAiReview({
            verdict: '—',
            reasons: [],
            declineReasons: [],
            counterReasons: [],
            summary: typeof data.error === 'string' ? data.error : 'Could not analyze this offer.',
            suggestedCounterPackage: null,
            privateAiDmSent: false,
            executionMode: null,
            structuredAnalysis: null,
            aiConfidence: null,
          })
        }
      } finally {
        if (seq === reviewSeqRef.current) setAiLoading(false)
      }
    },
    [leagueId, tradeAiPremium],
  )

  const handleRespond = useCallback(
    async (proposalId: string, action: 'accept' | 'reject' | 'counter') => {
      setRespondLoading(proposalId)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals/${encodeURIComponent(proposalId)}/respond`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          }
        )
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) {
          setReviewId(null)
          setAiReview(null)
          await fetchProposals()
          await fetchInventory()
          if ((action === 'accept' || data.action === 'accepted') && data.session) onTradeAccepted?.(data.session)
          else if (action === 'accept') onTradeAccepted?.()
        }
      } finally {
        setRespondLoading(null)
      }
    },
    [leagueId, fetchProposals, fetchInventory, onTradeAccepted],
  )

  const handleCancelProposal = useCallback(
    async (proposalId: string) => {
      setCancelLoading(proposalId)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals/${encodeURIComponent(proposalId)}`,
          { method: 'DELETE' },
        )
        if (res.ok) {
          await fetchProposals()
        }
      } finally {
        setCancelLoading(null)
      }
    },
    [leagueId, fetchProposals],
  )

  const handleSubmitOffer = useCallback(async () => {
    if (!offerValid || !currentUserRosterId || !offerReceiverRosterId || mySlot == null || partnerSlot == null) return
    setOfferSending(true)
    setOfferError(null)
    try {
      const receiver = otherManagers.find((m) => m.rosterId === offerReceiverRosterId)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giveRound: offerGiveRound,
          giveSlot: mySlot,
          receiveRound: offerReceiveRound,
          receiveSlot: partnerSlot,
          receiverRosterId: offerReceiverRosterId,
          receiverName: receiver?.displayName ?? '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setShowOfferForm(false)
        setBuilderAnalysis(null)
        await fetchProposals()
        await fetchInventory()
      } else {
        setOfferError(typeof data.error === 'string' ? data.error : 'Failed to send offer')
      }
    } finally {
      setOfferSending(false)
    }
  }, [
    leagueId,
    currentUserRosterId,
    offerReceiverRosterId,
    offerGiveRound,
    offerReceiveRound,
    mySlot,
    partnerSlot,
    otherManagers,
    fetchProposals,
    fetchInventory,
    offerValid,
  ])

  const analyzeBuilder = useCallback(async () => {
    if (!offerValid || !currentUserRosterId || !offerReceiverRosterId || mySlot == null || partnerSlot == null) return
    const seq = ++analyzeSeqRef.current
    setAnalyzeLoading(true)
    setBuilderAnalysis(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-builder/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giveRound: offerGiveRound,
          giveSlot: mySlot,
          receiveRound: offerReceiveRound,
          receiveSlot: partnerSlot,
          receiverRosterId: offerReceiverRosterId,
          includeAiExplanation: tradeAiPremium,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (seq !== analyzeSeqRef.current) return
      if (res.ok && data.ok) {
        const sa = data.structuredAnalysis
        setBuilderAnalysis({
          verdict: data.verdict ?? 'neutral',
          reasons: Array.isArray(data.reasons) ? data.reasons : [],
          declineReasons: Array.isArray(data.declineReasons) ? data.declineReasons : [],
          counterReasons: Array.isArray(data.counterReasons) ? data.counterReasons : [],
          summary: typeof data.summary === 'string' ? data.summary : '',
          suggestedCounterPackage:
            typeof data.suggestedCounterPackage === 'string' ? data.suggestedCounterPackage : null,
          executionMode: typeof data?.execution?.mode === 'string' ? data.execution.mode : null,
          structuredAnalysis:
            sa &&
            typeof sa === 'object' &&
            typeof sa.moveDirection === 'string' &&
            typeof sa.fairnessBand === 'string'
              ? (sa as StructuredTradeAnalysis)
              : null,
          aiConfidence: typeof data.aiConfidence === 'number' ? data.aiConfidence : null,
        })
      } else {
        setBuilderAnalysis({
          verdict: '—',
          reasons: [],
          declineReasons: [],
          counterReasons: [],
          summary: typeof data.error === 'string' ? data.error : 'Could not analyze this trade.',
          suggestedCounterPackage: null,
          executionMode: null,
        })
      }
    } finally {
      if (seq === analyzeSeqRef.current) setAnalyzeLoading(false)
    }
  }, [
    leagueId,
    offerValid,
    currentUserRosterId,
    offerReceiverRosterId,
    offerGiveRound,
    offerReceiveRound,
    mySlot,
    partnerSlot,
    tradeAiPremium,
  ])

  const fetchSuggestions = useCallback(
    async (kind: DraftPickTradeSuggestionKind) => {
      if (!offerReceiverRosterId || tradesLocked) return
      const seq = ++suggestSeqRef.current
      setSuggestLoading(true)
      setSuggestions([])
      setSuggestionsEmptyReason(null)
      setSuggestionMeta(null)
      setLastSuggestionKind(kind)
      try {
        const payload: Record<string, unknown> = {
          partnerRosterId: offerReceiverRosterId,
          suggestionKind: kind,
          includeAi: tradeAiPremium,
        }
        if (kind === 'best_for_pick') {
          if (mySlot == null) {
            if (seq === suggestSeqRef.current) {
              setSuggestionsEmptyReason('Select your slot / partner so we can anchor “your pick”.')
              setSuggestLoading(false)
            }
            return
          }
          payload.anchorGiveRound = offerGiveRound
          payload.anchorGiveSlot = mySlot
        }
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/trade-builder/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (seq !== suggestSeqRef.current) return
        if (res.ok && data.ok && Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions)
          setSuggestionsEmptyReason(typeof data.emptyReason === 'string' ? data.emptyReason : null)
          setSuggestionMeta({
            aiUsed: Boolean(data.aiUsed),
            source: typeof data.suggestionSource === 'string' ? data.suggestionSource : null,
            notes: typeof data.aiStrategyNotes === 'string' ? data.aiStrategyNotes : null,
            reasonCode: typeof data.execution?.reasonCode === 'string' ? data.execution.reasonCode : null,
          })
        } else {
          setSuggestionsEmptyReason(typeof data.error === 'string' ? data.error : 'No suggestions available.')
        }
      } catch {
        if (seq === suggestSeqRef.current) setSuggestionsEmptyReason('Network error loading suggestions.')
      } finally {
        if (seq === suggestSeqRef.current) setSuggestLoading(false)
      }
    },
    [leagueId, offerReceiverRosterId, tradesLocked, offerGiveRound, mySlot, tradeAiPremium],
  )

  const applySuggestion = useCallback(
    (s: DraftPickTradeSuggestion) => {
      if (tradesLocked) return
      if (mySlot != null && s.giveSlot !== mySlot) return
      if (partnerSlot != null && s.receiveSlot !== partnerSlot) return
      setOfferGiveRound(s.giveRound)
      setOfferReceiveRound(s.receiveRound)
      setBuilderAnalysis(null)
    },
    [tradesLocked, mySlot, partnerSlot],
  )

  const pendingForMe = proposals.filter((p) => p.status === 'pending' && p.receiverRosterId === currentUserRosterId)
  const pendingFromMe = proposals.filter((p) => p.status === 'pending' && p.proposerRosterId === currentUserRosterId)

  return (
    <DraftPickTradePanelRoot
      className="flex max-h-[min(92vh,940px)] min-h-0 w-full flex-col overflow-hidden rounded-3xl border-0 shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
      presentationVariant={presentationVariant}
      leagueName={leagueName}
      tradesLocked={tradesLocked}
      pickTradeEnabled={pickTradeEnabled}
      draftSessionStatus={draftSessionStatus}
      loading={loading}
      inventoryLoading={inventoryLoading}
      inventory={inventory}
      currentUserRosterId={currentUserRosterId}
      onClose={onClose}
      showOfferForm={showOfferForm}
      setShowOfferForm={setShowOfferForm}
      offerSending={offerSending}
      offerError={offerError}
      offerGiveRound={offerGiveRound}
      offerReceiveRound={offerReceiveRound}
      offerReceiverRosterId={offerReceiverRosterId}
      setOfferGiveRound={setOfferGiveRound}
      setOfferReceiveRound={setOfferReceiveRound}
      setOfferReceiverRosterId={setOfferReceiverRosterId}
      setOfferError={setOfferError}
      mySlot={mySlot ?? null}
      partnerSlot={partnerSlot}
      otherManagers={otherManagers}
      slotOrder={slotOrder}
      handleSubmitOffer={handleSubmitOffer}
      offerValid={offerValid}
      validGiveRounds={validGiveRounds}
      validReceiveRounds={validReceiveRounds}
      proposals={proposals}
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
      rounds={rounds}
      teamCount={teamCount}
      builderAnalysis={builderAnalysis}
      analyzeLoading={analyzeLoading}
      analyzeBuilder={analyzeBuilder}
      suggestions={suggestions}
      suggestionsEmptyReason={suggestionsEmptyReason}
      suggestLoading={suggestLoading}
      fetchSuggestions={fetchSuggestions}
      applySuggestion={applySuggestion}
      lastSuggestionKind={lastSuggestionKind}
      suggestionMeta={suggestionMeta}
      tradeAiPremium={tradeAiPremium}
      onClockTradeTimerBehavior={onClockTradeTimerBehavior}
    />
  )
}

export default DraftPickTradePanel
