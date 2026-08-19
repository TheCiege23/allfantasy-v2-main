'use client'

import { Sparkles, RefreshCw, MessageCircle, AlertTriangle } from 'lucide-react'
import { DraftLiveBrainPremiumBlock } from '@/components/app/draft-room/DraftLiveBrainPremiumBlock'
import { DraftRoomAccordion } from '@/components/app/draft-room/DraftRoomAccordion'
import { getDraftAIChatUrl, buildAskChimmyAboutPickPrompt } from '@/lib/draft-room/DraftToAIContextBridge'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { DRAFT_WAR_ROOM_LEGACY_URL } from '@/lib/draft-room'
import { useAIAssistantAvailability } from '@/hooks/useAIAssistantAvailability'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import { WarRoomPanel } from '@/components/war-room/WarRoomPanel'
import ChimmyChatPanel from '@/components/chimmy/ChimmyChatPanel'
import { DraftWarRoom } from '@/components/draft/ai/DraftWarRoom'
import type { DraftHelperPanelProps } from '@/components/app/draft-room/DraftHelperPanel'

function truncate(s: string, n: number) {
  const t = s.trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

/** Accordion layout for live redraft snake draft helper — preserves all AI / War Room / Chimmy behavior. */
export function DraftHelperRedraftLayout(props: DraftHelperPanelProps) {
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
    picksUntilUser = null,
    userOnTheClock = false,
    resolvedRecommendedPlayer = null,
    canCommitRecommendedPick = false,
    onDraftRecommendedPlayer,
    onQueueRecommendedPlayer,
    onQueueAlternativePlayer,
  } = props

  const { t } = useLanguage()
  const { enabled: aiAssistantEnabled, loading: aiAvailabilityLoading } = useAIAssistantAvailability()
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

  const copilotSubtitle =
    loading && !recommendation
      ? 'Loading copilot recommendation…'
      : error
        ? error
        : recommendation
          ? `${recommendation.player.name} · ${truncate(recommendation.reason, 96)}`
          : 'Expand for AI explanation, picks, scarcity, and queue actions'

  const warSubtitle =
    warRoom?.snapshot?.bestPick?.name != null
      ? `Focus: ${warRoom.snapshot.bestPick.name} · ${truncate(
          warRoom.snapshot.strategyTip || warRoom.snapshot.reasoning?.[0] || 'Scarcity & positional runs',
          88,
        )}`
      : warRoom?.loading
        ? 'Refreshing board intel…'
        : 'Expand for positional scarcity and live targets'

  const intelSubtitle =
    sportsFeed?.available && sportsFeed.headlines[0]?.title
      ? sportsFeed.headlines[0].title
      : aiFeatureStatus?.chimmyReady
        ? 'Feeds + AI features active — expand for headlines & injuries'
        : 'Expand for news, injuries, and tool status'

  const chimmySubtitle = chimmyToolSummary ? truncate(chimmyToolSummary, 100) : 'Draft-aware assistant with league context'

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-violet-500/25 bg-[linear-gradient(180deg,rgba(20,12,40,0.4),rgba(5,10,20,0.96))] shadow-[inset_1px_0_0_rgba(167,139,250,0.12),0_16px_48px_rgba(0,0,0,0.35)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-violet-500/15 bg-[linear-gradient(90deg,rgba(167,139,250,0.08),transparent)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">{t('draftRoom.helper.title')}</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          data-testid="draft-helper-refresh"
          className="rounded-lg border border-white/15 bg-black/25 px-2 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          aria-label="Refresh recommendation"
        >
          <RefreshCw className={`inline h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 [scrollbar-color:rgba(148,163,184,0.35)_transparent] [scrollbar-width:thin]">
        <DraftRoomAccordion
          variant="redraft_snake"
          persistenceKey="af:draft:redraft:sec:copilot"
          defaultOpen
          title="Draft copilot"
          collapsedSubtitle={copilotSubtitle}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          headerActions={
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRefresh()
              }}
              disabled={loading}
              className="rounded border border-cyan-400/25 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50"
            >
              Refresh
            </button>
          }
          testId="draft-helper-accordion-copilot"
        >
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-[11px] text-white/75">
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
            <p className="text-[10px] text-white/55" data-testid="draft-helper-execution-mode">
              {executionMode === 'ai_explained'
                ? t('draftRoom.helper.execution.aiExplained')
                : t('draftRoom.helper.execution.deterministic')}
            </p>
            <div className="grid gap-2">
              <InContextMonetizationCard
                title="Draft prep access"
                featureId="draft_prep"
                tokenRuleCodes={['ai_draft_pick_explanation']}
                testIdPrefix="draft-prep-monetization"
              />
              <InContextMonetizationCard
                title="AF Legacy strategy build access"
                featureId="draft_strategy_build"
                tokenRuleCodes={['ai_draft_helper_session_recommendation']}
                testIdPrefix="draft-helper-monetization"
              />
            </div>
            {liveBrain && (
              <DraftLiveBrainPremiumBlock liveBrain={liveBrain} onPlayerClick={onPlayerClick} />
            )}
            {error && <p className="text-xs text-amber-400">{error}</p>}
            {loading && !recommendation && (
              <p className="py-3 text-center text-xs text-white/50">Getting recommendation…</p>
            )}
            {!loading && !error && recommendation && (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlayerClick?.(recommendation.player)}
                  onKeyDown={(e) => e.key === 'Enter' && onPlayerClick?.(recommendation.player)}
                  data-testid="draft-helper-recommendation-card"
                  className="rounded-xl border border-cyan-400/30 bg-[linear-gradient(155deg,rgba(34,211,238,0.14),rgba(15,23,42,0.95))] px-3 py-3 text-left shadow-[0_16px_48px_rgba(0,0,0,0.4)] ring-1 ring-cyan-400/15"
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
                  </div>
                </div>
                {explanation && <p className="text-[10px] text-white/80">{explanation}</p>}
                {(reachWarning || valueWarning || scarcityInsight || stackInsight || correlationInsight || formatInsight || byeNote) && (
                  <div className="space-y-1">
                    {reachWarning && (
                      <p className="flex items-start gap-1 text-[10px] text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {reachWarning}
                      </p>
                    )}
                    {valueWarning && (
                      <p className="flex items-start gap-1 text-[10px] text-emerald-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {valueWarning}
                      </p>
                    )}
                    {scarcityInsight && <p className="text-[10px] text-cyan-300/90">{scarcityInsight}</p>}
                    {stackInsight && <p className="text-[10px] text-violet-200/90">{stackInsight}</p>}
                    {correlationInsight && <p className="text-[10px] text-indigo-200/90">{correlationInsight}</p>}
                    {formatInsight && <p className="text-[10px] text-sky-200/90">{formatInsight}</p>}
                    {byeNote && <p className="text-[10px] text-amber-300/90">{byeNote}</p>}
                  </div>
                )}
                {evidence.length > 0 && (
                  <div>
                    <p className="text-[9px] font-medium uppercase tracking-wider text-white/50">{t('draftRoom.helper.evidence')}</p>
                    <ul className="list-inside list-disc text-[10px] text-white/70">
                      {evidence.slice(0, 4).map((item, i) => (
                        <li key={`e-${i}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {caveats.length > 0 && (
                  <div>
                    <p className="text-[9px] font-medium uppercase tracking-wider text-white/50">Caveats</p>
                    <ul className="list-inside list-disc text-[10px] text-white/60">
                      {caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {uncertainty && (
                  <p className="text-[10px] text-amber-200/90" data-testid="draft-helper-uncertainty">
                    {uncertainty}
                  </p>
                )}
                {alternatives.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-medium uppercase tracking-wider text-white/50">{t('draftRoom.helper.alternatives')}</p>
                    <ul className="space-y-1">
                      {alternatives.slice(0, 5).map((alt, i) => (
                        <li
                          key={i}
                          data-testid={`draft-helper-alternative-${i}`}
                          className="rounded border border-white/12 bg-[linear-gradient(120deg,rgba(15,23,42,0.85),rgba(8,16,32,0.92))] px-2 py-1.5 text-[10px] text-white/82"
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
                            {onQueueAlternativePlayer ? (
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/20"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Open full Chimmy
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={onRefresh}
                    data-testid="draft-ai-suggestion-fallback-button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 hover:bg-amber-500/20"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('draftRoom.helper.aiUnavailableRefresh')}
                  </button>
                )}
              </>
            )}
            {!loading && !error && !recommendation && (
              <div className="space-y-2 py-3 text-center text-xs text-white/50">
                <p className="text-white/65">
                  Your ranked copilot recommendation loads when it is your pick — it follows the live board and your roster needs.
                </p>
                <p className="text-[11px] text-white/42">
                  Between picks, open AF Legacy for redraft lookahead; it tracks scarcity and positional runs as picks land.
                </p>
              </div>
            )}
          </div>
        </DraftRoomAccordion>

        {warRoom && leagueId ? (
          <DraftRoomAccordion
            variant="redraft_snake"
            persistenceKey="af:draft:redraft:sec:warboard"
            defaultOpen={false}
            title="AF Legacy (live board)"
            collapsedSubtitle={warSubtitle}
            testId="draft-helper-accordion-war-board"
          >
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
          </DraftRoomAccordion>
        ) : null}

        {(sportsFeed || aiFeatureStatus) && (
          <DraftRoomAccordion
            variant="redraft_snake"
            persistenceKey="af:draft:redraft:sec:intel"
            defaultOpen={false}
            title="Draft intelligence"
            collapsedSubtitle={intelSubtitle}
            testId="draft-helper-accordion-intel"
          >
            <div className="rounded-xl border border-white/10 bg-[#081224] p-3" data-testid="draft-helper-ai-sports-context">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">Feeds & tools</p>
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
          </DraftRoomAccordion>
        )}

        <DraftRoomAccordion
          variant="redraft_snake"
          persistenceKey="af:draft:redraft:sec:chimmy"
          defaultOpen
          title="Chimmy AI chat"
          collapsedSubtitle={chimmySubtitle}
          testId="draft-helper-accordion-chimmy"
        >
          <div
            className="rounded-xl border border-cyan-400/25 bg-[linear-gradient(180deg,rgba(8,22,38,0.95),rgba(4,12,24,0.98))] p-2 shadow-[inset_0_1px_0_rgba(34,211,238,0.08)]"
            data-testid="draft-helper-chimmy-panel"
          >
            <p className="mb-2 text-[11px] leading-relaxed text-white/70">
              Draft-aware chat uses your league, sport, queue, and live AI context inside the room.
            </p>
            {aiAssistantEnabled ? (
              <ChimmyChatPanel
                variant="inline"
                compact={false}
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
                className="min-h-[min(58vh,620px)] h-[min(58vh,620px)] max-h-[680px] rounded-xl border border-cyan-400/35 bg-[#030810] shadow-[0_22px_64px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(34,211,238,0.07)]"
              />
            ) : (
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-4 text-sm text-white/65">
                Chimmy is temporarily unavailable. The deterministic draft helper, live brain, and queue tools still work.
              </div>
            )}
          </div>
        </DraftRoomAccordion>

        {leagueId ? (
          <FeatureGate featureId="draft_strategy_build" featureNameOverride={t('draftRoom.helper.warRoom.featureName')} className="mt-0">
            <DraftRoomAccordion
              variant="redraft_snake"
              persistenceKey="af:draft:redraft:sec:warbuild"
              defaultOpen={false}
              title="Full AF Legacy (build)"
              collapsedSubtitle="Session strategy build & narrative — expand for full AF Legacy"
              testId="draft-helper-accordion-war-build"
            >
              <div className="space-y-3" data-testid="draft-war-room-panel">
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
                  className="inline-flex rounded-lg border border-violet-300/35 bg-violet-500/10 px-3 py-2 text-[11px] font-medium text-violet-100 hover:bg-violet-500/20"
                >
                  {t('draftRoom.helper.warRoom.launch')}
                </a>
              </div>
            </DraftRoomAccordion>
          </FeatureGate>
        ) : null}
      </div>
    </section>
  )
}
