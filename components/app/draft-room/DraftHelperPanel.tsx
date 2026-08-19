'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw, MessageCircle, AlertTriangle } from 'lucide-react'
import { DraftLiveBrainPremiumBlock } from '@/components/app/draft-room/DraftLiveBrainPremiumBlock'
import { getDraftAIChatUrl, buildAskChimmyAboutPickPrompt } from '@/lib/draft-room/DraftToAIContextBridge'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { DRAFT_WAR_ROOM_LEGACY_URL } from '@/lib/draft-room'
import { useAIAssistantAvailability } from '@/hooks/useAIAssistantAvailability'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import type { LiveDraftBrainEnvelope } from '@/lib/live-draft-brain/schemas'
import type { LiveDraftBrainInput } from '@/lib/live-draft-brain'
import { WarRoomPanel } from '@/components/war-room/WarRoomPanel'
import ChimmyChatPanel from '@/components/chimmy/ChimmyChatPanel'
import { DraftWarRoom, type DraftWarRoomSnapshot } from '@/components/draft/ai/DraftWarRoom'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import { DraftHelperRedraftLayout } from '@/components/app/draft-room/DraftHelperRedraftLayout'

export type DraftRecommendation = {
  player: { name: string; position: string; team?: string | null; adp?: number | null }
  reason: string
  confidence: number
}

type DraftSportsHeadline = {
  id: string
  title: string
  playerName?: string | null
  team?: string | null
  publishedAt?: string | null
  source?: string | null
}

type DraftSportsInjury = {
  playerName: string
  team?: string | null
  status?: string | null
  note?: string | null
  reportedAt?: string | null
  source?: string | null
}

export type DraftHelperPanelProps = {
  loading: boolean
  error: string | null
  recommendation: DraftRecommendation | null
  alternatives: Array<{ player: { name: string; position: string; team?: string | null }; reason: string; confidence: number }>
  reachWarning: string | null
  valueWarning: string | null
  scarcityInsight: string | null
  stackInsight: string | null
  correlationInsight: string | null
  formatInsight: string | null
  byeNote: string | null
  explanation: string
  evidence: string[]
  caveats: string[]
  uncertainty: string | null
  executionMode?: string | null
  sport: string
  round: number
  pick: number
  leagueId?: string
  leagueName?: string
  rosterSlots?: string[]
  queueLength?: number
  aiExplanationEnabled?: boolean
  onAiExplanationToggle?: (enabled: boolean) => void
  onRefresh: () => void
  onPlayerClick?: (player: { name: string; position: string; team?: string | null }) => void
  /** Deterministic Live Draft Brain (multi-pick score, next-pick hints, ADP blend) */
  liveBrain?: LiveDraftBrainEnvelope | null
  /** Live War Room brain payload when it is your pick (from `buildLiveDraftBrainPayload`). */
  warRoomBrainInput?: LiveDraftBrainInput | null
  draftSessionId?: string | null
  chimmyInitialPrompt?: string
  chimmyToolSummary?: string | null
  sportsFeed?: {
    available: boolean
    updatedAt?: string | null
    sourceKeys?: string[]
    headlines: DraftSportsHeadline[]
    injuries: DraftSportsInjury[]
  } | null
  aiFeatureStatus?: {
    chimmyReady: boolean
    liveBrainReady: boolean
    aiAdpEnabled: boolean
    queueReorderEnabled: boolean
    draftExplanationEnabled: boolean
    orphanAiEnabled: boolean
    commissionerAiManagersCount: number
  } | null
  /** Live War Room (AI draft assistant) — optional; renders above legacy helper when provided. */
  warRoom?: {
    snapshot: DraftWarRoomSnapshot | null
    loading: boolean
    error: string | null
    canDraft: boolean
    onRefresh: (force?: boolean) => void
    resolvePlayer: (name: string, position: string) => PlayerEntry | null
    onDraftPlayer: (player: PlayerEntry) => void
    onQueuePlayer: (player: PlayerEntry) => void
  } | null
  presentationVariant?: 'default' | 'redraft_snake'
  /** Live redraft snake — recommendation card actions + lookahead copy */
  picksUntilUser?: number | null
  userOnTheClock?: boolean
  resolvedRecommendedPlayer?: PlayerEntry | null
  canCommitRecommendedPick?: boolean
  onDraftRecommendedPlayer?: () => void
  onQueueRecommendedPlayer?: () => void
  onQueueAlternativePlayer?: (player: { name: string; position: string; team?: string | null }) => void
}

export function DraftHelperPanel(props: DraftHelperPanelProps) {
  /** Must run before any conditional return — redraft_snake delegates to DraftHelperRedraftLayout but hooks order must match every render. */
  const [warRoomOpen, setWarRoomOpen] = useState(false)
  const { t } = useLanguage()
  const { enabled: aiAssistantEnabled, loading: aiAvailabilityLoading } = useAIAssistantAvailability()

  if (props.presentationVariant === 'redraft_snake') {
    return <DraftHelperRedraftLayout {...props} />
  }

  const {
    loading,
    error,
    recommendation,
    alternatives,
    reachWarning,
    valueWarning,
    scarcityInsight,
    stackInsight,
    correlationInsight,
    formatInsight,
    byeNote,
    explanation,
    evidence,
    caveats,
    uncertainty,
    executionMode,
    sport,
    round,
    pick,
    leagueId,
    leagueName,
    rosterSlots,
    queueLength,
    aiExplanationEnabled = false,
    onAiExplanationToggle,
    onRefresh,
    onPlayerClick,
    liveBrain,
    warRoomBrainInput = null,
    draftSessionId = null,
    chimmyInitialPrompt = '',
    chimmyToolSummary = null,
    sportsFeed = null,
    aiFeatureStatus = null,
    warRoom = null,
    presentationVariant = 'default',
    picksUntilUser = null,
    userOnTheClock = false,
    resolvedRecommendedPlayer = null,
    canCommitRecommendedPick = false,
    onDraftRecommendedPlayer,
    onQueueRecommendedPlayer,
    onQueueAlternativePlayer,
  } = props

  /** Always false: `redraft_snake` returns early with `DraftHelperRedraftLayout`. */
  const rs = false
  const chimmyPrompt = buildAskChimmyAboutPickPrompt({
    sport,
    round,
    pick,
    leagueName,
    rosterPositions: rosterSlots,
    queueLength,
    recommendedPlayer: recommendation?.player.name,
    recommendedPosition: recommendation?.player.position,
    explanation,
  })
  const chimmyUrl = getDraftAIChatUrl(chimmyPrompt, {
    leagueId,
    insightType: 'draft',
    sport,
  })

  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-[#060d1e] ${
        rs
          ? 'border-violet-500/25 bg-[linear-gradient(180deg,rgba(20,12,40,0.4),rgba(5,10,20,0.96))] shadow-[inset_1px_0_0_rgba(167,139,250,0.12),0_16px_48px_rgba(0,0,0,0.35)]'
          : 'border-white/10'
      }`}
    >
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${rs ? 'border-violet-500/15 bg-[linear-gradient(90deg,rgba(167,139,250,0.08),transparent)]' : 'border-white/8'}`}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">{t('draftRoom.helper.title')}</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          data-testid="draft-helper-refresh"
          className="rounded border border-white/15 bg-black/20 p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-50"
          aria-label="Refresh recommendation"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="border-b border-white/8 px-3 py-1.5">
        <label className="inline-flex items-center gap-2 text-[10px] text-white/70">
          <input
            type="checkbox"
            checked={aiExplanationEnabled}
            onChange={(event) => onAiExplanationToggle?.(event.target.checked)}
            data-testid="draft-helper-ai-explanation-toggle"
            disabled={!aiAssistantEnabled}
            className="rounded border-white/25 bg-black/40"
          />
          {t('draftRoom.helper.aiExplainLabel')}
          {!aiAssistantEnabled && !aiAvailabilityLoading ? ` ${t('draftRoom.helper.aiExplainDisabled')}` : ''}
        </label>
      </div>
      <div className="border-b border-white/8 px-3 py-1.5 text-[10px] text-white/60" data-testid="draft-helper-execution-mode">
        {executionMode === 'ai_explained'
          ? t('draftRoom.helper.execution.aiExplained')
          : t('draftRoom.helper.execution.deterministic')}
      </div>
      <div className="border-b border-white/8 px-2 py-2">
        <InContextMonetizationCard
          title="Draft prep access"
          featureId="draft_prep"
          tokenRuleCodes={['ai_draft_pick_explanation']}
          className="mb-2"
          testIdPrefix="draft-prep-monetization"
        />
        <InContextMonetizationCard
          title="AF Legacy strategy build access"
          featureId="draft_strategy_build"
          tokenRuleCodes={['ai_draft_helper_session_recommendation']}
          testIdPrefix="draft-helper-monetization"
        />
      </div>
      <div className="flex-1 overflow-auto p-2">
        {warRoom && leagueId ? (
          <div className="mb-3">
            <DraftWarRoom
              sport={sport}
              leagueId={leagueId}
              data={warRoom.snapshot}
              loading={warRoom.loading}
              error={warRoom.error}
              canDraft={warRoom.canDraft}
              onRefresh={warRoom.onRefresh}
              onVisible={() => warRoom.onRefresh(true)}
              resolvePlayerEntry={warRoom.resolvePlayer}
              onDraftPlayer={warRoom.onDraftPlayer}
              onAddToQueue={warRoom.onQueuePlayer}
            />
          </div>
        ) : null}
        {liveBrain && (
          <div className="mb-3">
            <DraftLiveBrainPremiumBlock liveBrain={liveBrain} onPlayerClick={onPlayerClick} />
          </div>
        )}
        {(sportsFeed || aiFeatureStatus) && (
          <div className="mb-3 rounded-xl border border-white/10 bg-[#081224] p-3" data-testid="draft-helper-ai-sports-context">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
                Draft room intelligence
              </p>
              {sportsFeed?.updatedAt ? (
                <span className="text-[9px] text-white/45">
                  Updated {new Date(sportsFeed.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              ) : null}
            </div>
            {aiFeatureStatus && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.chimmyReady ? 'border-cyan-300/35 bg-cyan-500/10 text-cyan-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  Chimmy {aiFeatureStatus.chimmyReady ? 'ready' : 'offline'}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.liveBrainReady ? 'border-violet-300/35 bg-violet-500/10 text-violet-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  Live Brain {aiFeatureStatus.liveBrainReady ? 'live' : 'standby'}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.aiAdpEnabled ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  AI ADP {aiFeatureStatus.aiAdpEnabled ? 'on' : 'off'}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.queueReorderEnabled ? 'border-amber-300/35 bg-amber-500/10 text-amber-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  Queue AI {aiFeatureStatus.queueReorderEnabled ? 'on' : 'off'}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.draftExplanationEnabled ? 'border-sky-300/35 bg-sky-500/10 text-sky-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  Explain {aiFeatureStatus.draftExplanationEnabled ? 'on' : 'off'}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] ${aiFeatureStatus.orphanAiEnabled ? 'border-fuchsia-300/35 bg-fuchsia-500/10 text-fuchsia-100' : 'border-white/15 bg-black/25 text-white/60'}`}>
                  Orphan AI {aiFeatureStatus.orphanAiEnabled ? 'armed' : 'off'}
                </span>
                {aiFeatureStatus.commissionerAiManagersCount > 0 ? (
                  <span className="rounded border border-rose-300/35 bg-rose-500/10 px-1.5 py-0.5 text-[9px] text-rose-100">
                    Commissioner AI {aiFeatureStatus.commissionerAiManagersCount}
                  </span>
                ) : null}
              </div>
            )}
            {sportsFeed?.available ? (
              <div className="mt-3 space-y-2 text-[10px] text-white/72">
                {sportsFeed.headlines.length > 0 ? (
                  <div>
                    <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">News</p>
                    <div className="space-y-1">
                      {sportsFeed.headlines.slice(0, 2).map((item) => (
                        <p key={item.id} className="rounded border border-white/8 bg-black/20 px-2 py-1">
                          {item.title}
                          {item.playerName ? ` — ${item.playerName}` : ''}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                {sportsFeed.injuries.length > 0 ? (
                  <div>
                    <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-white/45">Injuries</p>
                    <div className="space-y-1">
                      {sportsFeed.injuries.slice(0, 2).map((item) => (
                        <p key={`${item.playerName}-${item.team ?? 'na'}`} className="rounded border border-white/8 bg-black/20 px-2 py-1">
                          {item.playerName}
                          {item.team ? ` (${item.team})` : ''}: {item.status ?? 'Watch'}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-white/50">
                Sports feed is standing by. Draft AI still works from the live room context even while feed rows are sparse.
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="mb-2 text-xs text-amber-400">{error}</p>
        )}
        {loading && !recommendation && (
          <p className="py-4 text-center text-xs text-white/50">Getting recommendation…</p>
        )}
        {!loading && !error && recommendation && (
          <>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onPlayerClick?.(recommendation.player)}
              onKeyDown={(e) => e.key === 'Enter' && onPlayerClick?.(recommendation.player)}
              data-testid="draft-helper-recommendation-card"
              className={
                rs
                  ? 'mb-3 rounded-xl border border-cyan-400/30 bg-[linear-gradient(155deg,rgba(34,211,238,0.14),rgba(15,23,42,0.95))] px-3 py-3 text-left shadow-[0_16px_48px_rgba(0,0,0,0.4)] ring-1 ring-cyan-400/15'
                  : 'mb-2 rounded-lg border border-cyan-300/30 bg-cyan-500/8 px-2.5 py-2 text-left'
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/90">
                    {userOnTheClock ? 'On the clock — copilot pick' : 'Copilot pick'}
                  </p>
                  <p className="mt-1 font-semibold text-cyan-50">
                    {recommendation.player.name}
                    <span className="ml-1 text-[10px] font-normal text-white/75">
                      {recommendation.player.position}
                      {recommendation.player.team ? ` · ${recommendation.player.team}` : ''}
                      {recommendation.player.adp != null ? ` · ADP ${recommendation.player.adp}` : ''}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-white/88">{recommendation.reason}</p>
                  <p className="mt-1 text-[10px] text-white/55">
                    {t('draftRoom.helper.confidence')} {recommendation.confidence}%
                    {picksUntilUser != null && picksUntilUser > 0 ? ` · ~${picksUntilUser} to you` : ''}
                  </p>
                </div>
                {rs ? (
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlayerClick?.(recommendation.player)
                      }}
                      className="rounded-lg border border-white/15 bg-black/25 px-2.5 py-1.5 text-[10px] font-semibold text-white/90 hover:bg-white/10"
                    >
                      View player
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (resolvedRecommendedPlayer && onQueueRecommendedPlayer) onQueueRecommendedPlayer()
                      }}
                      disabled={!resolvedRecommendedPlayer || !onQueueRecommendedPlayer}
                      className="rounded-lg border border-violet-400/35 bg-violet-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-violet-100 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Add to queue
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (canCommitRecommendedPick && onDraftRecommendedPlayer) onDraftRecommendedPlayer()
                      }}
                      disabled={!canCommitRecommendedPick || !onDraftRecommendedPlayer}
                      className="rounded-lg border border-cyan-400/45 bg-cyan-500/25 px-2.5 py-1.5 text-[10px] font-bold text-cyan-50 hover:bg-cyan-500/35 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Draft now
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {explanation && (
              <p className="mb-2 text-[10px] text-white/80">{explanation}</p>
            )}
            {(reachWarning || valueWarning || scarcityInsight || stackInsight || correlationInsight || formatInsight || byeNote) && (
              <div className="mb-2 space-y-1">
                {reachWarning && (
                  <p className="flex items-start gap-1 text-[10px] text-amber-300">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    {reachWarning}
                  </p>
                )}
                {valueWarning && (
                  <p className="flex items-start gap-1 text-[10px] text-emerald-300">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    {valueWarning}
                  </p>
                )}
                {scarcityInsight && (
                  <p className="text-[10px] text-cyan-300/90">{scarcityInsight}</p>
                )}
                {stackInsight && (
                  <p className="text-[10px] text-violet-200/90">{stackInsight}</p>
                )}
                {correlationInsight && (
                  <p className="text-[10px] text-indigo-200/90">{correlationInsight}</p>
                )}
                {formatInsight && (
                  <p className="text-[10px] text-sky-200/90">{formatInsight}</p>
                )}
                {byeNote && (
                  <p className="text-[10px] text-amber-300/90">{byeNote}</p>
                )}
              </div>
            )}
            {evidence.length > 0 && (
              <div className="mb-2">
                <p className="text-[9px] font-medium text-white/50 uppercase tracking-wider">{t('draftRoom.helper.evidence')}</p>
                <ul className="list-inside list-disc text-[10px] text-white/70">
                  {evidence.slice(0, 4).map((item, i) => (
                    <li key={`e-${i}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {caveats.length > 0 && (
              <div className="mb-2">
                <p className="text-[9px] font-medium text-white/50 uppercase tracking-wider">Caveats</p>
                <ul className="list-inside list-disc text-[10px] text-white/60">
                  {caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {uncertainty && (
              <p className="mb-2 text-[10px] text-amber-200/90" data-testid="draft-helper-uncertainty">
                {uncertainty}
              </p>
            )}
            {alternatives.length > 0 && (
              <div className="mb-2">
                <p className="text-[9px] font-medium text-white/50 uppercase tracking-wider mb-1">{t('draftRoom.helper.alternatives')}</p>
                <ul className="space-y-1">
                  {alternatives.slice(0, rs ? 5 : 3).map((alt, i) => (
                    <li
                      key={i}
                      data-testid={`draft-helper-alternative-${i}`}
                      className={`rounded border px-2 py-1.5 text-[10px] text-white/82 ${
                        rs
                          ? 'border-white/12 bg-[linear-gradient(120deg,rgba(15,23,42,0.85),rgba(8,16,32,0.92))]'
                          : 'border-white/10 bg-[#0a1228]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer rounded text-left hover:text-white"
                          onClick={() => onPlayerClick?.(alt.player)}
                        >
                          <span className="font-medium text-white/95">{alt.player.name}</span>{' '}
                          <span className="text-white/55">
                            ({alt.player.position}) — {alt.reason}
                          </span>
                        </button>
                        {rs && onQueueAlternativePlayer ? (
                          <button
                            type="button"
                            onClick={() => onQueueAlternativePlayer(alt.player)}
                            className="shrink-0 rounded border border-white/14 bg-black/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-100/90 hover:bg-white/10"
                          >
                            Queue
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {aiAssistantEnabled ? (
              <a
                href={chimmyUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="draft-ai-suggestion-button"
                className="mt-2 inline-flex items-center gap-1.5 rounded border border-cyan-300/35 bg-cyan-500/10 px-2.5 py-1.5 text-[10px] text-cyan-100 hover:bg-cyan-500/20"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Open full Chimmy
              </a>
            ) : (
              <button
                type="button"
                onClick={onRefresh}
                data-testid="draft-ai-suggestion-fallback-button"
                className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-300/35 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-100 hover:bg-amber-500/20"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('draftRoom.helper.aiUnavailableRefresh')}
              </button>
            )}
          </>
        )}
        {!loading && !error && !recommendation && (
          <div className="space-y-2 py-4 text-center text-xs text-white/50">
            {rs ? (
              <>
                <p className="text-white/65">
                  Your ranked copilot recommendation loads when it is your pick — it follows the live board and your roster needs.
                </p>
                <p className="text-[11px] text-white/42">
                  Between picks, use AF Legacy (below) for redraft lookahead; it tracks scarcity and positional runs as picks land.
                </p>
              </>
            ) : (
              <p>Add players to the pool and click Refresh for a recommendation.</p>
            )}
          </div>
        )}
        <div className="mt-3 rounded-xl border border-cyan-400/18 bg-cyan-500/6 p-2.5" data-testid="draft-helper-chimmy-panel">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">Chimmy AI chat</p>
              <p className="text-[10px] text-white/55">
                Draft-aware chat uses your league, sport, queue, and live AI context inside the room.
              </p>
            </div>
          </div>
          {aiAssistantEnabled ? (
            <ChimmyChatPanel
              variant="inline"
              compact
              initialPrompt={chimmyInitialPrompt}
              clearUrlPromptAfterUse={false}
              leagueName={leagueName ?? null}
              leagueId={leagueId ?? null}
              insightType="draft"
              sport={sport}
              source="draft_tool"
              toolContext={{
                toolName: 'Draft Room',
                summary: chimmyToolSummary ?? undefined,
                leagueName: leagueName ?? null,
                sport,
              }}
              className="min-h-[340px] h-[380px]"
            />
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-[10px] text-white/60">
              Chimmy is temporarily unavailable. The deterministic draft helper, live brain, and queue tools still work.
            </div>
          )}
        </div>
        <div className="mt-2 border-t border-white/8 pt-2">
          <FeatureGate
            featureId="draft_strategy_build"
            featureNameOverride={t('draftRoom.helper.warRoom.featureName')}
            className="mb-2"
          >
            <>
              <button
                type="button"
                data-testid="draft-open-war-room-button"
                onClick={() => setWarRoomOpen((open) => !open)}
                className="rounded border border-violet-400/35 bg-violet-500/10 px-2.5 py-1.5 text-[10px] text-violet-100 hover:bg-violet-500/20"
              >
                {warRoomOpen ? t('draftRoom.helper.warRoom.close') : t('draftRoom.helper.warRoom.open')}
              </button>
              {warRoomOpen && leagueId && (
                <div className="mt-2 space-y-2" data-testid="draft-war-room-panel">
                  <WarRoomPanel
                    leagueId={leagueId}
                    sport={sport}
                    draftSessionId={draftSessionId}
                    useDemoBoard={!warRoomBrainInput}
                    brainInput={warRoomBrainInput ?? undefined}
                    includeNarrative
                  />
                  <a
                    href={DRAFT_WAR_ROOM_LEGACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="draft-war-room-link"
                    className="inline-flex rounded border border-violet-300/35 bg-violet-500/8 px-2 py-1 text-[10px] text-violet-100 hover:bg-violet-500/20"
                  >
                    {t('draftRoom.helper.warRoom.launch')}
                  </a>
                </div>
              )}
            </>
          </FeatureGate>
        </div>
      </div>
    </section>
  )
}
