'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NativeUndoPreview } from '@/lib/league/undoNativeConversion'

/**
 * "Undo the switch to AllFantasy", for the head commissioner of a league that switched in place
 * (lib/league/undoNativeConversion.ts, plan §8). Shown while undo is open — until the league's first season on
 * AllFantasy starts — and nothing otherwise: a closed undo is not something the commissioner can act on.
 *
 * Two steps on purpose. The first shows exactly what undo throws away (the route's preview); the second sends that
 * list's token back, so if a trade or a claim lands in between the commissioner is shown the new list instead.
 */

type Open = Extract<NativeUndoPreview, { status: 'open' }>

const PROVIDERS: Record<string, string> = { sleeper: 'Sleeper', espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MyFantasyLeague', fantrax: 'Fantrax', fleaflicker: 'Fleaflicker' }
const providerLabel = (platform: string) => PROVIDERS[platform.toLowerCase()] ?? platform

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function NativeUndoView({ preview, confirming, busy = false, notice, onStart, onCancel, onConfirm }: {
  preview: Open
  confirming: boolean
  busy?: boolean
  notice?: string | null
  onStart?: () => void
  onCancel?: () => void
  onConfirm?: () => void
}) {
  const provider = providerLabel(preview.fromPlatform)
  return (
    <section className="af-readiness rounded-2xl border border-white/[0.08] p-4" data-testid="native-undo-card" data-state={confirming ? 'confirming' : 'idle'} aria-labelledby="native-undo-title">
      <p className="af-admin-eyebrow text-[11px] font-black uppercase tracking-[0.18em]">Switched to AllFantasy</p>
      <h3 id="native-undo-title" className="mt-1 text-base font-black text-white">You can still go back to {provider}</h3>
      <p className="mt-1 text-xs leading-5 text-white/60">
        This league switched on {shortDate(preview.convertedAt)}. Undo is open until its first season on AllFantasy starts.
      </p>

      {confirming ? (
        <div className="mt-3" data-testid="native-undo-confirm">
          <p className="text-xs font-black text-white/80">Undo throws away</p>
          {preview.discards.length ? (
            <ul className="mt-2 space-y-2">
              {preview.discards.map((d) => (
                <li key={d.code} className="rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm font-black text-white" data-testid={`native-undo-discard-${d.code}`}>{d.label}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs leading-5 text-white/60" data-testid="native-undo-nothing">Nothing has happened on AllFantasy since the switch.</p>
          )}
          <p className="mt-2 text-xs leading-5 text-white/50">
            Rosters, picks and settings go back to how they were at the switch, and the league syncs from {provider} again. Chat and history stay.
          </p>
          {notice ? <p className="mt-2 text-xs font-bold text-amber-200" role="status" data-testid="native-undo-notice">{notice}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onConfirm} disabled={busy} className="min-h-[44px] rounded-lg bg-red-500/90 px-4 text-xs font-extrabold text-white disabled:opacity-55" data-testid="native-undo-confirm-button">
              {busy ? 'Undoing…' : `Undo and go back to ${provider}`}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-extrabold text-white/80 disabled:opacity-55">
              Keep it on AllFantasy
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {notice ? <p className="mb-2 text-xs font-bold text-amber-200" role="status" data-testid="native-undo-notice">{notice}</p> : null}
          <button type="button" onClick={onStart} className="min-h-[44px] rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-extrabold text-white/80" data-testid="native-undo-start">
            Undo the switch
          </button>
        </div>
      )}
    </section>
  )
}

export function NativeUndoCard({ leagueId }: { leagueId: string }) {
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/convert-to-native/undo`
  const [preview, setPreview] = useState<Open | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as NativeUndoPreview
    return body.status === 'open' ? body : null
  }, [url])

  useEffect(() => {
    let live = true
    load().then((next) => { if (live) setPreview(next) }).catch(() => {})
    return () => { live = false }
  }, [load])

  const start = useCallback(() => {
    setNotice(null)
    // Re-read before showing the list: it must describe the league as it is now.
    load().then((next) => { setPreview(next); if (next) setConfirming(true) }).catch(() => setNotice('Could not load what undo would change. Try again.'))
  }, [load])

  const confirm = useCallback(async () => {
    if (!preview) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: preview.token }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; preview?: NativeUndoPreview | null }
      if (res.ok) { window.location.reload(); return }
      if (body.code === 'changed' && body.preview?.status === 'open') {
        setPreview(body.preview)
        setNotice('The league changed since you opened this. Check the list again.')
      } else {
        setNotice(body.error ?? 'Undo did not complete, and nothing was changed.')
        if (body.code === 'closed' || body.code === 'none') { setConfirming(false); setPreview(null) }
      }
    } catch {
      setNotice('Undo did not complete, and nothing was changed. Try again.')
    } finally {
      setBusy(false)
    }
  }, [preview, url])

  if (!preview) return notice ? <p className="text-xs font-bold text-amber-200" role="status">{notice}</p> : null
  return (
    <NativeUndoView
      preview={preview}
      confirming={confirming}
      busy={busy}
      notice={notice}
      onStart={start}
      onCancel={() => { setConfirming(false); setNotice(null) }}
      onConfirm={confirm}
    />
  )
}
