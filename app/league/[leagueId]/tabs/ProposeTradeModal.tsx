'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-transactions.css'
import '@/components/league/trade-proposer.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  saveActionLabel,
  shadowDisclosure,
  sourcePlatformLabel,
  writeAuthorityCopy,
} from '@/lib/league/write-authority'
import { AppModal } from '@/components/ui/AppModal'
import { PlayerAvatar } from '@/components/league/native/screens/NativeScreenParts'
import type { LeagueTeamSlot } from '@/app/dashboard/types'
import type { TradeableRoster, TradeableRosterPlayer } from '@/app/api/leagues/[leagueId]/trades/rosters/route'
import type {
  MultiTeamTradeSuggestion,
  SuggestedMultiTeamLeg,
  TradePartnerSuggestion,
  SuggestedTradePackage,
} from '@/lib/league-trade-engine/proposalSuggestions'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { ComposerAsset } from '@/lib/league-trade-engine/proposalPackageGrades'
import { ComposerGradeLine } from './ComposerGradeLine'

/** One side of the composed deal, in the grade preview's shape. Picks carry their season and round. */
export function composerSide(
  roster: TradeableRoster,
  playerIds: ReadonlySet<string>,
  pickIds: ReadonlySet<string>,
  faab: string,
): ComposerAsset[] {
  const players = [...playerIds].map((id): ComposerAsset => ({ kind: 'player', id, name: roster.players.find((p) => p.id === id)?.name ?? id }))
  const picks = [...pickIds].map((id): ComposerAsset => {
    const pick = roster.picks.find((p) => p.pickId === id)
    return { kind: 'pick', season: pick?.season ?? null, round: pick?.round ?? null, label: pick?.label ?? id }
  })
  const amount = Math.floor(Number(faab))
  return [...players, ...picks, ...(amount > 0 ? [{ kind: 'faab' as const, amount }] : [])]
}

/**
 * A package's reason without its "stays within N% of the priced value" clause — the suggester's own
 * value gap, which could read against the grade shown beside it. Everything else in the reason stays.
 */
export function reasonWithoutValueGap(reason: string): string {
  return reason.replace(/;?\s*the package stays within \d+% of the priced value,?/i, ';').replace(/;\s*;/g, ';').replace(/^;\s*/, '').trim()
}

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
  /** Pending native offer being answered, when composing a counter. */
  counterTradeId?: string | null
  /**
   * Opened from the Propose grid (components/league/TradeProposeGrid.tsx): the manager tapped, and
   * the player tapped on their roster. Applied once, after the rosters load.
   */
  initialPartnerRosterId?: string | null
  initialGetPlayerId?: string | null
}

/** "Jahmyr Gibbs" → "J. Gibbs"; a one-word name (a team defense) stays whole. */
export function tileName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return name.trim()
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`
}

/** The three steps, in order. A counteroffer opens on `assets`: its partner is fixed. */
export type ProposeStep = 'partner' | 'assets' | 'review'

/** Offer lifetimes the trade engine accepts (`expiresInHours`; it defaults to 48). */
export const TRADE_EXPIRY_OPTIONS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 24, label: '1 day' },
  { hours: 48, label: '2 days' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
]

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
  counterTradeId = null,
  initialPartnerRosterId = null,
  initialGetPlayerId = null,
}: ProposeTradeModalProps) {
  const [step, setStep] = useState<ProposeStep>(counterTradeId ? 'assets' : 'partner')
  const [expiresInHours, setExpiresInHours] = useState(48)
  const [sendDirectMessage, setSendDirectMessage] = useState(true)
  const preselectApplied = useRef(false)
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
  const [counterReady, setCounterReady] = useState(false)
  const [counterLoading, setCounterLoading] = useState(false)
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
      setCounterReady(false)
      setCounterLoading(false)
      setExpiresInHours(48)
      setSendDirectMessage(true)
      preselectApplied.current = false
      setStep(counterTradeId ? 'assets' : 'partner')
    }
  }, [open, counterTradeId])

  // A counter has its partner fixed, so it opens straight on the assets.
  useEffect(() => {
    if (open && counterTradeId) setStep('assets')
  }, [open, counterTradeId])

  // Opened from the Propose grid: select the tapped manager and player once the rosters are in.
  useEffect(() => {
    if (!open || counterTradeId || preselectApplied.current || !rosters || (!initialPartnerRosterId && !initialGetPlayerId)) return
    // The Players screen's Trade tab knows the player and may not know his team's roster id here:
    // the team is then whichever other roster holds him.
    const mine = viewerTeamRosterId ?? viewerRosterId
    const partner =
      (initialPartnerRosterId ? rosters.find((r) => r.rosterId === initialPartnerRosterId) : undefined) ??
      (initialGetPlayerId ? rosters.find((r) => r.rosterId !== mine && r.players.some((p) => p.id === initialGetPlayerId)) : undefined)
    if (!partner) return
    preselectApplied.current = true
    setPartnerRosterId(partner.rosterId)
    if (initialGetPlayerId && partner.players.some((p) => p.id === initialGetPlayerId)) setGetPlayerIds(new Set([initialGetPlayerId]))
    setStep('assets')
  }, [open, counterTradeId, rosters, initialPartnerRosterId, initialGetPlayerId, viewerTeamRosterId, viewerRosterId])

  const myRoster = useMemo(
    () => rosters?.find((r) => r.rosterId === viewerTeamRosterId) ?? rosters?.find((r) => r.rosterId === viewerRosterId) ?? rosters?.find((r) => r.platformUserId === myUserId) ?? null,
    [rosters, viewerTeamRosterId, viewerRosterId, myUserId],
  )
  useEffect(() => {
    if (!open || !counterTradeId || !myRoster || !rosters || counterReady) return
    let active = true
    setCounterLoading(true)
    setError(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(counterTradeId)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? 'Could not load the offer.')
        const trade = data.trade as { status?: string; proposerRosterId?: string; receiverRosterId?: string; items?: Array<{ itemType: string; itemReference?: string | null; fromRosterId: string; toRosterId: string; faabAmount?: number | null }> } | undefined
        if (!trade || trade.status !== 'pending' || !Array.isArray(trade.items)) throw new Error('This offer is no longer available to counter.')
        const ids = [...new Set([trade.proposerRosterId, trade.receiverRosterId, ...trade.items.flatMap(item => [item.fromRosterId, item.toRosterId])].filter((id): id is string => Boolean(id)))]
        if (ids.length !== 2 || !ids.includes(myRoster.rosterId)) throw new Error('Only two-team offers involving your team can be opened as a counter.')
        const partner = rosters.find(r => ids.includes(r.rosterId) && r.rosterId !== myRoster.rosterId && r.canReceiveProposal)
        if (!partner) throw new Error('This trade partner is no longer available.')
        const givePlayers = new Set<string>(), getPlayers = new Set<string>(), givePicks = new Set<string>(), getPicks = new Set<string>()
        let giveBudget = 0, getBudget = 0
        for (const item of trade.items) {
          const giving = item.fromRosterId === myRoster.rosterId && item.toRosterId === partner.rosterId
          const receiving = item.fromRosterId === partner.rosterId && item.toRosterId === myRoster.rosterId
          if (!giving && !receiving) throw new Error('This offer contains an unsupported trade leg.')
          const owner = giving ? myRoster : partner
          const id = item.itemReference ?? ''
          if (item.itemType === 'player' && owner.players.some(p => p.id === id)) (giving ? givePlayers : getPlayers).add(id)
          else if (['rookie_pick', 'devy_pick', 'future_pick'].includes(item.itemType) && owner.picks.some(p => p.pickId === id)) (giving ? givePicks : getPicks).add(id)
          else if (item.itemType === 'faab' && typeof item.faabAmount === 'number' && item.faabAmount > 0) { if (giving) giveBudget += item.faabAmount; else getBudget += item.faabAmount }
          else throw new Error('An original asset is unavailable or cannot be edited. Review the offer before building a new trade.')
        }
        if (!active) return
        setPartnerRosterId(partner.rosterId)
        setGivePlayerIds(givePlayers); setGetPlayerIds(getPlayers); setGivePickIds(givePicks); setGetPickIds(getPicks)
        setGiveFaab(giveBudget ? String(giveBudget) : ''); setGetFaab(getBudget ? String(getBudget) : '')
        setCounterLoading(false)
        setCounterReady(true)
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load the offer.') })
      .finally(() => { if (active) setCounterLoading(false) })
    return () => { active = false }
  }, [open, counterTradeId, leagueId, myRoster, rosters, counterReady])

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
  const canSubmit = Boolean(myRoster && partnerRoster && firstHasAssets && (!multiTeam || (secondPartnerRoster && secondHasAssets)) && !submitting && (!counterTradeId || counterReady) && !counterLoading)

  /*
   * THE grade for the deal as composed (2026-09-28): re-asked 450 ms after the last change, two-team
   * only, from the viewer's side (`/trades/grade-preview`). A stale answer is dropped by sequence, so
   * a slow response can never paint the letter of a deal the manager has already changed.
   */
  const [composedGrade, setComposedGrade] = useState<SuggestionGrade | null>(null)
  const [composedGradeLoading, setComposedGradeLoading] = useState(false)
  const composedSeq = useRef(0)
  const composedKey = JSON.stringify([partnerRosterId, [...givePlayerIds], [...getPlayerIds], [...givePickIds], [...getPickIds], giveFaab, getFaab, multiTeam])
  useEffect(() => {
    const seq = ++composedSeq.current
    setComposedGrade(null)
    if (!open || multiTeam || !myRoster || !partnerRoster || !firstHasAssets) {
      setComposedGradeLoading(false)
      return
    }
    const give = composerSide(myRoster, givePlayerIds, givePickIds, giveFaab)
    const get = composerSide(partnerRoster, getPlayerIds, getPickIds, getFaab)
    if (give.length === 0 || get.length === 0) {
      setComposedGrade({ graded: false, reason: 'Add something to both sides to see the grade.' })
      setComposedGradeLoading(false)
      return
    }
    setComposedGradeLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/grade-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ give, get }),
        })
        const data = (await res.json().catch(() => null)) as { grade?: SuggestionGrade } | null
        if (seq !== composedSeq.current) return
        setComposedGrade(res.ok && data?.grade ? data.grade : { graded: false, reason: 'This trade could not be graded just now.' })
      } catch {
        if (seq === composedSeq.current) setComposedGrade({ graded: false, reason: 'This trade could not be graded just now.' })
      } finally {
        if (seq === composedSeq.current) setComposedGradeLoading(false)
      }
    }, 450)
    return () => window.clearTimeout(timer)
    // `composedKey` stands for every input the grade depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, composedKey, myRoster, partnerRoster, leagueId])

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
    setStep('assets')
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
    setStep('assets')
  }

  /** Step 1: tap a manager. With a third team on, the second tap fills the third seat; a tap on a chosen one frees it. */
  function choosePartner(rosterId: string) {
    markCustomChange()
    if (rosterId === partnerRosterId) {
      setPartnerRosterId(secondPartnerRosterId)
      setSecondPartnerRosterId(null)
      setGetPlayerIds(new Set(secondGetPlayerIds)); setGetPickIds(new Set(secondGetPickIds)); setGetFaab(secondGetFaab)
      setSecondGetPlayerIds(new Set()); setSecondGetPickIds(new Set()); setSecondGetFaab('')
      return
    }
    if (rosterId === secondPartnerRosterId) {
      setSecondPartnerRosterId(null)
      setSecondGetPlayerIds(new Set()); setSecondGetPickIds(new Set()); setSecondGetFaab('')
      return
    }
    if (multiTeam && partnerRosterId) {
      setSecondPartnerRosterId(rosterId)
      setSecondGetPlayerIds(new Set()); setSecondGetPickIds(new Set()); setSecondGetFaab('')
      return
    }
    setPartnerRosterId(rosterId)
    setGetPlayerIds(new Set()); setGetPickIds(new Set()); setGetFaab('')
  }

  /**
   * Step 2, a tile on YOUR roster. Two teams: in or out. Three teams: each tap moves it on —
   * out → to the first partner → to the second → out — and the tile says where it is going.
   */
  function cycleMine(kind: 'player' | 'pick', id: string) {
    markCustomChange()
    const [first, setFirst, second, setSecond] = kind === 'player'
      ? [givePlayerIds, setGivePlayerIds, secondGivePlayerIds, setSecondGivePlayerIds] as const
      : [givePickIds, setGivePickIds, secondGivePickIds, setSecondGivePickIds] as const
    const without = (s: Set<string>) => { const n = new Set(s); n.delete(id); return n }
    if (first.has(id)) {
      setFirst(without(first))
      if (multiTeam && secondPartnerRoster) setSecond(new Set(second).add(id))
      return
    }
    if (second.has(id)) { setSecond(without(second)); return }
    setFirst(new Set(first).add(id))
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
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null, team: player?.team ?? null, headshotUrl: player?.imageUrl ?? null },
          }
        }),
        ...[...state.getPlayers].map((id) => {
          const player = findPlayer(partner, id)
          return {
            itemType: 'player' as const,
            itemReference: id,
            fromRosterId: partner.rosterId,
            toRosterId: myRoster.rosterId,
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null, team: player?.team ?? null, headshotUrl: player?.imageUrl ?? null },
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
        ...directPartnerLegs.map((leg) => {
          const sourceRoster = [myRoster, partnerRoster, secondPartnerRoster].find((roster) => roster?.rosterId === leg.fromRosterId)
          const player = leg.asset.kind === 'player' ? sourceRoster?.players.find((row) => row.id === leg.asset.id) : null
          return {
            itemType: leg.asset.itemType,
            itemReference: leg.asset.kind === 'faab' ? undefined : leg.asset.id,
            fromRosterId: leg.fromRosterId,
            toRosterId: leg.toRosterId,
            ...(leg.asset.kind === 'faab' ? { faabAmount: leg.asset.amount ?? 0 } : {}),
            metadata: { playerName: leg.asset.name, position: leg.asset.position, team: player?.team ?? null, headshotUrl: player?.imageUrl ?? null, amount: leg.asset.amount },
          }
        }),
      ]
      const selectedPackage = suggestions.flatMap((suggestion) => suggestion.packages).find((proposal) => proposal.id === selectedSuggestionId)
      const selectedMultiPackage = multiTeamSuggestions.find((proposal) => proposal.id === selectedSuggestionId)

      const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/trades${counterTradeId ? `/${encodeURIComponent(counterTradeId)}/counter` : ''}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposerRosterId: myRoster.rosterId,
          receiverRosterId: partnerRoster.rosterId,
          assets,
          decisionEvidenceToken: selectedPackage?.decisionEvidenceToken ?? selectedMultiPackage?.decisionEvidenceToken ?? null,
          expiresInHours,
          metadata: {
            sendDirectMessage,
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
      toast.success(counterTradeId ? 'Counteroffer sent' : (created.title ?? tradeCopy.title), { description: counterTradeId ? 'The original offer is now marked as countered.' : (created.detail || undefined) })
      onSubmitted()
      onClose()
    } catch {
      setError('Failed to submit trade.')
    } finally {
      setSubmitting(false)
    }
  }

  const participants = [myRoster, partnerRoster, ...(multiTeam && secondPartnerRoster ? [secondPartnerRoster] : [])].filter(
    (r): r is TradeableRoster => Boolean(r),
  )
  const nameOf = (id: string) => (id === myRoster?.rosterId ? 'You' : rosters?.find((r) => r.rosterId === id)?.ownerName ?? 'Manager')
  const dealLine = `${participants.length}-way trade: ${participants.map((r) => nameOf(r.rosterId)).join(', ')}`

  /** Every asset moving, one leg each, with the way to take it back out. Feeds the summary and the review. */
  const legs: TradeLeg[] = []
  if (myRoster && partnerRoster) {
    const add = (
      from: TradeableRoster,
      to: TradeableRoster,
      players: Set<string>,
      setPlayers: (next: Set<string>) => void,
      picks: Set<string>,
      setPicks: (next: Set<string>) => void,
      faab: string,
      setFaab: (next: string) => void,
    ) => {
      const drop = (set: Set<string>, setSet: (next: Set<string>) => void, id: string) => () => {
        markCustomChange()
        const next = new Set(set)
        next.delete(id)
        setSet(next)
      }
      for (const id of players) {
        const p = from.players.find((x) => x.id === id)
        legs.push({ key: `p:${from.rosterId}:${to.rosterId}:${id}`, from: from.rosterId, to: to.rosterId, kind: 'player', label: p?.name ?? id, position: p?.position ?? null, team: p?.team ?? null, headshotUrl: p?.imageUrl ?? null, remove: drop(players, setPlayers, id) })
      }
      for (const id of picks) {
        legs.push({ key: `k:${from.rosterId}:${to.rosterId}:${id}`, from: from.rosterId, to: to.rosterId, kind: 'pick', label: from.picks.find((x) => x.pickId === id)?.label ?? id, position: null, team: null, headshotUrl: null, remove: drop(picks, setPicks, id) })
      }
      const amount = Math.floor(Number(faab))
      if (amount > 0) {
        legs.push({ key: `f:${from.rosterId}:${to.rosterId}`, from: from.rosterId, to: to.rosterId, kind: 'faab', label: `$${amount} FAAB`, position: null, team: null, headshotUrl: null, remove: () => { markCustomChange(); setFaab('') } })
      }
    }
    add(myRoster, partnerRoster, givePlayerIds, setGivePlayerIds, givePickIds, setGivePickIds, giveFaab, setGiveFaab)
    add(partnerRoster, myRoster, getPlayerIds, setGetPlayerIds, getPickIds, setGetPickIds, getFaab, setGetFaab)
    if (multiTeam && secondPartnerRoster) {
      add(myRoster, secondPartnerRoster, secondGivePlayerIds, setSecondGivePlayerIds, secondGivePickIds, setSecondGivePickIds, secondGiveFaab, setSecondGiveFaab)
      add(secondPartnerRoster, myRoster, secondGetPlayerIds, setSecondGetPlayerIds, secondGetPickIds, setSecondGetPickIds, secondGetFaab, setSecondGetFaab)
    }
    for (const leg of directPartnerLegs) {
      const source = rosters?.find((r) => r.rosterId === leg.fromRosterId)
      const p = leg.asset.kind === 'player' ? source?.players.find((x) => x.id === leg.asset.id) : null
      legs.push({ key: `d:${leg.fromRosterId}:${leg.toRosterId}:${leg.asset.id}`, from: leg.fromRosterId, to: leg.toRosterId, kind: leg.asset.kind === 'player' ? 'player' : leg.asset.kind === 'faab' ? 'faab' : 'pick', label: leg.asset.name, position: leg.asset.position ?? null, team: p?.team ?? null, headshotUrl: p?.imageUrl ?? null, remove: null })
    }
  }

  const partnersReady = Boolean(partnerRoster) && (!multiTeam || Boolean(secondPartnerRoster))
  const assetsReady = Boolean(myRoster && partnerRoster && firstHasAssets && (!multiTeam || (secondPartnerRoster && secondHasAssets)))
  const title = counterTradeId
    ? 'Counter offer'
    : step === 'partner'
      ? (shadowNotice ? 'Build a shadow trade' : 'Propose a trade')
      : step === 'assets'
        ? 'Add trade assets'
        : 'Review trade offer'
  const stepNumber = step === 'partner' ? 1 : step === 'assets' ? 2 : 3

  function teamBadge(roster: TradeableRoster | null | undefined) {
    if (!roster) return null
    const name = nameOf(roster.rosterId)
    return roster.avatarUrl ? (
      // Provider avatar hosts are dynamic and are intentionally not constrained to Next Image domains.
      // eslint-disable-next-line @next/next/no-img-element
      <img className="af-tp-team-avatar" src={roster.avatarUrl} alt="" />
    ) : (
      <span className="af-tp-team-avatar" aria-hidden>{(roster.ownerName ?? name).slice(0, 1).toUpperCase()}</span>
    )
  }

  function rosterColumn(roster: TradeableRoster, side: 'mine' | 'first' | 'second') {
    const mine = side === 'mine'
    const players = side === 'first' ? getPlayerIds : side === 'second' ? secondGetPlayerIds : null
    const picks = side === 'first' ? getPickIds : side === 'second' ? secondGetPickIds : null
    const destination = (id: string, kind: 'player' | 'pick'): string | null => {
      const [a, b] = kind === 'player' ? [givePlayerIds, secondGivePlayerIds] : [givePickIds, secondGivePickIds]
      if (a.has(id)) return partnerRoster ? nameOf(partnerRoster.rosterId) : null
      if (b.has(id)) return secondPartnerRoster ? nameOf(secondPartnerRoster.rosterId) : null
      return null
    }
    const faab = side === 'mine' ? giveFaab : side === 'first' ? getFaab : secondGetFaab
    const setFaab = side === 'mine' ? setGiveFaab : side === 'first' ? setGetFaab : setSecondGetFaab
    return (
      <section key={roster.rosterId} className="af-tp-col" data-side={side} aria-label={mine ? 'Your roster' : `${nameOf(roster.rosterId)} roster`}>
        <header className="af-tp-col-head">
          {teamBadge(roster)}
          <strong>{nameOf(roster.rosterId)}</strong>
          <small>{roster.wins}-{roster.losses}{roster.ties ? `-${roster.ties}` : ''}</small>
        </header>
        {roster.players.length === 0 && roster.picks.length === 0 ? <p className="af-tp-empty">No tradeable players yet.</p> : null}
        <div className="af-tp-tiles">
          {roster.players.map((p) => {
            const dest = mine ? destination(p.id, 'player') : null
            const on = mine ? Boolean(dest) || givePlayerIds.has(p.id) || secondGivePlayerIds.has(p.id) : Boolean(players?.has(p.id))
            return (
              <button
                key={p.id}
                type="button"
                className="af-tp-tile"
                data-pos={(p.position ?? '').toLowerCase() || undefined}
                aria-pressed={on}
                aria-label={`${p.name}${p.position ? `, ${p.position}` : ''}${p.team ? `, ${p.team}` : ''}${multiTeam && dest ? `, to ${dest}` : ''}`}
                onClick={() => (mine ? cycleMine('player', p.id) : toggle(players!, side === 'first' ? setGetPlayerIds : setSecondGetPlayerIds, p.id))}
              >
                <PlayerAvatar name={p.name} headshotUrl={p.imageUrl} team={p.team} sport={sport} />
                <span className="af-tp-tile-text">
                  <span className="af-tp-tile-meta">{p.position ?? '—'}{p.team ? ` · ${p.team}` : ''}</span>
                  <span className="af-tp-tile-name">{tileName(p.name)}</span>
                  {multiTeam && dest ? <span className="af-tp-tile-to">To {dest}</span> : null}
                </span>
                <span className="af-tp-tile-check" aria-hidden />
              </button>
            )
          })}
          {roster.picks.map((p) => {
            const dest = mine ? destination(p.pickId, 'pick') : null
            const on = mine ? Boolean(dest) || givePickIds.has(p.pickId) || secondGivePickIds.has(p.pickId) : Boolean(picks?.has(p.pickId))
            const locked = p.proposable === false
            return (
              <button
                key={p.pickId}
                type="button"
                className="af-tp-tile"
                data-kind="pick"
                aria-pressed={on}
                disabled={locked && !on}
                title={locked ? 'This pick can only be traded on its own platform.' : undefined}
                aria-label={`${p.label}${multiTeam && dest ? `, to ${dest}` : ''}`}
                onClick={() => (mine ? cycleMine('pick', p.pickId) : toggle(picks!, side === 'first' ? setGetPickIds : setSecondGetPickIds, p.pickId))}
              >
                <span className="af-tp-pick-icon" aria-hidden>PICK</span>
                <span className="af-tp-tile-text">
                  <span className="af-tp-tile-meta">{p.fromTeam ? `From ${p.fromTeam}` : 'Draft pick'}</span>
                  <span className="af-tp-tile-name">{p.label}</span>
                  {multiTeam && dest ? <span className="af-tp-tile-to">To {dest}</span> : null}
                </span>
                <span className="af-tp-tile-check" aria-hidden />
              </button>
            )
          })}
        </div>
        {roster.faabRemaining != null ? (
          <label className="af-tp-faab">
            <span>{mine ? 'FAAB you send' : 'FAAB you get'}</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max={roster.faabRemaining}
              value={faab}
              placeholder="0"
              aria-label={`FAAB — ${nameOf(roster.rosterId)}`}
              onChange={(e) => { markCustomChange(); setFaab(e.target.value) }}
            />
            <small>of ${roster.faabRemaining}</small>
          </label>
        ) : null}
        {mine && multiTeam && secondPartnerRoster && myRoster?.faabRemaining != null ? (
          <label className="af-tp-faab">
            <span>FAAB to {nameOf(secondPartnerRoster.rosterId)}</span>
            <input type="number" inputMode="numeric" min="0" max={Math.max(0, myRoster.faabRemaining - Number(giveFaab || 0))} value={secondGiveFaab} placeholder="0" aria-label={`FAAB to ${nameOf(secondPartnerRoster.rosterId)}`} onChange={(e) => { markCustomChange(); setSecondGiveFaab(e.target.value) }} />
          </label>
        ) : null}
      </section>
    )
  }

  function summary(editable: boolean) {
    return (
      <div className="af-tp-summary" data-testid="propose-trade-summary">
        {participants.map((r) => {
          const receives = legs.filter((l) => l.to === r.rosterId)
          const sends = legs.filter((l) => l.from === r.rosterId)
          const item = (l: TradeLeg, dir: 'from' | 'to') => (
            <li key={l.key} className="af-tp-sum-item">
              {l.kind === 'player' ? (
                <PlayerAvatar name={l.label} headshotUrl={l.headshotUrl} team={l.team} sport={sport} />
              ) : (
                <span className="af-tp-pick-icon" aria-hidden>{l.kind === 'faab' ? '$' : 'PICK'}</span>
              )}
              <span className="af-tp-sum-text">
                <b>{l.label}</b>
                <small>
                  {l.position && l.kind === 'player' ? `${l.position}${l.team ? ` · ${l.team}` : ''} · ` : ''}
                  {dir === 'from' ? `From ${nameOf(l.from)}` : `To ${nameOf(l.to)}`}
                </small>
              </span>
              {editable && l.remove ? (
                <button type="button" className="af-tp-x" aria-label={`Remove ${l.label}`} onClick={l.remove}>×</button>
              ) : null}
            </li>
          )
          return (
            <section key={r.rosterId} className="af-tp-sum-team" data-testid="propose-trade-review-team">
              <header>{teamBadge(r)}<strong>{nameOf(r.rosterId)}</strong></header>
              <div className="af-tp-sum-cols">
                <div>
                  <p className="af-tp-sum-label" data-dir="in">Receives</p>
                  {receives.length ? <ul>{receives.map((l) => item(l, 'from'))}</ul> : <p className="af-tp-empty">Nothing yet</p>}
                </div>
                <div>
                  <p className="af-tp-sum-label" data-dir="out">Sends</p>
                  {sends.length ? <ul>{sends.map((l) => item(l, 'to'))}</ul> : <p className="af-tp-empty">Nothing yet</p>}
                </div>
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  const footNote =
    step === 'partner'
      ? partnerRoster
        ? multiTeam && !secondPartnerRoster
          ? 'Pick the third team'
          : dealLine
        : 'Choose who you are trading with'
      : step === 'assets'
        ? !firstHasAssets
          ? 'Tap players or picks to add them'
          : multiTeam && secondPartnerRoster && !secondHasAssets
            ? `${nameOf(secondPartnerRoster.rosterId)} isn’t in the deal yet`
            : `You send ${legs.filter((l) => l.from === myRoster?.rosterId).length} · You get ${legs.filter((l) => l.to === myRoster?.rosterId).length}`
        : dealLine

  const footer = (
    <div className="af-tp-foot">
      <span className="af-tp-foot-note" data-testid="propose-trade-foot-note">{loading ? '' : footNote}</span>
      <div className="af-tp-foot-btns">
        {step === 'partner' || (step === 'assets' && counterTradeId) ? (
          <button type="button" className="af-tp-btn" onClick={onClose}>Cancel</button>
        ) : (
          <button type="button" className="af-tp-btn" onClick={() => setStep(step === 'review' ? 'assets' : 'partner')}>Back</button>
        )}
        {step === 'review' ? (
          <button
            type="button"
            className="af-tp-btn"
            data-variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            data-testid="propose-trade-submit"
          >
            {submitting ? 'Sending…' : counterTradeId ? 'Send counteroffer' : submitLabel}
          </button>
        ) : (
          <button
            type="button"
            className="af-tp-btn"
            data-variant="primary"
            disabled={step === 'partner' ? !partnersReady : !assetsReady || counterLoading}
            onClick={() => setStep(step === 'partner' ? 'assets' : 'review')}
            data-testid="propose-trade-next"
          >
            Next
          </button>
        )}
      </div>
    </div>
  )

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      description={`Step ${stepNumber} of 3${step === 'assets' ? ' · tap a player or pick to add it' : ''}`}
      size="xl"
      className="af-core af-league-transactions af-transaction-dialog"
      footer={footer}
    >
      <div className="af-tp" data-step={step} data-testid={`propose-trade-step-${step}`}>
        {/*
          Shown before any selection is made. A manager building a trade for an imported league
          needs to know up front that the offer stops at AllFantasy — discovering it in the
          success toast is too late to be honest about it.
        */}
        {shadowNotice && step === 'partner' ? (
          <p data-testid="shadow-league-trade-notice" className="af-tp-notice">
            This proposal stays inside AllFantasy — {sourceLabel ?? 'your host platform'} is not notified.
            Use it as a plan, then send the offer in {sourceLabel ?? 'your host platform'}.
          </p>
        ) : null}
        {error ? <p className="af-tp-error" role="alert">{error}</p> : null}
        {loading || rosters === null ? (
          <p className="af-tp-empty" role="status">Loading rosters…</p>
        ) : step === 'partner' ? (
          <>
            {!counterTradeId && visibleSuggestions.length > 0 ? (
              <section aria-label="Chimmy's suggested partners">
                <div className="af-tp-section-head">
                  <h3>Chimmy&apos;s suggested partners</h3>
                  {tradeContext ? (
                    <label className="af-tp-goal">
                      Your goal
                      <select
                        aria-label="My trade strategy"
                        value={tradeContext.strategyConfirmed ? (tradeContext.managerStrategy ?? 'balanced') : ''}
                        disabled={savingStrategy}
                        onChange={(event) => void updateManagerStrategy(event.target.value as 'win-now' | 'balanced' | 'rebuild')}
                      >
                        <option value="" disabled>Choose</option>
                        <option value="win-now">Win now</option>
                        <option value="balanced">Balanced</option>
                        <option value="rebuild">Rebuild</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                <div className="af-tp-suggest">
                  {visibleSuggestions.slice(0, 3).map((suggestion) => {
                    const roster = rosters?.find((r) => r.rosterId === suggestion.rosterId)
                    const best = suggestion.packages[0]
                    return (
                      <button key={suggestion.rosterId} type="button" className="af-tp-card" onClick={() => (best ? applySuggestion(suggestion.rosterId, best) : choosePartner(suggestion.rosterId))} data-testid={`suggested-trade-partner-${suggestion.rosterId}`}>
                        <span className="af-tp-card-head">
                          {teamBadge(roster)}
                          <b>{roster?.ownerName ?? 'Manager'}</b>
                          <span className="af-tp-fit">{suggestion.fitScore}% fit</span>
                        </span>
                        {best ? <span className="af-tp-card-line">Send {best.send.map((a) => a.name).join(' + ')} for {best.receive.map((a) => a.name).join(' + ')}</span> : null}
                        {best ? <ComposerGradeLine compact grade={best.grade} partnerName={roster?.ownerName} testId="composer-partner-grade" /> : null}
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}
            {!counterTradeId && visibleMultiTeamSuggestions.length > 0 ? (
              <section aria-label="Three-team ideas">
                <div className="af-tp-section-head"><h3>Three-team ideas</h3></div>
                <div className="af-tp-suggest">
                  {visibleMultiTeamSuggestions.map((suggestion) => (
                    <button key={suggestion.id} type="button" className="af-tp-card" data-tone="violet" onClick={() => applyMultiTeamSuggestion(suggestion)}>
                      <b>{suggestion.rosterIds.slice(1).map((id) => nameOf(id)).join(' + ')}</b>
                      <span className="af-tp-card-line">{suggestion.reason}</span>
                      {suggestion.simulation?.available ? <span className="af-tp-card-line" data-tone={(suggestion.simulation.deltaPct ?? 0) >= 0 ? 'good' : 'bad'}>{suggestion.simulation.metric === 'survival' ? 'Survival' : 'Playoff'} odds {(suggestion.simulation.deltaPct ?? 0) >= 0 ? '+' : ''}{suggestion.simulation.deltaPct?.toFixed(1)}%</span> : null}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            <section aria-label="Managers">
              <div className="af-tp-section-head">
                <h3>{multiTeam ? 'Pick two managers' : 'Pick a manager'}</h3>
                {partnerRosters.length >= 2 ? (
                  <label className="af-tp-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={multiTeam}
                      onChange={(e) => {
                        markCustomChange()
                        setMultiTeam(e.target.checked)
                        if (!e.target.checked) setSecondPartnerRosterId(null)
                      }}
                      data-testid="propose-trade-third-team"
                    />
                    Add a third team
                  </label>
                ) : null}
              </div>
              {partnerRosters.length === 0 ? <p className="af-tp-empty">No other manager can receive an offer yet.</p> : null}
              <div className="af-tp-managers">
                {partnerRosters.map((r) => {
                  const seat = r.rosterId === partnerRosterId ? 1 : r.rosterId === secondPartnerRosterId ? 2 : 0
                  return (
                    <button
                      key={r.rosterId}
                      type="button"
                      className="af-tp-manager"
                      aria-pressed={seat > 0}
                      onClick={() => choosePartner(r.rosterId)}
                      data-testid={`propose-trade-partner-${r.rosterId}`}
                    >
                      {teamBadge(r)}
                      <span className="af-tp-manager-text">
                        <b>{r.ownerName ?? 'Manager'}</b>
                        <small>{r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''} · {r.players.length} players</small>
                      </span>
                      <span className="af-tp-tile-check" aria-hidden />
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        ) : step === 'assets' ? (
          <>
            {counterLoading ? <p className="af-tp-empty" role="status">Loading the offer…</p> : null}
            {!counterTradeId && activeSuggestion?.packages.length ? (
              <details className="af-tp-ideas">
                <summary>Chimmy&apos;s package ideas for {partnerRoster ? nameOf(partnerRoster.rosterId) : 'this manager'} · {activeSuggestion.packages.length}</summary>
                <div className="af-tp-suggest">
                  {activeSuggestion.packages.map((proposal, index) => (
                    <button key={`${activeSuggestion.rosterId}-${index}`} type="button" className="af-tp-card" onClick={() => applySuggestion(activeSuggestion.rosterId, proposal)}>
                      <span className="af-tp-card-line"><b>Send</b> {proposal.send.map((asset) => asset.name).join(' + ')}</span>
                      <span className="af-tp-card-line"><b>Get</b> {proposal.receive.map((asset) => asset.name).join(' + ')}</span>
                      {/*
                        🛑 THE GRADE, NOT "N% VALUE MATCH" (2026-09-28). `fairness` is the suggester's own
                        value gap; when the package is graded it is not shown, and the reason's clause that
                        quotes it is cut — it could read against the letter beside it.
                      */}
                      <ComposerGradeLine compact grade={proposal.grade} partnerName={partnerRoster?.ownerName} testId="composer-package-grade" />
                      <span className="af-tp-card-line">
                        {proposal.grade ? reasonWithoutValueGap(proposal.reason) : `${proposal.fairness}% value match · ${proposal.reason}`}
                      </span>
                      {proposal.simulation?.available ? <span className="af-tp-card-line" data-tone={(proposal.simulation.deltaPct ?? 0) >= 0 ? 'good' : 'bad'}>{proposal.simulation.metric === 'survival' ? 'Survival' : 'Playoff'} odds {proposal.simulation.beforePct?.toFixed(1)}% → {proposal.simulation.afterPct?.toFixed(1)}%</span> : null}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
            {myRoster && partnerRoster ? (
              <div className="af-tp-assets">
                <div className="af-tp-board" data-teams={participants.length}>
                  {rosterColumn(myRoster, 'mine')}
                  {rosterColumn(partnerRoster, 'first')}
                  {multiTeam && secondPartnerRoster ? rosterColumn(secondPartnerRoster, 'second') : null}
                </div>
                <aside className="af-tp-aside" aria-label="Trade summary">
                  <h3>Trade summary</h3>
                  {multiTeam ? <p className="af-tp-hint">Tap your player again to send him to the other team.</p> : null}
                  {summary(true)}
                </aside>
              </div>
            ) : partnerRosterId ? (
              <p className="af-tp-empty">This manager has no tradeable roster yet.</p>
            ) : (
              <p className="af-tp-empty">Pick a manager first.</p>
            )}
          </>
        ) : (
          <div className="af-tp-review" data-testid="propose-trade-review">
            <label className="af-tp-row">
              <span>Trade expires in</span>
              <select value={expiresInHours} onChange={(e) => setExpiresInHours(Number(e.target.value))} data-testid="propose-trade-expiry">
                {TRADE_EXPIRY_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
              </select>
            </label>
            {summary(false)}
            {/* THE grade for the deal as composed, before it is sent (2026-09-28). */}
            <div className="af-tp-grade" data-testid="composer-deal-grade-box">
              <p className="af-tp-sum-label">How this trade grades</p>
              {multiTeam ? (
                <span className="af-tp-hint">Three-team trades aren&apos;t graded.</span>
              ) : composedGradeLoading && !composedGrade ? (
                <span className="af-tp-hint">Grading…</span>
              ) : (
                <ComposerGradeLine grade={composedGrade} partnerName={partnerRoster?.ownerName} testId="composer-deal-grade" />
              )}
            </div>
            <label className="af-tp-row">
              <span>Send direct message</span>
              <input
                type="checkbox"
                role="switch"
                className="af-tp-toggle"
                checked={sendDirectMessage}
                onChange={(e) => setSendDirectMessage(e.target.checked)}
                data-testid="propose-trade-send-dm"
              />
            </label>
            {multiTeam ? <p className="af-tp-hint">Every manager must accept before the league reviews it. Direct messages go to two-team offers only.</p> : null}
          </div>
        )}
      </div>
    </AppModal>
  )
}

/** One asset moving between two teams, as the summary draws it. `remove` is null for a leg the viewer is not party to. */
type TradeLeg = {
  key: string
  from: string
  to: string
  kind: 'player' | 'pick' | 'faab'
  label: string
  position: string | null
  team: string | null
  headshotUrl: string | null
  remove: (() => void) | null
}
