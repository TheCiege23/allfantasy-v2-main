'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { ImportedGuillyTabData } from '@/lib/guillotine/importedGuillyHealthLoad'
import type { TeamOutlook } from '@/lib/guillotine/survivalOutlook'
import { boardFromImportedView } from '@/lib/guillotine/survivalBoardModel'
import { GuillySurvivalBoard } from '@/components/guillotine/GuillySurvivalBoard'

/**
 * The Chop tab of an IMPORTED Guilly league: the same survival board a league hosted here shows
 * (components/guillotine/GuillySurvivalBoard.tsx), read from the provider's own weekly scores
 * (../../../api/leagues/[leagueId]/guillotine/imported). The provider runs the chop; the board says so.
 *
 * It was two tabs — "Guilly" (a plain standings list of its own) and "Matchup" (the board) — showing the same
 * scores twice. One page now (owner's decision, 2026-11-25): the board is the list, and what only the Guilly tab
 * said — the reliability check's doubt, and a format we only recognised — sits above it when it applies.
 */
const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
}

type Data = ImportedGuillyTabData & { myRosterId?: string | null; outlook?: Record<string, TeamOutlook> | null }

export function ImportedGuillyTab({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setData(null)
    setError(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/imported?outlook=1`, { credentials: 'include', cache: 'no-store', signal: ac.signal })
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

  const board = useMemo(() => (data ? boardFromImportedView(data.view, data.myRosterId, data.outlook) : null), [data])
  const platform = data ? PLATFORM_NAMES[data.platform] ?? 'your platform' : null
  const syncHref = `/core/sync?league=${encodeURIComponent(leagueId)}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4" data-testid="imported-guilly-tab">
      {data && platform && data.check.status === 'attention' ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/90" data-testid="imported-guilly-doubt">
          Some of this may be out of step with {platform}: {data.check.attention === 1 ? 'one thing needs' : `${data.check.attention} things need`} a look.{' '}
          <Link href={syncHref} className="font-semibold underline">See the Sync check</Link>
        </p>
      ) : data && data.check.format === 'detected' ? (
        <p className="text-[12px] text-white/50" data-testid="imported-guilly-unconfirmed">
          We recognised this as a Guilly league from its name or settings. <Link href={syncHref} className="underline">Confirm it on the Sync screen</Link>.
        </p>
      ) : null}
      <GuillySurvivalBoard
        board={board}
        loading={!data && !error}
        error={error}
        sourceNote={platform ? `Scores from ${platform}, which runs the chop. AllFantasy never chops a team here.` : null}
      />
    </div>
  )
}
