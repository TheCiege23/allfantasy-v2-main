'use client'

import { useCallback, useEffect, useState } from 'react'
import { survivorIdolArt } from '@/lib/survivor/survivorIdolTypes'

/**
 * The idol reveal popup (owner's call, 2026-10-20): on the next league load after an idol reached
 * this manager — drafted with a player, seeded after the draft, or arrived by trade or waiver —
 * show the player, the idol, what it does and when it expires, until they tap "Got it". The private
 * Chimmy DM stays in the thread; this only acknowledges it. Owner-only by construction: the API
 * returns the viewer's own reveals.
 */
export type IdolReveal = {
  messageId: string
  playerName: string | null
  playerImageUrl: string | null
  idolTypeId: string | null
  idolLabel: string | null
  idolDescription: string | null
  expiryText: string | null
  foundInDraft: boolean
  message: string
}

export function SurvivorIdolRevealModal({ leagueId }: { leagueId: string }) {
  const [reveals, setReveals] = useState<IdolReveal[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-reveals`, { credentials: 'include', cache: 'no-store' })
      .then(async response => (response.ok ? response.json() : null))
      .then(payload => { if (active && Array.isArray(payload?.reveals)) setReveals(payload.reveals as IdolReveal[]) })
      .catch(() => undefined)
    return () => { active = false }
  }, [leagueId])

  const current = reveals[0]
  const acknowledge = useCallback(async () => {
    if (!current || busy) return
    setBusy(true)
    try {
      await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-reveals`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: current.messageId }),
      })
    } catch {
      // The DM is still in the Chimmy thread; the popup simply shows again next time.
    } finally {
      setReveals(list => list.slice(1))
      setBusy(false)
    }
  }, [current, busy, leagueId])

  if (!current) return null
  const art = survivorIdolArt(current.idolTypeId)
  const title = current.idolLabel ?? 'A hidden idol'
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-labelledby="svr-title" data-testid="survivor-idol-reveal">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/30 bg-[#050a14] shadow-2xl">
        <div className="border-b border-amber-500/20 bg-gradient-to-r from-amber-950/50 to-transparent px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">{current.foundInDraft ? 'Found in the draft' : 'A hidden idol is yours'}</p>
          <h2 id="svr-title" className="mt-1 text-xl font-bold text-amber-100">{title}</h2>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm text-white/80">
          <div className="flex items-center gap-3">
            {current.playerImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.playerImageUrl} alt="" className="h-14 w-14 rounded-full border border-white/15 object-cover" />
            ) : art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={art} alt="" className="h-14 w-14 object-contain" />
            ) : null}
            <div className="min-w-0">
              <p className="font-semibold text-white">{current.playerName ?? 'Your player'}</p>
              <p className="text-xs text-white/55">carries your secret {title}. Only you know.</p>
            </div>
          </div>
          {current.idolDescription && <p>{current.idolDescription}</p>}
          {current.expiryText && <p className="rounded-lg border border-amber-400/25 bg-amber-950/20 px-3 py-2 text-amber-100" data-testid="svr-expiry">{current.expiryText}</p>}
          <p className="text-xs text-white/50">The idol follows the player through trades and waivers. Chimmy&apos;s private message has the details.</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <span className="text-xs text-white/45">{reveals.length > 1 ? `${reveals.length - 1} more to see` : ''}</span>
          <button type="button" onClick={() => void acknowledge()} disabled={busy} className="min-h-11 rounded-lg bg-gradient-to-b from-[#e7c46a] to-[#d4a94a] px-5 text-sm font-semibold text-[#1d1406] disabled:opacity-50">Got it</button>
        </div>
      </div>
    </div>
  )
}
