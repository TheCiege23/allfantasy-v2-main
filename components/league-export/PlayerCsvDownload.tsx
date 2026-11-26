'use client'

/**
 * "Export league" — downloads every player in the league's pool as a CSV: ids, team, position, who holds
 * them and where (starter, bench, IR, taxi, devy), and ADP. Any league member, native or imported.
 * The file is built by GET /api/leagues/[leagueId]/player-csv (lib/league-export/playerPoolCsv.ts).
 *
 * Fetched rather than linked so a failure shows a sentence here instead of navigating to raw JSON.
 */

import { useState } from 'react'
import './player-csv-download.css'

function filenameFrom(disposition: string | null): string {
  const m = /filename="([^"]+)"/.exec(disposition ?? '')
  return m?.[1] ?? 'league-players.csv'
}

export function PlayerCsvDownload({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{ k: 'idle' } | { k: 'busy' } | { k: 'error'; message: string }>({ k: 'idle' })

  async function download() {
    setState({ k: 'busy' })
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/player-csv`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setState({ k: 'error', message: body?.error ?? 'Could not build the player list. Try again in a minute.' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filenameFrom(res.headers.get('content-disposition'))
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setState({ k: 'idle' })
    } catch {
      setState({ k: 'error', message: 'Could not reach AllFantasy. Check your connection and try again.' })
    }
  }

  return (
    <section className="af-pcsv" data-testid="player-csv-download" aria-labelledby="af-pcsv-title">
      <h2 id="af-pcsv-title" className="af-pcsv-title">
        Export league
      </h2>
      <p className="af-pcsv-help">
        Every player as a spreadsheet: IDs, team, position, who has them, and ADP.
      </p>
      <button type="button" className="af-pcsv-btn" onClick={() => void download()} disabled={state.k === 'busy'}>
        {state.k === 'busy' ? 'Building…' : 'Download player CSV'}
      </button>
      {state.k === 'error' ? (
        <p className="af-pcsv-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  )
}
