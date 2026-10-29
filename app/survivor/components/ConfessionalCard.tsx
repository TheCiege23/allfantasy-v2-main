'use client'

import { useCallback, useEffect, useState } from 'react'

const MAX = 280
type Confessional = { id: string; text: string; createdAt: string }

/**
 * Record a confessional: a private note to camera. Only the author sees it while they play. It is
 * quoted in the episode that sends them home, and every confessional is revealed after the finale.
 */
export function ConfessionalCard({ leagueId }: { leagueId: string }) {
  const [mine, setMine] = useState<Confessional[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/confessionals?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      if (res.ok) setMine(((await res.json()) as { mine?: Confessional[] }).mine ?? [])
    } catch { /* the card still records */ }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/survivor/confessionals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, text }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Your confessional was not saved.')
      setText('')
      setMessage({ tone: 'ok', text: 'Recorded. Only you can see it for now.' })
      await load()
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Your confessional was not saved.' })
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" data-testid="confessional-card">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-amber-100">Confessional</h2>
      <p className="mt-1 text-[12px] text-white/60">
        Say what you really think. Nobody sees it while you play. If you&apos;re voted out, Chimmy quotes your latest one in that week&apos;s episode, and every confessional is revealed after the finale.
      </p>
      <textarea aria-label="Your confessional" value={text} onChange={event => setText(event.target.value.slice(0, MAX))} rows={3}
        placeholder="I trust my tribe… for now." className="mt-3 w-full rounded-lg border border-white/15 bg-black/30 p-3 text-[13px] text-white" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/45">{text.length} / {MAX}</span>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void save()} className="min-h-[44px] rounded-lg bg-amber-400 px-4 text-[13px] font-semibold text-black disabled:opacity-40">
          {busy ? 'Saving…' : 'Record'}
        </button>
      </div>
      {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-[12px] ${message.tone === 'error' ? 'text-red-200' : 'text-emerald-200'}`}>{message.text}</p> : null}
      {mine.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-white/70">Your confessionals ({mine.length})</summary>
          <ul className="mt-2 space-y-2">
            {mine.map(row => (
              <li key={row.id} className="rounded-lg border border-white/10 bg-black/20 p-2 text-[12px] text-white/75">
                <time className="block text-[11px] text-white/40" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                {row.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
