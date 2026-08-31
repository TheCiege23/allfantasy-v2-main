'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

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

type SyncRound = {
  ok?: boolean
  totalCandidates?: number
  attempted?: number
  synced?: number
  locked?: number
  failed?: number
  remaining?: string[]
  error?: string
}

type Phase = 'idle' | 'busy' | 'done' | 'error'

export type SyncNowButtonProps = {
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

/**
 * A backstop on the continuation loop, not a cap on the work.
 *
 * ⚠ IT MUST NEVER BE THE THING THAT ENDS A NORMAL RUN. The server guarantees at
 * least one league per platform per round, so the honest terminator is an empty
 * `remaining`. This only catches a server that starts answering with a
 * `remaining` it never shrinks — which would otherwise be an infinite POST loop
 * against the user's own providers. If it ever fires, the run is reported as
 * incomplete rather than done, because it is.
 */
const MAX_ROUNDS = 40

export function SyncNowButton({ variant = 'chip', eligibleCount }: SyncNowButtonProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  /* A full-account resync outlives most screens; don't set state after unmount. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /* Only a counted zero disables. See `eligibleCount` above for why null does not. */
  const nothingToSync = eligibleCount === 0
  const disabled = phase === 'busy' || nothingToSync

  const run = useCallback(async () => {
    if (phase === 'busy' || nothingToSync) return
    setPhase('busy')
    setMessage(null)

    let only: string[] | null = null
    let total = 0
    let synced = 0
    let locked = 0
    let failed = 0
    let rounds = 0
    let exhausted = false

    while (rounds < MAX_ROUNDS) {
      rounds += 1

      let round: SyncRound | null = null
      let httpOk = false
      try {
        const res = await fetch('/api/core/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(only ? { only } : {}),
        })
        httpOk = res.ok
        round = (await res.json().catch(() => null)) as SyncRound | null
      } catch {
        round = null
      }
      /* Navigated away mid-run. The rounds already sent still completed server-side. */
      if (!alive.current) return

      if (!httpOk || !round?.ok) {
        setPhase('error')
        setMessage(
          synced > 0
            ? `Stopped after ${synced} of ${total}`
            : (round?.error ?? 'Sync did not run. Try again shortly.'),
        )
        return
      }

      /* The denominator comes from the first round and stays put — a later
         round recomputes the same candidate set, so it should not move. */
      if (rounds === 1) total = round.totalCandidates ?? 0
      synced += round.synced ?? 0
      locked += round.locked ?? 0
      failed += round.failed ?? 0

      if (total === 0) {
        setPhase('done')
        setMessage('No connected leagues to sync')
        return
      }

      /*
       * Progress between rounds, not just at the end. A 50-league account is
       * minutes of work, and a button that sits on "Syncing…" for four of them
       * is indistinguishable from one that has hung.
       */
      setMessage(`Synced ${synced + locked + failed} of ${total}…`)

      const rest = Array.isArray(round.remaining) ? round.remaining : []
      if (rest.length === 0) break
      /* No forward progress this round — see MAX_ROUNDS. Stop rather than spin. */
      if (!round.attempted) {
        exhausted = true
        break
      }
      only = rest
      if (rounds >= MAX_ROUNDS) exhausted = true
    }

    if (!alive.current) return

    const stragglers = locked + failed
    if (exhausted) {
      setPhase('error')
      setMessage(`Synced ${synced} of ${total} — press again to finish`)
    } else if (stragglers > 0) {
      setPhase('error')
      setMessage(`Synced ${synced} of ${total}`)
    } else {
      setPhase('done')
      setMessage(`Synced ${synced}`)
    }

    /*
     * Every /core screen is server-rendered from the tables the resync just
     * wrote, so a refresh is what makes the press visible. Without it the
     * button reports success beside numbers that have not moved.
     */
    router.refresh()
  }, [phase, nothingToSync, router])

  const label = phase === 'busy' ? 'Syncing…' : 'Sync now'
  const hint = nothingToSync
    ? 'Import a league first — there is nothing to sync yet'
    : 'Pick up new activity in your connected leagues'

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
