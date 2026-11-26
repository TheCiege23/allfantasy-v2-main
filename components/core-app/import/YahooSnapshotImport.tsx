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
  | { k: 'done'; leagueId: string; name: string; updated: boolean; member: boolean }

interface PreviewView {
  name: string
  season: number | null
  teamCount: number
  scoring: string | null
  rosterSlots: string[]
  draftPicks: number
  /** The preview's managers: `rosterId` is the team's source id, what the commit's claim takes. */
  teams: Array<{ id: string; name: string; manager: string | null }>
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
    teams: Array.isArray(d.managers)
      ? d.managers
          .map((m: Record<string, unknown>) => ({
            id: String(m.rosterId ?? ''),
            name: String(m.teamName ?? m.displayName ?? ''),
            manager: typeof m.displayName === 'string' && m.displayName && m.displayName !== m.teamName ? m.displayName : null,
          }))
          .filter((t: { id: string; name: string }) => t.id && t.name)
      : [],
  }
}

/** "Which team is yours?" — a team's source id, or this for a commissioner who runs no team. */
export const YAHOO_NO_TEAM = 'none'

/**
 * "Who runs this league?" — the same answers, and the same wire values, as ESPN's
 * `espnLeagueRunBy` (`me` / `member`). See lib/league-import/espn/espnPublicMemberImport.ts.
 *
 * 🛑 THIS WAS A SINGLE "I'm the commissioner" CHECKBOX THAT HAD TO BE TICKED TO IMPORT AT ALL, so a
 * member of a public league Yahoo created (owner report 2026-11-26) could only get in by attesting to
 * something false. A member now imports with their team and no attestation is sent.
 */
export type YahooLeagueRunBy = 'me' | 'member'

const YAHOO_RUN_BY_OPTIONS: ReadonlyArray<{ value: YahooLeagueRunBy; label: string; help: string }> = [
  {
    value: 'me',
    label: 'I’m the commissioner',
    help: 'You run this league on Yahoo. You get the commissioner’s C on AllFantasy.',
  },
  {
    value: 'member',
    label: 'I’m a member of this league',
    help: 'Someone else runs it — including a public league Yahoo set up. Pick your team and you join as a member.',
  },
]

/**
 * Why the Import button is disabled, as one line, or null when it is not. The button used to grey out
 * with no word of explanation until the commissioner box was ticked.
 *
 * A member must pick a real team — "I don't have a team" is a commissioner-only answer.
 */
export function yahooImportBlockedHint(runBy: YahooLeagueRunBy | null, teamChoice: string): string | null {
  const needs: string[] = []
  if (!teamChoice || (runBy === 'member' && teamChoice === YAHOO_NO_TEAM)) needs.push('pick your team')
  if (!runBy) needs.push('choose “I’m the commissioner” or “I’m a member of this league”')
  if (needs.length === 0) return null
  const line = needs.join(' and ')
  return `To import, ${line}.`
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
  const [runBy, setRunBy] = useState<YahooLeagueRunBy | null>(null)
  const [teamChoice, setTeamChoice] = useState('')
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
        if (!runBy) return
        /* The picked team is claimed for the importer (a commissioner's also gets the C); nothing on a
           pasted page says which team is theirs, so without it the league lands with no owner. */
        const claimSourceTeamId = teamChoice && teamChoice !== YAHOO_NO_TEAM ? teamChoice : undefined
        const result = await submitImportCreation(
          'yahoo',
          sourceId,
          '',
          /* 🛑 The commissioner attestation is sent ONLY by someone who said they are the commissioner. */
          runBy === 'me' ? { accepted: true, statement: 'I am the commissioner of this Yahoo league.' } : undefined,
          {
            yahooLeagueRunBy: runBy,
            ...(force ? { force: true } : {}),
            ...(claimSourceTeamId ? { claimSourceTeamId } : {}),
          },
        )
        if (!result.ok || !result.data?.league) {
          setAlreadyImported(result.code === 'LEAGUE_ALREADY_IMPORTED')
          setError(result.error ?? 'The import did not finish. Try again.')
          return
        }
        /*
         * ⚠ A SECOND PLAIN IMPORT OF THE SAME LEAGUE IS A 200 THAT WROTE NOTHING: the server matched the
         * earlier completed run and returned it untouched (`existed`). Saying "Imported" there told the
         * commissioner their new pages and team pick had landed when they had not.
         */
        if (!force && result.existed) {
          setAlreadyImported(true)
          setError('This league is already in your account. Update it with the pages you pasted?')
          return
        }
        setPhase({
          k: 'done',
          leagueId: result.data.league.id,
          name: result.data.league.name,
          updated: force,
          member: runBy === 'member',
        })
      } finally {
        setBusy(false)
      }
    },
    [sourceId, teamChoice, runBy],
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
    setRunBy(null)
    setTeamChoice('')
    setPhase({ k: 'start' })
  }, [checklist])

  if (!enabled) return null

  const rostersAdded = checklist?.teams.filter((t) => t.hasRoster).length ?? 0
  /* A preview with no teams has nothing to pick from: a commissioner imports with no team, a member cannot. */
  const blockedHint =
    phase.k === 'review'
      ? yahooImportBlockedHint(runBy, phase.preview.teams.length > 0 ? teamChoice : YAHOO_NO_TEAM)
      : null

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
            <fieldset className="af-im-runby" data-testid="yahoo-run-by">
              <legend className="af-label">Who runs this league on Yahoo?</legend>
              {YAHOO_RUN_BY_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className="af-im-runby-option"
                  data-selected={runBy === o.value ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name="yahoo-run-by"
                    value={o.value}
                    checked={runBy === o.value}
                    data-testid={`yahoo-run-by-${o.value}`}
                    disabled={busy}
                    onChange={() => {
                      setRunBy(o.value)
                      /* "I don't have a team" is not an answer a member can give. */
                      if (o.value === 'member' && teamChoice === YAHOO_NO_TEAM) setTeamChoice('')
                    }}
                  />
                  <span className="af-im-runby-text">
                    <strong>{o.label}</strong>
                    <span className="af-im-field-help">{o.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {phase.preview.teams.length > 0 ? (
              <label className="af-im-fx-field">
                <span>Which team is yours?</span>
                <select
                  className="af-im-ys-input"
                  value={teamChoice}
                  onChange={(e) => setTeamChoice(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Pick your team</option>
                  {phase.preview.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.manager ? `${t.name} (${t.manager})` : t.name}
                    </option>
                  ))}
                  {runBy !== 'member' ? (
                    <option value={YAHOO_NO_TEAM}>I don&apos;t have a team in this league</option>
                  ) : null}
                </select>
              </label>
            ) : null}
            <div className="af-im-ys-row af-im-ys-row--end">
              <button type="button" className="af-im-ys-quiet" onClick={() => setPhase({ k: 'collect' })} disabled={busy}>
                ← Back
              </button>
              {alreadyImported ? (
                <button type="button" className="af-im-fx-go" onClick={() => void commit(true)} disabled={busy || blockedHint !== null}>
                  {busy ? 'Updating…' : 'Update my existing league'}
                </button>
              ) : (
                <button type="button" className="af-im-fx-go" onClick={() => void commit(false)} disabled={busy || blockedHint !== null}>
                  {busy ? 'Importing…' : 'Import league'}
                </button>
              )}
            </div>
            {blockedHint ? (
              <p className="af-im-fx-note" data-testid="yahoo-import-blocked-hint">
                {blockedHint}
              </p>
            ) : null}
          </>
        ) : null}

        {phase.k === 'done' ? (
          <div className="af-im-fx-done" role="status">
            <p className="af-im-fx-done-h">
              {phase.updated ? 'Updated' : 'Imported'} {phase.name}
            </p>
            {phase.member ? (
              <p className="af-im-fx-note">You joined as a member with your team. Commissioner tools stay with the league&apos;s commissioner.</p>
            ) : null}
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
