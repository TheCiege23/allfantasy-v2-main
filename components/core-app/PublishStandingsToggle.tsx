'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The commissioner's publish switch for `/standings/{leagueId}` (38a·7b).
 *
 * ⚠ TWO STEPS, DELIBERATELY. Turning this on publishes a league's name and every
 * team name to the open web, where a search engine will index and cache them.
 * Those names are user-authored and often personal, and the commissioner is
 * making that decision on eleven other people's behalf. A one-click switch for
 * that is the wrong affordance; the confirm step exists to make the scope
 * legible before it is irreversible-in-practice.
 *
 * Turning it OFF is one click. Making something private again should never be
 * harder than making it public.
 *
 * ⚠ NO NEW ENDPOINT. `PATCH /api/league/settings` already shallow-merges into
 * `League.settings` behind `requireCommissionerRole` — the same gate the hub
 * itself resolved server-side. This component cannot grant access it does not
 * have: a member who forged this request is rejected by the route.
 */

export type PublishStandingsToggleProps = {
  leagueId: string
  enabled: boolean
  /** Where the published page lives, shown so the scope is concrete. */
  url: string
}

export function PublishStandingsToggle({ leagueId, enabled, url }: PublishStandingsToggleProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setPublished(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/league/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leagueId, settingsMerge: { publicStandings: next } }),
      })
      if (!res.ok) {
        /*
         * The route's own message is shown rather than a generic failure — it
         * distinguishes "you are not the commissioner" from "the league could
         * not be found", and a commissioner who has just been told "something
         * went wrong" has no idea which.
         */
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Could not save (${res.status}).`)
        return
      }
      setConfirming(false)
      // Server component; the hub re-reads League.settings on refresh.
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  if (enabled) {
    return (
      <div className="af-ch-publish-actions">
        <a
          className="af-ch-publish-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url} ↗
        </a>
        <button
          type="button"
          className="af-btn af-ch-publish-btn"
          data-variant="quiet"
          onClick={() => void setPublished(false)}
          disabled={busy}
        >
          {busy ? 'Making private…' : 'Make private'}
        </button>
        {error ? <p className="af-ch-publish-error">{error}</p> : null}
      </div>
    )
  }

  if (!confirming) {
    return (
      <div className="af-ch-publish-actions">
        <button
          type="button"
          className="af-btn af-ch-publish-btn"
          onClick={() => setConfirming(true)}
          disabled={busy}
        >
          Publish standings
        </button>
      </div>
    )
  }

  return (
    <div className="af-ch-publish-confirm">
      <p className="af-ch-publish-confirm-t">Publish this league&apos;s standings?</p>
      {/*
        The list is specific on both sides. "Some league data" would be the
        vague version and is exactly what someone would agree to without
        realising what it covered.
      */}
      <ul className="af-ch-publish-list">
        <li data-in="true">Published: league name, team names, records, points</li>
        <li data-in="false">Not published: manager names, rosters, trades, chat</li>
        <li data-in="false">
          Anyone with the link can read it without an account, and search engines may index it
        </li>
      </ul>
      <div className="af-ch-publish-actions">
        <button
          type="button"
          className="af-btn af-ch-publish-btn"
          onClick={() => void setPublished(true)}
          disabled={busy}
        >
          {busy ? 'Publishing…' : 'Yes, publish'}
        </button>
        <button
          type="button"
          className="af-btn af-ch-publish-btn"
          data-variant="quiet"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {error ? <p className="af-ch-publish-error">{error}</p> : null}
    </div>
  )
}

export default PublishStandingsToggle
