'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SUPPORT_WIDGET_TOOL } from '@/lib/support/support-widget'
import '@/components/core-app/af-support.css'

/**
 * 25b — contact support.
 *
 * ⚠ ONE COMPONENT, FOUR STATES — NOT FOUR SCREENS. The handoff draws the base
 * form, the diagnostics disclosure, the confirmation and the error/retry as
 * separate frames because that is how a mock shows states. They are one modal
 * with a state machine; four components would be four places for the disclosure
 * to go missing from.
 *
 * ⚠ DIAGNOSTIC CONTEXT IS SHOWN BEFORE IT IS SENT, AND CAN BE REMOVED. This is
 * the whole point of the design: no silent telemetry. Everything in
 * `diagnostics` below is rendered as an itemised, individually removable list,
 * and only the rows still ticked are transmitted. A support form that quietly
 * attaches your session is a support form that harvests.
 *
 * ⚠ CATEGORY CHANGES WHAT IS ASKED NEXT. "Wrong data" needs to know which
 * league; "Something's broken" needs reproduction steps; "Billing" needs
 * neither. A single generic textarea for five different problems is how support
 * tickets arrive unactionable — see `FOLLOW_UP`.
 *
 * ⚠ NO NEW API ROUTE. Posts to `/api/legacy/feedback`, which already accepts
 * `feedbackType`, `tool`, `feedbackText`, `stepsToReproduce`, `pageUrl`,
 * `browser` and `email`. The repo sits at Vercel's hard 2048-route ceiling and a
 * contact form is not worth a route. The server resolves recipients from
 * SUPPORT_NOTIFICATION_EMAILS — no address appears in this file, its markup, or
 * its payload.
 */

export type SupportCategory = 'broken' | 'wrong_data' | 'billing' | 'idea' | 'praise'

const CATEGORIES: Array<{ id: SupportCategory; label: string }> = [
  { id: 'broken', label: "Something's broken" },
  { id: 'wrong_data', label: 'Wrong data' },
  { id: 'billing', label: 'Billing' },
  { id: 'idea', label: 'Idea' },
  { id: 'praise', label: 'Praise' },
]

/**
 * What each category needs beyond the message.
 *
 * `league` and `steps` are the two that materially change whether a report can
 * be acted on; the other three genuinely need nothing extra, and asking anyway
 * is friction for its own sake.
 */
const FOLLOW_UP: Record<SupportCategory, { league: boolean; steps: boolean; hint: string }> = {
  broken: {
    league: false,
    steps: true,
    hint: 'What were you doing when it broke? Even one line helps more than a screenshot.',
  },
  wrong_data: {
    league: true,
    steps: false,
    hint: 'Which league, and what should the number have been? We can check it against the source.',
  },
  billing: {
    league: false,
    steps: false,
    hint: 'Never include card numbers here. We can find your account from your email.',
  },
  idea: { league: false, steps: false, hint: 'What would you do with it once it existed?' },
  praise: { league: false, steps: false, hint: 'Genuinely, thank you — we read all of these.' },
}

export type SupportModalProps = {
  open: boolean
  onClose: () => void
  /** Prefilled from the session. Editable — a user may want replies elsewhere. */
  defaultEmail?: string | null
  /** Leagues to choose from when the category needs one. */
  leagues?: Array<{ id: string; name: string }>
  /** The league the current page is about, preselected. */
  pageLeagueId?: string | null
}

type DiagnosticRow = { id: string; label: string; value: string }

export function SupportModal({
  open,
  onClose,
  defaultEmail,
  leagues = [],
  pageLeagueId = null,
}: SupportModalProps) {
  const [category, setCategory] = useState<SupportCategory>('broken')
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [message, setMessage] = useState('')
  const [steps, setSteps] = useState('')
  const [leagueId, setLeagueId] = useState<string | null>(pageLeagueId)
  const [status, setStatus] = useState<'form' | 'sending' | 'sent' | 'error'>('form')
  const [error, setError] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setLeagueId(pageLeagueId)
  }, [open, pageLeagueId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /*
   * Everything we would attach, itemised. Read at render rather than at submit
   * so the list the user approves is the list that goes — a diagnostics block
   * computed at send time could differ from the one they were shown.
   */
  const diagnostics: DiagnosticRow[] = useMemo(() => {
    if (typeof window === 'undefined') return []
    const league = leagues.find((l) => l.id === leagueId)
    const rows: DiagnosticRow[] = [
      { id: 'page', label: 'Page you were on', value: window.location.pathname },
      {
        id: 'browser',
        label: 'Browser',
        // Trimmed to the family. A full UA string is a fingerprint, and the
        // family is what a triage actually reads.
        value: /Firefox\//.test(navigator.userAgent)
          ? 'Firefox'
          : /Edg\//.test(navigator.userAgent)
            ? 'Edge'
            : /Chrome\//.test(navigator.userAgent)
              ? 'Chrome'
              : /Safari\//.test(navigator.userAgent)
                ? 'Safari'
                : 'Other',
      },
      {
        id: 'viewport',
        label: 'Window size',
        value: `${window.innerWidth}×${window.innerHeight}`,
      },
    ]
    if (league) rows.push({ id: 'league', label: 'League in context', value: league.name })
    return rows
  }, [leagueId, leagues])

  const included = diagnostics.filter((d) => !excluded.has(d.id))
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const needs = FOLLOW_UP[category]
  const canSubmit =
    emailValid &&
    message.trim().length > 0 &&
    (!needs.league || leagueId != null || leagues.length === 0) &&
    status !== 'sending'

  const submit = useCallback(async () => {
    setStatus('sending')
    setError(null)
    try {
      const browser = included.find((d) => d.id === 'browser')?.value ?? null
      /*
       * Only the rows still ticked. `feedbackText` carries the message plus the
       * approved context — the schema has no structured diagnostics field, and
       * inventing one server-side would mean a migration for a support form.
       */
      const contextLines = included
        .filter((d) => d.id !== 'browser')
        .map((d) => `${d.label}: ${d.value}`)
      const feedbackText = contextLines.length
        ? `${message.trim()}\n\n---\nContext the reporter approved:\n${contextLines.join('\n')}`
        : message.trim()

      const res = await fetch('/api/legacy/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackType: category,
          tool: SUPPORT_WIDGET_TOOL,
          feedbackText,
          stepsToReproduce: needs.steps && steps.trim() ? steps.trim().slice(0, 2000) : null,
          pageUrl: included.some((d) => d.id === 'page')
            ? window.location.href.slice(0, 500)
            : null,
          browser,
          email: email.trim(),
          canContact: true,
        }),
      })
      if (!res.ok) throw new Error(`Support returned ${res.status}`)
      setStatus('sent')
    } catch (e) {
      setStatus('error')
      setError(
        e instanceof Error
          ? `We could not send that (${e.message}). Nothing was lost — your message is still in the box.`
          : 'We could not send that. Nothing was lost — your message is still in the box.',
      )
    }
  }, [category, email, included, message, needs.steps, steps])

  if (!open) return null

  return (
    <>
      <button type="button" className="af-sp-scrim" aria-label="Close support" onClick={onClose} />
      <div className="af-sp" role="dialog" aria-modal="true" aria-label="Contact support">
        <header className="af-sp-head">
          <h2 className="af-sp-title">
            {status === 'sent' ? 'Sent' : status === 'error' ? "That didn't send" : 'Tell us what happened'}
          </h2>
          <button type="button" className="af-sp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {status === 'sent' ? (
          /* ── Confirmed ─────────────────────────────────────────── */
          <div className="af-sp-body">
            <p className="af-sp-confirm">
              A person will read this. If you asked something we can answer, the reply goes to{' '}
              <b>{email.trim()}</b>.
            </p>
            <p className="af-sp-note">
              We sent exactly what you saw above — the message, and the{' '}
              {included.length === 0 ? 'no' : included.length} context{' '}
              {included.length === 1 ? 'item' : 'items'} you left ticked. Nothing else.
            </p>
            <div className="af-sp-actions">
              <button type="button" className="af-sp-btn af-sp-btn--primary" onClick={onClose}>
                Done
              </button>
              <button
                type="button"
                className="af-sp-btn"
                onClick={() => {
                  setStatus('form')
                  setMessage('')
                  setSteps('')
                }}
              >
                Send another
              </button>
            </div>
          </div>
        ) : (
          <form
            className="af-sp-body"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) void submit()
            }}
          >
            {/* Category — drives what is asked next. */}
            <div className="af-sp-field">
              <span className="af-sp-label">What kind of thing is it?</span>
              <div className="af-sp-chips">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="af-sp-chip"
                    data-on={c.id === category}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="af-sp-hint">{needs.hint}</p>
            </div>

            {/* Category-specific follow-up. */}
            {needs.league && leagues.length > 0 ? (
              <div className="af-sp-field">
                <label className="af-sp-label" htmlFor="af-sp-league">
                  Which league?
                </label>
                <select
                  id="af-sp-league"
                  className="af-sp-select"
                  value={leagueId ?? ''}
                  onChange={(e) => setLeagueId(e.target.value || null)}
                >
                  <option value="">Pick a league…</option>
                  {leagues.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="af-sp-field">
              <label className="af-sp-label" htmlFor="af-sp-message">
                What happened?
              </label>
              <textarea
                id="af-sp-message"
                className="af-sp-textarea"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Plain language is fine."
              />
            </div>

            {needs.steps ? (
              <div className="af-sp-field">
                <label className="af-sp-label" htmlFor="af-sp-steps">
                  What were you doing? <i>(optional)</i>
                </label>
                <textarea
                  id="af-sp-steps"
                  className="af-sp-textarea"
                  rows={2}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  placeholder="1. Opened my team  2. Clicked the flex slot  3. …"
                />
              </div>
            ) : null}

            <div className="af-sp-field">
              <label className="af-sp-label" htmlFor="af-sp-email">
                Where should we reply?
              </label>
              <input
                id="af-sp-email"
                className="af-sp-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {/*
              The diagnostics disclosure. Shown, itemised, removable — the
              handoff's central requirement, and the reason this modal exists
              rather than a one-field widget.
            */}
            <div className="af-sp-diag">
              <p className="af-sp-diag-t">What we&apos;ll attach</p>
              <p className="af-sp-diag-b">
                This is everything. Untick anything you would rather not send — nothing is
                collected in the background.
              </p>
              <ul className="af-sp-diag-list">
                {diagnostics.map((d) => (
                  <li key={d.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!excluded.has(d.id)}
                        onChange={(e) =>
                          setExcluded((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.delete(d.id)
                            else next.add(d.id)
                            return next
                          })
                        }
                      />
                      <span className="af-sp-diag-label">{d.label}</span>
                      <span className="af-sp-diag-value">{d.value}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {status === 'error' && error ? <p className="af-sp-error">{error}</p> : null}

            <div className="af-sp-actions">
              <button type="submit" className="af-sp-btn af-sp-btn--primary" disabled={!canSubmit}>
                {status === 'sending' ? 'Sending…' : status === 'error' ? 'Try again' : 'Send it'}
              </button>
              <button type="button" className="af-sp-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

export default SupportModal
