'use client'

/**
 * ChimmySavedRecommendationCard — Pattern E
 * Renders a saved Chimmy recommendation with its original action CTA.
 * Shown in the Saved Recommendations panel or wherever SavedAIRecommendation
 * entries from the logger are displayed.
 */

import { useState } from 'react'
import { BookmarkCheck, CheckCircle2, Sparkles, X } from 'lucide-react'
import type { SavedAIRecommendation, AIActionContext } from '@/lib/chimmy-actions'
import { markRecommendationActedOn, trackAIActionEvent } from '@/lib/chimmy-actions'
import { useAIAction } from '@/components/chimmy-actions'

export interface ChimmySavedRecommendationCardProps {
  saved: SavedAIRecommendation
  context: AIActionContext
  /** Called after user clicks "Act Now" */
  onActNow?: (saved: SavedAIRecommendation) => void
  /** Called after user clicks "Dismiss" */
  onDismiss?: (saved: SavedAIRecommendation) => void
  className?: string
}

const SPORT_COLORS: Record<string, string> = {
  NFL:  'bg-sky-600/20  text-sky-300',
  NBA:  'bg-orange-600/20 text-orange-300',
  MLB:  'bg-red-600/20  text-red-300',
  NHL:  'bg-blue-600/20 text-blue-300',
  default: 'bg-white/10 text-white/60',
}

function relativeTime(epochMs: number): string {
  const diffSec = Math.floor((Date.now() - epochMs) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export default function ChimmySavedRecommendationCard({
  saved,
  context,
  onActNow,
  onDismiss,
  className = '',
}: ChimmySavedRecommendationCardProps) {
  const [actedOn, setActedOn] = useState(saved.actedOn ?? false)
  const [dismissed, setDismissed] = useState(false)
  const { execute, isExecuting } = useAIAction()

  if (dismissed) return null

  const sportColor = SPORT_COLORS[saved.sport] ?? SPORT_COLORS.default

  async function handleActNow() {
    await execute(saved.action, context, {
      onSuccess: async () => {
        setActedOn(true)
        await markRecommendationActedOn(saved.id)
        await trackAIActionEvent({
          action: saved.action,
          context,
          event: 'staged', // `execute` stages the action; the manager has not submitted it yet.
          metadata: {
            source: 'saved_recommendation_card',
            followedSuggestion: true,
          },
        })
        onActNow?.(saved)
      },
    })
  }

  function handleDismiss() {
    markRecommendationActedOn(saved.id).catch(() => {})
    trackAIActionEvent({
      action: saved.action,
      context,
      event: 'dismissed',
      metadata: { source: 'saved_recommendation_card' },
    }).catch(() => {})
    setDismissed(true)
    onDismiss?.(saved)
  }

  return (
    <div
      className={[
        'group relative flex flex-col gap-2 rounded-xl border border-white/[0.08]',
        'bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-4',
        'transition-opacity',
        actedOn ? 'opacity-60' : 'opacity-100',
        className,
      ].join(' ')}
    >
      {/* Header row: badges + dismiss */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Chimmy icon */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600/20">
            <Sparkles className="h-2.5 w-2.5 text-indigo-400" aria-hidden="true" />
          </span>
          {/* Sport badge */}
          <span className={['rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', sportColor].join(' ')}>
            {saved.sport}
          </span>
          {/* Surface badge */}
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-medium text-white/40 uppercase tracking-wide">
            {saved.surface}
          </span>
        </div>

        {/* Dismiss button */}
        {!actedOn && (
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1 text-white/30 opacity-0 transition-all hover:bg-white/8 hover:text-white/60 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Dismiss saved recommendation"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Headline */}
      <p className="text-sm font-semibold leading-snug text-white/90">
        {saved.recommendationText}
      </p>

      {/* Footer row: timestamp + action */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="flex items-center gap-1 text-[11px] text-white/30">
          <BookmarkCheck className="h-3 w-3 text-indigo-400/60" aria-hidden="true" />
          {relativeTime(saved.savedAt)}
          {saved.expiresAt && saved.expiresAt > Date.now() && (
            <span className="ml-1 text-amber-500/60">
              · expires {relativeTime(saved.expiresAt)}
            </span>
          )}
        </span>

        {actedOn ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Done
          </span>
        ) : (
          <button
            type="button"
            onClick={handleActNow}
            disabled={isExecuting}
            className={[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5',
              'bg-indigo-600 text-xs font-medium text-white shadow-sm',
              'transition-all hover:bg-indigo-500 active:scale-95',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500',
            ].join(' ')}
          >
            {isExecuting ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3 w-3" aria-hidden="true" />
            )}
            Act Now
          </button>
        )}
      </div>
    </div>
  )
}
