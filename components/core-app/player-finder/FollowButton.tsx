'use client'

import { useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { followCopy } from '@/lib/core-app/finderFollowCopy'

/**
 * "Alert me" on the open player's card (Guap, 2026-10-08): follow him across every league from the
 * screen people actually search on. Until now the follow lived only behind the ☆ in the player-card
 * sheet, so the Finder — where you go to look someone up — could not keep an eye on him for you.
 *
 * The same follow as that ☆ (`player_follows`, through /api/core/player-card/watch with no
 * `leagueId`), so the home "Following" card, the news pushes and the "he's free in your league"
 * alert (lib/follows/followFreeAgentCheck.ts) all read one list.
 *
 * ⚠ OPTIMISTIC, AND REVERTED ON A REFUSAL — not only on a throw. A 401, 409 (the follow limit) or
 * 503 (follows unavailable) resolves normally; leaving the bell lit there would say something was
 * saved when nothing was. The limit gets its own sentence because "try again" would not help.
 */
export function FollowButton({
  sport,
  sleeperId,
  externalId,
  playerName,
  following,
}: {
  sport: string
  sleeperId: string | null
  externalId: string | null
  playerName: string
  /** The server's answer for this player. */
  following: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = followCopy(language)
  // An override that falls back to the payload, so a new player's state wins the moment it lands.
  const [override, setOverride] = useState<{ key: string; on: boolean } | null>(null)
  const [note, setNote] = useState<{ key: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const key = `${sport}:${sleeperId ?? externalId ?? playerName}`
  const on = override?.key === key ? override.on : following
  const shownNote = note?.key === key ? note.text : null
  if (!sleeperId && !externalId) return null

  const toggle = async () => {
    if (busy) return
    const next = !on
    setBusy(true)
    setOverride({ key, on: next })
    setNote(next ? { key, text: t.followedNote(playerName) } : null)
    try {
      const res = await fetch('/api/core/player-card/watch', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sport, ...(sleeperId ? { sleeperId } : {}), ...(externalId ? { externalId } : {}) }),
      })
      if (!res?.ok) {
        setOverride({ key, on: !next })
        setNote({ key, text: res?.status === 409 ? t.limit : t.failed })
      }
    } catch {
      setOverride({ key, on: !next })
      setNote({ key, text: t.failed })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="af-pf-follow-wrap">
      <button
        type="button"
        className="af-pf-follow"
        data-on={on ? 'true' : 'false'}
        aria-pressed={on}
        aria-label={on ? t.stopLabel(playerName) : t.startLabel(playerName)}
        onClick={toggle}
        disabled={busy}
      >
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {on ? t.on : t.off}
      </button>
      {shownNote ? (
        <span className="af-pf-follow-note" role="status">
          {shownNote}
        </span>
      ) : null}
    </span>
  )
}

export default FollowButton
