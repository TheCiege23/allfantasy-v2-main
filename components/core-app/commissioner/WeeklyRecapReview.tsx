'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import { RECAP_TEXT_MAX, type RecapDraft, type RecapReviewSettings } from '@/lib/recap-review/recapReview'

/**
 * Weekly recap review card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 6), on the Commissioner Hub.
 * Auto keeps today's behaviour; Review holds Tuesday's recap here for the commissioner to edit and post.
 */

type View = { review: RecapReviewSettings; chimmySpeaksUp: boolean; draft: RecapDraft | null }

type M = typeof commissionerScreensMessages.en

const ERRORS: Record<string, (m: M) => string> = {
  chimmy_quiet: (m) => m.recapErrChimmyQuiet,
  already_posted: (m) => m.recapErrAlreadyPosted,
  not_pending: (m) => m.recapErrNotPending,
  text_required: (m) => m.recapErrTextRequired,
}

export function WeeklyRecapReview({ leagueId }: { leagueId: string }) {
  const m = useMessages(commissionerScreensMessages)
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/weekly-recap`

  const [view, setView] = useState<View | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Never rejects: a failed read is a message on the card, not an unhandled error on the hub.
    try {
      const res = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as View | { error?: string } | null
      if (!res.ok || !body || !('review' in body)) return setMessage((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      setView(body)
      setText(body.draft ? (body.draft.editedText ?? body.draft.generatedText) : '')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  async function call(method: 'PUT' | 'POST', payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        const known = body?.error ? ERRORS[body.error] : undefined
        setMessage(known ? known(m) : body?.error ?? `HTTP ${res.status}`)
        return
      }
      setMessage(done)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!view) return <p className="af-ch-muted">{message ?? m.commonLoading}</p>
  const { review, draft } = view
  const at = draft ? { season: draft.season, week: draft.week } : null

  return (
    <div className="af-ch-recipes" data-testid="weekly-recap-review">
      <ul className="af-ch-recipe-list">
        <li data-on={review.mode === 'review'}>
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">{m.recapTitle}</p>
            <p className="af-ch-recipe-desc">
              {m.recapDesc}
            </p>
            {review.mode === 'review' && (
              <label className="af-ch-recipe-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={review.autoPostIfUntouched}
                  disabled={busy}
                  onChange={(e) => call('PUT', { mode: 'review', autoPostIfUntouched: e.target.checked }, m.recapSaved)}
                />
                {m.recapAutoPost}
              </label>
            )}
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={review.mode === 'review'}
              disabled={busy}
              aria-label={m.recapTitle}
              onChange={(e) =>
                call('PUT', { mode: e.target.checked ? 'review' : 'auto', autoPostIfUntouched: review.autoPostIfUntouched }, e.target.checked ? m.recapWillWait : m.recapAutoAgain)
              }
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>
      </ul>

      {!view.chimmySpeaksUp && (
        <p className="af-ch-recipes-banner">{m.recapChimmyOff}</p>
      )}

      {draft && at ? (
        <div style={{ marginTop: 12 }}>
          <p className="af-ch-recipe-label">{m.recapWaiting(draft.week)}</p>
          <textarea
            className="w-full rounded-lg bg-black/30 p-2 text-sm"
            style={{ marginTop: 8, minHeight: 220, fontFamily: 'inherit' }}
            maxLength={RECAP_TEXT_MAX}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="af-btn" disabled={busy || !text.trim()} onClick={() => call('POST', { action: 'post', ...at, text }, m.recapPosted)}>
              {m.recapPost}
            </button>
            <button type="button" className="af-btn" disabled={busy || !text.trim()} onClick={() => call('POST', { action: 'save', ...at, text }, m.recapEditSaved)}>
              {m.recapSaveEdit}
            </button>
            <button type="button" className="af-btn" disabled={busy} onClick={() => setText(draft.generatedText)}>
              {m.recapReset}
            </button>
            <button type="button" className="af-btn" disabled={busy} onClick={() => call('POST', { action: 'discard', ...at }, m.recapDiscarded)}>
              {m.recapSkip}
            </button>
          </div>
        </div>
      ) : review.mode === 'review' ? (
        <p className="af-ch-recipe-desc" style={{ marginTop: 8 }}>{m.recapNoneWaiting}</p>
      ) : null}

      {message && <p role="status" className="af-ch-recipe-error">{message}</p>}
    </div>
  )
}
