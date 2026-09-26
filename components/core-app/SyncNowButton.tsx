'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { claimClientSyncRefresh, getClientSyncSnapshot, getServerSyncSnapshot, startClientSync, subscribeClientSync } from '@/lib/core-app/clientSyncJob'

/**
 * "Sync now" — the shell's one write-shaped control, and it is not a write.
 *
 * ⚠ THIS DOES NOT CONTRADICT THE READ-ONLY CHIP SITTING NEXT TO IT. Read-only is
 * a statement about the *platform*: we never change a lineup, accept a trade or
 * post a message on Sleeper/ESPN/Fantrax. Re-reading those leagues into our own
 * tables is the opposite of a write to them, and the label says "Sync" rather
 * than "Update" for exactly that reason.
 *
 * ⚠ ONE PRESS SYNCS EVERY LEAGUE, ACROSS AS MANY REQUESTS AS THAT TAKES.
 * `/api/core/sync` cannot finish a 50-league account inside one serverless
 * invocation, so it works until its time budget is spent and hands back the
 * leagues it did not reach. This component posts those straight back and keeps
 * going until nothing is left — the person presses once and watches a counter,
 * which is the only part of the arrangement they should ever have to know.
 *
 * ⚠ THE RESULT LINE REPORTS WHAT ACTUALLY ADVANCED, NOT THAT THE REQUESTS
 * RETURNED 200. A round answers ok:true when it completed even if individual
 * leagues were locked or failed — a button that says "Synced" over that is the
 * stale-data problem it was added to fix, wearing a success message.
 */

export type SyncNowButtonProps = {
  onlyKey?: string | null
  /**
   * `panel` is the full-width action row on the /core home screen — the visible
   * button. `chip` is the compact topbar form carried on every other screen.
   */
  variant?: 'panel' | 'chip'
  /**
   * How many of this user's leagues can actually be re-synced, counted by
   * `selectResyncCandidates` on the server.
   *
   * ⚠ ZERO DISABLES THE BUTTON, AND THAT IS THE POINT — there is nothing to
   * re-read until an import has landed, and a button that accepts a press and
   * then reports "nothing happened" is worse than one that says so up front.
   *
   * ⚠ `null` IS "WE COULD NOT COUNT", NOT ZERO. A failed read must not grey the
   * button out, because that tells the user they have no leagues when in fact we
   * only failed to look. It stays enabled and the press reports the real error.
   */
  eligibleCount: number | null
}

export function SyncNowButton({ variant = 'chip', eligibleCount, onlyKey }: SyncNowButtonProps) {
  const router = useRouter()
  const { phase, message, completion } = useSyncExternalStore(subscribeClientSync, getClientSyncSnapshot, getServerSyncSnapshot)
  useEffect(() => {
    if (claimClientSyncRefresh(completion)) router.refresh()
  }, [completion, router])

  /* Only a counted zero disables. See `eligibleCount` above for why null does not. */
  const nothingToSync = eligibleCount === 0
  const disabled = phase === 'busy' || nothingToSync

  const run = useCallback(() => {
    if (phase === 'busy' || nothingToSync) return
    void startClientSync(onlyKey).catch(() => undefined)
  }, [phase, nothingToSync, onlyKey])

  const label = phase === 'busy' ? 'Syncing…' : onlyKey ? 'Sync this league' : 'Sync now'
  const hint = nothingToSync
    ? 'Import a league first — there is nothing to sync yet'
    : onlyKey ? 'Refresh rosters, scores and activity for this league' : 'Pick up new activity in your connected leagues'

  const button = (
    <button
      type="button"
      className={variant === 'panel' ? 'af-syncnow af-syncnow-lg' : 'af-syncnow'}
      data-phase={phase}
      onClick={() => void run()}
      disabled={disabled}
      /* Not aria-disabled: there is genuinely nothing to activate, so removing
         it from the tab order is correct rather than merely convenient. */
      title={hint}
    >
      <span className="af-syncnow-glyph" aria-hidden>
        ⟳
      </span>
      {label}
    </button>
  )

  /* Polite, not assertive: it reports the outcome of a press the user made and
     is watching — it does not need to interrupt what they are reading. */
  const status = (
    <span className="af-syncnow-msg" role="status" aria-live="polite" data-phase={phase}>
      {phase === 'busy' ? (message ?? 'Re-reading your leagues…') : (message ?? '')}
    </span>
  )

  if (variant === 'chip') {
    return (
      <span className="af-syncnow-wrap">
        {button}
        {status}
      </span>
    )
  }

  return (
    <section className="af-syncnow-panel" aria-label="Sync your leagues">
      <div className="af-syncnow-panel-text">
        <span className="af-label af-syncnow-panel-title">Leagues out of date?</span>
        <span className="af-syncnow-panel-sub">
          {nothingToSync ? (
            /*
              ⚠ THE DISABLED STATE EXPLAINS ITSELF RATHER THAN JUST DIMMING.
              A greyed control with no reason beside it reads as broken, and the
              person's next move is to press it repeatedly.
            */
            <>
              Nothing to sync yet — <a href="/import">import a league</a> and this turns on.
            </>
          ) : (
            <>
              {/*
                ⚠ "PICK UP WHAT'S NEW", NOT "RE-IMPORT". The wording tracks what
                the endpoint actually does: a connected league resumes from its
                sync checkpoints rather than being rebuilt. Promising a full
                re-read would be a promise the incremental path does not keep —
                and would make the run look broken when it finishes quickly.
              */}
              Pick up new activity in {eligibleCount == null ? 'your' : eligibleCount} connected{' '}
              {eligibleCount === 1 ? 'league' : 'leagues'}. We only read — nothing changes on
              Sleeper, ESPN or Fantrax.
            </>
          )}
        </span>
      </div>
      <div className="af-syncnow-panel-action">
        {button}
        {status}
      </div>
    </section>
  )
}

export default SyncNowButton
