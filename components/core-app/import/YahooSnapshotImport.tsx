'use client'

/**
 * Yahoo by copy-paste — the way in while Yahoo's Fantasy API access is unapproved.
 *
 * The commissioner opens each of their own Yahoo league pages (we link straight to them), copies the
 * page, and pastes it here. Each paste is recognised by itself, so order does not matter, and the
 * checklist says exactly what is still needed. Settings + standings is an importable league; draft
 * and rosters add detail.
 *
 * ⚠ IT RENDERS NOTHING UNLESS THE SERVER SAYS THIS ACCOUNT MAY USE IT. Rollout lives in
 * lib/yahoo/yahooAvailability.ts (`isYahooSnapshotImportOpenFor`), which a client component cannot
 * read — so the first GET decides.
 *
 * ⚠ IMPORT GOES THROUGH THE SAME CLIENT SERVICE AS EVERY OTHER PROVIDER (fetchImportPreview /
 * submitImportCreation), with `sourceId: yahoo-snapshot:<id>`. No second copy of that sequence.
 *
 * ⚠ SEPARATE FILE ON PURPOSE, like FantraxUpload: ImportV4 is large and frequently edited.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import type { YahooSnapshotChecklist } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'
import { buildYahooSnapshotBookmarklet } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet'
import { OPEN_YAHOO_COPY_PASTE_EVENT, useYahooCopyPasteEnabled } from './yahooCopyPaste'

const ENDPOINT = '/api/leagues/import/yahoo-snapshot'

const PAGE_LABEL: Record<string, string> = {
  settings: 'league settings',
  standings: 'standings',
  draft: 'draft results',
  roster: 'roster',
}

type Phase =
  | { k: 'start' }
  | { k: 'collect' }
  | { k: 'review'; preview: PreviewView }
  | { k: 'done'; leagueId: string; name: string; updated: boolean }

interface PreviewView {
  name: string
  season: number | null
  teamCount: number
  scoring: string | null
  rosterSlots: string[]
  draftPicks: number
}

function toPreviewView(data: unknown): PreviewView {
  const d = (data ?? {}) as Record<string, any>
  const league = (d.league ?? {}) as Record<string, any>
  return {
    name: String(league.name ?? 'Your Yahoo league'),
    season: typeof league.season === 'number' ? league.season : null,
    teamCount: Number(league.teamCount ?? (Array.isArray(d.managers) ? d.managers.length : 0)),
    scoring: league.settings?.scoringLabel ?? d.formatSummary?.detectedFormat ?? null,
    rosterSlots: Array.isArray(d.rosterPositions) ? d.rosterPositions.map(String) : [],
    draftPicks: Number(d.draftPickCount ?? 0),
  }
}

/** "QB, RB, RB, BN, BN" -> "QB, 2 RB, 2 BN" — first-seen order, each slot named once. */
export function summarizeSlots(slots: string[]): string {
  const counts = new Map<string, number>()
  for (const slot of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1)
  return [...counts].map(([slot, n]) => (n > 1 ? `${n} ${slot}` : slot)).join(', ')
}

function Mark({ done }: { done: boolean }) {
  return (
    <span className={done ? 'af-im-ys-mark af-im-ys-mark--done' : 'af-im-ys-mark'} aria-hidden>
      {done ? '✓' : ''}
    </span>
  )
}

export function YahooSnapshotImport() {
  const enabled = useYahooCopyPasteEnabled()
  const [phase, setPhase] = useState<Phase>({ k: 'start' })
  const [leagueInput, setLeagueInput] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [checklist, setChecklist] = useState<YahooSnapshotChecklist | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [alreadyImported, setAlreadyImported] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bookmarkRef = useRef<HTMLAnchorElement>(null)
  const [open, setOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  /* The Yahoo tile's "Import by copy-paste" button: open, and bring the panel into view. */
  useEffect(() => {
    const onOpen = () => {
      setOpen(true)
      window.requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    window.addEventListener(OPEN_YAHOO_COPY_PASTE_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_YAHOO_COPY_PASTE_EVENT, onOpen)
  }, [])

  const start = useCallback(async (league?: string) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${ENDPOINT}?league=${encodeURIComponent((league ?? leagueInput).trim())}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.checklist) {
        setError(body.error ?? 'That league link did not work. Check it and try again.')
        return
      }
      setSourceId(body.sourceId)
      setChecklist(body.checklist)
      setPhase({ k: 'collect' })
    } finally {
      setBusy(false)
    }
  }, [leagueInput])

  /*
   * `/import?yahooLeague=<id>` — where the bookmark's window sends you to review. Opens the panel
   * straight on that league's checklist instead of asking for the link again.
   */
  useEffect(() => {
    if (!enabled) return
    const league = new URLSearchParams(window.location.search).get('yahooLeague')
    if (!league) return
    setOpen(true)
    setLeagueInput(league)
    void start(league)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the panel first becomes available
  }, [enabled])

  /*
   * Pages sent with the bookmark land in another window, so the checklist here goes stale. Re-read it
   * when the commissioner comes back to this tab — one cheap GET, no AI call.
   */
  useEffect(() => {
    if (phase.k !== 'collect' || !checklist) return
    const leagueId = checklist.leagueId
    const refresh = () => {
      fetch(`${ENDPOINT}?league=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (body?.checklist) setChecklist(body.checklist)
        })
        .catch(() => {})
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [phase.k, checklist?.leagueId])

  /*
   * ⚠ THE HREF IS SET ON THE DOM NODE, NOT IN JSX. React refuses `javascript:` URLs in `href`
   * (it renders a blocked placeholder), and a bookmarklet is nothing but a `javascript:` URL. The
   * origin is this page's, so a preview or staging deployment builds a bookmark for itself.
   */
  useEffect(() => {
    bookmarkRef.current?.setAttribute('href', buildYahooSnapshotBookmarklet(window.location.origin))
  }, [phase.k])

  const readPage = useCallback(async () => {
    if (!checklist) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.set('league', checklist.leagueId)
      if (file) form.set('image', file)
      else form.set('text', text)
      const res = await fetch(ENDPOINT, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'We could not read that page. Try again.')
        return
      }
      setChecklist(body.checklist)
      setNotice(
        body.page === 'roster' && body.team
          ? `Got it: ${body.team}'s roster.`
          : `Got it: ${PAGE_LABEL[body.page] ?? 'page'}.`,
      )
      setText('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } finally {
      setBusy(false)
    }
  }, [checklist, file, text])

  const review = useCallback(async () => {
    if (!sourceId) return
    setError(null)
    setBusy(true)
    try {
      const result = await fetchImportPreview('yahoo', sourceId)
      if (!result.ok) {
        setError(result.error ?? 'We could not build a preview. Check the pages and try again.')
        return
      }
      setPhase({ k: 'review', preview: toPreviewView(result.data) })
    } finally {
      setBusy(false)
    }
  }, [sourceId])

  const commit = useCallback(
    async (force: boolean) => {
      if (!sourceId) return
      setError(null)
      setBusy(true)
      try {
        const result = await submitImportCreation(
          'yahoo',
          sourceId,
          '',
          { accepted: true, statement: 'I am the commissioner of this Yahoo league.' },
          force ? { force: true } : undefined,
        )
        if (!result.ok || !result.data?.league) {
          setAlreadyImported(result.code === 'LEAGUE_ALREADY_IMPORTED')
          setError(result.error ?? 'The import did not finish. Try again.')
          return
        }
        setPhase({ k: 'done', leagueId: result.data.league.id, name: result.data.league.name, updated: force })
      } finally {
        setBusy(false)
      }
    },
    [sourceId],
  )

  const startOver = useCallback(async () => {
    if (checklist) {
      await fetch(`${ENDPOINT}?league=${encodeURIComponent(checklist.leagueId)}`, { method: 'DELETE' }).catch(() => {})
    }
    setChecklist(null)
    setSourceId(null)
    setText('')
    setFile(null)
    setNotice(null)
    setError(null)
    setAlreadyImported(false)
    setIsCommissioner(false)
    setPhase({ k: 'start' })
  }, [checklist])

  if (!enabled) return null

  const rostersAdded = checklist?.teams.filter((t) => t.hasRoster).length ?? 0

  return (
    <details ref={detailsRef} id="af-yahoo-copy-paste" className="af-im-ys" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="af-im-fx-link af-im-fx-link--foot af-im-ys-toggle">Yahoo league? Import it by copy-paste →</summary>
      {/* No heading of its own: the summary above already says what this is, once. */}
      <section className="af-im-fx" aria-label="Import a Yahoo league by copy-paste">
        {phase.k === 'start' ? (
          <p className="af-im-fx-p">
            Yahoo hasn&apos;t opened its data to us yet. Copy two pages from your league and we&apos;ll set it up.
          </p>
        ) : null}

        {phase.k === 'start' ? (
          <form
            className="af-im-fx-form"
            onSubmit={(e) => {
              e.preventDefault()
              void start()
            }}
          >
            <label className="af-im-fx-field">
              <span>Your Yahoo league link</span>
              <input
                className="af-im-ys-input"
                value={leagueInput}
                onChange={(e) => setLeagueInput(e.target.value)}
                placeholder="football.fantasysports.yahoo.com/f1/123456"
                inputMode="url"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="af-im-fx-go" disabled={busy || !leagueInput.trim()}>
              {busy ? 'Checking…' : 'Start'}
            </button>
          </form>
        ) : null}

        {phase.k === 'collect' && checklist ? (
          <>
            <ol className="af-im-ys-list">
              <li>
                <Mark done={checklist.settings} />
                <span className="af-im-ys-item">League settings</span>
                <a href={checklist.links.settings} target="_blank" rel="noopener noreferrer">
                  Open on Yahoo ↗
                </a>
              </li>
              <li>
                <Mark done={checklist.standings} />
                <span className="af-im-ys-item">Standings</span>
                <a href={checklist.links.standings} target="_blank" rel="noopener noreferrer">
                  Open on Yahoo ↗
                </a>
              </li>
              <li>
                <Mark done={checklist.draft} />
                <span className="af-im-ys-item">
                  Draft results <i>optional</i>
                </span>
                <a href={checklist.links.draft} target="_blank" rel="noopener noreferrer">
                  Open on Yahoo ↗
                </a>
              </li>
              <li className="af-im-ys-rosters">
                <Mark done={checklist.teams.length > 0 && rostersAdded === checklist.teams.length} />
                <span className="af-im-ys-item">
                  Team rosters <i>optional</i>
                  {checklist.teams.length > 0 ? ` · ${rostersAdded} of ${checklist.teams.length}` : ''}
                </span>
                {checklist.teams.length > 0 ? (
                  <details className="af-im-ys-teams">
                    <summary>Team pages</summary>
                    <ul>
                      {checklist.teams.map((t) => (
                        <li key={t.name}>
                          <Mark done={t.hasRoster} />
                          <span className="af-im-ys-item">{t.name}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="af-im-fx-note">
                      Open each team from your standings page on Yahoo, then copy and paste it here.
                    </p>
                  </details>
                ) : (
                  <span className="af-im-ys-hint">after standings</span>
                )}
              </li>
            </ol>

            {checklist.unmatchedRosters.length > 0 ? (
              <p className="af-im-fx-warn" role="status">
                We couldn&apos;t match {checklist.unmatchedRosters.join(', ')} to a team in your standings. Re-paste your
                standings if a team was renamed.
              </p>
            ) : null}

            <div className="af-im-ys-bm">
              <p className="af-im-ys-bm-h">Faster on a computer: one click per page</p>
              <p className="af-im-fx-note">
                Drag this button to your bookmarks bar. Then on each Yahoo page above, click the bookmark and the
                page comes straight here.
              </p>
              <a
                ref={bookmarkRef}
                className="af-im-ys-bm-btn"
                draggable
                onClick={(e) => {
                  e.preventDefault()
                  setNotice('Drag the Send to AllFantasy button to your bookmarks bar, then click it on a Yahoo page.')
                }}
              >
                Send to AllFantasy
              </a>
            </div>

            <label className="af-im-ys-paste-label" htmlFor="af-im-ys-paste">
              On the Yahoo page press <kbd>Ctrl</kbd>+<kbd>A</kbd>, then <kbd>Ctrl</kbd>+<kbd>C</kbd>, and paste it here
            </label>
            <textarea
              id="af-im-ys-paste"
              className="af-im-ys-paste"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (e.target.value) setFile(null)
              }}
              rows={5}
              placeholder="Paste one page at a time"
              disabled={busy}
            />
            <div className="af-im-ys-row">
              <label className="af-im-ys-file">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null)
                    if (e.target.files?.[0]) setText('')
                  }}
                  disabled={busy}
                />
                <span>{file ? file.name : 'On a phone? Add a screenshot instead'}</span>
              </label>
              <button
                type="button"
                className="af-im-fx-go"
                onClick={() => void readPage()}
                disabled={busy || (!text.trim() && !file)}
              >
                {busy ? 'Reading…' : 'Read this page'}
              </button>
            </div>

            {notice ? (
              <p className="af-im-ys-ok" role="status">
                {notice}
              </p>
            ) : null}

            <div className="af-im-ys-row af-im-ys-row--end">
              <button type="button" className="af-im-ys-quiet" onClick={() => void startOver()} disabled={busy}>
                Start over
              </button>
              <button
                type="button"
                className="af-im-fx-go"
                onClick={() => void review()}
                disabled={busy || !checklist.ready}
                title={checklist.ready ? undefined : `Still needed: ${checklist.missing.join(', ')}`}
              >
                {checklist.ready ? 'Review import →' : `Still needed: ${checklist.missing.join(', ')}`}
              </button>
            </div>
          </>
        ) : null}

        {phase.k === 'review' ? (
          <>
            <dl className="af-im-ys-summary">
              <div>
                <dt>League</dt>
                <dd>
                  {phase.preview.name}
                  {phase.preview.season ? ` · ${phase.preview.season}` : ''}
                </dd>
              </div>
              <div>
                <dt>Teams</dt>
                <dd>{phase.preview.teamCount}</dd>
              </div>
              {phase.preview.scoring ? (
                <div>
                  <dt>Scoring</dt>
                  <dd>{phase.preview.scoring}</dd>
                </div>
              ) : null}
              {phase.preview.rosterSlots.length > 0 ? (
                <div>
                  <dt>Lineup</dt>
                  <dd>{summarizeSlots(phase.preview.rosterSlots)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Draft</dt>
                <dd>{phase.preview.draftPicks > 0 ? `${phase.preview.draftPicks} picks` : 'Not added'}</dd>
              </div>
              <div>
                <dt>Rosters</dt>
                <dd>{rostersAdded > 0 ? `${rostersAdded} of ${checklist?.teams.length ?? 0} teams` : 'Not added'}</dd>
              </div>
            </dl>
            <p className="af-im-fx-note">
              Check these match Yahoo. If something is off, go back and paste that page again.
            </p>
            <label className="af-im-fx-check af-im-ys-attest">
              <input type="checkbox" checked={isCommissioner} onChange={(e) => setIsCommissioner(e.target.checked)} />
              I&apos;m the commissioner of this league
            </label>
            <div className="af-im-ys-row af-im-ys-row--end">
              <button type="button" className="af-im-ys-quiet" onClick={() => setPhase({ k: 'collect' })} disabled={busy}>
                ← Back
              </button>
              {alreadyImported ? (
                <button type="button" className="af-im-fx-go" onClick={() => void commit(true)} disabled={busy || !isCommissioner}>
                  {busy ? 'Updating…' : 'Update my existing league'}
                </button>
              ) : (
                <button type="button" className="af-im-fx-go" onClick={() => void commit(false)} disabled={busy || !isCommissioner}>
                  {busy ? 'Importing…' : 'Import league'}
                </button>
              )}
            </div>
          </>
        ) : null}

        {phase.k === 'done' ? (
          <div className="af-im-fx-done" role="status">
            <p className="af-im-fx-done-h">
              {phase.updated ? 'Updated' : 'Imported'} {phase.name}
            </p>
            <p className="af-im-fx-p">
              <a href={`/core?league=${encodeURIComponent(phase.leagueId)}`}>Open league →</a>
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="af-im-fx-err" role="alert">
            {error}
          </p>
        ) : null}

        {phase.k !== 'start' && phase.k !== 'done' ? (
          <p className="af-im-fx-note">
            This is a copy, not a live connection, so it won&apos;t update by itself. Paste pages again any time to refresh.
          </p>
        ) : null}
      </section>
    </details>
  )
}
