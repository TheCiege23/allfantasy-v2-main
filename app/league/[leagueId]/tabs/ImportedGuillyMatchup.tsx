'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ImportedGuillyTabData } from '@/lib/guillotine/importedGuillyHealthLoad'
import { boardFromImportedView } from '@/lib/guillotine/survivalBoardModel'
import { GuillySurvivalBoard } from '@/components/guillotine/GuillySurvivalBoard'

/**
 * The Matchup tab of an IMPORTED Guilly league. It used to be the head-to-head matchup center, which a
 * Guilly league does not have: it is you against the whole league. This is the same survival board a
 * league hosted here shows, read from the provider's own weekly scores (../../../api/leagues/[leagueId]/
 * guillotine/imported). The provider runs the chop; the board says so.
 */
const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

type Data = ImportedGuillyTabData & { myRosterId?: string | null }

export function ImportedGuillyMatchup({ leagueId, onOpenGuilly }: { leagueId: string; onOpenGuilly?: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setData(null)
    setError(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/imported`, { credentials: 'include', cache: 'no-store', signal: ac.signal })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) setError(typeof d?.error === 'string' ? d.error : 'Could not load the chop line.')
        else setData(d as Data)
      })
      .catch(() => {
        if (!ac.signal.aborted) setError('Could not reach the server. Try again.')
      })
    return () => ac.abort()
  }, [leagueId])

  const board = useMemo(() => (data ? boardFromImportedView(data.view, data.myRosterId) : null), [data])
  const platform = data ? PLATFORM_NAMES[data.platform] ?? 'your platform' : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-4" data-testid="imported-guilly-matchup">
      <GuillySurvivalBoard
        board={board}
        loading={!data && !error}
        error={error}
        sourceNote={platform ? `Scores from ${platform}, which runs the chop` : null}
        actions={onOpenGuilly ? [{ label: 'Guilly details', onClick: onOpenGuilly }] : []}
      />
    </div>
  )
}
