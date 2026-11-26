'use client'

import { useState } from 'react'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { LAST_WORDS_MAX } from '@/lib/guillotine/lastWords'
import type { LastWordsState } from '@/lib/guillotine/lastWordsStore'

/**
 * Last words (lib/guillotine/lastWords.ts): a chopped manager's parting message to the league.
 *
 * This is the manager's own box, shown only to someone whose team was chopped. Everyone else reads the messages
 * where the chops already are: on the chop moment and in the Graveyard (`LastWordsQuote`). Saved through POST
 * /api/leagues/[id]/guillotine/summary, which decides who may write; this only shows what it answered.
 */
export function GuillotineLastWords({
  leagueId,
  state: initial,
  onSaved,
}: {
  leagueId: string
  state: LastWordsState | null | undefined
  onSaved?: (next: LastWordsState) => void
}) {
  const [state, setState] = useState(initial ?? null)
  const [draft, setDraft] = useState(initial?.mine?.text ?? '')
  const [editing, setEditing] = useState(!initial?.mine?.text)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const mine = state?.mine
  if (!mine) return null

  const save = async () => {
    setStatus({ kind: 'saving' })
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'last_words', text: draft }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; lastWords?: LastWordsState | null }
      if (!res.ok) {
        setStatus({ kind: 'error', message: d.error ?? 'Could not save your last words. Try again.' })
        return
      }
      if (d.lastWords) {
        setState(d.lastWords)
        setDraft(d.lastWords.mine?.text ?? '')
        onSaved?.(d.lastWords)
      }
      setEditing(false)
      setStatus({ kind: 'idle' })
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server. Try again.' })
    }
  }

  const left = LAST_WORDS_MAX - [...draft].length
  const open = mine.window === 'open'

  return (
    <section className="gl gl-card rounded-2xl border p-4 sm:p-6" data-testid="guillotine-last-words">
      <h2 className="gl-text mb-1 text-lg font-semibold">Your last words</h2>
      {mine.window === 'removed' ? (
        <p className="gl-text2 text-[13px]" data-testid="guillotine-last-words-removed">The commissioner removed your last words.</p>
      ) : open && editing ? (
        <div className="space-y-2">
          <label className="gl-text2 block text-[13px]" htmlFor="guillotine-last-words-input">
            You were chopped in week {mine.week}. Leave the league one line; it shows beside your chop.
          </label>
          <textarea
            id="guillotine-last-words-input"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setStatus({ kind: 'idle' }) }}
            rows={2}
            placeholder="I regret nothing."
            className="gl-field w-full rounded-lg border px-3 py-2 text-sm"
            data-testid="guillotine-last-words-input"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-[12px] tabular-nums ${left < 0 ? 'gl-warn' : 'gl-muted'}`} data-testid="guillotine-last-words-left">
              {left < 0 ? `${-left} over` : `${left} left`}
            </span>
            <div className="flex gap-2">
              {mine.text ? (
                <button type="button" onClick={() => { setDraft(mine.text ?? ''); setEditing(false); setStatus({ kind: 'idle' }) }} className="gl-btn-quiet min-h-[40px] rounded-lg border px-4 text-sm font-semibold">
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!draft.trim() || left < 0 || status.kind === 'saving' || draft.trim() === (mine.text ?? '')}
                className="gl-btn-primary min-h-[40px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
                data-testid="guillotine-last-words-save"
              >
                {status.kind === 'saving' ? 'Saving…' : mine.text ? 'Save change' : 'Say it'}
              </button>
            </div>
          </div>
          {status.kind === 'error' ? <p role="alert" className="gl-warn text-[13px]" data-testid="guillotine-last-words-error">{status.message}</p> : null}
        </div>
      ) : mine.text ? (
        <div className="space-y-2">
          <LastWordsQuote text={mine.text} testId="guillotine-last-words-mine" />
          {open ? (
            <button type="button" onClick={() => setEditing(true)} className="gl-btn-quiet min-h-[40px] rounded-lg border px-4 text-sm font-semibold" data-testid="guillotine-last-words-edit">
              Change it
            </button>
          ) : (
            <p className="gl-muted text-[12px]" data-testid="guillotine-last-words-closed">Another team has been chopped since, so this can no longer be changed.</p>
          )}
        </div>
      ) : (
        <p className="gl-text2 text-[13px]" data-testid="guillotine-last-words-closed">You were chopped in week {mine.week}. The time to leave last words has passed.</p>
      )}
    </section>
  )
}

/** One team's last words, as everyone reads them. Masked the way league chat masks a message. */
export function LastWordsQuote({ text, testId, className }: { text: string; testId?: string; className?: string }) {
  return (
    <blockquote className={`gl-text2 text-[13px] italic ${className ?? ''}`} data-testid={testId}>
      “{censorProfanity(text)}”
    </blockquote>
  )
}
