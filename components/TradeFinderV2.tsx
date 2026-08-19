'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Search, ChevronDown, ChevronUp, Copy, MessageCircle, ArrowRight, ArrowLeft, Zap, RefreshCw, AlertTriangle, Users, TrendingUp, Shield, X, Layers, BarChart3, Info, Send, RotateCcw, Target, UserCheck, Handshake } from 'lucide-react'
import { Card, Button, Pill, cx, EmptyState, LoadingSpinner, Divider } from '@/components/ui/legacy-ui'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import AIBottomSheet from '@/components/mobile/AIBottomSheet'
import { ConfidencePill, ConfidenceBreakdownModal, RiskFlags } from '@/components/ai'
import type { Confidence, ConfidenceBreakdown } from '@/components/ai'
import { NegotiationSheet } from '@/components/negotiation'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type { NegotiationData } from '@/components/negotiation'
import type { TradeCandidate as PatchTradeCandidate, TradeAsset as PatchTradeAsset } from '@/lib/trade-finder/apply-counter'
import { computeValueDeltaPct, previewFairnessLabel, FAIRNESS_DISPLAY } from '@/lib/trade-finder/score-candidate'
import type { FairnessLabel } from '@/lib/trade-finder/score-candidate'
import { getTradeAnalyzerAIChatUrl } from '@/lib/trade-analyzer/TradeToAIContextBridge'

type Objective = 'WIN_NOW' | 'REBUILD' | 'BALANCED'
type FinderMode = 'FAST' | 'DEEP'
type TopTab = 'trades' | 'matchmaking'

type MatchmakingGoal = 'rb_depth' | 'wr_depth' | 'qb_upgrade' | 'te_upgrade' | 'get_younger' | 'acquire_picks' | 'win_now' | 'rebuild' | 'target_player'

interface MatchOfferAsset {
  name: string
  value: number
  position: string
  isPick: boolean
}

interface MatchPartner {
  rosterId: number
  displayName: string
  avatar?: string
  contenderTier: string
  matchScore: number
  scoreBreakdown: {
    needOverlap: number
    targetAvailability: number
    biasAlignment: number
    tradeFrequency: number
    overpayWillingness: number
  }
  reasons: string[]
  acceptEstimate: number
  acceptLabel: string
  suggestedOffer: {
    userGives: MatchOfferAsset[]
    partnerGives: MatchOfferAsset[]
    fairnessPct: number
  } | null
  tendencyInsights: string[]
}

interface MatchmakingResponse {
  success: boolean
  goal: MatchmakingGoal
  goalDescription: string
  targetPlayer?: string
  partners: MatchPartner[]
  stats: {
    partnersEvaluated: number
    qualifiedPartners: number
  }
}

const GOAL_OPTIONS: Array<{ key: MatchmakingGoal; label: string; icon: string; description: string }> = [
  { key: 'rb_depth', label: 'RB Depth', icon: '🏃', description: 'Find running back depth' },
  { key: 'wr_depth', label: 'WR Depth', icon: '🎯', description: 'Find wide receiver depth' },
  { key: 'qb_upgrade', label: 'QB Upgrade', icon: '🎖️', description: 'Upgrade at quarterback' },
  { key: 'te_upgrade', label: 'TE Upgrade', icon: '💪', description: 'Upgrade at tight end' },
  { key: 'get_younger', label: 'Get Younger', icon: '⬇️', description: 'Acquire younger assets' },
  { key: 'acquire_picks', label: 'Get Picks', icon: '🎟️', description: 'Acquire draft picks' },
  { key: 'win_now', label: 'Win Now', icon: '🏆', description: 'Buy proven starters' },
  { key: 'rebuild', label: 'Rebuild', icon: '♻️', description: 'Get young players + picks' },
  { key: 'target_player', label: 'Target Player', icon: '🎯', description: 'Acquire a specific player' },
]

interface League {
  league_id: string
  name: string
  season: number
  type: string
  scoring: string
  sport?: string
  is_sf?: boolean
  team_count: number
}

interface TradeAsset {
  assetId?: string
  name: string
  value: number
  tier: string
  position: string
  age?: number
  isPick?: boolean
}

interface TradeSide {
  teamId: string
  gives: TradeAsset[]
  receives: TradeAsset[]
}

interface TradeRecommendation {
  tradeId: string
  rank: number
  summary: string
  whyItHelpsYou: string
  whyTheyAccept: string
  negotiationTip: string
  confidence: 'HIGH' | 'MEDIUM' | 'LEARNING'
  confidenceScore: number
  riskFlags: string[]
  fallbackAsset: string | null
  archetype?: string
  finderScore?: number
  negotiation?: NegotiationData
}

interface TradeCandidate {
  tradeId: string
  archetype: string
  finderScore: number
  valueDeltaPct: number
  whyThisExists: string
  teamA: TradeSide
  teamB: TradeSide
  scoreBreakdown?: Record<string, number>
}

interface AssetIndexEntry {
  id: string
  label: string
  kind: 'PLAYER' | 'PICK'
  value?: number
  tier?: string
  position?: string
}

interface TradeOpportunity {
  type: string
  title: string
  description: string
  icon: string
  targetManager?: string
  targetTeamId?: string
  relevantPlayers: Array<{ name: string; position: string; value: number; reason: string }>
  confidence: number
  actionable: boolean
}

interface FinderResponse {
  success: boolean
  recommendations: TradeRecommendation[]
  opportunities?: TradeOpportunity[]
  overallStrategy?: string
  objectiveNotes?: string
  candidates?: TradeCandidate[]
  assetIndex?: Record<string, AssetIndexEntry>
  meta: {
    partnersEvaluated: number
    rawCandidatesGenerated: number
    prunedTo: number
    aiEnhanced?: boolean
    hasOpportunities?: boolean
    message?: string
    note?: string
  }
}

interface TradeFinderV2Props {
  leagues: League[]
  username: string
  sleeperUserId?: string
  selectedLeague?: string
  onLeagueChange?: (leagueId: string) => void
  userRosterId?: number | null
}

const ARCHETYPE_LABELS: Record<string, { label: string; icon: string }> = {
  POSITIONAL_SWAP: { label: 'Positional Swap', icon: '🔄' },
  CONSOLIDATION: { label: 'Consolidation', icon: '📦' },
  PICK_FOR_PLAYER: { label: 'Pick for Player', icon: '🎯' },
  WINDOW_ARBITRAGE: { label: 'Window Arbitrage', icon: '⏳' },
  INJURY_DISCOUNT: { label: 'Injury Discount', icon: '🩹' },
}

function AssetRow({ asset, direction }: { asset: TradeAsset; direction: 'in' | 'out' }) {
  const tierShort = asset.tier?.replace('Tier', 'T').replace('_', ' ').replace(/Tier\d_/, '') || ''
  const posColor = {
    QB: 'text-rose-300',
    RB: 'text-cyan-300',
    WR: 'text-emerald-300',
    TE: 'text-amber-300',
    PICK: 'text-purple-300',
  }[asset.position] || 'text-white/70'

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 py-1.5">
      <div className={cx(
        'w-1.5 h-8 rounded-full flex-shrink-0',
        direction === 'in' ? 'bg-cyan-400' : 'bg-amber-400'
      )} />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
          <span className={cx('text-[10px] font-bold uppercase flex-shrink-0', posColor)}>{asset.position}</span>
          {!asset.isPick && <MiniPlayerImg sleeperId={asset.assetId} name={asset.name} size={18} />}
          <span className="text-xs sm:text-sm text-white font-medium truncate min-w-0">{asset.name}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 min-w-0 overflow-hidden">
          <span className="text-[9px] sm:text-[10px] text-white/40 flex-shrink-0">{tierShort}</span>
          {asset.age && <span className="text-[9px] sm:text-[10px] text-white/30 flex-shrink-0">Age {asset.age}</span>}
          <span className="text-[9px] sm:text-[10px] text-white/25 flex-shrink-0 truncate">{asset.value.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

function ExpandableSection({ title, icon, children, defaultOpen = false }: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-t border-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 px-1 text-left touch-manipulation"
      >
        <div className="flex items-center gap-2 text-sm text-white/70">
          {icon}
          <span>{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
      </button>
      {open && <div className="pb-3 px-1">{children}</div>}
    </div>
  )
}

function ScoreBar({ label, value, max = 100, color = 'cyan' }: { label: string; value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    purple: 'bg-purple-400',
    rose: 'bg-rose-400',
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/50 w-20 flex-shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cx('h-full rounded-full transition-all', colorMap[color] || 'bg-cyan-400')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-white/40 w-6 text-right">{Math.round(value)}</span>
    </div>
  )
}

function AcceptBadge({ label, estimate }: { label: string; estimate: number }) {
  const colorMap: Record<string, string> = {
    'Very Likely': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'Likely': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    'Possible': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'Unlikely': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  }
  const classes = colorMap[label] || 'bg-white/10 text-white/60 border-white/10'
  return (
    <span className={cx('text-[10px] font-medium px-2 py-0.5 rounded-full border', classes)}>
      {label} ({Math.round(estimate * 100)}%)
    </span>
  )
}

function PartnerCard({ partner, rank }: { partner: MatchPartner; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const bd = partner.scoreBreakdown

  return (
    <div className="bg-black/30 border border-white/8 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 touch-manipulation"
      >
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0 text-sm font-bold text-white/80">
            {rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-white truncate">{partner.displayName}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-white/40">{partner.contenderTier}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-cyan-400 font-medium">Match: {partner.matchScore}/100</span>
              <AcceptBadge label={partner.acceptLabel} estimate={partner.acceptEstimate} />
            </div>
            {partner.reasons.length > 0 && (
              <p className="text-[11px] text-white/50 mt-1.5 line-clamp-2">{partner.reasons[0]}</p>
            )}
          </div>
          <div className="flex-shrink-0">
            {expanded ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
          <div className="space-y-1.5">
            <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mb-2">Score Breakdown</p>
            <ScoreBar label="Need Overlap" value={bd.needOverlap} color="cyan" />
            <ScoreBar label="Availability" value={bd.targetAvailability} color="emerald" />
            <ScoreBar label="Bias Align" value={bd.biasAlignment} color="purple" />
            <ScoreBar label="Trade Freq" value={bd.tradeFrequency} color="amber" />
            <ScoreBar label="Overpay" value={bd.overpayWillingness} color="rose" />
          </div>

          {partner.reasons.length > 1 && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mb-1.5">Why They Match</p>
              <ul className="space-y-1">
                {partner.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-white/60 flex items-start gap-1.5">
                    <span className="text-cyan-400 mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {partner.suggestedOffer && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mb-2">Suggested Trade</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-2.5">
                  <p className="text-[10px] text-amber-400/70 font-medium mb-1.5">You Send</p>
                  {partner.suggestedOffer.userGives.map((a, i) => (
                    <div key={i} className="flex items-center gap-1 py-0.5">
                      <span className="text-[10px] font-bold text-white/40">{a.position}</span>
                      <span className="text-xs text-white/80 truncate">{a.name}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-cyan-500/5 border border-cyan-500/10 rounded-xl p-2.5">
                  <p className="text-[10px] text-cyan-400/70 font-medium mb-1.5">You Get</p>
                  {partner.suggestedOffer.partnerGives.map((a, i) => (
                    <div key={i} className="flex items-center gap-1 py-0.5">
                      <span className="text-[10px] font-bold text-white/40">{a.position}</span>
                      <span className="text-xs text-white/80 truncate">{a.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-center">
                <span className={cx(
                  'text-[10px] font-medium px-2 py-0.5 rounded-full',
                  Math.abs(partner.suggestedOffer.fairnessPct) < 10
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : Math.abs(partner.suggestedOffer.fairnessPct) < 20
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-rose-500/15 text-rose-300'
                )}>
                  Fairness: {partner.suggestedOffer.fairnessPct > 0 ? '+' : ''}{partner.suggestedOffer.fairnessPct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {partner.tendencyInsights.length > 0 && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider font-medium mb-1.5">Tendency Insights</p>
              <div className="flex flex-wrap gap-1">
                {partner.tendencyInsights.map((t, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 bg-purple-500/10 border border-purple-500/15 rounded-full text-purple-300/80">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function buildConfidenceDrivers(rec: TradeRecommendation, candidate?: TradeCandidate): string[] {
  const drivers: string[] = []

  if (candidate?.valueDeltaPct !== undefined) {
    const gap = Math.abs(candidate.valueDeltaPct)
    drivers.push(gap < 10
      ? `Value gap is narrow (${candidate.valueDeltaPct > 0 ? '+' : ''}${candidate.valueDeltaPct.toFixed(1)}%)`
      : `Notable value gap (${candidate.valueDeltaPct > 0 ? '+' : ''}${candidate.valueDeltaPct.toFixed(1)}%)`)
  }

  if (candidate?.finderScore) {
    drivers.push(`Finder score: ${candidate.finderScore}/100`)
  }

  if (rec.riskFlags?.length) {
    rec.riskFlags.forEach(flag => drivers.push(flag))
  }

  drivers.push('League data fully loaded')

  if (candidate?.archetype) {
    const info = ARCHETYPE_LABELS[candidate.archetype]
    if (info) drivers.push(`Trade type: ${info.label}`)
  }

  return drivers
}

function toCandidateAsset(a: TradeAsset): PatchTradeAsset {
  return {
    id: a.assetId || a.name,
    label: a.name,
    kind: a.isPick ? 'PICK' : 'PLAYER',
    value: a.value,
    tier: a.tier,
    position: a.position,
  }
}

function buildEnrichedIndex(
  assetIndex?: Record<string, AssetIndexEntry>,
  gives: TradeAsset[] = [],
  receives: TradeAsset[] = [],
): Record<string, PatchTradeAsset> {
  const enriched: Record<string, PatchTradeAsset> = {}
  if (assetIndex) {
    for (const [k, v] of Object.entries(assetIndex)) {
      enriched[k] = { id: v.id, label: v.label, kind: v.kind, value: v.value, tier: v.tier, position: v.position }
      if (v.label && !enriched[v.label]) {
        enriched[v.label] = enriched[k]
      }
      const lower = v.label?.toLowerCase()
      if (lower && !enriched[lower]) {
        enriched[lower] = enriched[k]
      }
    }
  }
  for (const a of [...gives, ...receives]) {
    const ca = toCandidateAsset(a)
    if (!enriched[ca.id]) enriched[ca.id] = ca
    if (ca.label && !enriched[ca.label]) enriched[ca.label] = ca
  }
  return enriched
}

function FairnessPreview({ label, deltaPct, isPatched, onReset }: {
  label: FairnessLabel
  deltaPct: number
  isPatched: boolean
  onReset?: () => void
}) {
  const display = FAIRNESS_DISPLAY[label]
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/20 border border-white/5">
      <div className="flex items-center gap-2">
        <div className={cx('text-xs font-bold', display.color)}>
          {display.text}
        </div>
        <span className={cx('text-[11px] font-medium', deltaPct >= 0 ? 'text-emerald-400/80' : 'text-amber-400/80')}>
          ({deltaPct > 0 ? '+' : ''}{deltaPct}%)
        </span>
        {isPatched && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/20 text-purple-300">
            Counter Applied
          </span>
        )}
      </div>
      {isPatched && onReset && (
        <button onClick={onReset} className="flex items-center gap-1 text-[10px] text-white/40 hover:text-white/60 transition-colors touch-manipulation">
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      )}
    </div>
  )
}

function TradeCard({
  recommendation,
  candidate,
  index,
  total,
  onCopy,
  onAskAI,
  assetIndex,
  onRecheck,
  patchedTrade,
  onOpenNegotiation,
  onResetPatch,
}: {
  recommendation: TradeRecommendation
  candidate?: TradeCandidate
  index: number
  total: number
  onCopy: () => void
  onAskAI: () => void
  assetIndex?: Record<string, AssetIndexEntry>
  onRecheck?: (youSend: TradeAsset[], youReceive: TradeAsset[]) => void
  patchedTrade?: PatchTradeCandidate | null
  onOpenNegotiation?: () => void
  onResetPatch?: () => void
}) {
  const [showConfidenceDetail, setShowConfidenceDetail] = useState(false)
  const [recheckLoading, setRecheckLoading] = useState(false)

  const archetype = candidate?.archetype || recommendation.archetype || ''
  const archetypeInfo = ARCHETYPE_LABELS[archetype]
  const partnerTeamId = candidate?.teamB?.teamId || ''

  const originalGives = candidate?.teamA?.gives || []
  const originalReceives = candidate?.teamA?.receives || []

  const displayGives = patchedTrade ? patchedTrade.youSend.map(a => ({
    assetId: a.id, name: a.label, value: a.value ?? 0, tier: a.tier ?? '', position: a.position ?? '', isPick: a.kind === 'PICK',
  })) : originalGives

  const displayReceives = patchedTrade ? patchedTrade.youReceive.map(a => ({
    assetId: a.id, name: a.label, value: a.value ?? 0, tier: a.tier ?? '', position: a.position ?? '', isPick: a.kind === 'PICK',
  })) : originalReceives

  const previewDelta = patchedTrade ? computeValueDeltaPct(patchedTrade) : null
  const previewLabel = previewDelta !== null ? previewFairnessLabel(previewDelta) : null
  const isPatched = patchedTrade !== null

  const handleRecheck = useCallback(async () => {
    if (!onRecheck) return
    setRecheckLoading(true)
    try {
      onRecheck(displayGives, displayReceives)
    } finally {
      setRecheckLoading(false)
    }
  }, [onRecheck, displayGives, displayReceives])

  return (
    <Card accent="cyan" padding="none" className="w-full">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">
              {index === 0 ? '🔥' : index === 1 ? '⚡' : '💎'}
            </span>
            <span className="text-sm font-bold text-white">
              {index === 0 ? 'Best Trade' : `Trade #${index + 1}`}
            </span>
            <span className="text-[10px] text-white/30">{index + 1}/{total}</span>
          </div>
          <ConfidencePill
            confidence={{ rating: recommendation.confidence, score: recommendation.confidenceScore }}
            onClick={() => setShowConfidenceDetail(!showConfidenceDetail)}
          />
        </div>

        <ConfidenceBreakdownModal
          open={showConfidenceDetail}
          onClose={() => setShowConfidenceDetail(false)}
          confidence={{
            rating: recommendation.confidence,
            score: recommendation.confidenceScore,
            drivers: buildConfidenceDrivers(recommendation, candidate),
          }}
        />

        <RiskFlags risks={recommendation.riskFlags || []} />

        {archetypeInfo && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm">{archetypeInfo.icon}</span>
            <span className="text-[11px] text-white/50 font-medium">{archetypeInfo.label}</span>
            {candidate?.finderScore && (
              <Pill tone="cyan" size="sm">Score: {candidate.finderScore}/100</Pill>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 text-xs text-white/50">
          <span>You</span>
          <ArrowRight className="w-3 h-3" />
          <span>Team {partnerTeamId}</span>
        </div>

        {previewLabel && previewDelta !== null && (
          <div className="mb-3">
            <FairnessPreview label={previewLabel} deltaPct={previewDelta} isPatched={isPatched} onReset={onResetPatch} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-1">
          <div>
            <div className="text-[10px] font-bold uppercase text-cyan-400/70 mb-1.5 tracking-wider">You Receive</div>
            <div className="space-y-0.5">
              {displayReceives.map((asset, i) => (
                <AssetRow key={i} asset={asset} direction="in" />
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-amber-400/70 mb-1.5 tracking-wider">You Send</div>
            <div className="space-y-0.5">
              {displayGives.map((asset, i) => (
                <AssetRow key={i} asset={asset} direction="out" />
              ))}
            </div>
          </div>
        </div>

        <p className="text-sm text-white/80 mt-3 leading-relaxed">{recommendation.summary}</p>

        <ExpandableSection title="Why this helps YOU" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{recommendation.whyItHelpsYou}</p>
        </ExpandableSection>

        <ExpandableSection title="Why they might accept" icon={<Users className="w-3.5 h-3.5" />}>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{recommendation.whyTheyAccept}</p>
        </ExpandableSection>

        {recommendation.negotiationTip && (
          <ExpandableSection title="Negotiation tip" icon={<Shield className="w-3.5 h-3.5" />}>
            <p className="text-sm text-cyan-200/80 leading-relaxed">{recommendation.negotiationTip}</p>
            {recommendation.fallbackAsset && (
              <div className="mt-2 p-2 bg-cyan-500/10 rounded-lg border border-cyan-400/15 text-xs text-cyan-300/80">
                Plan B: Swap for <span className="font-medium text-cyan-200">{recommendation.fallbackAsset}</span> if rejected
              </div>
            )}
          </ExpandableSection>
        )}

        {candidate?.whyThisExists && (
          <ExpandableSection title="Why this partner?" icon={<Info className="w-3.5 h-3.5" />}>
            <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-400/15 text-xs text-purple-200/80">
              {candidate.whyThisExists}
            </div>
          </ExpandableSection>
        )}
      </div>

      <Divider />

      <div className="flex items-center gap-2 p-3 sm:p-4">
        <Button variant="secondary" size="sm" onClick={onCopy} className="flex-1">
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Trade</span>
        </Button>
        {recommendation.negotiation && onOpenNegotiation && (
          <Button variant="secondary" size="sm" onClick={onOpenNegotiation} className="flex-1">
            <Send className="w-3.5 h-3.5" />
            <span>Send Message</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onAskAI} className="flex-1">
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Ask AI</span>
        </Button>
      </div>

      {isPatched && onRecheck && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          <button
            onClick={handleRecheck}
            disabled={recheckLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/15 to-purple-500/15 border border-cyan-400/20 text-xs font-medium text-cyan-300 hover:from-cyan-500/25 hover:to-purple-500/25 transition-all touch-manipulation disabled:opacity-50"
          >
            {recheckLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>{recheckLoading ? 'Re-checking...' : 'Re-check with AI'}</span>
          </button>
        </div>
      )}

    </Card>
  )
}

function DeepDiveModal({ open, onClose, recommendation, candidate }: {
  open: boolean
  onClose: () => void
  recommendation: TradeRecommendation
  candidate?: TradeCandidate
}) {
  const [tab, setTab] = useState<'summary' | 'context' | 'risks'>('summary')

  return (
    <AIBottomSheet open={open} onClose={onClose} title="Deep Dive" height="full">
      <div className="flex gap-1 p-1 bg-black/20 rounded-xl mb-4">
        {(['summary', 'context', 'risks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              'flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all touch-manipulation capitalize',
              tab === t
                ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-400/25'
                : 'text-white/45 hover:text-white/70'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          <p className="text-sm text-white/80 leading-relaxed">{recommendation.summary}</p>
          <div className="p-3 bg-black/20 rounded-xl space-y-2">
            <div className="text-xs text-white/50">Why it helps you</div>
            <p className="text-sm text-white/70">{recommendation.whyItHelpsYou}</p>
          </div>
          <div className="p-3 bg-black/20 rounded-xl space-y-2">
            <div className="text-xs text-white/50">Why they accept</div>
            <p className="text-sm text-white/70">{recommendation.whyTheyAccept}</p>
          </div>
          {recommendation.negotiationTip && (
            <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-400/15 space-y-2">
              <div className="text-xs text-cyan-400/70">Negotiation tip</div>
              <p className="text-sm text-cyan-200/80">{recommendation.negotiationTip}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'context' && (
        <div className="space-y-4">
          {candidate?.scoreBreakdown && (
            <div className="space-y-2">
              <div className="text-xs text-white/50 font-medium">Score Breakdown</div>
              {Object.entries(candidate.scoreBreakdown).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-white/60 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-400 to-purple-400 rounded-full" style={{ width: `${Math.min(100, (val as number / 30) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-white/50 w-8 text-right">{val as number}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {candidate && (
            <div className="p-3 bg-black/20 rounded-xl space-y-2">
              <div className="text-xs text-white/50">Value Gap</div>
              <div className="text-lg font-bold text-white">
                {candidate.valueDeltaPct > 0 ? '+' : ''}{candidate.valueDeltaPct.toFixed(1)}%
              </div>
              <div className="text-xs text-white/40">
                Positive = you gain value. Negative = you overpay slightly.
              </div>
            </div>
          )}
          {candidate?.whyThisExists && (
            <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-400/15">
              <div className="text-xs text-purple-400/70 mb-1">Partner Intelligence</div>
              <p className="text-sm text-purple-200/80">{candidate.whyThisExists}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'risks' && (
        <div className="space-y-4">
          {recommendation.riskFlags?.length > 0 ? (
            recommendation.riskFlags.map((flag, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-xl border border-amber-400/15">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-amber-200/80">{flag}</span>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-white/40 text-sm">No significant risks identified</div>
          )}
          {recommendation.fallbackAsset && (
            <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-400/15">
              <div className="text-xs text-cyan-400/70 mb-1">Fallback Option</div>
              <p className="text-sm text-cyan-200/80">If rejected, try swapping for: <span className="font-medium text-cyan-200">{recommendation.fallbackAsset}</span></p>
            </div>
          )}
        </div>
      )}
    </AIBottomSheet>
  )
}

function LoadingAnimation({ mode }: { mode: FinderMode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 sm:py-16">
      <div className="relative w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-purple-400/30 animate-spin" style={{ animationDuration: '3s' }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Search className="w-8 h-8 text-cyan-400 animate-pulse" />
        </div>
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        {mode === 'DEEP' ? 'Deep scanning every roster...' : 'Finding the best trades...'}
      </h3>
      <p className="text-xs text-white/40 max-w-[240px] text-center">
        AI is scanning every team, roster, and pick in your league
      </p>
    </div>
  )
}

export default function TradeFinderV2({
  leagues,
  username,
  sleeperUserId,
  selectedLeague: externalSelectedLeague,
  onLeagueChange,
  userRosterId: externalRosterId,
}: TradeFinderV2Props) {
  const [topTab, setTopTab] = useState<TopTab>('trades')
  const [selectedLeague, setSelectedLeague] = useState(externalSelectedLeague || '')
  const [objective, setObjective] = useState<Objective>('BALANCED')
  const [mode, setMode] = useState<FinderMode>('FAST')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [response, setResponse] = useState<FinderResponse | null>(null)
  const [mmGoal, setMmGoal] = useState<MatchmakingGoal>('win_now')
  const [mmTargetPlayer, setMmTargetPlayer] = useState('')
  const [mmLoading, setMmLoading] = useState(false)
  const [mmError, setMmError] = useState('')
  const [mmResponse, setMmResponse] = useState<MatchmakingResponse | null>(null)
  const [currentCardIndex, setCurrentCardIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [deepDiveOpen, setDeepDiveOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [chatTradeContext, setChatTradeContext] = useState<string | null>(null)
  const [userRosterId, setUserRosterId] = useState<number | null>(externalRosterId || null)
  const [negOpen, setNegOpen] = useState(false)
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null)
  const [patchedCandidates, setPatchedCandidates] = useState<Record<string, PatchTradeCandidate>>({})
  const cardContainerRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (externalSelectedLeague) setSelectedLeague(externalSelectedLeague)
  }, [externalSelectedLeague])

  useEffect(() => {
    if (externalRosterId) setUserRosterId(externalRosterId)
  }, [externalRosterId])

  const handleLeagueChange = useCallback((leagueId: string) => {
    setSelectedLeague(leagueId)
    setResponse(null)
    setError('')
    setCurrentCardIndex(0)
    onLeagueChange?.(leagueId)
  }, [onLeagueChange])

  const resolveRosterId = useCallback(async (leagueId: string): Promise<number | null> => {
    if (userRosterId) return userRosterId
    try {
      const leagueSport = String(
        leagues.find((league) => league.league_id === leagueId)?.sport ?? 'nfl'
      ).toLowerCase()
      const params = new URLSearchParams({ league_id: leagueId, sleeper_username: username, sport: leagueSport })
      if (sleeperUserId) params.set('sleeper_user_id', sleeperUserId)
      const res = await fetch(`/api/legacy/trade/roster?${params.toString()}`)
      const data = await res.json()
      if (data.resolved?.roster_id) {
        setUserRosterId(data.resolved.roster_id)
        return data.resolved.roster_id
      }
    } catch {}
    return null
  }, [username, sleeperUserId, userRosterId, leagues])

  const runMatchmaking = useCallback(async () => {
    if (!selectedLeague || !username) return

    setMmLoading(true)
    setMmError('')
    setMmResponse(null)

    try {
      const body: Record<string, unknown> = {
        leagueId: selectedLeague,
        sleeperUser: { username, ...(sleeperUserId ? { userId: sleeperUserId } : {}) },
        goal: mmGoal,
        maxResults: 5,
      }
      if (mmGoal === 'target_player' && mmTargetPlayer.trim()) {
        body.targetPlayerName = mmTargetPlayer.trim()
      }

      const res = await fetch('/api/trade-finder/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setMmError(data.error || 'Failed to find trade partners')
        return
      }

      setMmResponse(data)
    } catch {
      setMmError('Network error - please try again')
    } finally {
      setMmLoading(false)
    }
  }, [selectedLeague, username, mmGoal, mmTargetPlayer])

  const runFinder = useCallback(async () => {
    if (!selectedLeague || !username) return

    setLoading(true)
    setError('')
    setResponse(null)
    setCurrentCardIndex(0)
    setShowAll(false)

    try {
      let rosterId = userRosterId
      if (!rosterId) {
        rosterId = await resolveRosterId(selectedLeague)
      }
      if (!rosterId) {
        setError('Could not find your roster in this league. Make sure you have an active team.')
        return
      }

      const storedTone = typeof window !== 'undefined' ? localStorage.getItem('af_tone_preference') : null

      const res = await fetch('/api/trade-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: selectedLeague,
          user_roster_id: rosterId,
          objective,
          mode,
          preferredTone: storedTone || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to find trades')
        return
      }

      setResponse(data)
    } catch (e) {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }, [selectedLeague, username, objective, mode, userRosterId, resolveRosterId])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
    touchStartRef.current = null

    if (Math.abs(deltaX) > 50 && deltaY < 80) {
      const maxIndex = displayCount - 1
      if (deltaX < 0 && currentCardIndex < maxIndex) {
        setCurrentCardIndex(prev => prev + 1)
      } else if (deltaX > 0 && currentCardIndex > 0) {
        setCurrentCardIndex(prev => prev - 1)
      }
    }
  }, [currentCardIndex])

  const recommendations = response?.recommendations || []
  const candidates = response?.candidates || []
  const displayCount = showAll ? recommendations.length : Math.min(3, recommendations.length)

  const matchCandidateToRec = (rec: TradeRecommendation): TradeCandidate | undefined => {
    return candidates.find(c => c.tradeId === rec.tradeId)
  }

  const handleCopyTrade = (rec: TradeRecommendation, candidate?: TradeCandidate) => {
    const gives = candidate?.teamA?.gives || []
    const receives = candidate?.teamA?.receives || []
    const lines = [
      `Trade Proposal (via AllFantasy)`,
      ``,
      `I send: ${gives.map(a => a.name).join(', ')}`,
      `I receive: ${receives.map(a => a.name).join(', ')}`,
      ``,
      rec.summary,
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedId(rec.tradeId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const handleAskAI = (rec: TradeRecommendation) => {
    const candidate = matchCandidateToRec(rec)
    const gives = candidate?.teamA?.gives?.map(a => a.name).join(', ') || ''
    const receives = candidate?.teamA?.receives?.map(a => a.name).join(', ') || ''
    setChatTradeContext(`I'm considering this trade: I send ${gives} and receive ${receives}. ${rec.summary}. What do you think?`)
  }

  const currentLeague = leagues.find(l => l.league_id === selectedLeague)

  const activeRec = recommendations.find(r => r.tradeId === activeTradeId)
  const activeCandidate = activeRec ? matchCandidateToRec(activeRec) : undefined
  const activeOriginalGives = activeCandidate?.teamA?.gives || []
  const activeOriginalReceives = activeCandidate?.teamA?.receives || []
  const activePatched = activeTradeId ? patchedCandidates[activeTradeId] ?? null : null

  const activeSheetCandidate: PatchTradeCandidate = activePatched ?? {
    tradeId: activeCandidate?.tradeId ?? activeRec?.tradeId ?? 'temp',
    youSend: activeOriginalGives.map(toCandidateAsset),
    youReceive: activeOriginalReceives.map(toCandidateAsset),
    themSend: activeOriginalReceives.map(toCandidateAsset),
    themReceive: activeOriginalGives.map(toCandidateAsset),
    finderScore: activeCandidate?.finderScore,
    valueDeltaPct: activeCandidate?.valueDeltaPct,
  }

  const activeAssetIndex = useMemo(() => {
    return buildEnrichedIndex(response?.assetIndex, activeOriginalGives, activeOriginalReceives)
  }, [response?.assetIndex, activeOriginalGives, activeOriginalReceives])

  const handleOpenNegotiation = useCallback((tradeId: string) => {
    setActiveTradeId(tradeId)
    setNegOpen(true)
  }, [])

  const handleCandidateUpdate = useCallback((next: PatchTradeCandidate) => {
    if (!activeTradeId) return
    setPatchedCandidates(prev => ({ ...prev, [activeTradeId]: next }))
  }, [activeTradeId])

  const handleResetPatch = useCallback((tradeId: string) => {
    setPatchedCandidates(prev => {
      const copy = { ...prev }
      delete copy[tradeId]
      return copy
    })
  }, [])

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur-xl pb-3 -mx-4 px-4 sm:-mx-6 sm:px-6 pt-1 border-b border-white/5">
        <div className="flex bg-black/30 border border-white/10 rounded-xl overflow-hidden mb-3">
          {([
            { key: 'trades' as TopTab, label: 'Find Trades', icon: <Search className="w-3.5 h-3.5" /> },
            { key: 'matchmaking' as TopTab, label: 'Partner Match', icon: <Handshake className="w-3.5 h-3.5" /> },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTopTab(t.key)}
              className={cx(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all min-h-[44px] touch-manipulation',
                topTab === t.key
                  ? 'bg-gradient-to-r from-cyan-500/25 to-purple-500/25 text-white'
                  : 'text-white/40 hover:text-white/70'
              )}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <select
            value={selectedLeague}
            onChange={(e) => handleLeagueChange(e.target.value)}
            className="flex-1 px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-cyan-400/60 min-h-[44px] touch-manipulation appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              backgroundSize: '14px',
            }}
          >
            <option value="" className="bg-slate-900">Select League</option>
            {leagues.map((lg) => (
              <option key={lg.league_id} value={lg.league_id} className="bg-slate-900">
                {lg.name} ({lg.season})
              </option>
            ))}
          </select>

          {topTab === 'trades' && (
            <div className="flex bg-black/30 border border-white/10 rounded-xl overflow-hidden">
              {(['FAST', 'DEEP'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cx(
                    'px-3 py-2.5 text-xs font-medium transition-all min-h-[44px] touch-manipulation',
                    mode === m
                      ? 'bg-gradient-to-r from-cyan-500/25 to-purple-500/25 text-white'
                      : 'text-white/40 hover:text-white/70'
                  )}
                >
                  {m === 'FAST' ? <Zap className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {topTab === 'trades' && (
          <>
            <div className="flex gap-2 mb-3">
              {([
                { key: 'WIN_NOW' as Objective, label: 'Win Now', icon: '🏆' },
                { key: 'REBUILD' as Objective, label: 'Rebuild', icon: '♻️' },
                { key: 'BALANCED' as Objective, label: 'Balanced', icon: '⚖️' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => {
                    setObjective(opt.key)
                    if (response) runFinder()
                  }}
                  className={cx(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all min-h-[44px] touch-manipulation border',
                    objective === opt.key
                      ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-cyan-400/30 text-white'
                      : 'bg-black/20 border-white/8 text-white/50 hover:text-white/80 hover:bg-white/5'
                  )}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>

            {selectedLeague && (
              <FeatureGate featureId="legacy_trade_finder" featureNameOverride="Trade Review">
                <Button
                  onClick={runFinder}
                  loading={loading}
                  disabled={!selectedLeague || loading}
                  fullWidth
                  variant="primary"
                  size="default"
                >
                  <Search className="w-4 h-4" />
                  <span>{loading ? 'Scanning league...' : response ? 'Re-scan' : 'Find Trades'}</span>
                </Button>
              </FeatureGate>
            )}
          </>
        )}

        {topTab === 'matchmaking' && (
          <>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {GOAL_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setMmGoal(opt.key)}
                  className={cx(
                    'flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-[11px] font-medium transition-all touch-manipulation border',
                    mmGoal === opt.key
                      ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-cyan-400/30 text-white'
                      : 'bg-black/20 border-white/8 text-white/40 hover:text-white/70 hover:bg-white/5'
                  )}
                >
                  <span className="text-sm">{opt.icon}</span>
                  <span className="leading-tight">{opt.label}</span>
                </button>
              ))}
            </div>

            {mmGoal === 'target_player' && (
              <input
                type="text"
                value={mmTargetPlayer}
                onChange={(e) => setMmTargetPlayer(e.target.value)}
                placeholder="Player name (e.g. CeeDee Lamb)"
                className="w-full px-3 py-2.5 bg-black/30 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-cyan-400/60 mb-3 min-h-[44px] touch-manipulation placeholder:text-white/30"
              />
            )}

            {selectedLeague && (
              <FeatureGate featureId="legacy_trade_finder" featureNameOverride="Trade Review">
                <Button
                  onClick={runMatchmaking}
                  loading={mmLoading}
                  disabled={!selectedLeague || mmLoading || (mmGoal === 'target_player' && !mmTargetPlayer.trim())}
                  fullWidth
                  variant="primary"
                  size="default"
                >
                  <Handshake className="w-4 h-4" />
                  <span>{mmLoading ? 'Finding partners...' : mmResponse ? 'Re-scan' : 'Find Best Partners'}</span>
                </Button>
              </FeatureGate>
            )}
          </>
        )}
      </div>

      {!username && (
        <div className="py-8 text-center">
          <p className="text-sm text-white/50">Import your Sleeper account first to use Trade Finder</p>
        </div>
      )}

      {username && !selectedLeague && !loading && !mmLoading && (
        <div className="py-8 text-center">
          <p className="text-sm text-white/50">Select a league above to start {topTab === 'trades' ? 'finding trades' : 'finding trade partners'}</p>
        </div>
      )}

      {topTab === 'matchmaking' && (
        <>
          {mmLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
                <Handshake className="absolute inset-0 m-auto w-5 h-5 text-cyan-400/60" />
              </div>
              <p className="text-sm text-white/60 font-medium">Analyzing trade partners...</p>
              <p className="text-xs text-white/30">Scoring bias alignment, need overlap & trade frequency</p>
            </div>
          )}

          {mmError && (
            <div className="p-4 bg-rose-500/10 border border-rose-400/20 rounded-xl">
              <p className="text-sm text-rose-300">{mmError}</p>
            </div>
          )}

          {mmResponse && !mmLoading && (
            <div className="space-y-3">
              <div className="text-center">
                <p className="text-xs text-white/40">
                  Evaluated {mmResponse.stats.partnersEvaluated} managers, found {mmResponse.stats.qualifiedPartners} qualified partners
                </p>
                {mmResponse.targetPlayer && (
                  <p className="text-xs text-cyan-400 mt-1">Target: {mmResponse.targetPlayer}</p>
                )}
              </div>

              <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 rounded-xl border border-cyan-400/15">
                <p className="text-xs text-white/70">{mmResponse.goalDescription}</p>
              </div>

              {mmResponse.partners.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-white/50">No strong matches found for this goal. Try a different objective or check back after more league activity.</p>
                </div>
              )}

              {mmResponse.partners.map((partner, idx) => (
                <PartnerCard key={partner.rosterId} partner={partner} rank={idx + 1} />
              ))}
            </div>
          )}

          {!mmResponse && !mmLoading && !mmError && selectedLeague && username && (
            <div className="py-8 text-center space-y-2">
              <Handshake className="w-8 h-8 text-white/20 mx-auto" />
              <p className="text-sm text-white/50">Pick a goal above and find the best trade partners in your league</p>
              <p className="text-xs text-white/30">AI scores managers by need overlap, bias alignment, and trade willingness</p>
            </div>
          )}
        </>
      )}

      {topTab === 'trades' && loading && <LoadingAnimation mode={mode} />}

      {topTab === 'trades' && error && (
        <div className="p-4 bg-rose-500/10 border border-rose-400/20 rounded-xl">
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      {topTab === 'trades' && response && !loading && recommendations.length > 0 && (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-xs text-white/40">
              AI scanned {response.meta.partnersEvaluated} teams, generated {response.meta.rawCandidatesGenerated} candidates, refined to {response.meta.prunedTo}
            </p>
          </div>

          {response.overallStrategy && (
            <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 rounded-xl border border-cyan-400/15">
              <p className="text-xs text-white/70">{response.overallStrategy}</p>
            </div>
          )}

          <div
            ref={cardContainerRef}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            className="relative"
          >
            {recommendations.slice(0, displayCount).map((rec, idx) => {
              const candidate = matchCandidateToRec(rec)
              const isActive = idx === currentCardIndex

              return (
                <div
                  key={rec.tradeId || idx}
                  className={cx(
                    'transition-all duration-300',
                    isActive ? 'block' : 'hidden'
                  )}
                >
                  <TradeCard
                    recommendation={rec}
                    candidate={candidate}
                    index={idx}
                    total={displayCount}
                    onCopy={() => handleCopyTrade(rec, candidate)}
                    onAskAI={() => handleAskAI(rec)}
                    assetIndex={response?.assetIndex}
                    onRecheck={(youSend, youReceive) => {
                      const gives = youSend.map(a => a.name).join(', ')
                      const receives = youReceive.map(a => a.name).join(', ')
                      setChatTradeContext(`Re-evaluate this modified trade: I send ${gives} and receive ${receives}. Is this still a good deal?`)
                    }}
                    patchedTrade={patchedCandidates[rec.tradeId] ?? null}
                    onOpenNegotiation={() => handleOpenNegotiation(rec.tradeId)}
                    onResetPatch={() => handleResetPatch(rec.tradeId)}
                  />
                </div>
              )
            })}

            {displayCount > 1 && (
              <div className="flex items-center justify-center gap-4 mt-4">
                <button
                  onClick={() => setCurrentCardIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentCardIndex === 0}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all touch-manipulation"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="flex gap-1.5">
                  {recommendations.slice(0, displayCount).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentCardIndex(i)}
                      className={cx(
                        'w-2 h-2 rounded-full transition-all touch-manipulation',
                        i === currentCardIndex ? 'bg-cyan-400 w-6' : 'bg-white/20 hover:bg-white/40'
                      )}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setCurrentCardIndex(prev => Math.min(displayCount - 1, prev + 1))}
                  disabled={currentCardIndex >= displayCount - 1}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all touch-manipulation"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {recommendations.length > 3 && !showAll && (
            <div className="text-center">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Show {recommendations.length - 3} More
              </Button>
            </div>
          )}

          {recommendations[currentCardIndex] && (
            <div className="text-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeepDiveOpen(true)}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Deep Dive</span>
              </Button>
            </div>
          )}

          {recommendations[currentCardIndex] && (
            <DeepDiveModal
              open={deepDiveOpen}
              onClose={() => setDeepDiveOpen(false)}
              recommendation={recommendations[currentCardIndex]}
              candidate={matchCandidateToRec(recommendations[currentCardIndex])}
            />
          )}
        </div>
      )}

      {topTab === 'trades' && response && !loading && recommendations.length === 0 && (
        <div className="space-y-3">
          {(response.opportunities && response.opportunities.length > 0) ? (
            <>
              <div className="text-center py-3">
                <p className="text-sm font-medium text-white/70">No clean market wins today. Best options are:</p>
              </div>
              {response.opportunities.map((opp, idx) => (
                <Card key={idx} accent="slate" padding="sm">
                  <div className="p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{opp.icon}</span>
                        <div>
                          <h4 className="text-sm font-bold text-white">{opp.title}</h4>
                          {opp.targetManager && (
                            <span className="text-[10px] text-white/40">Target: {opp.targetManager}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {opp.actionable && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">ACTIONABLE</span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          opp.confidence >= 60 ? 'bg-emerald-500/20 text-emerald-300' :
                          opp.confidence >= 40 ? 'bg-amber-500/20 text-amber-300' :
                          'bg-slate-500/20 text-slate-300'
                        }`}>{opp.confidence}%</span>
                      </div>
                    </div>
                    <p className="text-xs text-white/50">{opp.description}</p>
                    {opp.relevantPlayers.length > 0 && (
                      <div className="space-y-1">
                        {opp.relevantPlayers.map((player, pIdx) => (
                          <div key={pIdx} className="flex items-center gap-2 p-1.5 rounded-lg bg-black/20 border border-white/5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              player.position === 'QB' ? 'bg-red-500/20 text-red-300' :
                              player.position === 'RB' ? 'bg-blue-500/20 text-blue-300' :
                              player.position === 'WR' ? 'bg-green-500/20 text-green-300' :
                              player.position === 'TE' ? 'bg-orange-500/20 text-orange-300' :
                              'bg-purple-500/20 text-purple-300'
                            }`}>{player.position}</span>
                            <span className="text-xs text-white font-medium flex-1 truncate">{player.name}</span>
                            {player.value > 0 && (
                              <span className="text-[10px] text-white/30 font-mono">{player.value.toLocaleString()}</span>
                            )}
                          </div>
                        ))}
                        <p className="text-[10px] text-white/30 italic mt-1">{opp.relevantPlayers[0]?.reason}</p>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </>
          ) : (
            <Card accent="slate" padding="default">
              <div className="text-center py-6 space-y-4">
                <span className="text-4xl block">🏆</span>
                <h3 className="text-base font-semibold text-white/80">Your team is well-balanced</h3>
                {response.meta.message && (
                  <p className="text-sm text-white/50 max-w-sm mx-auto">{response.meta.message}</p>
                )}
                <p className="text-xs text-white/40">No urgent moves needed. Check back as values shift.</p>
              </div>
            </Card>
          )}
          <div className="flex gap-2 justify-center pt-1">
            {objective !== 'REBUILD' && (
              <Button variant="secondary" size="sm" onClick={() => { setObjective('REBUILD'); setTimeout(runFinder, 100) }}>
                Try Rebuild
              </Button>
            )}
            {mode !== 'DEEP' && (
              <Button variant="secondary" size="sm" onClick={() => { setMode('DEEP'); setTimeout(runFinder, 100) }}>
                Try Deep Scan
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={runFinder}>
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {chatTradeContext && (
        <AIBottomSheet
          open={!!chatTradeContext}
          onClose={() => setChatTradeContext(null)}
          title="Ask AI About This Trade"
          height="half"
        >
          <div className="space-y-3">
            <div className="p-3 bg-black/20 rounded-xl text-sm text-white/70">
              {chatTradeContext}
            </div>
            <p className="text-xs text-white/40 text-center">
              Head to the Chat tab to discuss this trade with your AI assistant
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="sm"
                fullWidth
                onClick={() => {
                  const url = getTradeAnalyzerAIChatUrl(chatTradeContext, {
                    leagueId: selectedLeague || undefined,
                    insightType: 'trade',
                  })
                  window.location.href = url
                }}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Open Chat with this prompt
              </Button>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                onClick={() => {
                  navigator.clipboard.writeText(chatTradeContext)
                  setChatTradeContext(null)
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy only
              </Button>
            </div>
          </div>
        </AIBottomSheet>
      )}

      <NegotiationSheet
        open={negOpen}
        onClose={() => setNegOpen(false)}
        candidate={activeSheetCandidate}
        negotiation={(activeRec?.negotiation ?? {
          dmMessages: [],
          counters: [],
          sweeteners: [],
          redLines: [],
        }) as NegotiationData}
        assetIndex={activeAssetIndex}
        onCandidateUpdate={handleCandidateUpdate}
      />
    </div>
  )
}
