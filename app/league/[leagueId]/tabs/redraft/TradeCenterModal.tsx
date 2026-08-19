'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppModal } from '@/components/ui/AppModal'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import {
  createTradeProposal,
  fetchRedraftRoster,
  type RedraftRosterClient,
  type RedraftRosterPlayerClient,
  type RedraftRosterRow,
  type RedraftTradeAssetInput,
  type RedraftTradeSettings,
} from '@/lib/redraft/client'

type Step = 'partner' | 'assets' | 'review'

type Side = 'mine' | 'theirs'

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
        <span className="text-[10px] text-white/50">
          {player.position}
          {player.team ? ` · ${player.team}` : ''}
          {player.byeWeek ? ` · BYE ${player.byeWeek}` : ''}
          {player.injuryStatus ? ` · ${player.injuryStatus}` : ''}
          {player.isLocked ? ' · 🔒' : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-[10px] text-white/55">
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
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)

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
    setReason('')
    setError(null)
    setSuccessId(null)
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

  const deadlinePassed =
    settings?.tradeDeadlineWeek != null && currentWeek > settings.tradeDeadlineWeek
  const lockedSelected =
    selectedMinePlayers.some((p) => p.isLocked) || selectedTheirsPlayers.some((p) => p.isLocked)
  const faabOver = mineFaab > mineFaabAvail || theirsFaab > theirsFaabAvail

  const apiAssets = useMemo<RedraftTradeAssetInput[]>(() => {
    if (!proposerRosterId || !receiverRosterId) return []
    const out: RedraftTradeAssetInput[] = [
      ...selectedMinePlayers.map((p) => playerToAsset(p, proposerRosterId, receiverRosterId)),
      ...selectedTheirsPlayers.map((p) => playerToAsset(p, receiverRosterId, proposerRosterId)),
    ]
    if (mineFaab > 0) out.push(faabAsset(mineFaab, proposerRosterId, receiverRosterId))
    if (theirsFaab > 0) out.push(faabAsset(theirsFaab, receiverRosterId, proposerRosterId))
    return out
  }, [proposerRosterId, receiverRosterId, selectedMinePlayers, selectedTheirsPlayers, mineFaab, theirsFaab])

  // Deterministic value preview (same engine as the persisted snapshot; client-side has no ADP, so
  // the authoritative captured snapshot may differ slightly — both are deterministic).
  const valuePreview = useMemo(() => {
    if (!proposerRosterId || !receiverRosterId || (!mineHasAssets && !theirsHasAssets)) return null
    const enriched: EnrichedTradeAsset[] = [
      ...selectedMinePlayers.map((p) => ({
        kind: 'player' as const, fromRosterId: proposerRosterId, toRosterId: receiverRosterId,
        playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team,
        sources: { projectionValue: p.restOfSeasonProjection ?? p.weeklyProjection ?? null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
      })),
      ...selectedTheirsPlayers.map((p) => ({
        kind: 'player' as const, fromRosterId: receiverRosterId, toRosterId: proposerRosterId,
        playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team,
        sources: { projectionValue: p.restOfSeasonProjection ?? p.weeklyProjection ?? null, rankingValue: null, adpValue: null, fantasyCalcValue: null },
      })),
    ]
    if (mineFaab > 0) enriched.push({ kind: 'faab', fromRosterId: proposerRosterId, toRosterId: receiverRosterId, faabAmount: mineFaab, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } })
    if (theirsFaab > 0) enriched.push({ kind: 'faab', fromRosterId: receiverRosterId, toRosterId: proposerRosterId, faabAmount: theirsFaab, sources: { projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null } })
    return buildTradeValueSnapshot({
      proposerRosterId, receiverRosterId, assets: enriched, currentSeason: null,
      context: { sport: '', leagueType: 'redraft', scoring: '', rosterFormat: 'standard', capturedAt: new Date().toISOString() },
    })
  }, [proposerRosterId, receiverRosterId, selectedMinePlayers, selectedTheirsPlayers, mineFaab, theirsFaab, mineHasAssets, theirsHasAssets])

  const canSubmit = Boolean(
    seasonId && proposerRosterId && receiverRosterId && mineHasAssets && theirsHasAssets &&
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
        reason: reason.trim() || undefined,
        assets: apiAssets,
      })
      setSuccessId(res.proposal?.id ?? 'created')
      onSubmitted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit trade')
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, leagueId, seasonId, proposerRosterId, receiverRosterId, reason, apiAssets, onSubmitted])

  const proposerName = rosterLabel(rosterRowById.get(proposerRosterId), proposerRosterId)
  const receiverName = rosterLabel(rosterRowById.get(receiverRosterId), receiverRosterId)

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
            (step === 'assets' && (!mineHasAssets || !theirsHasAssets))
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
            {proposerName} → {receiverName}. The other manager can now review and respond.
          </p>
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
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
            Multi-team trades — <span className="text-white/55">coming soon</span> (the engine currently supports
            two-team trades).
          </div>
        </div>
      ) : step === 'assets' ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.9fr]">
          {(['mine', 'theirs'] as Side[]).map((side) => {
            const roster = side === 'mine' ? proposerRoster : receiverRoster
            const sel = side === 'mine' ? mineSel : theirsSel
            const setSel = side === 'mine' ? setMineSel : setTheirsSel
            const faab = side === 'mine' ? mineFaab : theirsFaab
            const setFaab = side === 'mine' ? setMineFaab : setTheirsFaab
            const faabAvail = side === 'mine' ? mineFaabAvail : theirsFaabAvail
            const name = side === 'mine' ? proposerName : receiverName
            return (
              <section key={side} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <p className="text-[12px] font-semibold text-white">{name} sends</p>
                <div className="space-y-1.5">
                  {assetLoading ? (
                    <p className="text-[11px] text-white/45">Loading roster…</p>
                  ) : (roster?.players ?? []).length ? (
                    (roster?.players ?? []).map((p) => (
                      <PlayerCard
                        key={p.id}
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
                  </label>
                ) : null}
                {settings?.draftPickTrading ? (
                  <p className="rounded border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-[10px] text-sky-200/70">
                    Draft-pick trading is enabled — picks are recorded on the proposal as reference-only (no owned-pick
                    inventory in redraft yet).
                  </p>
                ) : null}
              </section>
            )
          })}
          <aside className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <p className="text-[12px] font-semibold text-white">Trade summary</p>
            <SummarySide label={`${proposerName} sends`} players={selectedMinePlayers} faab={mineFaab} />
            <SummarySide label={`${receiverName} sends`} players={selectedTheirsPlayers} faab={theirsFaab} />
            {faabOver ? <p className="text-[10px] text-rose-300">FAAB exceeds available balance.</p> : null}
          </aside>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewSide label={`${proposerName} sends`} players={selectedMinePlayers} faab={mineFaab} />
            <ReviewSide label={`${receiverName} sends`} players={selectedTheirsPlayers} faab={theirsFaab} />
          </div>

          {valuePreview ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3" data-testid="trade-value-panel">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-white">Trade Value</p>
                <span
                  className="rounded-md border border-[#ff9ec0]/40 bg-[#ff3d81]/10 px-2 py-0.5 text-[13px] font-bold text-[#ffd7e5]"
                  data-testid="trade-value-grade"
                >
                  {valuePreview.grade.grade}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <p className="text-white/50">{proposerName} value</p>
                  <p className="text-[15px] font-bold text-white">{valuePreview.sides[0]?.total ?? 0}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <p className="text-white/50">{receiverName} value</p>
                  <p className="text-[15px] font-bold text-white">{valuePreview.sides[1]?.total ?? 0}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-white/60">
                <span className="rounded border border-white/10 px-2 py-0.5">Fairness {valuePreview.grade.fairnessScore}/100</span>
                <span className="rounded border border-white/10 px-2 py-0.5">Confidence {valuePreview.grade.confidenceScore}/100</span>
                <span className="rounded border border-white/10 px-2 py-0.5">Δ {Math.abs(valuePreview.grade.valueDifference)}</span>
              </div>
              <ul className="space-y-0.5 text-[11px] text-white/70">
                {valuePreview.grade.bullets.map((b, i) => (
                  <li key={i}>• {b}</li>
                ))}
              </ul>
              <p className="text-[10px] text-white/40">
                Values captured at proposal time · {new Date(valuePreview.context.capturedAt).toLocaleString()}
              </p>
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
            Note for the other manager (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this works for both teams…"
              className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-[12px] text-white placeholder:text-white/30"
            />
          </label>
          <p className="text-[10px] text-white/40">
            Review mode: {settings?.commissionerTradeReviewType ?? 'commissioner'} · expires in{' '}
            {settings?.tradeReviewHours ?? 48}h.
          </p>
        </div>
      )}
      {error ? <p className="mt-3 text-[11px] text-rose-300">{error}</p> : null}
    </AppModal>
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
              <span className="text-[10px] text-white/45">
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
