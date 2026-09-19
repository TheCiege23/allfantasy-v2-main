'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  saveActionLabel,
  shadowDisclosure,
  sourcePlatformLabel,
  writeAuthorityCopy,
} from '@/lib/league/write-authority'
import { AppModal } from '@/components/ui/AppModal'
import { PlayerImage } from '@/app/components/PlayerImage'
import { TeamLogo } from '@/app/components/TeamLogo'
import type { LeagueTeamSlot } from '@/app/dashboard/types'
import type { TradeableRoster, TradeableRosterPlayer } from '@/app/api/leagues/[leagueId]/trades/rosters/route'
import type {
  MultiTeamTradeSuggestion,
  SuggestedMultiTeamLeg,
  TradePartnerSuggestion,
  SuggestedTradePackage,
} from '@/lib/league-trade-engine/proposalSuggestions'

export type ProposeTradeModalProps = {
  open: boolean
  onClose: () => void
  leagueId: string
  teams: LeagueTeamSlot[]
  onSubmitted: () => void
  /**
   * `League.platform`. Drives Write Authority: on an imported (SHADOW) league this builder
   * creates a proposal that exists only in AllFantasy — the trade partner, who plays on
   * ESPN/Yahoo/Sleeper, will never receive it. Omitted/native leagues send a real offer.
   */
  platform?: string | null
  sport?: string | null
}

type TradeContext = {
  valueBook: string
  proposalModel?: string
  managerStrategy?: string
  strategyConfirmed?: boolean
  contextualGradeComplete?: boolean
  missing: string[]
}

/**
 * Native AllFantasy trade builder for NFL redraft leagues: partner picker, real roster asset
 * checkboxes on both sides, submits to the real `AfLeagueTrade` engine
 * (`POST /api/leagues/[leagueId]/trades`) — the same engine verified end-to-end (create, accept,
 * commissioner review, roster sync) — not the Sleeper-deeplink / simulation-only trade finder.
 */
export function ProposeTradeModal({
  open,
  onClose,
  leagueId,
  onSubmitted,
  platform,
  sport,
}: ProposeTradeModalProps) {
  const { data: session } = useSession()
  const myUserId = session?.user?.id ?? null
  const tradeCopy = useMemo(() => writeAuthorityCopy('trade', platform), [platform])
  const submitLabel = useMemo(() => saveActionLabel('trade', platform), [platform])
  const shadowNotice = useMemo(() => shadowDisclosure(platform), [platform])
  const sourceLabel = useMemo(() => sourcePlatformLabel(platform), [platform])

  const [rosters, setRosters] = useState<TradeableRoster[] | null>(null)
  const [viewerRosterId, setViewerRosterId] = useState<string | null>(null)
  const [viewerTeamRosterId, setViewerTeamRosterId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TradePartnerSuggestion[]>([])
  const [multiTeamSuggestions, setMultiTeamSuggestions] = useState<MultiTeamTradeSuggestion[]>([])
  const [tradeContext, setTradeContext] = useState<TradeContext | null>(null)
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [partnerRosterId, setPartnerRosterId] = useState<string | null>(null)
  const [secondPartnerRosterId, setSecondPartnerRosterId] = useState<string | null>(null)
  const [multiTeam, setMultiTeam] = useState(false)
  const [givePlayerIds, setGivePlayerIds] = useState<Set<string>>(new Set())
  const [getPlayerIds, setGetPlayerIds] = useState<Set<string>>(new Set())
  const [givePickIds, setGivePickIds] = useState<Set<string>>(new Set())
  const [getPickIds, setGetPickIds] = useState<Set<string>>(new Set())
  const [giveFaab, setGiveFaab] = useState('')
  const [getFaab, setGetFaab] = useState('')
  const [secondGivePlayerIds, setSecondGivePlayerIds] = useState<Set<string>>(new Set())
  const [secondGetPlayerIds, setSecondGetPlayerIds] = useState<Set<string>>(new Set())
  const [secondGivePickIds, setSecondGivePickIds] = useState<Set<string>>(new Set())
  const [secondGetPickIds, setSecondGetPickIds] = useState<Set<string>>(new Set())
  const [secondGiveFaab, setSecondGiveFaab] = useState('')
  const [secondGetFaab, setSecondGetFaab] = useState('')
  const [directPartnerLegs, setDirectPartnerLegs] = useState<SuggestedMultiTeamLeg[]>([])
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTradeData = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/rosters`)
      if (!response.ok) throw new Error('Failed to load rosters')
      const data = (await response.json()) as { rosters?: TradeableRoster[]; viewerRosterId?: string | null; viewerTeamRosterId?: string | null; suggestions?: TradePartnerSuggestion[]; multiTeamSuggestions?: MultiTeamTradeSuggestion[]; tradeContext?: TradeContext }
      setRosters(Array.isArray(data.rosters) ? data.rosters : [])
      setViewerRosterId(data.viewerRosterId ?? null)
      setViewerTeamRosterId(data.viewerTeamRosterId ?? data.viewerRosterId ?? null)
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
      setMultiTeamSuggestions(Array.isArray(data.multiTeamSuggestions) ? data.multiTeamSuggestions : [])
      setTradeContext(data.tradeContext ?? null)
    } catch {
      setError('Could not load rosters for this league.')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    if (!open) return
    void loadTradeData()
  }, [open, loadTradeData])

  async function updateManagerStrategy(active: 'win-now' | 'balanced' | 'rebuild') {
    setSavingStrategy(true)
    setError(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/strategy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not save trade strategy.')
      await loadTradeData()
      toast.success('Trade strategy saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save trade strategy.')
    } finally {
      setSavingStrategy(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setPartnerRosterId(null)
      setSecondPartnerRosterId(null)
      setMultiTeam(false)
      setGivePlayerIds(new Set())
      setGetPlayerIds(new Set())
      setGivePickIds(new Set())
      setGetPickIds(new Set())
      setGiveFaab('')
      setGetFaab('')
      setSecondGivePlayerIds(new Set())
      setSecondGetPlayerIds(new Set())
      setSecondGivePickIds(new Set())
      setSecondGetPickIds(new Set())
      setSecondGiveFaab('')
      setSecondGetFaab('')
      setDirectPartnerLegs([])
      setSelectedSuggestionId(null)
      setError(null)
    }
  }, [open])

  const myRoster = useMemo(
    () => rosters?.find((r) => r.rosterId === viewerTeamRosterId) ?? rosters?.find((r) => r.rosterId === viewerRosterId) ?? rosters?.find((r) => r.platformUserId === myUserId) ?? null,
    [rosters, viewerTeamRosterId, viewerRosterId, myUserId],
  )
  const partnerRoster = useMemo(
    () => (partnerRosterId ? (rosters?.find((r) => r.rosterId === partnerRosterId) ?? null) : null),
    [rosters, partnerRosterId],
  )
  const secondPartnerRoster = useMemo(
    () => (secondPartnerRosterId ? (rosters?.find((r) => r.rosterId === secondPartnerRosterId) ?? null) : null),
    [rosters, secondPartnerRosterId],
  )
  const partnerRosters = useMemo(
    () => (rosters ?? []).filter((r) => r.rosterId !== myRoster?.rosterId && (Boolean(shadowNotice) || r.canReceiveProposal)),
    [rosters, myRoster, shadowNotice],
  )
  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => partnerRosters.some((roster) => roster.rosterId === suggestion.rosterId)),
    [suggestions, partnerRosters],
  )
  const visibleMultiTeamSuggestions = useMemo(() => {
    const reachable = new Set(partnerRosters.map((roster) => roster.rosterId))
    return multiTeamSuggestions.filter((suggestion) => suggestion.rosterIds.slice(1).every((rosterId) => reachable.has(rosterId)))
  }, [multiTeamSuggestions, partnerRosters])
  const activeSuggestion = useMemo(
    () => suggestions.find((suggestion) => suggestion.rosterId === partnerRosterId) ?? null,
    [suggestions, partnerRosterId],
  )

  function markCustomChange() {
    setSelectedSuggestionId(null)
    setDirectPartnerLegs([])
  }

  function toggle(set: Set<string>, setSet: (next: Set<string>) => void, id: string) {
    markCustomChange()
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }

  const firstHasAssets = givePlayerIds.size + getPlayerIds.size + givePickIds.size + getPickIds.size > 0 || Number(giveFaab) > 0 || Number(getFaab) > 0
  const secondHasAssets = secondGivePlayerIds.size + secondGetPlayerIds.size + secondGivePickIds.size + secondGetPickIds.size > 0 || Number(secondGiveFaab) > 0 || Number(secondGetFaab) > 0
  const canSubmit = Boolean(myRoster && partnerRoster && firstHasAssets && (!multiTeam || (secondPartnerRoster && secondHasAssets)) && !submitting)

  function applySuggestion(partnerId: string, proposal: SuggestedTradePackage) {
    setMultiTeam(false)
    setSecondPartnerRosterId(null)
    setDirectPartnerLegs([])
    setSelectedSuggestionId(proposal.id)
    setPartnerRosterId(partnerId)
    setGivePlayerIds(new Set(proposal.send.filter((a) => a.kind === 'player').map((a) => a.id)))
    setGetPlayerIds(new Set(proposal.receive.filter((a) => a.kind === 'player').map((a) => a.id)))
    setGivePickIds(new Set(proposal.send.filter((a) => a.kind === 'pick').map((a) => a.id)))
    setGetPickIds(new Set(proposal.receive.filter((a) => a.kind === 'pick').map((a) => a.id)))
    setGiveFaab(String(proposal.send.find((a) => a.kind === 'faab')?.amount ?? ''))
    setGetFaab(String(proposal.receive.find((a) => a.kind === 'faab')?.amount ?? ''))
  }

  function applyMultiTeamSuggestion(suggestion: MultiTeamTradeSuggestion) {
    const [, firstPartnerId, secondPartnerId] = suggestion.rosterIds
    const viewerId = myRoster?.rosterId
    if (!viewerId) return
    setMultiTeam(true)
    setPartnerRosterId(firstPartnerId)
    setSecondPartnerRosterId(secondPartnerId)
    setSelectedSuggestionId(suggestion.id)
    setGivePlayerIds(new Set(suggestion.legs.filter((leg) => leg.fromRosterId === viewerId && leg.toRosterId === firstPartnerId && leg.asset.kind === 'player').map((leg) => leg.asset.id)))
    setGetPlayerIds(new Set(suggestion.legs.filter((leg) => leg.fromRosterId === firstPartnerId && leg.toRosterId === viewerId && leg.asset.kind === 'player').map((leg) => leg.asset.id)))
    setSecondGivePlayerIds(new Set(suggestion.legs.filter((leg) => leg.fromRosterId === viewerId && leg.toRosterId === secondPartnerId && leg.asset.kind === 'player').map((leg) => leg.asset.id)))
    setSecondGetPlayerIds(new Set(suggestion.legs.filter((leg) => leg.fromRosterId === secondPartnerId && leg.toRosterId === viewerId && leg.asset.kind === 'player').map((leg) => leg.asset.id)))
    setGivePickIds(new Set()); setGetPickIds(new Set()); setSecondGivePickIds(new Set()); setSecondGetPickIds(new Set())
    setGiveFaab(''); setGetFaab(''); setSecondGiveFaab(''); setSecondGetFaab('')
    setDirectPartnerLegs(suggestion.legs.filter((leg) => leg.fromRosterId !== viewerId && leg.toRosterId !== viewerId))
  }

  async function handleSubmit() {
    if (!myRoster || !partnerRoster) return
    setSubmitting(true)
    setError(null)
    try {
      const findPlayer = (roster: TradeableRoster, id: string): TradeableRosterPlayer | undefined =>
        roster.players.find((p) => p.id === id)
      const legAssets = (partner: TradeableRoster, state: {
        givePlayers: Set<string>; getPlayers: Set<string>; givePicks: Set<string>; getPicks: Set<string>; giveFaab: string; getFaab: string
      }) => [
        ...[...state.givePlayers].map((id) => {
          const player = findPlayer(myRoster, id)
          return {
            itemType: 'player' as const,
            itemReference: id,
            fromRosterId: myRoster.rosterId,
            toRosterId: partner.rosterId,
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null },
          }
        }),
        ...[...state.getPlayers].map((id) => {
          const player = findPlayer(partner, id)
          return {
            itemType: 'player' as const,
            itemReference: id,
            fromRosterId: partner.rosterId,
            toRosterId: myRoster.rosterId,
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null },
          }
        }),
        ...[...state.givePicks].map((id) => {
          const pick = myRoster.picks.find((p) => p.pickId === id)
          return { itemType: pick?.itemType ?? 'future_pick' as const, itemReference: id, fromRosterId: myRoster.rosterId, toRosterId: partner.rosterId, metadata: { label: pick?.label ?? id } }
        }),
        ...[...state.getPicks].map((id) => {
          const pick = partner.picks.find((p) => p.pickId === id)
          return { itemType: pick?.itemType ?? 'future_pick' as const, itemReference: id, fromRosterId: partner.rosterId, toRosterId: myRoster.rosterId, metadata: { label: pick?.label ?? id } }
        }),
        ...(Number(state.giveFaab) > 0 ? [{ itemType: 'faab' as const, fromRosterId: myRoster.rosterId, toRosterId: partner.rosterId, faabAmount: Math.floor(Number(state.giveFaab)), metadata: { amount: Math.floor(Number(state.giveFaab)) } }] : []),
        ...(Number(state.getFaab) > 0 ? [{ itemType: 'faab' as const, fromRosterId: partner.rosterId, toRosterId: myRoster.rosterId, faabAmount: Math.floor(Number(state.getFaab)), metadata: { amount: Math.floor(Number(state.getFaab)) } }] : []),
      ]
      const assets = [
        ...legAssets(partnerRoster, { givePlayers: givePlayerIds, getPlayers: getPlayerIds, givePicks: givePickIds, getPicks: getPickIds, giveFaab, getFaab }),
        ...(multiTeam && secondPartnerRoster ? legAssets(secondPartnerRoster, {
          givePlayers: secondGivePlayerIds, getPlayers: secondGetPlayerIds, givePicks: secondGivePickIds, getPicks: secondGetPickIds, giveFaab: secondGiveFaab, getFaab: secondGetFaab,
        }) : []),
        ...directPartnerLegs.map((leg) => ({
          itemType: leg.asset.itemType,
          itemReference: leg.asset.kind === 'faab' ? undefined : leg.asset.id,
          fromRosterId: leg.fromRosterId,
          toRosterId: leg.toRosterId,
          ...(leg.asset.kind === 'faab' ? { faabAmount: leg.asset.amount ?? 0 } : {}),
          metadata: { playerName: leg.asset.name, position: leg.asset.position, amount: leg.asset.amount },
        })),
      ]
      const selectedPackage = suggestions.flatMap((suggestion) => suggestion.packages).find((proposal) => proposal.id === selectedSuggestionId)
      const selectedMultiPackage = multiTeamSuggestions.find((proposal) => proposal.id === selectedSuggestionId)

      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposerRosterId: myRoster.rosterId,
          receiverRosterId: partnerRoster.rosterId,
          assets,
          decisionEvidenceToken: selectedPackage?.decisionEvidenceToken ?? selectedMultiPackage?.decisionEvidenceToken ?? null,
          metadata: {
            multiTeam: Boolean(multiTeam && secondPartnerRoster),
            participantRosterIds: [myRoster.rosterId, partnerRoster.rosterId, ...(secondPartnerRoster ? [secondPartnerRoster.rosterId] : [])],
            acceptedRosterIds: [],
            proposalSource: 'league_partner_suggestions',
            gradeScope: 'league-specific-context-pending',
            suggestionId: selectedSuggestionId,
            suggestionModelVersion: 'league-proposal-v3',
            predictedAcceptance: selectedPackage?.acceptanceLikelihood ?? null,
            projectedOutcomeDelta: selectedPackage?.simulation?.deltaPct ?? selectedMultiPackage?.simulation?.deltaPct ?? null,
          },
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        writeAuthority?: { copy?: { title?: string; detail?: string } }
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to submit trade.')
        return
      }
      // Server envelope is authoritative; the local builder is the fallback. On a SHADOW league
      // this says "Shadow trade created — send this offer in ESPN to make it real", never
      // "Trade offer sent", which would imply the partner was notified on their platform.
      const created = data.writeAuthority?.copy ?? tradeCopy
      toast.success(created.title ?? tradeCopy.title, { description: created.detail || undefined })
      onSubmitted()
      onClose()
    } catch {
      setError('Failed to submit trade.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={shadowNotice ? 'Build a Shadow Trade' : 'Propose a Trade'}
      size="lg"
    >
      <div className="space-y-4 text-[13px] text-white/80">
        {/*
          Shown before any selection is made. A manager building a trade for an imported league
          needs to know up front that the offer stops at AllFantasy — discovering it in the
          success toast is too late to be honest about it.
        */}
        {shadowNotice ? (
          <p
            data-testid="shadow-league-trade-notice"
            className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100/90"
          >
            This proposal stays inside AllFantasy — {sourceLabel ?? 'your host platform'} is not notified.
            Use it as a plan, then send the offer in {sourceLabel ?? 'your host platform'}.
          </p>
        ) : null}
        {loading ? (
          <p className="text-white/50">Loading rosters…</p>
        ) : (
          <>
            {tradeContext ? (
              <div className="space-y-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-[11px] text-cyan-100/80">
                <p>
                  Suggestions use this league&apos;s {tradeContext.valueBook} values, {tradeContext.proposalModel ?? 'league'} rules and your {tradeContext.managerStrategy ?? 'balanced'} strategy, plus roster construction, records, picks and FAAB.{tradeContext.missing.length ? ` Full contextual grading remains pending for ${tradeContext.missing.join(' and ')}.` : ' The required strategy and paired outcome simulation are available.'}
                </p>
                <label className="flex flex-wrap items-center gap-2 text-cyan-50">
                  <span className="font-semibold">My goal in this league</span>
                  <select
                    aria-label="My trade strategy"
                    value={tradeContext.strategyConfirmed ? (tradeContext.managerStrategy ?? 'balanced') : ''}
                    disabled={savingStrategy}
                    onChange={(event) => void updateManagerStrategy(event.target.value as 'win-now' | 'balanced' | 'rebuild')}
                    className="rounded-md border border-cyan-300/25 bg-[#111728] px-2 py-1 text-white"
                  >
                    <option value="" disabled>Confirm your goal</option>
                    <option value="win-now">Win now</option>
                    <option value="balanced">Balanced</option>
                    <option value="rebuild">Rebuild</option>
                  </select>
                  {savingStrategy ? <span className="text-cyan-200/60">Saving…</span> : null}
                </label>
              </div>
            ) : null}
            {visibleSuggestions.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">Suggested trade partners</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {visibleSuggestions.slice(0, 3).map((suggestion) => {
                    const roster = rosters?.find((r) => r.rosterId === suggestion.rosterId)
                    const best = suggestion.packages[0]
                    return (
                      <button key={suggestion.rosterId} type="button" onClick={() => best && applySuggestion(suggestion.rosterId, best)} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-left hover:border-[#ff3d81]/50" data-testid={`suggested-trade-partner-${suggestion.rosterId}`}>
                        <span className="flex items-center gap-2">
                          {roster?.avatarUrl ? (
                            // Provider avatar hosts are dynamic and are intentionally not constrained to Next Image domains.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={roster.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : null}
                          <span className="font-bold text-white">{roster?.ownerName ?? 'Manager'}</span>
                          <span className="ml-auto font-mono text-[10px] text-emerald-300">{suggestion.fitScore}% fit</span>
                        </span>
                        {best ? <span className="mt-1.5 block text-[10.5px] leading-snug text-white/55">Send {best.send.map((a) => a.name).join(' + ')} for {best.receive.map((a) => a.name).join(' + ')}</span> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {visibleMultiTeamSuggestions.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">Suggested three-team trades</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleMultiTeamSuggestions.map((suggestion) => (
                    <button key={suggestion.id} type="button" onClick={() => applyMultiTeamSuggestion(suggestion)} className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-2.5 text-left hover:border-violet-300/50">
                      <span className="font-semibold text-violet-100">Circular three-team deal · {suggestion.fairness}% minimum match</span>
                      <span className="mt-1 block text-[10.5px] leading-snug text-white/55">{suggestion.reason}</span>
                      {suggestion.simulation?.available ? <span className={`mt-1 block text-[10px] ${(suggestion.simulation.deltaPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{suggestion.simulation.metric === 'survival' ? 'Survival' : 'Playoff'} probability impact: {(suggestion.simulation.deltaPct ?? 0) >= 0 ? '+' : ''}{suggestion.simulation.deltaPct?.toFixed(1)}%</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="block text-[11px] font-bold uppercase tracking-wide text-white/40">
              Trade partner
              <select
                value={partnerRosterId ?? ''}
                onChange={(e) => {
                  setSelectedSuggestionId(null)
                  setDirectPartnerLegs([])
                  setPartnerRosterId(e.target.value || null)
                  setGetPlayerIds(new Set())
                }}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0a1220] px-3 py-2 text-[13px] text-white/90"
                data-testid="propose-trade-partner-select"
              >
                <option value="">Select a manager…</option>
                {partnerRosters.map((t) => (
                  <option key={t.rosterId} value={t.rosterId}>
                    {t.ownerName ?? 'Manager'} · {t.wins}-{t.losses}
                  </option>
                ))}
              </select>
            </label>

            {activeSuggestion?.packages.length ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-200">Recommended packages for this manager</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {activeSuggestion.packages.map((proposal, index) => (
                    <button
                      key={`${activeSuggestion.rosterId}-${index}`}
                      type="button"
                      onClick={() => applySuggestion(activeSuggestion.rosterId, proposal)}
                      className="rounded-lg border border-white/10 bg-black/10 p-2 text-left hover:border-emerald-300/40"
                    >
                      <span className="block text-[11px] font-semibold text-white">
                        Send {proposal.send.map((asset) => asset.name).join(' + ')}
                      </span>
                      <span className="block text-[11px] text-white/65">
                        Receive {proposal.receive.map((asset) => asset.name).join(' + ')}
                      </span>
                      <span className="mt-1 block text-[10px] text-emerald-100/60">
                        {proposal.fairness}% value match · {proposal.reason}
                      </span>
                      {proposal.acceptanceLikelihood != null ? <span className="mt-1 block text-[10px] text-cyan-200/70">{proposal.acceptanceLikelihood}% learned acceptance likelihood</span> : null}
                      {proposal.simulation?.available ? <span className={`mt-1 block text-[10px] ${(proposal.simulation.deltaPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{proposal.simulation.metric === 'survival' ? 'Survival' : 'Playoff'} probability {proposal.simulation.beforePct?.toFixed(1)}% → {proposal.simulation.afterPct?.toFixed(1)}% ({(proposal.simulation.deltaPct ?? 0) >= 0 ? '+' : ''}{proposal.simulation.deltaPct?.toFixed(1)}%)</span> : proposal.simulation ? <span className="mt-1 block text-[10px] text-amber-200/60">Simulation withheld: {proposal.simulation.reason}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] font-semibold text-white/75">
              <input type="checkbox" checked={multiTeam} onChange={(e) => { setSelectedSuggestionId(null); setDirectPartnerLegs([]); setMultiTeam(e.target.checked); if (!e.target.checked) setSecondPartnerRosterId(null) }} />
              Add a third team
            </label>
            {multiTeam ? (
              <label className="block text-[11px] font-bold uppercase tracking-wide text-white/40">
                Third manager
                <select value={secondPartnerRosterId ?? ''} onChange={(e) => { setSelectedSuggestionId(null); setDirectPartnerLegs([]); setSecondPartnerRosterId(e.target.value || null) }} className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0a1220] px-3 py-2 text-[13px] text-white/90" data-testid="propose-trade-third-team-select">
                  <option value="">Select another manager…</option>
                  {partnerRosters.filter((r) => r.rosterId !== partnerRosterId).map((r) => <option key={r.rosterId} value={r.rosterId}>{r.ownerName ?? 'Manager'} · {r.wins}-{r.losses}</option>)}
                </select>
              </label>
            ) : null}

            {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}

            {myRoster && partnerRoster ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">You send</p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    {myRoster.players.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
                          <input
                            type="checkbox"
                            checked={givePlayerIds.has(p.id)}
                            onChange={() => toggle(givePlayerIds, setGivePlayerIds, p.id)}
                          />
                          <PlayerImage sleeperId={p.id} sport={sport ?? 'NFL'} name={p.name} position={p.position ?? undefined} headshotUrl={p.imageUrl} size={26} />
                          <span className="truncate">{p.name}</span>
                          {p.position ? <span className="text-white/35">{p.position}</span> : null}
                          {p.team ? <TeamLogo teamAbbr={p.team} sport={sport ?? 'NFL'} size={18} /> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {myRoster.picks.length > 0 ? <div className="mt-2 space-y-1 rounded-xl border border-white/10 p-2">{myRoster.picks.map((p) => <label key={p.pickId} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={givePickIds.has(p.pickId)} onChange={() => toggle(givePickIds, setGivePickIds, p.pickId)} /><span>{p.label}</span><span className="ml-auto text-white/35">{p.value?.toLocaleString() ?? '—'}</span></label>)}</div> : null}
                  {myRoster.faabRemaining != null ? <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">FAAB sent<input type="number" min="0" max={myRoster.faabRemaining} value={giveFaab} onChange={(e) => { markCustomChange(); setGiveFaab(e.target.value) }} className="ml-auto w-20 rounded border border-white/10 bg-[#0a1220] px-2 py-1 text-white" /><span>of ${myRoster.faabRemaining}</span></label> : null}
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">You receive</p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    {partnerRoster.players.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
                          <input
                            type="checkbox"
                            checked={getPlayerIds.has(p.id)}
                            onChange={() => toggle(getPlayerIds, setGetPlayerIds, p.id)}
                          />
                          <PlayerImage sleeperId={p.id} sport={sport ?? 'NFL'} name={p.name} position={p.position ?? undefined} headshotUrl={p.imageUrl} size={26} />
                          <span className="truncate">{p.name}</span>
                          {p.position ? <span className="text-white/35">{p.position}</span> : null}
                          {p.team ? <TeamLogo teamAbbr={p.team} sport={sport ?? 'NFL'} size={18} /> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                  {partnerRoster.picks.length > 0 ? <div className="mt-2 space-y-1 rounded-xl border border-white/10 p-2">{partnerRoster.picks.map((p) => <label key={p.pickId} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={getPickIds.has(p.pickId)} onChange={() => toggle(getPickIds, setGetPickIds, p.pickId)} /><span>{p.label}</span><span className="ml-auto text-white/35">{p.value?.toLocaleString() ?? '—'}</span></label>)}</div> : null}
                  {partnerRoster.faabRemaining != null ? <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">FAAB received<input type="number" min="0" max={partnerRoster.faabRemaining} value={getFaab} onChange={(e) => { markCustomChange(); setGetFaab(e.target.value) }} className="ml-auto w-20 rounded border border-white/10 bg-[#0a1220] px-2 py-1 text-white" /><span>of ${partnerRoster.faabRemaining}</span></label> : null}
                </div>
              </div>
            ) : partnerRosterId ? (
              <p className="text-white/45">This manager has no tradeable roster yet.</p>
            ) : null}

            {multiTeam && myRoster && secondPartnerRoster ? (
              <div className="rounded-2xl border border-violet-400/25 bg-violet-400/[0.04] p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-violet-200">Third-team leg · {secondPartnerRoster.ownerName ?? 'Manager'}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-white/40">You send to them</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
                      {myRoster.players.map((p) => <label key={p.id} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={secondGivePlayerIds.has(p.id)} disabled={givePlayerIds.has(p.id)} onChange={() => toggle(secondGivePlayerIds, setSecondGivePlayerIds, p.id)} /><span className="truncate">{p.name}</span><span className="ml-auto text-white/35">{p.position}</span></label>)}
                      {myRoster.picks.map((p) => <label key={p.pickId} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={secondGivePickIds.has(p.pickId)} disabled={givePickIds.has(p.pickId)} onChange={() => toggle(secondGivePickIds, setSecondGivePickIds, p.pickId)} /><span>{p.label}</span></label>)}
                    </div>
                    {myRoster.faabRemaining != null ? <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">FAAB<input type="number" min="0" max={Math.max(0, myRoster.faabRemaining - Number(giveFaab || 0))} value={secondGiveFaab} onChange={(e) => { markCustomChange(); setSecondGiveFaab(e.target.value) }} className="ml-auto w-20 rounded border border-white/10 bg-[#0a1220] px-2 py-1 text-white" /></label> : null}
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-white/40">You receive from them</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
                      {secondPartnerRoster.players.map((p) => <label key={p.id} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={secondGetPlayerIds.has(p.id)} onChange={() => toggle(secondGetPlayerIds, setSecondGetPlayerIds, p.id)} /><span className="truncate">{p.name}</span><span className="ml-auto text-white/35">{p.position}</span></label>)}
                      {secondPartnerRoster.picks.map((p) => <label key={p.pickId} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={secondGetPickIds.has(p.pickId)} onChange={() => toggle(secondGetPickIds, setSecondGetPickIds, p.pickId)} /><span>{p.label}</span></label>)}
                    </div>
                    {secondPartnerRoster.faabRemaining != null ? <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">FAAB<input type="number" min="0" max={secondPartnerRoster.faabRemaining} value={secondGetFaab} onChange={(e) => { markCustomChange(); setSecondGetFaab(e.target.value) }} className="ml-auto w-20 rounded border border-white/10 bg-[#0a1220] px-2 py-1 text-white" /></label> : null}
                  </div>
                </div>
                <p className="mt-2 text-[10.5px] text-violet-100/55">Every participating manager must accept before league review or processing begins.</p>
                {directPartnerLegs.length > 0 ? (
                  <div className="mt-2 rounded-xl border border-violet-300/15 bg-black/10 p-2 text-[10.5px] text-violet-100/70">
                    {directPartnerLegs.map((leg) => {
                      const from = rosters?.find((roster) => roster.rosterId === leg.fromRosterId)?.ownerName ?? 'Manager'
                      const to = rosters?.find((roster) => roster.rosterId === leg.toRosterId)?.ownerName ?? 'Manager'
                      return <p key={`${leg.fromRosterId}:${leg.toRosterId}:${leg.asset.id}`}>{from} sends {leg.asset.name} to {to}</p>
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="rounded-lg bg-[#ff3d81]/85 px-3 py-2 text-[12px] font-semibold text-black disabled:opacity-50"
                data-testid="propose-trade-submit"
              >
                {submitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </AppModal>
  )
}
