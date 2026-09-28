'use client'

import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'

import type { ChimmyAIAnalyticsIngressEvent } from '@/lib/chimmy-chat/analytics-events'
import { trackChimmyAIEvent } from '@/lib/chimmy-chat/analytics-events-client'
import type { ChimmyAssistantMode } from '@/lib/chimmy-chat/assistant-mode'
import { buildChimmyFeedbackEvent, type ChimmyFeedbackValue } from '@/lib/chimmy-chat/feedback-events'

/**
 * Thumbs up / down under a Chimmy answer in the drawer (owner's call 2026-09-24: "thumbs up/down").
 *
 * Same event the /chimmy/chat page already sends — `feedback_submit` to `/api/ai/events`, stored
 * in `analytics_events` — so both surfaces are one query, not two. What the drawer adds is WHAT the
 * rating is about: the tools the answer used (`meta.toolsUsed`) and the screen it was asked from,
 * in the question row's own words, so a thumbs-down lands next to the question and the tool that
 * earned it.
 *
 * Optional and quiet, like "Did it / Not doing it": nothing is inferred from not tapping, and a
 * lost event costs a data point, never the answer — the sender swallows its own failures.
 */

export type ChimmyAnswerRatingProps = {
  answerId: string
  rating: ChimmyFeedbackValue | null
  leagueId: string | null
  surface: ChimmyAIAnalyticsIngressEvent['surface']
  mode: ChimmyAssistantMode
  entry: string
  tools: readonly string[]
  onRated?: (rating: ChimmyFeedbackValue) => void
}

export function ChimmyAnswerRating({
  answerId,
  rating: initial,
  leagueId,
  surface,
  mode,
  entry,
  tools,
  onRated,
}: ChimmyAnswerRatingProps) {
  const [rating, setRating] = useState<ChimmyFeedbackValue | null>(initial)

  const rate = (next: ChimmyFeedbackValue) => {
    if (rating === next) return
    setRating(next)
    onRated?.(next)
    void trackChimmyAIEvent(
      buildChimmyFeedbackEvent({
        messageId: answerId,
        feedback: next,
        leagueId,
        surface,
        mode,
        source: 'core_comms',
        entry,
        tools,
      }),
    )
  }

  return (
    <div className="af-cm-rate" role="group" aria-label="Was this answer useful?">
      <button
        type="button"
        className="af-cm-rate-btn"
        aria-label="Useful"
        aria-pressed={rating === 'helpful'}
        onClick={() => rate('helpful')}
      >
        <ThumbsUp size={13} aria-hidden />
      </button>
      <button
        type="button"
        className="af-cm-rate-btn"
        aria-label="Not useful"
        aria-pressed={rating === 'unhelpful'}
        onClick={() => rate('unhelpful')}
      >
        <ThumbsDown size={13} aria-hidden />
      </button>
      {rating ? (
        <span className="af-cm-rate-note" role="status">
          {rating === 'helpful' ? 'Noted, thanks.' : "Noted. Tell me what I missed and I'll take another run at it."}
        </span>
      ) : null}
    </div>
  )
}
