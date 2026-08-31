'use client'

import { useMemo, useState } from 'react'
import type { StandingsBoard } from '@/lib/tournament/standingsBoard'

/**
 * Send one message to a slice of the tournament.
 *
 * 🛑 THE RESULT IS TWO NUMBERS, NEVER ONE. In an imported tournament most
 * managers have no AllFantasy account, so "sent" on its own would tell a
 * commissioner 240 people were reached when 30 were — and they would stop
 * chasing it. Delivered and still-to-post are both shown, and the paste blocks
 * for the second group come back with the response.
 */

type PasteBlock = { leagueName: string; text: string; handleCount: number }

type SendResult = {
  audienceLabel: string
  selectedCount: number
  deliveredCount: number
  unreachableCount: number
  pasteBlocks: PasteBlock[]
  scheduledFor: string | null
}

/**
 * Starting points, not a fixed vocabulary — the commissioner edits before
 * sending, and the send takes whatever is in the box.
 */
const TEMPLATES: Array<{ label: string; audience: string; title: string; body: string }> = [
  {
    label: 'Redraft is open',
    audience: 'standing:in',
    title: 'You advanced — redraft is open',
    body: 'You made the cut. The redraft happens this week — watch for your new league and draft time.',
  },
  {
    label: 'Season over',
    audience: 'standing:out',
    title: 'Your run ends here',
    body: 'That is the end of the road this year. Thanks for playing — final standings are posted.',
  },
  {
    label: 'Bubble warning',
    audience: 'standing:bubble',
    title: 'You are on the bubble',
    body: 'You are one spot outside the cut with a week to go. Set your best lineup.',
  },
  {
    label: 'Draft reminder',
    audience: 'all',
    title: 'Draft reminder',
    body: 'Drafts are underway. Check your league and make your picks before the clock runs out.',
  },
]

function CopyBlock({ block }: { block: PasteBlock }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="af-th-paste">
      <div className="af-th-paste-head">
        <strong>{block.leagueName}</strong>
        <span className="af-th-linknote">{block.handleCount} to post by hand</span>
        <button
          type="button"
          className="af-th-linkbtn"
          onClick={async () => {
            try {
              if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
              await navigator.clipboard.writeText(block.text)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 2400)
            } catch {
              /* The textarea below is the fallback — it is always selectable. */
            }
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {/* readOnly, not disabled: a disabled textarea cannot be selected, which
          removes the manual fallback exactly when the clipboard API failed. */}
      <textarea className="af-th-pastebox" readOnly rows={3} value={block.text} />
    </div>
  )
}

export function BroadcastPanel({ board }: { board: StandingsBoard }) {
  const [audience, setAudience] = useState('all')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)

  const options = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [
      { value: 'all', label: 'Everyone in the tournament' },
      { value: 'standing:in', label: 'Managers currently advancing' },
      { value: 'standing:bubble', label: 'Managers on the bubble' },
      { value: 'standing:out', label: 'Managers currently eliminated' },
    ]
    for (const c of board.conferences) {
      out.push({ value: `conference:${c.id}`, label: `Conference — ${c.name}` })
    }
    for (const c of board.conferences) {
      for (const l of c.leagues) {
        out.push({ value: `league:${l.tournamentLeagueId}`, label: `League — ${l.name}` })
      }
    }
    if (board.unmatchedTotal > 0) {
      out.push({ value: 'unlinked', label: `Managers not yet linked (${board.unmatchedTotal})` })
    }
    return out
  }, [board])

  async function send() {
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(board.tournamentId)}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience,
          title,
          message,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        }),
      })
      const body = (await res.json()) as SendResult & { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not send that message')
      setResult(body)
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that message')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">Send a message</h2>

      <div className="af-th-fields">
        <label className="af-th-field">
          <span>Who</span>
          <select
            className="af-th-input"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="af-th-field">
          <span>Subject</span>
          <input
            className="af-th-input"
            value={title}
            placeholder="Tournament update"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="af-th-field">
          <span>Send later (optional)</span>
          <input
            className="af-th-input"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
        </label>
      </div>

      <div className="af-th-templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            className="af-th-linkbtn"
            onClick={() => {
              setAudience(t.audience)
              setTitle(t.title)
              setMessage(t.body)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        className="af-th-pastebox"
        rows={4}
        value={message}
        placeholder="Write your message, or start from a template above."
        onChange={(e) => setMessage(e.target.value)}
      />

      <div className="af-th-actions">
        <button
          type="button"
          className="af-th-copy"
          disabled={!message.trim() || sending}
          onClick={send}
        >
          {sending ? 'Sending…' : scheduledFor ? 'Schedule' : 'Send'}
        </button>
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="af-th-result">
          <p className="af-th-note">
            {result.scheduledFor ? (
              <>
                Scheduled for {new Date(result.scheduledFor).toLocaleString()} to{' '}
                {result.audienceLabel} — {result.selectedCount} managers.{' '}
                {/* ⚠ Said plainly: the row is stored, and nothing posts it yet. */}
                <strong>Nothing sends automatically yet</strong> — the scheduled message is saved,
                but it needs posting by hand until the scheduler is wired up.
              </>
            ) : (
              <>
                Sent to {result.audienceLabel} — {result.selectedCount} managers selected,{' '}
                <strong>{result.deliveredCount} notified in AllFantasy</strong>,{' '}
                {result.unreachableCount} have no account here.
              </>
            )}
          </p>

          {result.pasteBlocks.length > 0 ? (
            <>
              <p className="af-th-note">
                Paste these into each league&apos;s chat on the host platform — AllFantasy cannot
                post there.
              </p>
              {result.pasteBlocks.map((b) => (
                <CopyBlock key={b.leagueName} block={b} />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
