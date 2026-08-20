'use client'

/**
 * 11d — universal messaging: one message, every league you run.
 *
 * ⚠ SCOPE LIVES IN THE LABEL, NEVER BEHIND A CLICK. Build rule 3. "Broadcast to
 * @everyone" with the league count hidden until a confirmation dialog is exactly
 * how a commissioner messages three leagues intending to message one. The count
 * is rendered in the row itself and it is the real number of AF-hosted leagues
 * this user commissions, not a placeholder.
 *
 * ⚠ TWO OF THE HANDOFF'S THREE ACTIONS ARE DISABLED, ON PURPOSE, AND SAY WHY.
 * The design shows "Schedule for Sunday 9a" and "Send only to inactive
 * managers". Neither capability exists: `POST /api/commissioner/broadcast` takes
 * `{ leagueIds, message }` and sends immediately to every member of each league
 * — there is no scheduled-send store and no per-member targeting on any
 * commissioner endpoint in this repo. Rendering them as live buttons would let a
 * commissioner believe a reminder is queued for Sunday when nothing is queued at
 * all, which is a worse failure than an honestly greyed row. The inactive count
 * is still shown, because the number is real even when the send path is not.
 *
 * ⚠ THIS IS AN ENTRY POINT, NOT A SECOND SEND IMPLEMENTATION. Same rule 11a's
 * "Send @everyone" follows: the composer and permission check belong to the
 * broadcast flow, and duplicating them here is how two send paths drift apart.
 */

import { useState } from 'react'
import { toast } from 'sonner'

export type MessagingScope = {
  /** AF-hosted leagues this user commissions — the real broadcast blast radius. */
  leagueIds: string[]
  /** Managers across those leagues currently flagged inactive. Display-only; see the header note. */
  inactiveManagerCount: number | null
}

const TEMPLATES: { label: string; body: string }[] = [
  { label: 'Weekly recap', body: 'Weekly recap is up — check the standings and get your lineup in before Sunday.' },
  { label: 'Deadline reminder', body: 'Reminder: the trade deadline is coming up. Get your deals done.' },
  { label: 'Set your lineup', body: 'Lineups lock at kickoff. Make sure yours is set — a few of you are still empty.' },
  { label: 'Dues', body: 'Friendly nudge on league dues — please settle up when you get a minute.' },
]

export function UniversalMessaging({ scope }: { scope: MessagingScope }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)

  const leagueCount = scope.leagueIds.length

  const send = async () => {
    const message = draft.trim()
    if (!message) {
      toast.error('Write a message first.')
      return
    }
    if (leagueCount === 0) return
    setSending(true)
    try {
      const res = await fetch('/api/commissioner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds: scope.leagueIds, message }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        results?: { leagueId: string; sent: boolean }[]
      }
      if (!res.ok) throw new Error(json.error ?? 'Broadcast failed')
      /*
       * The API reports per-league success and a partial failure is real (a
       * league where the commissioner check fails is skipped, not fatal). Report
       * what actually happened rather than a blanket "Sent".
       */
      const sent = (json.results ?? []).filter((r) => r.sent).length
      const total = json.results?.length ?? leagueCount
      toast.success(
        sent === total
          ? `Sent to @everyone in ${sent} league${sent === 1 ? '' : 's'}.`
          : `Sent to ${sent} of ${total} leagues — the rest were skipped.`,
      )
      setDraft('')
      setComposing(false)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Broadcast failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="af-card" style={{ padding: 16 }} data-testid="universal-messaging">
      <p className="af-cm-msg-lead">One message, every league you run.</p>

      <div className="af-cm-msg-actions">
        <button
          type="button"
          className="af-cm-msg-action"
          disabled={leagueCount === 0 || sending}
          onClick={() => setComposing((v) => !v)}
        >
          <span className="af-cm-msg-action-icon" aria-hidden>
            ⚑
          </span>
          <span>Broadcast to @everyone</span>
          <span className="af-cm-msg-scope af-num">
            {leagueCount} league{leagueCount === 1 ? '' : 's'}
          </span>
        </button>

        {composing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <textarea
              className="af-cm-numinput"
              style={{ width: '100%', minHeight: 88, textAlign: 'left', padding: 11, fontSize: 14, fontWeight: 400 }}
              maxLength={500}
              value={draft}
              placeholder={`This goes to every member of all ${leagueCount} league${leagueCount === 1 ? '' : 's'}.`}
              aria-label="Broadcast message"
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="af-cm-templates">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" className="af-cm-template" onClick={() => setDraft(t.body)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <button type="button" className="af-btn" disabled={sending || !draft.trim()} onClick={() => void send()}>
                {sending ? 'Sending…' : `Send to ${leagueCount} league${leagueCount === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="af-btn af-btn--ghost" disabled={sending} onClick={() => setComposing(false)}>
                Cancel
              </button>
              <span className="af-cm-msg-scope af-num">{draft.trim().length} / 500</span>
            </div>
          </div>
        ) : null}

        {/* Disabled and explained. See the header note — do not "enable" these without a send path. */}
        <button
          type="button"
          className="af-cm-msg-action"
          disabled
          title="Scheduled sends are not built yet — this broadcast endpoint delivers immediately."
        >
          <span className="af-cm-msg-action-icon" aria-hidden>
            ◷
          </span>
          <span>Schedule for later</span>
          <span className="af-cm-msg-scope af-num">Not yet</span>
        </button>

        <button
          type="button"
          className="af-cm-msg-action"
          disabled
          title="Broadcasts go to every member of a league. Messaging a subset of managers is not supported by any commissioner endpoint yet."
        >
          <span className="af-cm-msg-action-icon" aria-hidden>
            ●
          </span>
          <span>Send only to inactive managers</span>
          <span className="af-cm-msg-scope af-num">
            {scope.inactiveManagerCount != null ? scope.inactiveManagerCount : '—'}
          </span>
        </button>
      </div>
    </div>
  )
}

export default UniversalMessaging
