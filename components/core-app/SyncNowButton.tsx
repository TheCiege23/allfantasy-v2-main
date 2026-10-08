'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { bindClientSyncAccount, claimClientSyncRefresh, getClientSyncSnapshot, getServerSyncSnapshot, resumeClientSync, startClientSync, subscribeClientSync } from '@/lib/core-app/clientSyncJob'
import { useClientSyncAccount } from '@/components/providers/ClientSyncAccountProvider'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { syncMessageText } from '@/lib/core-app/syncMessageText'
import { ageText } from '@/lib/core-app/shellCopy'

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
  /**
   * The shell's last-sync age (`describeAge`), for the panel's "Updated 2h ago" line. Optional: the
   * panel says nothing about age rather than inventing one when it is absent.
   */
  syncAge?: { label: string; stale: boolean } | null
}

export function SyncNowButton({ variant = 'chip', eligibleCount, onlyKey, syncAge = null }: SyncNowButtonProps) {
  const router = useRouter()
  const accountId = useClientSyncAccount()
  const { phase, message, completion } = useSyncExternalStore(subscribeClientSync, getClientSyncSnapshot, getServerSyncSnapshot)
  useEffect(() => {
    bindClientSyncAccount(accountId)
    if (accountId) void resumeClientSync()?.catch(() => undefined)
  }, [accountId])
  useEffect(() => {
    if (claimClientSyncRefresh(completion)) router.refresh()
  }, [completion, router])

  /* Only a counted zero disables. See `eligibleCount` above for why null does not. */
  const nothingToSync = eligibleCount === 0
  const disabled = !accountId || phase === 'busy' || nothingToSync

  const run = useCallback(() => {
    if (!accountId || phase === 'busy' || nothingToSync) return
    void startClientSync(onlyKey).catch(() => undefined)
  }, [accountId, phase, nothingToSync, onlyKey])

  /* In the reader's language — the chip is in the top bar of every /core screen (2026-10-03). */
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const label =
    phase === 'busy'
      ? es ? 'Sincronizando…' : 'Syncing…'
      : onlyKey
        ? es ? 'Sincronizar esta liga' : 'Sync this league'
        : es ? 'Sincronizar' : 'Sync now'
  const hint = nothingToSync
    ? es ? 'Importa una liga primero: aún no hay nada que sincronizar' : 'Import a league first — there is nothing to sync yet'
    : onlyKey
      ? es ? 'Actualiza plantillas, marcadores y actividad de esta liga' : 'Refresh rosters, scores and activity for this league'
      : es ? 'Trae la actividad nueva de tus ligas conectadas' : 'Pick up new activity in your connected leagues'

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
      {/* The sync loop writes these in English; they are translated here, where the language is known. */}
      {phase === 'busy'
        ? message
          ? syncMessageText(message, language)
          : es ? 'Releyendo tus ligas…' : 'Re-reading your leagues…'
        : syncMessageText(message, language)}
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

  /*
   * ⚠ THE HOME PANEL IS A QUIET STATUS ROW, NOT A QUESTION (2026-10-08). It used to ask "Leagues
   * out of date?" over a paragraph about read-only access — plumbing a manager never needs to read,
   * founder-reported as feeling like behind-the-scenes info. Now it reads like a native app's pull-to-
   * refresh line: what it is ("Your leagues"), how fresh it is ("Updated 2h ago"), and the button.
   * While a sync runs, the progress message takes the age's place, so the row never grows.
   */
  const never = syncAge ? /^never/i.test(syncAge.label.trim()) : false
  const ageLine = !syncAge
    ? null
    : never
      ? es ? 'Aún no se ha sincronizado' : 'Not synced yet'
      : es ? `Actualizado ${ageText(syncAge.label, 'es')}` : `Updated ${syncAge.label}`
  const showStatus = phase === 'busy' || Boolean(message)
  return (
    <section
      className="af-syncnow-panel"
      aria-label={es ? 'Sincroniza tus ligas' : 'Sync your leagues'}
      data-stale={syncAge?.stale && !nothingToSync ? 'true' : undefined}
    >
      <span className="af-syncnow-panel-dot" aria-hidden />
      <div className="af-syncnow-panel-text">
        <span className="af-syncnow-panel-title">
          {nothingToSync
            ? es ? 'Aún no hay ligas' : 'No leagues yet'
            : es
              ? eligibleCount == null ? 'Tus ligas' : `Tus ${eligibleCount} liga${eligibleCount === 1 ? '' : 's'}`
              : eligibleCount == null ? 'Your leagues' : `Your ${eligibleCount} league${eligibleCount === 1 ? '' : 's'}`}
        </span>
        {nothingToSync ? (
          /*
            ⚠ THE DISABLED STATE EXPLAINS ITSELF RATHER THAN JUST DIMMING. A greyed control with no
            reason beside it reads as broken, and the person's next move is to press it repeatedly.
          */
          <span className="af-syncnow-panel-sub">
            {es ? (
              <>
                <a href="/import">Importa una liga</a> para empezar.
              </>
            ) : (
              <>
                <a href="/import">Import a league</a> to get started.
              </>
            )}
          </span>
        ) : showStatus ? (
          status
        ) : ageLine ? (
          <span className="af-syncnow-panel-sub af-num">{ageLine}</span>
        ) : null}
      </div>
      {button}
    </section>
  )
}

export default SyncNowButton
