'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Add a Fantrax trade-history export to a league that is already imported.
 *
 * Fantrax shares future draft picks for rounds 1-4 only, so a pick traded in a
 * later round reaches us from nowhere but the league's own trade history. This
 * is the one place a manager can hand that over.
 *
 * ⚠ SEPARATE FROM `FantraxUpload` ON PURPOSE. That panel banks a whole CSV-era
 * snapshot and asks for a username, a season and a sport. This one adds one file
 * to a league imported by id and needs none of those — folding it into that form
 * would put five irrelevant fields in front of a one-file job.
 *
 * ⚠ IT DOES NOT IMPORT ANYTHING BY ITSELF, AND THE RESULT SAYS SO. The picks are
 * stored beside the league and picked up on its next sync, so the confirmation
 * says "on the next sync" rather than implying they are on screen already.
 */

type Added = {
  pickTradesInFile: number
  added: number
  stored: number
  unreadablePickRows: number
  unknownTeams: string[]
  rounds: number[]
}

function roundsLabel(rounds: number[]): string {
  if (rounds.length === 0) return ''
  const min = Math.min(...rounds)
  const max = Math.max(...rounds)
  return min === max ? `round ${min}` : `rounds ${min}–${max}`
}

export function FantraxTradeHistoryUpload({ defaultLeagueId = '' }: { defaultLeagueId?: string }) {
  const [leagueId, setLeagueId] = useState(defaultLeagueId)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Added | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setDone(null)

      if (!leagueId.trim()) {
        setError('Paste the Fantrax league ID or link this trade history belongs to.')
        return
      }
      if (!file) {
        setError('Choose the trade history CSV you downloaded from Fantrax.')
        return
      }

      setBusy(true)
      try {
        const fd = new FormData()
        fd.append('leagueId', leagueId.trim())
        fd.append('file', file)
        const res = await fetch('/api/league/import/fantrax/trade-history', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => null)) as (Partial<Added> & { error?: string }) | null

        if (!res.ok || !data || typeof data.pickTradesInFile !== 'number') {
          setError(data?.error ?? `Upload failed (${res.status}).`)
          return
        }
        setDone({
          pickTradesInFile: data.pickTradesInFile,
          added: data.added ?? 0,
          stored: data.stored ?? 0,
          unreadablePickRows: data.unreadablePickRows ?? 0,
          unknownTeams: Array.isArray(data.unknownTeams) ? data.unknownTeams : [],
          rounds: Array.isArray(data.rounds) ? data.rounds : [],
        })
        setFile(null)
        if (fileRef.current) fileRef.current.value = ''
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
      }
    },
    [leagueId, file],
  )

  return (
    <section className="af-im-fx">
      <h2 className="af-im-fx-h">Add traded picks past round 4</h2>
      <p className="af-im-fx-p">
        Fantrax only shares future picks for rounds 1&ndash;4. To add later-round pick trades, open
        your league on Fantrax, go to Transactions &rarr; History &rarr; Trades, and download the
        CSV.
      </p>

      <form onSubmit={submit} className="af-im-fx-form">
        <label className="af-im-fx-field">
          <span>Fantrax league ID or link</span>
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            placeholder="fantrax.com/fantasy/league/…"
            autoComplete="off"
          />
        </label>

        <label className="af-im-fx-files">
          <span>Trade history CSV</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <i>{file ? `${file.name} ready.` : 'One file. Import the league first if you have not yet.'}</i>
        </label>

        <button type="submit" className="af-im-fx-go" disabled={busy}>
          {busy ? 'Adding…' : 'Add trade history'}
        </button>
      </form>

      {error ? <p className="af-im-fx-err">{error}</p> : null}

      {done ? (
        <div className="af-im-fx-done">
          <p className="af-im-fx-done-h">
            {done.pickTradesInFile === 0
              ? 'No draft pick trades in that file'
              : `${done.pickTradesInFile} pick trade${done.pickTradesInFile === 1 ? '' : 's'} read`}
          </p>
          {done.pickTradesInFile > 0 ? (
            <p className="af-im-fx-p">
              {done.added > 0 ? `${done.added} new` : 'All already on file'} &middot; {roundsLabel(done.rounds)}.
              They appear on the league&rsquo;s next sync.
            </p>
          ) : (
            <p className="af-im-fx-p">The file was a trade history, but none of its rows were draft picks.</p>
          )}
          {done.unknownTeams.length > 0 ? (
            <ul className="af-im-fx-warn" aria-label="Teams we could not match">
              <li>
                Not matched to a team in this league, so their picks were skipped:{' '}
                {done.unknownTeams.join(', ')}
              </li>
            </ul>
          ) : null}
          {done.unreadablePickRows > 0 ? (
            <ul className="af-im-fx-warn" aria-label="Rows we could not read">
              <li>
                {done.unreadablePickRows} pick row{done.unreadablePickRows === 1 ? '' : 's'} could not be read
                and {done.unreadablePickRows === 1 ? 'was' : 'were'} skipped.
              </li>
            </ul>
          ) : null}
          <p className="af-im-fx-note">
            Rounds 1&ndash;4 always come from Fantrax directly, so this only fills in the later rounds.
          </p>
        </div>
      ) : null}
    </section>
  )
}
