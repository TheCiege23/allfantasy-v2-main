'use client'

/**
 * "You're up" alert — slides in once per pick when the clock reaches the
 * viewer, offers a one-tap draft of the top queued (else best available)
 * player, and warns about back-to-back picks at the turn. Dismissal is per
 * pick, so the next turn shows it again.
 *
 * Anchored to the bottom, never the top: the top is where the header's pick
 * clock lives, and covering the countdown at the one moment it matters most is
 * worse than covering a few rows of the player list. On phones it sits above
 * the bottom docks.
 */

import React from 'react'
import { Bell, X } from 'lucide-react'

export type YoureUpAlertProps = {
  pickLabel: string
  /** True when this pick has a running clock (the header shows the live countdown). */
  timed: boolean
  suggestion: { name: string; position: string; source: 'queue' | 'best_available' } | null
  /** Label of the viewer's back-to-back pick right after this one, if any. */
  backToBackLabel: string | null
  drafting: boolean
  canDraft: boolean
  onDraftSuggestion: () => void
  onSeePlayers: () => void
  onDismiss: () => void
}

export function YoureUpAlert({
  pickLabel,
  timed,
  suggestion,
  backToBackLabel,
  drafting,
  canDraft,
  onDraftSuggestion,
  onSeePlayers,
  onDismiss,
}: YoureUpAlertProps) {
  return (
    <div
      role="alert"
      data-testid="draft-youre-up-alert"
      className="pointer-events-auto fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+132px)] z-[70] mx-auto max-w-md rounded-2xl md:bottom-6 bg-amber-400 px-4 py-3 text-[#0a111d] shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center gap-3">
        <Bell className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold uppercase tracking-[0.04em]">You&apos;re up · {pickLabel}</p>
          {timed ? <p className="text-[13px] font-semibold">Your pick clock is running</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid="draft-youre-up-dismiss"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/10 hover:bg-black/20"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {suggestion || backToBackLabel ? (
        <p className="mt-1.5 text-[14px] leading-snug">
          {suggestion
            ? `${suggestion.source === 'queue' ? 'Top of your queue' : 'Best available by ADP'}: ${suggestion.name} · ${suggestion.position}.`
            : null}
          {backToBackLabel ? ` You pick again at ${backToBackLabel} — back-to-back.` : null}
        </p>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        {suggestion && canDraft ? (
          <button
            type="button"
            onClick={onDraftSuggestion}
            disabled={drafting}
            data-testid="draft-youre-up-draft"
            className="h-11 min-w-0 flex-1 truncate rounded-xl bg-[#0a111d] px-3 text-[15px] font-extrabold text-amber-300 disabled:opacity-60"
          >
            {drafting ? 'Drafting…' : `Draft ${suggestion.name}`}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSeePlayers}
          data-testid="draft-youre-up-see-players"
          className="h-11 flex-1 rounded-xl border-2 border-[#0a111d] px-3 text-[15px] font-extrabold"
        >
          See players
        </button>
      </div>
    </div>
  )
}
