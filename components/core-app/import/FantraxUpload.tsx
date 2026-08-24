'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Fantrax CSV upload — the step that has to happen before a Fantrax league can
 * be imported at all.
 *
 * ⚠ FANTRAX IS NOT FETCHABLE, AND THAT IS NOT A GAP IN OUR ADAPTER. Every other
 * provider on this page is read from an API given an identifier. Fantrax web
 * leagues are not publicly readable by ID — a pasted league id resolves to a
 * username lookup and fails — so `fetchFantraxLeagueForImport` reads only
 * snapshots that were uploaded here first, and only ones stamped with the
 * uploader's own account id. This panel creates that snapshot. Without it there
 * is nothing for the import step to find, which is why a Fantrax field on its
 * own would be a field you can type into and never finish.
 *
 * ⚠ UPLOADING IS NOT IMPORTING, AND THIS PANEL SAYS SO. Banking a snapshot
 * works today. Turning one into an AllFantasy league is still gated by
 * `IMPORT_PROVIDER_UI_OPTIONS.fantrax.available`, which is false until someone
 * has actually run upload-then-import end to end. This panel therefore hands
 * back the snapshot id and stops, rather than implying the second half happened.
 *
 * ⚠ SEPARATE FILE ON PURPOSE. `ImportV4.tsx` is large and frequently edited;
 * keeping this out of it means the upload path can land without touching the
 * discovery and bulk-run logic around it.
 */

type UploadedSnapshot = {
  id: string
  name: string
  season: number
  teamCount: number | null
  record: string | null
  userTeam: string | null
}

const SPORTS = [
  { value: 'nfl', label: 'NFL' },
  { value: 'cfb', label: 'College football' },
] as const

export function FantraxUpload({ onUploaded }: { onUploaded?: (snapshotId: string) => void }) {
  const [username, setUsername] = useState('')
  const [leagueName, setLeagueName] = useState('')
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [sport, setSport] = useState<string>('nfl')
  const [isDevy, setIsDevy] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [done, setDone] = useState<UploadedSnapshot | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setWarnings([])
      setDone(null)

      if (!username.trim()) {
        setError('Your Fantrax username is required — it is how the snapshot is filed.')
        return
      }
      if (files.length === 0) {
        setError('Add at least one CSV exported from Fantrax.')
        return
      }

      setBusy(true)
      try {
        const fd = new FormData()
        fd.append('username', username.trim())
        fd.append('season', season)
        fd.append('sport', sport)
        if (leagueName.trim()) fd.append('leagueName', leagueName.trim())
        fd.append('isDevy', String(isDevy))
        // The route reads any entry whose key starts with file_.
        files.forEach((f, i) => fd.append(`file_${i}`, f))

        const res = await fetch('/api/legacy/fantrax', { method: 'POST', body: fd })
        const data = (await res.json().catch(() => null)) as
          | {
              success?: boolean
              league?: {
                id: string
                name: string
                season: number
                teamCount: number | null
                record: string | null
                userTeam: string | null
              }
              error?: string
              details?: unknown
              errors?: string[]
            }
          | null

        if (!res.ok || !data?.success || !data.league) {
          /*
           * The route reports parse problems in `details`. Surfacing them beats a
           * generic failure: a Fantrax export that is missing the standings file
           * fails for a reason the user can act on.
           */
          const detail = Array.isArray(data?.details) ? ` — ${(data?.details as string[]).join('; ')}` : ''
          setError(`${data?.error ?? `Upload failed (${res.status}).`}${detail}`)
          return
        }

        /*
         * ⚠ A SUCCESSFUL UPLOAD CAN STILL HAVE DROPPED SOMETHING. `parseFantraxFiles`
         * returns `errors` alongside a success when it could read the league but not
         * every file — a missing transactions export, say. Swallowing those would let
         * a partial snapshot look complete, and the gap only reappears much later as
         * missing history on the career page.
         */
        if (Array.isArray(data.errors) && data.errors.length > 0) setWarnings(data.errors)
        setDone(data.league)
        onUploaded?.(data.league.id)
        setFiles([])
        if (fileRef.current) fileRef.current.value = ''
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
      }
    },
    [username, leagueName, season, sport, isDevy, files, onUploaded],
  )

  return (
    <section className="af-im-fx">
      <h2 className="af-im-fx-h">Upload a Fantrax export</h2>
      <p className="af-im-fx-p">
        Fantrax leagues cannot be read from a league ID the way Sleeper and Yahoo can — nothing there
        is public. Export your league&apos;s CSVs from Fantrax and upload them here; that snapshot is
        what an import reads.
      </p>

      <form onSubmit={submit} className="af-im-fx-form">
        <label className="af-im-fx-field">
          <span>Fantrax username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-fantrax-username"
            autoComplete="off"
          />
        </label>

        <label className="af-im-fx-field">
          <span>
            League name <i>optional</i>
          </span>
          <input
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
            placeholder="Read from the export if blank"
            autoComplete="off"
          />
        </label>

        <label className="af-im-fx-field af-im-fx-field--sm">
          <span>Season</span>
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
          />
        </label>

        <label className="af-im-fx-field af-im-fx-field--sm">
          <span>Sport</span>
          <select value={sport} onChange={(e) => setSport(e.target.value)}>
            {SPORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="af-im-fx-check">
          <input type="checkbox" checked={isDevy} onChange={(e) => setIsDevy(e.target.checked)} />
          <span>Devy league</span>
        </label>

        <label className="af-im-fx-files">
          <span>CSV files</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <i>
            {files.length === 0
              ? 'Standings, rosters, matchups and transactions — whichever your export includes.'
              : `${files.length} file${files.length === 1 ? '' : 's'} ready.`}
          </i>
        </label>

        <button type="submit" className="af-im-fx-go" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload snapshot'}
        </button>
      </form>

      {error ? <p className="af-im-fx-err">{error}</p> : null}
      {warnings.length > 0 ? (
        <ul className="af-im-fx-warn" aria-label="Parts of the export we could not read">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {done ? (
        <div className="af-im-fx-done">
          <p className="af-im-fx-done-h">
            Saved {done.name} · {done.season}
          </p>
          <p className="af-im-fx-p">
            {done.userTeam ? `${done.userTeam} · ` : ''}
            {done.record ?? 'no record in the export'}
            {done.teamCount ? ` · ${done.teamCount} teams` : ''}
          </p>
          {/*
            ⚠ THE ID IS SHOWN BECAUSE IT IS THE IMPORT INPUT. When Fantrax import
            is switched on, this is what goes in the provider field. Saying so now
            is cheaper than a user re-uploading later to find it again.
          */}
          <p className="af-im-fx-id">
            Snapshot id <code>{done.id}</code>
          </p>
          <p className="af-im-fx-note">
            Your history is banked. Turning a Fantrax snapshot into an AllFantasy league is not
            switched on yet — this is stored against your account and will import without
            re-uploading once it is.
          </p>
        </div>
      ) : null}
    </section>
  )
}
