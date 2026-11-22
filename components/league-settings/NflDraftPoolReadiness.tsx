'use client'

import { useState } from 'react'
import type { NflDraftPoolCapacity } from '@/lib/draft-room/nflDraftPoolCapacity'

type Readiness = { status: 'idle' | 'loading' | 'error' } |
  { status: 'loaded'; capacity: NflDraftPoolCapacity | null }

export function NflDraftPoolReadiness({ leagueId }: { leagueId: string }) {
  const [readiness, setReadiness] = useState<Readiness>({ status: 'idle' })

  async function load() {
    setReadiness({ status: 'loading' })
    try {
      const response = await fetch('/api/leagues/' + encodeURIComponent(leagueId) + '/draft/session?commissionerReadiness=1', {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Draft readiness unavailable')
      const data = await response.json()
      setReadiness({ status: 'loaded', capacity: data.draftPoolCapacity ?? null })
    } catch {
      setReadiness({ status: 'error' })
    }
  }

  const capacity = readiness.status === 'loaded' ? readiness.capacity : null
  return (
    <details onToggle={event => {
      if (event.currentTarget.open && readiness.status === 'idle') void load()
    }}>
      <summary className="afh-link cursor-pointer">Draft pool readiness</summary>
      <div className="mt-2 space-y-1 text-sm" aria-live="polite">
        {readiness.status === 'loading' && <p>Checking player availability…</p>}
        {readiness.status === 'error' && <p>Draft pool readiness is unavailable. Try again.</p>}
        {readiness.status === 'loaded' && !capacity && <p>No NFL startup draft is waiting to start.</p>}
        {capacity && <>
          <p>{capacity.eligiblePlayers} eligible players for {capacity.requiredPlayers} picks in the largest pool</p>
          <p>{capacity.rosterFeedRefreshedAt
            ? 'Latest NFL roster update ' + new Date(capacity.rosterFeedRefreshedAt).toLocaleString()
            : 'NFL roster feed update unavailable'}</p>
          {capacity.error && <p className="text-amber-200">{capacity.error}</p>}
        </>}
        {(readiness.status === 'loaded' || readiness.status === 'error') && (
          <button type="button" className="afh-link underline" onClick={() => void load()}>Refresh readiness</button>
        )}
      </div>
    </details>
  )
}
