'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { inboxShortcutFor, readSendOutcome } from '@/lib/core-app/importVerifyGate'

/**
 * The import screen's verify step (2026-10-11), shown where the import routes answer 403
 * VERIFICATION_REQUIRED.
 *
 * ⚠ IT REPLACES A SENTENCE WITH NOTHING TO PRESS. "Verify your email or phone before importing a
 * league." was the whole response — no button, no resend, no link. Measured that day in production:
 * of 71 email-and-password sign-ups in 60 days, 38 never confirmed, and 14 of those had linked
 * Sleeper and read ~24 pages each without importing anything. Sign-ins through Google confirm
 * automatically and were 32 of 32. And people confirm in the first session or never: 24 of the 25
 * since 2026-09-26 did it within 15 minutes, while the next-day reminder emails recovered almost
 * nobody. So this is the moment that matters, and it now has a button.
 *
 * ⚠ THE SEND IS THE EXISTING ROUTE, NOT A NEW ONE: POST /api/auth/verify-email/send, the same call
 * the /verify screen makes (rate limits, cooldown and the honest 502 included). Its `returnTo` is
 * this screen, so the emailed link lands back on the import.
 *
 * ⚠ CARRYING ON IS THE CALLER'S RETRY, NOT A STATUS CHECK. Re-running the blocked step is the only
 * check that matters, and it needs no new endpoint: if the account is now verified the step
 * succeeds and this card goes away; if not, the caller shows it again. It runs on its own when the
 * person comes back to the tab, but ONLY for a read (looking up leagues, previewing one) —
 * `autoResume` is false for an import, which writes, so that one waits for a tap.
 *
 * Measured: `import_verify_shown` / `import_verify_link_sent` / `import_verify_continue` (toolKey
 * `import_verify`) through /api/analytics/track, which attaches the user.
 */

function track(event: string, meta: Record<string, string>): void {
  if (typeof window === 'undefined') return
  void fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, toolKey: 'import_verify', path: window.location?.pathname ?? null, meta }),
  }).catch(() => {})
}

/** A tab regaining focus fires `focus` and `visibilitychange` together; one retry per return. */
const RESUME_THROTTLE_MS = 4_000

type SendState = { k: 'idle' } | { k: 'sending' } | { k: 'sent' } | { k: 'wait'; message: string } | { k: 'failed'; message: string }

export function ImportVerifyGate({
  email,
  returnTo,
  step,
  autoResume,
  resuming,
  onResume,
}: {
  /** The signed-in account's address, so the card can say where the link went. */
  email: string | null
  /** Where the emailed link brings them back to: this screen, with its query. */
  returnTo: string
  /** Which step was blocked, for the analytics only. */
  step: 'discover' | 'preview' | 'commit' | 'bulk'
  /** Retry on its own when the tab comes back. Never for a step that writes. */
  autoResume: boolean
  resuming: boolean
  onResume: () => void
}) {
  const [send, setSend] = useState<SendState>({ k: 'idle' })
  /* Once a link has gone out, the card stays on "check your inbox" — a resend refused by the
     route's 60-second cooldown must not take the inbox button away. */
  const [sentOnce, setSentOnce] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastResumeRef = useRef(0)
  const inbox = inboxShortcutFor(email)

  useEffect(() => {
    track('import_verify_shown', { step })
    // The import's error panel scrolls into view for the same reason: the row that was pressed can
    // be thousands of pixels below this card.
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    // Once per mount: re-opening for the same step after a failed retry is the same view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resume = useCallback(
    (trigger: 'tap' | 'focus' | 'already_verified') => {
      const now = Date.now()
      if (trigger === 'focus' && now - lastResumeRef.current < RESUME_THROTTLE_MS) return
      lastResumeRef.current = now
      track('import_verify_continue', { step, trigger })
      onResume()
    },
    [onResume, step]
  )

  useEffect(() => {
    if (!autoResume || !sentOnce) return
    const onBack = () => {
      if (document.visibilityState === 'visible') resume('focus')
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [autoResume, sentOnce, resume])

  const sendLink = async () => {
    setSend({ k: 'sending' })
    let outcome: ReturnType<typeof readSendOutcome>
    try {
      const res = await fetch('/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo }),
      })
      const body = await res.json().catch(() => null)
      outcome = readSendOutcome(res.status, body)
    } catch {
      outcome = { k: 'failed', message: 'We couldn’t reach the server. Check your connection and try again.' }
    }
    if (outcome.k === 'already_verified') {
      setSend({ k: 'idle' })
      resume('already_verified')
      return
    }
    if (outcome.k === 'sent') {
      setSentOnce(true)
      track('import_verify_link_sent', { step })
    }
    setSend(outcome)
  }

  const phoneHref = `/verify?error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`
  const where = email ? <strong className="af-im-verify-email">{email}</strong> : 'your email'

  return (
    <div className="af-im-verify" ref={rootRef} role="region" aria-label="Confirm your email" data-testid="import-verify-gate">
      <p className="af-im-verify-title">Confirm your email to bring your leagues in</p>
      {sentOnce ? (
        <p className="af-im-verify-body" role="status">
          Sent to {where}. Tap the link in that email, then come back here — your import picks up where you
          left off. Not there? Check Spam or Promotions.
        </p>
      ) : (
        <p className="af-im-verify-body">
          One quick step: we just need to know {where} is yours. We’ll email you a link — it takes about a
          minute.
        </p>
      )}
      {send.k === 'wait' || send.k === 'failed' ? (
        <p className="af-im-verify-note" role="alert">
          {send.message}
        </p>
      ) : null}

      <div className="af-im-verify-actions">
        {sentOnce ? (
          <>
            {inbox ? (
              <a className="af-btn af-im-verify-primary" href={inbox.href} target="_blank" rel="noopener noreferrer">
                {inbox.label}
              </a>
            ) : null}
            <button
              type="button"
              className={inbox ? 'af-btn af-btn--ghost' : 'af-btn af-im-verify-primary'}
              disabled={resuming}
              onClick={() => resume('tap')}
            >
              {resuming ? 'Checking…' : 'I’ve confirmed — continue'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="af-btn af-im-verify-primary"
            disabled={send.k === 'sending'}
            onClick={() => void sendLink()}
          >
            {send.k === 'sending' ? 'Sending…' : 'Email me the link'}
          </button>
        )}
      </div>

      <p className="af-im-verify-foot">
        {sentOnce ? (
          <>
            <button
              type="button"
              className="af-im-verify-link"
              disabled={send.k === 'sending'}
              onClick={() => void sendLink()}
            >
              {send.k === 'sending' ? 'Sending…' : 'Send it again'}
            </button>
            {' · '}
          </>
        ) : (
          <>
            <button type="button" className="af-im-verify-link" disabled={resuming} onClick={() => resume('tap')}>
              Already confirmed? Continue
            </button>
            {' · '}
          </>
        )}
        <a className="af-im-verify-link" href={phoneHref}>
          Use your phone instead
        </a>
      </p>
    </div>
  )
}

export default ImportVerifyGate
