'use client'

/**
 * "You're up" alert — slides in once per pick when the clock reaches the
 * viewer, offers a one-tap draft of the top queued (else best available)
 * player, and warns about back-to-back picks at the turn. Dismissal is per
 * pick, so the next turn shows it again.
 *
 * Placement avoids the two things you need while on the clock: the header's
 * pick clock (top) and the player list (bottom on desktop, where you draft and
 * queue). On desktop it sits just under the header, over the display-only
 * recent-picks strip; on phones and tablets it sits above the bottom docks.
 * z-[45]: above the room (header is z-30) but below every dialog (z-50 / z-60),
 * so an open trade panel or player card is never covered by it.
 */

import React, { useEffect } from 'react'
import { Bell, X } from 'lucide-react'

type YoureUpAlertProps = {
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
  /** True when the player list is already on screen (the phone's Players tab): "See players" would go nowhere. */
  playersOnScreen?: boolean
}

export function YoureUpAlert({
  pickLabel,
  suggestion,
  backToBackLabel,
  drafting,
  canDraft,
  onDraftSuggestion,
  onSeePlayers,
  onDismiss,
  playersOnScreen = false,
}: YoureUpAlertProps) {
  /*
   * Two lines, not three (2026-11-24, the simplify pass): "Your pick clock is running" said what the header's
   * countdown shows, so the line under the title is the suggestion (or the back-to-back warning) instead.
   * `timed` stays in the props so the caller's contract is unchanged; the clock itself is the header's.
   */
  const detail =
    [
      suggestion ? `${suggestion.source === 'queue' ? 'Top of your queue' : 'Best available by ADP'}: ${suggestion.name} · ${suggestion.position}.` : null,
      backToBackLabel ? `You pick again at ${backToBackLabel} — back-to-back.` : null,
    ]
      .filter(Boolean)
      .join(' ') || null
  /*
   * A short buzz when it becomes your turn (2026-11-19), on phones that allow it. Once per pick:
   * the alert mounts once per pick. Browsers without the Vibration API (iOS Safari) skip it.
   */
  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([70, 50, 70])
    } catch {
      /* a hint, never an error */
    }
  }, [pickLabel])
  return (
    <div
      role="alert"
      data-testid="draft-youre-up-alert"
      className="pointer-events-auto fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+132px)] z-[45] mx-auto max-w-md rounded-2xl md:bottom-6 lg:bottom-auto lg:top-24 bg-amber-400 px-4 py-3 text-[#0a111d] shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center gap-3">
        <Bell className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold uppercase tracking-[0.04em]">You&apos;re up · {pickLabel}</p>
          {detail ? <p className="text-[13px] font-semibold leading-snug" data-testid="draft-youre-up-detail">{detail}</p> : null}
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
      {/* No empty row: on the Players tab with nothing to suggest there is no button to show. */}
      {(suggestion && canDraft) || !playersOnScreen ? <div className="mt-2.5 flex gap-2">
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
        {playersOnScreen ? null : <button
          type="button"
          onClick={onSeePlayers}
          data-testid="draft-youre-up-see-players"
          className="h-11 flex-1 rounded-xl border-2 border-[#0a111d] px-3 text-[15px] font-extrabold"
        >
          See players
        </button>}
      </div> : null}
    </div>
  )
}
