'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PositionEligibilityView,
  type PositionEligibilityLogEntry,
  type PositionEligibilityPlayer,
  type PositionEligibilitySubmit,
} from './PositionEligibilityView'

type PanelData = { players: PositionEligibilityPlayer[]; log: PositionEligibilityLogEntry[]; canEdit: boolean }

/** NBA leagues: the commissioner's position-eligibility tool and the league-wide change log. */
export function PositionEligibilityPanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/position-eligibility`

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Could not load position eligibility.')
      setData(body as PanelData)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load position eligibility.')
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const onSubmit = useCallback(
    async (change: PositionEligibilitySubmit) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? 'That change was not saved.')
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That change was not saved.')
        throw e
      } finally {
        setBusy(false)
      }
    },
    [url, load],
  )

  if (loadError) return <p className="text-xs text-white/50">{loadError}</p>
  if (!data) return <p className="py-6 text-center text-xs text-white/40">Loading position eligibility…</p>
  return (
    <PositionEligibilityView
      players={data.players}
      log={data.log}
      canEdit={data.canEdit}
      busy={busy}
      error={error}
      onSubmit={async (c) => {
        try {
          await onSubmit(c)
          return true
        } catch {
          return false // shown via `error`; the form stays open
        }
      }}
    />
  )
}
