'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Flag, X } from 'lucide-react'
import LeaguePickerRow, { type PickerLeague } from '@/components/commish/LeaguePickerRow'

/**
 * 10b — "Send to @everyone". Commissioner-only broadcast to the chats of the leagues they pick.
 *
 * Mounts over the league-chat dock (the chat bubble), not a standalone /chat page — that page does
 * not exist, and league chat surfaces in the dock.
 *
 * ⚠ MESSAGE LIMIT IS 500, NOT THE HANDOFF'S 2000. `POST /api/commissioner/broadcast` rejects
 * anything longer with "Message too long". A counter that invites 2000 characters and then fails
 * the send is a control that lies, so the UI binds to the limit the server actually enforces.
 * Raising it is a one-line server change — but it has to happen there FIRST, not here.
 *
 * ⚠ THE SEND IS PER-LEAGUE AND PARTIAL FAILURE IS REAL. The endpoint re-checks commissioner rights
 * on every league id and returns `results: [{ leagueId, sent, error }]`, so some can succeed while
 * others are refused. This reports what actually happened per league instead of a blanket "sent".
 */

const MESSAGE_LIMIT = 500

type SendResult = { leagueId: string; sent: boolean; error?: string }

export default function BroadcastModal({
  open,
  onClose,
  /** Pre-check the league the commissioner opened the composer from. */
  defaultLeagueId,
}: {
  open: boolean
  onClose: () => void
  defaultLeagueId?: string
}) {
  const [leagues, setLeagues] = useState<PickerLeague[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<SendResult[] | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setResults(null)
    fetch('/api/commissioner/leagues')
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        const list: PickerLeague[] = Array.isArray(data?.leagues) ? data.leagues : []
        setLeagues(list)
        // Only ever pre-select a league that can actually receive a broadcast.
        const seed = list.find((l) => l.id === defaultLeagueId && l.isNative)
        setSelected(new Set(seed ? [seed.id] : []))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your leagues.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, defaultLeagueId])

  // Escape closes, matching every other dismissible surface in the product.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const nativeCount = useMemo(() => leagues.filter((l) => l.isNative).length, [leagues])

  /*
   * Handoff build rule 2: the recipient line recomputes from the checked rows. Never a static
   * "notify everyone" — the number is the whole point of the confirmation.
   */
  const recipients = useMemo(
    () =>
      leagues
        .filter((l) => selected.has(l.id))
        .reduce((n, l) => n + l.memberCount, 0),
    [leagues, selected],
  )

  const canSend = selected.size > 0 && message.trim().length > 0 && !sending

  const send = useCallback(async () => {
    if (!canSend) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/commissioner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds: [...selected], message: message.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Send failed')
      const list: SendResult[] = Array.isArray(data?.results) ? data.results : []
      setResults(list)
      if (list.length > 0 && list.every((r) => r.sent)) {
        setMessage('')
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [canSend, selected, message, onClose])

  if (!open) return null

  const failed = results?.filter((r) => !r.sent) ?? []

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send to everyone"
      data-testid="broadcast-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-[696px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1228] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-400/60 text-amber-400">
            <Flag className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-black tracking-[-0.02em] text-white">Send to @everyone</h2>
            <p className="mt-1 text-sm text-white/60">
              Every member of the leagues you pick gets a notification. You commission{' '}
              {nativeCount} AllFantasy-hosted {nativeCount === 1 ? 'league' : 'leagues'}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Send to */}
        <h3 className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Send to
        </h3>
        <div className="mt-2 space-y-2">
          {loading ? <p className="py-6 text-center text-sm text-white/50">Loading your leagues…</p> : null}
          {!loading && leagues.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/50">
              You don&apos;t commission any leagues yet.
            </p>
          ) : null}
          {leagues.map((l) => (
            <LeaguePickerRow
              key={l.id}
              league={l}
              checked={selected.has(l.id)}
              onToggle={toggle}
            />
          ))}
        </div>

        {/* Announcement */}
        <h3 className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          Announcement
        </h3>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_LIMIT))}
          rows={4}
          maxLength={MESSAGE_LIMIT}
          aria-label="Announcement"
          data-testid="broadcast-message"
          placeholder="What does everyone need to know?"
          className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/60 focus:outline-none focus:ring-[3px] focus:ring-cyan-400/15"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {/* Handoff build rule 4: the counter is always visible, not only near the limit. */}
          <span className="font-mono text-xs text-white/40" data-testid="broadcast-counter">
            {message.length} / {MESSAGE_LIMIT}
          </span>
          <span className="text-xs text-white/45">
            Posts in each league&apos;s chat as a commissioner notice.
          </span>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        {failed.length > 0 ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Sent to {(results?.length ?? 0) - failed.length} of {results?.length}. Refused for{' '}
            {failed.length} {failed.length === 1 ? 'league' : 'leagues'} — you may no longer
            commission {failed.length === 1 ? 'it' : 'them'}.
          </p>
        ) : null}

        {/* Footer */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold text-white/70" data-testid="broadcast-recipients">
            {recipients} {recipients === 1 ? 'person' : 'people'} will be notified across{' '}
            {selected.size} {selected.size === 1 ? 'league' : 'leagues'}.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 hover:bg-white/5"
            >
              Cancel
            </button>
            {/*
             * The only strongly-coloured control in the modal (handoff rule 3). Broadcast is
             * high-stakes and one-way, so the send must not read like just another selection.
             */}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              data-testid="broadcast-send"
              className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-[#231a02] transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send @everyone'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
