'use client'

import React from 'react'
import { Volume2, Square, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'
import { SuggestedActionRenderer } from '@/lib/chimmy-chat/SuggestedActionRenderer'
import { isRenderableChimmyContentHref } from '@/lib/chimmy-chat/safeChimmyLinks'
import {
  buildChimmyCollapsedSummary,
  isLongChimmyResponse,
} from '@/lib/chimmy-chat/presentation'
import { buildSmartFollowUpChips, type ChimmyFollowUpChip } from '@/lib/chimmy-chat/smart-followups'
import ChimmyResponseStructure from './ChimmyResponseStructure'
import { ChimmyOrchestrationPanel } from './ChimmyOrchestrationPanel'
import ChimmyTrustPanel from './ChimmyTrustPanel'

export type { ChimmyMessageMeta } from '@/lib/chimmy-chat/types'

export interface ChimmyMessageBubbleProps {
  messageId?: string
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
  meta?: ChimmyMessageMeta | null
  onFollowUpClick?: (chip: ChimmyFollowUpChip) => void
  followUpChips?: ChimmyFollowUpChip[]
  showVoiceButton?: boolean
  onVoiceToggle?: () => void
  onVoiceEnabledToggle?: () => void
  voiceEnabled?: boolean
  voiceLoading?: boolean
  voicePlaying?: boolean
  /** ElevenLabs / Chimmy TTS voice name shown on the play button */
  voiceDisplayName?: string
  /** When true, renders the corner voice badge (only on last assistant reply) */
  isLastAssistantMessage?: boolean
  onFeedbackSubmit?: (args: { messageId: string; feedback: 'helpful' | 'unhelpful' }) => void
  feedbackSelection?: 'helpful' | 'unhelpful' | null
  showTrustPanel?: boolean
  enableFollowUps?: boolean
}

function renderContentWithLinks(text: string) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }
    const href = match[2]
    // Security: only internal app routes from model content render as live links. An external/arbitrary
    // URL in the model's own output is untrusted (prompt-injection / open-redirect) → show the label as
    // plain text, never a clickable external link. Real external actions come from server-resolved cards.
    if (isRenderableChimmyContentHref(href)) {
      nodes.push(
        <a
          key={`l-${match.index}`}
          href={href}
          className="underline text-cyan-300 hover:text-cyan-200"
        >
          {match[1]}
        </a>
      )
    } else {
      nodes.push(<span key={`x-${match.index}`}>{match[1]}</span>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(<span key="t-end">{text.slice(lastIndex)}</span>)
  return <div className="whitespace-pre-wrap break-words">{nodes.length ? nodes : text}</div>
}

export default function ChimmyMessageBubble({
  messageId,
  role,
  content,
  imageUrl,
  meta,
  onFollowUpClick,
  followUpChips,
  showVoiceButton,
  onVoiceToggle,
  onVoiceEnabledToggle,
  voiceEnabled = true,
  voiceLoading = false,
  voicePlaying = false,
  voiceDisplayName = 'Voice',
  isLastAssistantMessage = false,
  onFeedbackSubmit,
  feedbackSelection = null,
  showTrustPanel = true,
  enableFollowUps = true,
}: ChimmyMessageBubbleProps) {
  const isUser = role === 'user'
  const responseStructure = !isUser ? meta?.responseStructure : undefined
  const hasResponseStructure = Boolean(responseStructure?.shortAnswer?.trim())
  const isLongResponse = !isUser && isLongChimmyResponse(content)
  const collapsedSummary = !isUser
    ? buildChimmyCollapsedSummary({
        content,
        responseStructure,
      })
    : ''
  const [showFullAnalysis, setShowFullAnalysis] = React.useState(false)
  const hasInlineLinks = /\[[^\]]+\]\(([^)]+)\)/.test(content)
  const shouldRenderRawContent =
    isLongResponse
      ? showFullAnalysis
      : !hasResponseStructure ||
        hasInlineLinks ||
        (content.trim().length > (responseStructure?.shortAnswer?.trim().length ?? 0) + 90)


  const mergedFollowUpChips = React.useMemo(() => {
    return buildSmartFollowUpChips({
      contractFollowUps: meta?.answerContract?.followUps,
      orchestrationFollowUps: meta?.orchestration?.followUps,
      fallbackFollowUps: followUpChips,
      limit: 5,
    })
  }, [meta?.answerContract?.followUps, meta?.orchestration?.followUps, followUpChips])

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-cyan-500/15 border border-cyan-400/25 text-white'
            : 'border border-white/10 bg-[#060d1e]/95 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,0.35)]'
        }`}
      >
        {isLastAssistantMessage && showVoiceButton && onVoiceToggle && (
          <button
            type="button"
            onClick={onVoiceToggle}
            disabled={voiceLoading}
            data-testid="chimmy-voice-badge"
            aria-label={voicePlaying ? `Stop ${voiceDisplayName} voice` : `Play ${voiceDisplayName} voice`}
            className={`absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full border transition ${
              voicePlaying
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.35)]'
                : voiceLoading
                  ? 'border-white/20 bg-white/5 text-white/40'
                  : 'border-white/20 bg-white/5 text-white/40 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-300'
            } disabled:cursor-not-allowed`}
          >
            {voiceLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : voicePlaying ? (
              <Square className="h-3 w-3" />
            ) : (
              <Volume2 className="h-3 w-3" />
            )}
          </button>
        )}
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Uploaded"
            className="max-w-full max-h-48 rounded-lg mb-2 object-cover"
          />
        )}
        {hasResponseStructure && responseStructure && (
          <ChimmyResponseStructure
            quickAnswer={responseStructure.shortAnswer}
            whatDataSays={responseStructure.whatDataSays}
            whatItMeans={responseStructure.whatItMeans}
            actionPlan={responseStructure.recommendedAction}
            caveats={responseStructure.caveats}
            sectionTitles={responseStructure.sectionTitles}
            collapsible
            className="mb-2"
          />
        )}
        {!isUser && isLongResponse && !hasResponseStructure && collapsedSummary && !showFullAnalysis && (
          <div className="mb-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-relaxed text-white/90">
            {renderContentWithLinks(collapsedSummary)}
          </div>
        )}
        {shouldRenderRawContent && (
          <div className="text-sm leading-relaxed">{renderContentWithLinks(content)}</div>
        )}
        {!isUser && isLongResponse && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowFullAnalysis((current) => !current)}
              data-testid="chimmy-toggle-full-analysis-button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
            >
              {showFullAnalysis ? 'Hide full analysis' : 'Show full analysis'}
            </button>
          </div>
        )}
        {!isUser && meta?.ctaHref && meta?.ctaLabel && (
          <div className="mt-3">
            <a
              href={meta.ctaHref}
              data-testid="chimmy-upgrade-cta"
              className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
            >
              {meta.ctaLabel}
            </a>
          </div>
        )}

        {!isUser && meta && showTrustPanel && (
          <ChimmyTrustPanel
            confidencePct={meta.confidencePct}
            confidenceBlock={meta.answerContract?.confidence}
            dataSources={meta.dataSources}
            syncFreshness={meta.syncFreshness}
            sourceLinks={meta.sourceLinks}
          />
        )}
        {!isUser && <SuggestedActionRenderer content={content} />}

        {!isUser && meta?.orchestration && (
          <ChimmyOrchestrationPanel orchestration={meta.orchestration} />
        )}

        {!isUser && isLastAssistantMessage && onFeedbackSubmit && messageId && (
          <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              data-testid="chimmy-feedback-helpful"
              data-selected={feedbackSelection === 'helpful' ? 'true' : 'false'}
              onClick={() => onFeedbackSubmit({ messageId, feedback: 'helpful' })}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                feedbackSelection === 'helpful'
                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
              aria-label="Mark response as helpful"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Helpful
            </button>
            <button
              type="button"
              data-testid="chimmy-feedback-unhelpful"
              data-selected={feedbackSelection === 'unhelpful' ? 'true' : 'false'}
              onClick={() => onFeedbackSubmit({ messageId, feedback: 'unhelpful' })}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                feedbackSelection === 'unhelpful'
                  ? 'border-amber-300/40 bg-amber-500/15 text-amber-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
              aria-label="Mark response as unhelpful"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              Unhelpful
            </button>
          </div>
        )}

        {!isUser && showVoiceButton && onVoiceToggle && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={voiceLoading}
              data-testid="chimmy-play-voice-button"
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                voicePlaying
                  ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-100'
                  : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
              } disabled:opacity-50`}
              aria-label={
                voicePlaying ? `Stop ${voiceDisplayName} voice` : `Play ${voiceDisplayName} voice`
              }
            >
              {voiceLoading ? (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  Loading…
                </>
              ) : voicePlaying ? (
                <>Stop</>
              ) : (
                <>{voiceDisplayName}</>
              )}
            </button>
            {onVoiceEnabledToggle && (
              <button
                type="button"
                onClick={onVoiceEnabledToggle}
                data-testid="chimmy-message-voice-toggle-button"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/10"
                aria-label={voiceEnabled ? 'Disable Chimmy voice playback' : 'Enable Chimmy voice playback'}
              >
                {voiceEnabled ? 'Voice on' : 'Voice off'}
              </button>
            )}
          </div>
        )}

        {!isUser && enableFollowUps && mergedFollowUpChips.length > 0 && onFollowUpClick && (
          <div className="mt-3 flex flex-wrap gap-2">
            {mergedFollowUpChips.map((chip) => (
              <button
                key={chip.prompt}
                type="button"
                onClick={() => onFollowUpClick(chip)}
                data-testid={`chimmy-follow-up-chip-${chip.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 transition min-h-[36px]"
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
