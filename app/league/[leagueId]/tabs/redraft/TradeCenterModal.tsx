'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppModal } from '@/components/ui/AppModal'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { TradeValueBreakdown } from '@/components/trade-value/TradeValueBreakdown'
import {
  createTradeProposal,
  fetchRedraftRoster,
  type RedraftRosterClient,
  type RedraftRosterPlayerClient,
  type RedraftRosterRow,
  type RedraftTradeAssetInput,
  type RedraftTradeSettings,
  type TradeDecisionOsCard,
} from '@/lib/redraft/client'
import { MAX_REDRAFT_TRADE_TEAMS, uninvolvedTradeParticipants } from '@/lib/redraft/tradeParticipants'

type Step = 'partner' | 'assets' | 'review'

/** `receiptGradeFields` from the preview route: the one grade, from the proposer's side. */
type PreviewGrade = {
  grade: string | null
  partnerGrade: string | null
  gradeLabel: string | null
  gradeWithheld: string | null
  giveValue: number | null
  getValue: number | null
  evaluationReceiptId: string | null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function rosterLabel(row: RedraftRosterRow | undefined, fallbackId: string): string {
  return row?.teamName ?? row?.ownerName ?? fallbackId.slice(0, 6)
}

function playerSelId(p: RedraftRosterPlayerClient): string {
  return p.playerId || p.id
}

function playerToAsset(
  p: RedraftRosterPlayerClient,
  fromRosterId: string,
  toRosterId: string,
): RedraftTradeAssetInput {
  return {
    fromRosterId,
    toRosterId,
    assetType: 'player',
    playerId: p.playerId,
    playerName: p.playerName,
    metadata: {
      position: p.position,
      team: p.team,
      injuryStatus: p.injuryStatus,
      restOfSeasonProjection: p.restOfSeasonProjection ?? null,
    },
  }
}

function faabAsset(amount: number, fromRosterId: string, toRosterId: string): RedraftTradeAssetInput {
  return { fromRosterId, toRosterId, assetType: 'faab', metadata: { amount } }
}

function PlayerCard({
  player,
  selected,
  onToggle,
}: {
  player: RedraftRosterPlayerClient
  selected: boolean
  onToggle: () => void
}) {
  const proj = player.restOfSeasonProjection ?? player.weeklyProjection ?? null
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      data-testid={`trade-asset-player-${player.playerId || player.id}`}
      className={[
        'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] transition',
        selected
          ? 'border-emerald-300/70 bg-emerald-400/15 text-white'
          : 'border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25',
      ].join(' ')}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{player.playerName}</span>
        <span className="text-[11px] text-white/50">
          {player.position}
          {player.team ? ` · ${player.team}` : ''}
          {player.byeWeek ? ` · BYE ${player.byeWeek}` : ''}
          {player.injuryStatus ? ` · ${player.injuryStatus}` : ''}
          {player.isLocked ? ' · 🔒' : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] text-white/55">
        {proj != null ? `${proj.toFixed(1)} pts` : '—'}
      </span>
    </button>
  )
}

export function TradeCenterModal({
  open,
  onClose,
  leagueId,
  seasonId,
  standings,
  currentWeek,
  myRosterId,
  settings,
  faabByRosterId,
  onSubmitted,
  initialReceiverRosterId = null,
}: {
  open: boolean
  onClose: () => void
  leagueId: string
  seasonId: string
  standings: RedraftRosterRow[]
  currentWeek: number
  myRosterId: string | null
  settings: RedraftTradeSettings | null
  faabByRosterId: Record<string, number>
  onSubmitted?: () => void
  /** T7: when set (e.g. from "Build proposal"), preselect this partner and open at the assets step. */
  initialReceiverRosterId?: string | null
}) {
  const [step, setStep] = useState<Step>('partner')
  const [proposerRosterId, setProposerRosterId] = useState<string>('')
  const [receiverRosterId, setReceiverRosterId] = useState<string>('')
  const [proposerRoster, setProposerRoster] = useState<RedraftRosterClient | null>(null)
  const [receiverRoster, setReceiverRoster] = useState<RedraftRosterClient | null>(null)
  const [assetLoading, setAssetLoading] = useState(false)
  const [mineSel, setMineSel] = useState<string[]>([])
  const [theirsSel, setTheirsSel] = useState<string[]>([])
  const [mineFaab, setMineFaab] = useState(0)
  const [theirsFaab, setTheirsFaab] = useState(0)
  /*
   * MULTI-TEAM TRADES: up to two more teams beyond the receiver (four in all). With none chosen,
   * every piece of this modal is the two-team flow it always was — these stay empty and unused.
   */
  const [extraPartnerIds, setExtraPartnerIds] = useState<string[]>([])
  /** Loaded once per team; `null` records a team whose roster came back empty, so it is not refetched. */
  const [extraRosters, setExtraRosters] = useState<Record<string, RedraftRosterClient | null>>({})
  const [extraSel, setExtraSel] = useState<Record<string, string[]>>({})
  const [extraFaab, setExtraFaab] = useState<Record<string, number>>({})
  /** Multi-team only: which team receives each chosen asset, keyed `${fromRosterId}:${playerId | 'faab'}`. */
  const [destOf, setDestOf] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  /*
   * Decision OS Slice 3 — the deterministic evaluation POST /api/redraft/trade-proposals already
   * computes and returns with the created proposal. Until now the client's response type
   * (`{ proposal }`) typed it away, so the route paid for an evaluation nobody saw — the same
   * discard WaiverWirePage's Phase 1 card fixed on the waiver surface. Null when the live runner
   * is off or had nothing to say; the success view simply says less in that case.
   */
  const [decisionOs, setDecisionOs] = useState<TradeDecisionOsCard | null>(null)

  const rosterRowById = useMemo(() => {
    const m = new Map<string, RedraftRosterRow>()
    for (const r of standings) m.set(r.id, r)
    return m
  }, [standings])

  // Reset when (re)opened. Proposer defaults to the viewer's own roster.
  useEffect(() => {
    if (!open) return
    const preselect = initialReceiverRosterId && standings.some((r) => r.id === initialReceiverRosterId) ? initialReceiverRosterId : ''
    setStep(preselect ? 'assets' : 'partner')
    setReceiverRosterId(preselect)
    setMineSel([])
    setTheirsSel([])
    setMineFaab(0)
    setTheirsFaab(0)
    setExtraPartnerIds([])
    setExtraRosters({})
    setExtraSel({})
    setExtraFaab({})
    setDestOf({})
    setReason('')
    setError(null)
    setSuccessId(null)
    setDecisionOs(null)
    const defaultProposer = myRosterId && standings.some((r) => r.id === myRosterId)
      ? myRosterId
      : standings[0]?.id ?? ''
    setProposerRosterId(defaultProposer)
  }, [open, myRosterId, standings, initialReceiverRosterId])

  // Load both rosters' players once a partner is chosen.
  useEffect(() => {
    if (!open || !proposerRosterId || !receiverRosterId || proposerRosterId === receiverRosterId) {
      setProposerRoster(null)
      setReceiverRoster(null)
      return
    }
    let cancelled = false
    setAssetLoading(true)
    ;(async () => {
      try {
        const [a, b] = await Promise.all([
          fetchRedraftRoster(proposerRosterId, currentWeek),
          fetchRedraftRoster(receiverRosterId, currentWeek),
        ])
        if (!cancelled) {
          setProposerRoster(a)
          setReceiverRoster(b)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load rosters')
      } finally {
        if (!cancelled) setAssetLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, proposerRosterId, receiverRosterId, currentWeek])

  const partners = useMemo(
    () => standings.filter((r) => r.id !== proposerRosterId),
    [standings, proposerRosterId],
  )

  // The extra teams can never include the proposer or the receiver.
  useEffect(() => {
    setExtraPartnerIds((prev) => prev.filter((id) => id !== receiverRosterId && id !== proposerRosterId))
  }, [receiverRosterId, proposerRosterId])

  const multiTeam = extraPartnerIds.length > 0
  const participantIds = useMemo(
    () => (proposerRosterId && receiverRosterId ? [proposerRosterId, receiverRosterId, ...extraPartnerIds] : []),
    [proposerRosterId, receiverRosterId, extraPartnerIds],
  )

  // Load each extra team's players.
  useEffect(() => {
    if (!open || extraPartnerIds.length === 0) return
    const missing = extraPartnerIds.filter((id) => !(id in extraRosters))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await Promise.all(missing.map((id) => fetchRedraftRoster(id, currentWeek)))
        if (!cancelled) {
          setExtraRosters((prev) => {
            const next = { ...prev }
            missing.forEach((id, i) => {
              next[id] = loaded[i] ?? null
            })
            return next
          })
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load rosters')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, extraPartnerIds, extraRosters, currentWeek])

  const toggleExtraPartner = (id: string) => {
    setExtraPartnerIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_REDRAFT_TRADE_TEAMS - 2
          ? prev
          : [...prev, id],
    )
  }

  /** Multi-team: where an asset goes. Defaults to the receiver for the proposer's assets, else the proposer. */
  const destinationFor = (fromRosterId: string, key: string): string => {
    const chosen = destOf[`${fromRosterId}:${key}`]
    if (chosen && chosen !== fromRosterId && participantIds.includes(chosen)) return chosen
    return fromRosterId === proposerRosterId ? receiverRosterId : proposerRosterId
  }

  const mineFaabAvail = faabByRosterId[proposerRosterId] ?? 0
  const theirsFaabAvail = faabByRosterId[receiverRosterId] ?? 0

  const selectedMinePlayers = useMemo(
    () => (proposerRoster?.players ?? []).filter((p) => mineSel.includes(playerSelId(p))),
    [proposerRoster, mineSel],
  )
  const selectedTheirsPlayers = useMemo(
    () => (receiverRoster?.players ?? []).filter((p) => theirsSel.includes(playerSelId(p))),
    [receiverRoster, theirsSel],
  )

  const mineHasAssets = selectedMinePlayers.length > 0 || mineFaab > 0
  const theirsHasAssets = selectedTheirsPlayers.length > 0 || theirsFaab > 0

  const selectedExtraPlayers = useMemo(() => {
    const out: Record<string, RedraftRosterPlayerClient[]> = {}
    for (const id of extraPartnerIds) {
      const picked = extraSel[id] ?? []
      out[id] = (extraRosters[id]?.players ?? []).filter((p) => picked.includes(playerSelId(p)))
    }
    return out
  }, [extraPartnerIds, extraRosters, extraSel])

  const deadlinePassed =
    settings?.tradeDeadlineWeek != null && currentWeek > settings.tradeDeadlineWeek
  const lockedSelected =
    selectedMinePlayers.some((p) => p.isLocked) ||
    selectedTheirsPlayers.some((p) => p.isLocked) ||
    (multiTeam && Object.values(selectedExtraPlayers).some((ps) => ps.some((p) => p.isLocked)))
  const faabOver =
    mineFaab > mineFaabAvail ||
    theirsFaab > theirsFaabAvail ||
    (multiTeam && extraPartnerIds.some((id) => (extraFaab[id] ?? 0) > (faabByRosterId[id] ?? 0)))

  const apiAssets = useMemo<RedraftTradeAssetInput[]>(() => {
    if (!proposerRosterId || !receiverRosterId) return []
    if (multiTeam) {
      // Every chosen asset goes to the team picked for it.
      const out: RedraftTradeAssetInput[] = []
      const add = (fromRosterId: string, players: RedraftRosterPlayerClient[], faab: number) => {
        for (const p of players) out.push(playerToAsset(p, fromRosterId, destinationFor(fromRosterId, playerSelId(p))))
        if (faab > 0) out.push(faabAsset(faab, fromRosterId, destinationFor(fromRosterId, 'faab')))
      }
      add(proposerRosterId, selectedMinePlayers, mineFaab)
      add(receiverRosterId, selectedTheirsPlayers, theirsFaab)
      for (const id of extraPartnerIds) add(id, selectedExtraPlayers[id] ?? [], extraFaab[id] ?? 0)
      return out
    }
    const out: RedraftTradeAssetInput[] = [
      ...selectedMinePlayers.map((p) => playerToAsset(p, proposerRosterId, receiverRosterId)),
      ...selectedTheirsPlayers.map((p) => playerToAsset(p, receiverRosterId, proposerRosterId)),
    ]
    if (mineFaab > 0) out.push(faabAsset(mineFaab, proposerRosterId, receiverRosterId))
    if (theirsFaab > 0) out.push(faabAsset(theirsFaab, receiverRosterId, proposerRosterId))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- destinationFor reads destOf + participantIds, listed
  }, [proposerRosterId, receiverRosterId, selectedMinePlayers, selectedTheirsPlayers, mineFaab, theirsFaab, multiTeam, extraPartnerIds, selectedExtraPlayers, extraFaab, destOf, participantIds])

  /** Multi-team: every team must send or receive something. */
  const uninvolvedIds = useMemo(
    () => (multiTeam ? uninvolvedTradeParticipants(participantIds, apiAssets) : []),
    [multiTeam, participantIds, apiAssets],
  )
  const assetsReady = multiTeam ? apiAssets.length > 0 && uninvolvedIds.length === 0 : mineHasAssets && theirsHasAssets

  /*
   * ⚠ THE FALLBACK, NOT THE ANSWER. This runs the same engine, but on what a browser can see:
   * a projection and nothing else. Four of the five value sources are null here, `sport` and
   * `scoring` are empty, and there is no `ScoringContext` — so no `LeagueShape`, which means
   * standard-league scarcity for everybody and no format fit at all.
   *
   * `serverPreview` below replaces it whenever the route answers. This is kept because a failed
   * fetch must degrade to a rough number that SAYS it is rough, rather than to an empty panel —
   * and because it renders instantly while the request is in flight.
   */
  const clientPreview = useMemo(() => {
    // A value preview is one side against the other: two-team trades only.
    if (multiTeam) return null
    if (!proposerRosterId || !receiverRosterId || (!mineHasAssets && !theirsHasAssets)) return null
    const enriched: EnrichedTradeAsset[] = [
      ...selectedMinePlayers.map((p) => ({
        kind: 'player' as const, fromRosterId: proposerRosterId, toRosterId: receiverRosterId,
        playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team,
        sources: { projectionValue: p.restOfSeasonProjection ?? p.weeklyProjection ?? null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null },
      })),
      ...selectedTheirsPlayers.map((p) => ({
        kind: 'player' as const, fromRosterId: receiverRosterId, toRosterId: proposerRosterId,
        playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team,
        sources: { projectionValue: p.restOfSeasonProjection ?? p.weeklyProjection ?? null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null },
      })),
    ]
    if (mineFaab > 0) enriched.push({ kind: 'faab', fromRosterId: proposerRosterId, toRosterId: receiverRosterId, faabAmount: mineFaab, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null } })
    if (theirsFaab > 0) enriched.push({ kind: 'faab', fromRosterId: receiverRosterId, toRosterId: proposerRosterId, faabAmount: theirsFaab, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null } })
    return buildTradeValueSnapshot({
      proposerRosterId, receiverRosterId, assets: enriched, currentSeason: null,
      context: { sport: '', leagueType: 'redraft', scoring: '', rosterFormat: 'standard', capturedAt: new Date().toISOString() },
    })
  }, [multiTeam, proposerRosterId, receiverRosterId, selectedMinePlayers, selectedTheirsPlayers, mineFaab, theirsFaab, mineHasAssets, theirsHasAssets])

  /*
   * The REAL valuation, from the same function that writes the captured snapshot.
   *
   * 🛑 THE MODAL CANNOT DO THIS ITSELF. `resolveTradeEnrichment` is `server-only`, which is why
   * the client copy above exists at all and why it is so much poorer. Fetching means the number a
   * manager sees before sending and the number recorded on the proposal are produced by one
   * function rather than two that drift.
   */
  const [serverPreview, setServerPreview] = useState<TradeValueSnapshot | null>(null)
  /*
   * 🛑 THE ONE GRADE, from the preview route (Trade OS, 2026-09-27) — the letter and the totals shown
   * beside it. The snapshot's own letter is another scale, and the client estimate is projections
   * only; neither is shown as a letter any more. No server grade means no letter.
   */
  const [serverGrade, setServerGrade] = useState<PreviewGrade | null>(null)
  const [previewPending, setPreviewPending] = useState(false)

  useEffect(() => {
    // Two-team only: the preview route grades the proposer's side against the receiver's.
    if (multiTeam || !proposerRosterId || !receiverRosterId || apiAssets.length === 0) {
      setServerPreview(null)
      setServerGrade(null)
      return
    }

    /*
     * ⚠ DEBOUNCED AND ABORTED, because this fires on every player click. Without the abort a slow
     * early response can land after a fast later one and show a valuation for a selection the
     * manager has already changed — a stale number that looks live.
     */
    const ac = new AbortController()
    setPreviewPending(true)
    const t = setTimeout(() => {
      fetch('/api/redraft/trade-value-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, seasonId, proposerRosterId, receiverRosterId, assets: apiAssets }),
        signal: ac.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (ac.signal.aborted) return
          setServerPreview(j?.snapshot ?? null)
          setServerGrade(j?.tradeGrade ?? null)
        })
        /*
         * Deliberately silent: a failed preview falls back to the client estimate, which is
         * labelled as an estimate. Surfacing a red error for a number that is still shown would
         * be noise, and the label already tells the truth.
         */
        .catch(() => { if (!ac.signal.aborted) { setServerPreview(null); setServerGrade(null) } })
        .finally(() => { if (!ac.signal.aborted) setPreviewPending(false) })
    }, 400)

    return () => { ac.abort(); clearTimeout(t); }
  }, [multiTeam, leagueId, seasonId, proposerRosterId, receiverRosterId, apiAssets])

  const valuePreview = serverPreview ?? clientPreview
  const previewIsEstimate = serverPreview === null && clientPreview !== null

  const canSubmit = Boolean(
    seasonId && proposerRosterId && receiverRosterId && assetsReady &&
      !deadlinePassed && !faabOver && !submitting,
  )

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await createTradeProposal({
        leagueId,
        seasonId,
        proposerRosterId,
        receiverRosterId,
        ...(multiTeam ? { additionalRosterIds: extraPartnerIds } : {}),
        reason: reason.trim() || undefined,
        assets: apiAssets,
      })
      setSuccessId(res.proposal?.id ?? 'created')
      setDecisionOs(res.decisionOs ?? null)
      onSubmitted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit trade')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, leagueId, seasonId, proposerRosterId, receiverRosterId, multiTeam, extraPartnerIds, reason, apiAssets, onSubmitted])

  const proposerName = rosterLabel(rosterRowById.get(proposerRosterId), proposerRosterId)
  const receiverName = rosterLabel(rosterRowById.get(receiverRosterId), receiverRosterId)
  const nameOf = (id: string) => rosterLabel(rosterRowById.get(id), id)

  /** Every team's side of the board, in participant order. Two entries for a two-team trade. */
  const sides = [
    { key: 'mine', rosterId: proposerRosterId, roster: proposerRoster, sel: mineSel, setSel: setMineSel, faab: mineFaab, setFaab: setMineFaab, faabAvail: mineFaabAvail, name: proposerName },
    { key: 'theirs', rosterId: receiverRosterId, roster: receiverRoster, sel: theirsSel, setSel: setTheirsSel, faab: theirsFaab, setFaab: setTheirsFaab, faabAvail: theirsFaabAvail, name: receiverName },
    ...extraPartnerIds.map((id) => ({
      key: `extra-${id}`,
      rosterId: id,
      roster: extraRosters[id] ?? null,
      sel: extraSel[id] ?? [],
      setSel: (fn: (prev: string[]) => string[]) => setExtraSel((prev) => ({ ...prev, [id]: fn(prev[id] ?? []) })),
      faab: extraFaab[id] ?? 0,
      setFaab: (n: number) => setExtraFaab((prev) => ({ ...prev, [id]: n })),
      faabAvail: faabByRosterId[id] ?? 0,
      name: nameOf(id),
    })),
  ]

  const footer = successId ? (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-[#ff3d81]/80 px-4 py-1.5 text-[12px] font-semibold text-black"
      >
        Done
      </button>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        data-testid="trade-step-back"
        onClick={() => setStep((s) => (s === 'review' ? 'assets' : 'partner'))}
        disabled={step === 'partner'}
        className="rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-white/80 disabled:opacity-40"
      >
        Back
      </button>
      {step === 'review' ? (
        <button
          type="button"
          data-testid="trade-submit"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="rounded-lg bg-emerald-500/85 px-4 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
        >
          {submitting ? 'Submitting…' : 'Submit proposal'}
        </button>
      ) : (
        <button
          type="button"
          data-testid="trade-step-next"
          onClick={() => setStep((s) => (s === 'partner' ? 'assets' : 'review'))}
          disabled={
            (step === 'partner' && (!receiverRosterId || receiverRosterId === proposerRosterId)) ||
            (step === 'assets' && !assetsReady)
          }
          className="rounded-lg bg-[#ff3d81]/85 px-4 py-1.5 text-[12px] font-semibold text-black disabled:opacity-40"
        >
          Next
        </button>
      )}
    </div>
  )

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Propose a Trade"
      description={`Step ${step === 'partner' ? 1 : step === 'assets' ? 2 : 3} of 3 · ${proposerName}`}
      size="xl"
      footer={footer}
      data-testid="trade-center-modal"
    >
      {successId ? (
        <div className="space-y-2 py-6 text-center" data-testid="trade-success">
          <p className="text-[15px] font-semibold text-emerald-300">Trade proposal sent</p>
          <p className="text-[12px] text-white/60">
            {multiTeam
              ? `${[proposerName, receiverName, ...extraPartnerIds.map(nameOf)].join(', ')}. Every team has to accept before it goes through.`
              : `${proposerName} → ${receiverName}. The other manager can now review and respond.`}
          </p>
          {decisionOs ? (
            /*
             * Same render contract as WaiverWirePage's Phase 1 Decision OS card: the
             * four-answers text, legality, and an honesty number. Deliberately NO letter
             * grade — the engine's fallback grade is indistinguishable from a zero-data
             * grade, so this states data completeness, the claim it can actually back.
             */
            <div
              className="mx-auto max-w-md rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-left"
              data-testid="trade-decision-os-card"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-violet-200/80">
                <span className="font-medium text-violet-200">Decision OS</span>
                <span>
                  Data completeness {Math.round(decisionOs.completeness)}/100
                  {!decisionOs.card.legal ? ' · Blocked by league rules' : ''}
                </span>
              </div>
              <p className="text-sm text-white">{decisionOs.card.title}</p>
              <p className="mt-0.5 text-xs text-white/70">{decisionOs.card.subtitle}</p>
              <p className="mt-1 text-xs text-[#ffb8d1]">{decisionOs.card.detail}</p>
            </div>
          ) : null}
        </div>
      ) : step === 'partner' ? (
        <div className="space-y-3">
          <p className="text-[12px] text-white/60">Choose the team you want to trade with.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {partners.map((r) => {
              const sel = r.id === receiverRosterId
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={sel}
                  data-testid={`trade-partner-card-${r.id}`}
                  onClick={() => setReceiverRosterId(r.id)}
                  className={[
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    sel ? 'border-[#ff9ec0]/70 bg-[#ff3d81]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25',
                  ].join(' ')}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold text-white">
                    {initials(rosterLabel(r, r.id))}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">{rosterLabel(r, r.id)}</span>
                    <span className="block truncate text-[11px] text-white/50">
                      {r.ownerName ?? 'Manager'} · {r.wins}-{r.losses}
                      {r.ties ? `-${r.ties}` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {receiverRosterId && partners.length > 1 ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2" data-testid="trade-extra-partners">
              <p className="text-[11px] text-white/55">
                Make it a multi-team trade: add up to {MAX_REDRAFT_TRADE_TEAMS - 2} more teams. Every team has to
                send or receive something, and every team has to accept before it goes through.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {partners
                  .filter((r) => r.id !== receiverRosterId)
                  .map((r) => {
                    const on = extraPartnerIds.includes(r.id)
                    const full = !on && extraPartnerIds.length >= MAX_REDRAFT_TRADE_TEAMS - 2
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        disabled={full}
                        data-testid={`trade-extra-partner-${r.id}`}
                        onClick={() => toggleExtraPartner(r.id)}
                        className={[
                          'rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40',
                          on ? 'border-[#ff9ec0]/70 bg-[#ff3d81]/15 text-white' : 'border-white/15 text-white/70 hover:border-white/30',
                        ].join(' ')}
                      >
                        {on ? '✓ ' : '+ '}
                        {rosterLabel(r, r.id)}
                      </button>
                    )
                  })}
              </div>
            </div>
          ) : null}
        </div>
      ) : step === 'assets' ? (
        <div className={multiTeam ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3 lg:grid-cols-[1fr_1fr_0.9fr]'}>
          {sides.map((s) => {
            const { roster, sel, setSel, faab, setFaab, faabAvail, name } = s
            const side = s.key
            /** Multi-team: the "to" picker under a chosen asset. */
            const destPicker = (key: string) =>
              multiTeam ? (
                <label className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-white/50">
                  To
                  <select
                    value={destinationFor(s.rosterId, key)}
                    data-testid={`trade-dest-${s.rosterId}-${key}`}
                    onChange={(e) => setDestOf((prev) => ({ ...prev, [`${s.rosterId}:${key}`]: e.target.value }))}
                    className="rounded border border-white/15 bg-black/40 px-1 py-0.5 text-[11px] text-white"
                  >
                    {participantIds
                      .filter((id) => id !== s.rosterId)
                      .map((id) => (
                        <option key={id} value={id}>
                          {nameOf(id)}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null
            return (
              <section key={side} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <p className="text-[12px] font-semibold text-white">{name} sends</p>
                <div className="space-y-1.5">
                  {assetLoading ? (
                    <p className="text-[11px] text-white/45">Loading roster…</p>
                  ) : (roster?.players ?? []).length ? (
                    (roster?.players ?? []).map((p) => (
                      <div key={p.id}>
                        <PlayerCard
                          player={p}
                          selected={sel.includes(playerSelId(p))}
                          onToggle={() =>
                            setSel((prev) =>
                              prev.includes(playerSelId(p))
                                ? prev.filter((x) => x !== playerSelId(p))
                                : [...prev, playerSelId(p)],
                            )
                          }
                        />
                        {sel.includes(playerSelId(p)) ? destPicker(playerSelId(p)) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-white/45">No players.</p>
                  )}
                </div>
                {faabAvail > 0 ? (
                  <label className="block text-[11px] text-white/55">
                    FAAB ({faabAvail} available)
                    <input
                      type="number"
                      min={0}
                      max={faabAvail}
                      value={faab || ''}
                      data-testid={`trade-faab-${side}`}
                      onChange={(e) => setFaab(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-[11px] text-white"
                    />
                    {faab > 0 ? destPicker('faab') : null}
                  </label>
                ) : null}
                {settings?.draftPickTrading ? (
                  <p className="rounded border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-[11px] text-sky-200/70">
                    Draft picks can’t be offered here — a pick would be recorded without ever changing hands.
                    Dynasty leagues trade future picks in the Trade Center.
                  </p>
                ) : null}
              </section>
            )
          })}
          <aside className={['space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5', multiTeam ? 'md:col-span-2' : ''].join(' ')}>
            <p className="text-[12px] font-semibold text-white">Trade summary</p>
            {multiTeam ? (
              <MultiTeamSummary participantIds={participantIds} assets={apiAssets} nameOf={nameOf} />
            ) : (
              <>
                <SummarySide label={`${proposerName} sends`} players={selectedMinePlayers} faab={mineFaab} />
                <SummarySide label={`${receiverName} sends`} players={selectedTheirsPlayers} faab={theirsFaab} />
              </>
            )}
            {multiTeam && uninvolvedIds.length > 0 ? (
              <p className="text-[11px] text-amber-200/80" data-testid="trade-uninvolved-teams">
                {uninvolvedIds.map(nameOf).join(', ')} {uninvolvedIds.length === 1 ? 'has' : 'have'} nothing in this
                trade yet. Every team has to send or receive something.
              </p>
            ) : null}
            {faabOver ? <p className="text-[11px] text-rose-300">FAAB exceeds available balance.</p> : null}
          </aside>
        </div>
      ) : (
        <div className="space-y-3">
          {multiTeam ? (
            <>
              <MultiTeamSummary participantIds={participantIds} assets={apiAssets} nameOf={nameOf} />
              <p className="text-[11px] text-white/45" data-testid="trade-multi-team-grade-note">
                Grades are shown for two-team trades. Every team has to accept this one before it goes through.
              </p>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewSide label={`${proposerName} sends`} players={selectedMinePlayers} faab={mineFaab} />
              <ReviewSide label={`${receiverName} sends`} players={selectedTheirsPlayers} faab={theirsFaab} />
            </div>
          )}

          {valuePreview ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3" data-testid="trade-value-panel">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-white">Trade Value</p>
                {serverGrade?.grade ? (
                  <span
                    className="rounded-md border border-[#ff9ec0]/40 bg-[#ff3d81]/10 px-2 py-0.5 text-[13px] font-bold text-[#ffd7e5]"
                    data-testid="trade-value-grade"
                  >
                    {serverGrade.grade}
                  </span>
                ) : null}
              </div>
              {serverGrade?.grade && serverGrade.giveValue != null && serverGrade.getValue != null ? (
                <div className="grid grid-cols-2 gap-2 text-[11px]" data-testid="trade-value-grade-totals">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-white/50">{proposerName} sends</p>
                    <p className="text-[15px] font-bold text-white">{Math.round(serverGrade.giveValue)}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-white/50">{proposerName} gets</p>
                    <p className="text-[15px] font-bold text-white">{Math.round(serverGrade.getValue)}</p>
                  </div>
                </div>
              ) : serverGrade?.gradeWithheld ? (
                <p className="text-[11px] text-white/60" data-testid="trade-value-grade-withheld">Not graded: {serverGrade.gradeWithheld}</p>
              ) : null}
              {serverGrade?.gradeLabel ? <p className="text-[11px] text-white/70">{serverGrade.gradeLabel}</p> : null}
              {/*
                * Phase 6.2/6.3/6.4 — the derivation, not just the verdict. Everything below was
                * already computed and stored by the engine and rendered nowhere, which made the
                * grade a number to accept or dismiss rather than one to argue with.
                */}
              <details className="group" data-testid="trade-value-why">
                <summary className="cursor-pointer list-none text-[11px] font-medium text-[#ffd7e5]/80 hover:text-[#ffd7e5]">
                  <span className="group-open:hidden">The valuation recorded with the proposal ▸</span>
                  <span className="hidden group-open:inline">The valuation recorded with the proposal ▾</span>
                </summary>
                <div className="mt-2">
                  <TradeValueBreakdown
                    snapshot={valuePreview}
                    sideNames={{ [proposerRosterId]: proposerName, [receiverRosterId]: receiverName }}
                  />
                </div>
              </details>
              {/*
                * 🛑 SAY WHICH NUMBER THIS IS. The two differ — the estimate has no market value,
                * no IDP pricing, no league scarcity and no format fit — and a manager comparing
                * this against the value recorded on the proposal deserves to know why they moved.
                * An unlabelled estimate is the version of this panel that misleads.
                */}
              {previewIsEstimate ? (
                <p className="text-[11px] text-amber-200/70" data-testid="trade-value-estimate-note">
                  ⚠ Rough estimate{previewPending ? ' — still loading the full valuation…' : ''}. Priced from
                  projections alone, without market values, defensive pricing or your league&apos;s scarcity
                  settings. The value recorded when you send this trade will differ.
                </p>
              ) : (
                <p className="text-[11px] text-white/40">
                  Full valuation · your league&apos;s scoring, slots and team count · same engine that records
                  the trade · {new Date(valuePreview.context.capturedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : null}
          {(deadlinePassed || lockedSelected || faabOver) && (
            <div className="space-y-1 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/85">
              {deadlinePassed ? <p>⚠ Trade deadline (week {settings?.tradeDeadlineWeek}) has passed.</p> : null}
              {lockedSelected ? <p>⚠ A selected player is locked this week.</p> : null}
              {faabOver ? <p>⚠ FAAB amount exceeds available balance.</p> : null}
            </div>
          )}
          <label className="block text-[11px] text-white/55">
            {multiTeam ? 'Note for the other managers (optional)' : 'Note for the other manager (optional)'}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this works for both teams…"
              className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-[12px] text-white placeholder:text-white/30"
            />
          </label>
          <p className="text-[11px] text-white/40">
            Review mode: {settings?.commissionerTradeReviewType ?? 'commissioner'} · expires in{' '}
            {settings?.tradeReviewHours ?? 48}h.
          </p>
        </div>
      )}
      {error ? <p className="mt-3 text-[11px] text-rose-300">{error}</p> : null}
    </AppModal>
  )
}

/** Multi-team: each team's gives and gets, from the assets as they will be sent. */
function MultiTeamSummary({
  participantIds,
  assets,
  nameOf,
}: {
  participantIds: string[]
  assets: RedraftTradeAssetInput[]
  nameOf: (id: string) => string
}) {
  const label = (a: RedraftTradeAssetInput) =>
    a.assetType === 'faab' ? `$${Number((a.metadata as { amount?: number } | undefined)?.amount ?? 0)} FAAB` : a.playerName ?? 'Player'
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="trade-multi-team-summary">
      {participantIds.map((id) => {
        const gives = assets.filter((a) => a.fromRosterId === id)
        const gets = assets.filter((a) => a.toRosterId === id)
        return (
          <div key={id} className="rounded border border-white/10 bg-black/20 p-2 text-[11px]" data-testid={`trade-multi-team-side-${id}`}>
            <p className="font-semibold text-white/80">{nameOf(id)}</p>
            <p className="mt-1 text-white/45">Gives</p>
            {gives.length ? (
              <ul className="space-y-0.5 text-white/65">
                {gives.map((a, i) => (
                  <li key={`g${i}`}>
                    {label(a)} <span className="text-white/40">→ {nameOf(a.toRosterId)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-white/35">Nothing</p>
            )}
            <p className="mt-1 text-white/45">Gets</p>
            {gets.length ? (
              <ul className="space-y-0.5 text-emerald-200/80">
                {gets.map((a, i) => (
                  <li key={`r${i}`}>
                    {label(a)} <span className="text-white/40">← {nameOf(a.fromRosterId)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-white/35">Nothing</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SummarySide({
  label,
  players,
  faab,
}: {
  label: string
  players: RedraftRosterPlayerClient[]
  faab: number
}) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2 text-[11px]">
      <p className="font-semibold text-white/75">{label}</p>
      {players.length === 0 && faab === 0 ? (
        <p className="text-white/40">Nothing selected</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-white/60">
          {players.map((p) => (
            <li key={p.id}>{p.playerName}</li>
          ))}
          {faab > 0 ? <li>${faab} FAAB</li> : null}
        </ul>
      )}
    </div>
  )
}

function ReviewSide(props: { label: string; players: RedraftRosterPlayerClient[]; faab: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[12px]">
      <p className="font-semibold text-white">{props.label}</p>
      {props.players.length === 0 && props.faab === 0 ? (
        <p className="mt-1 text-white/40">Nothing selected</p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-white/70">
          {props.players.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span>{p.playerName}</span>
              <span className="text-[11px] text-white/45">
                {p.position}
                {p.team ? ` · ${p.team}` : ''}
              </span>
            </li>
          ))}
          {props.faab > 0 ? <li className="text-emerald-300">${props.faab} FAAB</li> : null}
        </ul>
      )}
    </div>
  )
}
