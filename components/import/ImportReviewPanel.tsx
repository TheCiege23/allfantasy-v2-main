'use client'

/**
 * "Review your import" — shown after the preview and before anything is written.
 *
 * The commissioner sees what came across, what did not, and what looks wrong; fixes the simple
 * things in place; re-runs the read if they changed something on the source platform; and
 * confirms only when ready. Edits travel to the commit as `ImportReviewOverrides`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IMPORT_REVIEW } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { resolveOutstandingWarnings } from '@/lib/league-import/review/buildImportReview'
import type {
  ImportReview,
  ImportReviewOverrides,
  ImportReviewSettingRow,
  ImportReviewTeam,
  ImportReviewWarning,
} from '@/lib/league-import/review/types'
import './import-review.css'

type PlayerPick = NonNullable<ImportReviewOverrides['playerMatches']>[string]

interface ImportReviewPanelProps {
  review: ImportReview
  provider: string
  /** Set when the league can be previewed but not imported (e.g. public ESPN, no account). */
  blockedReason?: string | null
  busy?: boolean
  /** Standalone mode: the panel owns Confirm / Back. Unused when `embedded`. */
  onConfirm?: (overrides: ImportReviewOverrides | null) => void
  onRerun: () => void
  onBack?: () => void
  /**
   * Embedded mode: the host screen keeps its own import button (and its own team picker,
   * commissioner confirmation, coverage list). The panel then shows no Confirm / Back and no
   * "did not come across" list, and reports its state through `onReviewStateChange` instead.
   */
  embedded?: boolean
  onReviewStateChange?: (state: ImportReviewState) => void
}

export interface ImportReviewState {
  overrides: ImportReviewOverrides | null
  /** No blocking problem left, and open warnings acknowledged. */
  ready: boolean
  /** Call when the host commits, so analytics records a confirmation rather than an abandonment. */
  markConfirmed: () => void
}

const SLOT_LABEL: Record<string, string> = { starter: 'Starter', bench: 'Bench', ir: 'IR', taxi: 'Taxi' }

function trimmedMap(m: Record<string, string>): Record<string, string> | undefined {
  const out = Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))
  return Object.keys(out).length ? out : undefined
}

function buildOverridesFromEdits(edits: {
  teamNames: Record<string, string>
  ownerNames: Record<string, string>
  playerMatches: Record<string, PlayerPick>
}): ImportReviewOverrides | null {
  const teamNames = trimmedMap(edits.teamNames)
  const ownerNames = trimmedMap(edits.ownerNames)
  const playerMatches = Object.keys(edits.playerMatches).length ? edits.playerMatches : undefined
  if (!teamNames && !ownerNames && !playerMatches) return null
  return { teamNames, ownerNames, playerMatches }
}

export function ImportReviewPanel(props: ImportReviewPanelProps) {
  const { review, provider } = props
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({})
  const [playerMatches, setPlayerMatches] = useState<Record<string, PlayerPick>>({})
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const confirmedRef = useRef(false)

  const edits = useMemo(() => ({ teamNames, ownerNames, playerMatches }), [teamNames, ownerNames, playerMatches])
  const outstanding = useMemo(() => resolveOutstandingWarnings(review, edits), [review, edits])
  const blocking = outstanding.filter((w) => w.severity === 'blocking')
  const needsAck = outstanding.some((w) => w.severity === 'warning')
  const fixedCount = review.warnings.length - outstanding.length

  // ── Analytics: codes and counts only, never names ───────────────────────────────────────
  const shownCodes = useMemo(() => [...new Set(review.warnings.map((w) => w.code))], [review])
  useEffect(() => {
    sendProductAnalyticsBeacon(IMPORT_REVIEW.SHOWN, {
      provider,
      warningCount: review.warnings.length,
      blockingCount: review.warnings.filter((w) => w.severity === 'blocking').length,
      teamCount: review.league.importedTeamCount,
      hasChanges: Boolean(review.changes && review.changes.items.length > 0),
    })
    for (const code of shownCodes) sendProductAnalyticsBeacon(IMPORT_REVIEW.WARNING_SHOWN, { provider, code })
    return () => {
      if (!confirmedRef.current) sendProductAnalyticsBeacon(IMPORT_REVIEW.ABANDONED, { provider, warningCount: review.warnings.length })
    }
    // One review object per preview run; re-runs produce a new object and a new "shown".
  }, [review, provider, shownCodes])

  const reportedFixes = useRef(new Set<string>())
  useEffect(() => {
    const open = new Set(outstanding)
    for (const w of review.warnings) {
      if (!w.fix || open.has(w)) continue
      const key = `${w.code}:${w.teamId ?? ''}`
      if (reportedFixes.current.has(key)) continue
      reportedFixes.current.add(key)
      sendProductAnalyticsBeacon(IMPORT_REVIEW.WARNING_FIXED, { provider, code: w.code, fix: w.fix })
    }
  }, [outstanding, review, provider])

  const canConfirm = !props.blockedReason && blocking.length === 0 && (!needsAck || acknowledged) && !props.busy
  const ready = blocking.length === 0 && (!needsAck || acknowledged)

  const markConfirmed = useCallback(() => {
    if (confirmedRef.current) return
    confirmedRef.current = true
    sendProductAnalyticsBeacon(IMPORT_REVIEW.CONFIRMED, {
      provider,
      outstandingWarnings: outstanding.length,
      fixedWarnings: fixedCount,
      editedTeams: Object.keys(trimmedMap(teamNames) ?? {}).length + Object.keys(trimmedMap(ownerNames) ?? {}).length,
      matchedPlayers: Object.keys(playerMatches).length,
    })
  }, [provider, outstanding.length, fixedCount, teamNames, ownerNames, playerMatches])

  const { onReviewStateChange } = props
  useEffect(() => {
    onReviewStateChange?.({ overrides: buildOverridesFromEdits(edits), ready, markConfirmed })
  }, [onReviewStateChange, edits, ready, markConfirmed])

  function confirm() {
    if (!canConfirm) return
    markConfirmed()
    props.onConfirm?.(buildOverridesFromEdits(edits))
  }

  const teamById = useMemo(() => new Map(review.teams.map((t) => [t.teamId, t])), [review])
  const playerById = useMemo(() => {
    const m = new Map<string, { name: string; position: string; team: string; teamName: string }>()
    for (const t of review.teams) for (const p of t.players) m.set(p.id, { ...p, teamName: t.teamName || t.ownerName })
    return m
  }, [review])

  const L = review.league

  return (
    <div className="af-ir" data-testid="import-review">
      <header className="af-ir-head">
        <p className="af-label">Review your import</p>
        {props.embedded ? null : <h2 className="af-ir-title">{L.name}</h2>}
        <dl className="af-ir-facts">
          <Fact label="Platform" value={L.platform} />
          <Fact label="Season" value={L.season ? String(L.season) : 'Not reported'} />
          <Fact label="League type" value={L.leagueTypeLabel} />
          <Fact
            label="Teams"
            value={
              L.declaredTeamCount && L.declaredTeamCount !== L.importedTeamCount
                ? `${L.importedTeamCount} of ${L.declaredTeamCount}`
                : String(L.importedTeamCount)
            }
          />
        </dl>
        <p className="af-im-field-help">
          Nothing is live in AF yet. Check the details below, fix anything that looks wrong, then confirm.
        </p>
      </header>

      {/* ── Warnings ─────────────────────────────────────────────────────────────────────── */}
      {review.warnings.length > 0 ? (
        <section className="af-ir-section" aria-labelledby="af-ir-warnings" data-testid="import-review-warnings">
          <h3 id="af-ir-warnings" className="af-ir-h3">
            Needs a look{' '}
            <span className="af-ir-count">
              {outstanding.length} open{fixedCount > 0 ? ` · ${fixedCount} fixed` : ''}
            </span>
          </h3>
          <ul className="af-ir-warnings">
            {review.warnings.map((w, i) => (
              <WarningRow
                key={`${w.code}-${w.teamId ?? i}`}
                warning={w}
                fixed={!outstanding.includes(w)}
                team={w.teamId ? teamById.get(w.teamId) : undefined}
                teamName={w.teamId ? teamNames[w.teamId] ?? '' : ''}
                ownerName={w.teamId ? ownerNames[w.teamId] ?? '' : ''}
                onTeamName={(v) => w.teamId && setTeamNames((p) => ({ ...p, [w.teamId as string]: v }))}
                onOwnerName={(v) => w.teamId && setOwnerNames((p) => ({ ...p, [w.teamId as string]: v }))}
              >
                {w.fix === 'player_match' && w.playerIds ? (
                  <UnmatchedPlayers
                    ids={w.playerIds}
                    sport={L.sport}
                    playerById={playerById}
                    picks={playerMatches}
                    onPick={(id, pick) =>
                      setPlayerMatches((p) => {
                        const next = { ...p }
                        if (pick) next[id] = pick
                        else delete next[id]
                        return next
                      })
                    }
                  />
                ) : null}
              </WarningRow>
            ))}
          </ul>
        </section>
      ) : (
        <p className="af-ir-allclear" data-testid="import-review-clear">
          Everything we checked came across cleanly.
        </p>
      )}

      {/* ── Changes since the last import ───────────────────────────────────────────────── */}
      {review.changes ? <ChangesSection changes={review.changes} /> : null}

      {/* ── Teams ───────────────────────────────────────────────────────────────────────── */}
      <section className="af-ir-section" aria-labelledby="af-ir-teams">
        <h3 id="af-ir-teams" className="af-ir-h3">
          Teams <span className="af-ir-count">{review.teams.length}</span>
        </h3>
        <ul className="af-ir-teams">
          {review.teams.map((t) => {
            const open = openTeams[t.teamId] === true
            return (
              <li key={t.teamId} className="af-ir-team" data-testid={`import-review-team-${t.teamId}`}>
                <div className="af-ir-team-row">
                  <label className="af-ir-inline">
                    <span className="af-ir-inline-label">Team</span>
                    <input
                      className="af-ir-input"
                      value={teamNames[t.teamId] ?? t.teamName}
                      placeholder={t.ownerName || 'Team name'}
                      onChange={(e) => setTeamNames((p) => ({ ...p, [t.teamId]: e.target.value }))}
                      aria-label={`Team name for ${t.teamName || t.ownerName || 'team'}`}
                      maxLength={80}
                    />
                  </label>
                  <label className="af-ir-inline">
                    <span className="af-ir-inline-label">Owner</span>
                    <input
                      className={`af-ir-input${t.ownerMissing && !ownerNames[t.teamId]?.trim() ? ' af-ir-input--warn' : ''}`}
                      value={ownerNames[t.teamId] ?? t.ownerName}
                      placeholder={t.ownerMissing ? 'No owner — open team' : 'Owner'}
                      onChange={(e) => setOwnerNames((p) => ({ ...p, [t.teamId]: e.target.value }))}
                      aria-label={`Owner for ${t.teamName || 'team'}`}
                      maxLength={80}
                    />
                  </label>
                  <button
                    type="button"
                    className="af-ir-roster-toggle"
                    aria-expanded={open}
                    onClick={() => setOpenTeams((p) => ({ ...p, [t.teamId]: !open }))}
                  >
                    {t.rosterFetchFailed ? 'Roster not read' : `${t.rosterCount} players`} {open ? '▴' : '▾'}
                  </button>
                </div>
                {open ? <RosterTable team={t} /> : null}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="af-ir-grid">
        <SettingsSection title="Scoring" rows={review.scoring} />
        <section className="af-ir-section" aria-labelledby="af-ir-slots">
          <h3 id="af-ir-slots" className="af-ir-h3">Roster slots</h3>
          {review.rosterSlots.length > 0 ? (
            <ul className="af-ir-chips">
              {review.rosterSlots.map((s) => (
                <li key={s.slot} className="af-ir-chip">
                  {s.count > 1 ? `${s.count}× ` : ''}
                  {s.slot}
                </li>
              ))}
            </ul>
          ) : (
            <p className="af-im-field-help">Not reported — AF’s standard lineup will be used.</p>
          )}
        </section>
        <SettingsSection title="Schedule & playoffs" rows={review.schedule} />
        <SettingsSection title="Draft, keepers & waivers" rows={review.draft} />
      </div>

      {review.notImported.length > 0 && !props.embedded ? (
        <section className="af-ir-section af-ir-missing" aria-labelledby="af-ir-missing" data-testid="import-review-not-imported">
          <h3 id="af-ir-missing" className="af-ir-h3">Did not come across</h3>
          <ul className="af-ir-chips">
            {review.notImported.map((n) => (
              <li key={n.key} className={`af-ir-chip af-ir-chip--${n.state}`}>
                {n.label} · {n.state === 'missing' ? 'not available' : 'partial'}
              </li>
            ))}
          </ul>
          <p className="af-im-field-help">
            These are not shared by {L.platform}, or only partly. Everything else above will be imported.
          </p>
        </section>
      ) : null}

      {props.blockedReason && !props.embedded ? (
        <p className="af-im-field-help" role="status" data-testid="import-preview-blocked">
          {props.blockedReason}
        </p>
      ) : null}

      {needsAck && !props.blockedReason ? (
        <label className="af-ir-ack" data-testid="import-review-ack">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>
            I’ve reviewed the {outstanding.filter((w) => w.severity === 'warning').length === 1 ? 'warning' : 'warnings'} above
            and want to import anyway. I can fix the rest in League Settings.
          </span>
        </label>
      ) : null}

      <div className="af-im-actions">
        {props.embedded ? null : (
          <button
            type="button"
            className="af-btn af-im-submit"
            disabled={!canConfirm}
            data-testid="import-commit"
            onClick={confirm}
          >
            {props.busy ? 'Importing…' : 'Confirm and import'}
          </button>
        )}
        <button
          type="button"
          className="af-btn af-btn--ghost"
          disabled={props.busy}
          data-testid="import-review-rerun"
          onClick={() => {
            sendProductAnalyticsBeacon(IMPORT_REVIEW.RERUN, { provider, warningCount: review.warnings.length })
            // A re-run replaces this review; it is not an abandonment.
            confirmedRef.current = true
            props.onRerun()
          }}
        >
          Re-run import
        </button>
        {props.embedded || !props.onBack ? null : (
          <button type="button" className="af-btn af-btn--ghost" disabled={props.busy} onClick={props.onBack}>
            Back
          </button>
        )}
      </div>
      {!canConfirm && !props.busy && !props.blockedReason ? (
        <p className="af-im-field-help" role="status">
          {blocking.length > 0
            ? 'Fix the problem marked “must fix” above, or re-run the import.'
            : 'Tick the box above to confirm you’ve read the warnings.'}
        </p>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="af-ir-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function SettingsSection({ title, rows }: { title: string; rows: ImportReviewSettingRow[] }) {
  return (
    <section className="af-ir-section">
      <h3 className="af-ir-h3">{title}</h3>
      <dl className="af-ir-rows">
        {rows.map((r) => (
          <div key={r.label} className="af-ir-row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const SEVERITY_LABEL = { blocking: 'Must fix', warning: 'Warning', info: 'FYI' } as const

function WarningRow(props: {
  warning: ImportReviewWarning
  fixed: boolean
  team?: ImportReviewTeam
  teamName: string
  ownerName: string
  onTeamName: (v: string) => void
  onOwnerName: (v: string) => void
  children?: React.ReactNode
}) {
  const w = props.warning
  return (
    <li
      className={`af-ir-warning af-ir-warning--${w.severity}${props.fixed ? ' af-ir-warning--fixed' : ''}`}
      data-testid={`import-review-warning-${w.code}`}
    >
      <div className="af-ir-warning-head">
        <span className="af-ir-badge">{props.fixed ? 'Fixed' : SEVERITY_LABEL[w.severity]}</span>
        <p className="af-ir-warning-title">{w.title}</p>
      </div>
      <p className="af-im-field-help">{w.detail}</p>
      {w.fix === 'owner' && props.team ? (
        <input
          className="af-ir-input"
          value={props.ownerName}
          onChange={(e) => props.onOwnerName(e.target.value)}
          placeholder="Owner name (optional)"
          aria-label={`Owner name for ${props.team.teamName || 'team'}`}
          maxLength={80}
        />
      ) : null}
      {w.fix === 'team_name' && props.team ? (
        <input
          className="af-ir-input"
          value={props.teamName}
          onChange={(e) => props.onTeamName(e.target.value)}
          placeholder="Team name"
          aria-label="Team name"
          maxLength={80}
        />
      ) : null}
      {props.children}
    </li>
  )
}

function UnmatchedPlayers(props: {
  ids: string[]
  sport: string
  playerById: Map<string, { name: string; position: string; team: string; teamName: string }>
  picks: Record<string, PlayerPick>
  onPick: (id: string, pick: PlayerPick | null) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const ids = showAll ? props.ids : props.ids.slice(0, 8)
  return (
    <div className="af-ir-unmatched">
      <ul>
        {ids.map((id) => {
          const p = props.playerById.get(id)
          const pick = props.picks[id]
          return (
            <li key={id} className="af-ir-unmatched-row">
              <div className="af-ir-unmatched-who">
                <strong>{p?.name ?? id}</strong>
                <span>
                  {[p?.position, p?.team, p?.teamName].filter(Boolean).join(' · ')}
                </span>
              </div>
              {pick ? (
                <div className="af-ir-picked">
                  <span>
                    Matched to <strong>{pick.name}</strong>
                    {pick.position ? ` · ${pick.position}` : ''}
                    {pick.team ? ` · ${pick.team}` : ''}
                  </span>
                  <button type="button" className="af-ir-link" onClick={() => props.onPick(id, null)}>
                    Undo
                  </button>
                </div>
              ) : (
                <PlayerSearch sport={props.sport} initial={p?.name ?? ''} onPick={(pk) => props.onPick(id, pk)} />
              )}
            </li>
          )
        })}
      </ul>
      {props.ids.length > 8 ? (
        <button type="button" className="af-ir-link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${props.ids.length}`}
        </button>
      ) : null}
    </div>
  )
}

type SearchHit = { afPlayerId: string; name: string; position: string | null; team: string | null }

function PlayerSearch(props: { sport: string; initial: string; onPick: (p: PlayerPick) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits(null)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/leagues/import/player-search?q=${encodeURIComponent(term)}&sport=${encodeURIComponent(props.sport)}`,
          { signal: ctrl.signal, credentials: 'include' },
        )
        if (!res.ok) {
          setError(res.status === 429 ? 'Searching too fast — wait a moment.' : 'Search is unavailable right now.')
          setHits([])
          return
        }
        const json = (await res.json()) as { players?: SearchHit[] }
        setError(null)
        setHits(json.players ?? [])
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') setError('Search is unavailable right now.')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [q, props.sport])

  return (
    <div className="af-ir-search">
      <input
        className="af-ir-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={props.initial ? `Search for ${props.initial}` : 'Search AF players'}
        aria-label={`Search AF players${props.initial ? ` for ${props.initial}` : ''}`}
      />
      {loading ? <p className="af-im-field-help">Searching…</p> : null}
      {error ? <p className="af-im-field-help" role="status">{error}</p> : null}
      {hits && hits.length === 0 && !error && !loading ? <p className="af-im-field-help">No players found.</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="af-ir-hits" role="listbox" aria-label="Matching players">
          {hits.map((h) => (
            <li key={h.afPlayerId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="af-ir-hit"
                onClick={() => props.onPick({ afPlayerId: h.afPlayerId, name: h.name, position: h.position, team: h.team })}
              >
                <strong>{h.name}</strong> {[h.position, h.team].filter(Boolean).join(' · ')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function RosterTable({ team }: { team: ImportReviewTeam }) {
  if (team.players.length === 0) {
    return <p className="af-im-field-help af-ir-roster-empty">No players on this roster.</p>
  }
  return (
    <table className="af-ir-roster">
      <thead>
        <tr>
          <th scope="col">Player</th>
          <th scope="col">Pos</th>
          <th scope="col">Slot</th>
          <th scope="col">
            <span className="af-ir-sr">Matched</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {team.players.map((p) => (
          <tr key={p.id}>
            <td>
              {p.name}
              {p.team ? <span className="af-ir-muted"> {p.team}</span> : null}
            </td>
            <td>{p.position || '—'}</td>
            <td>{SLOT_LABEL[p.slot]}</td>
            <td>
              {p.matched === false ? (
                <span className="af-ir-flag" title="Not matched to AF’s player database">Unmatched</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ChangesSection({ changes }: { changes: NonNullable<ImportReview['changes']> }) {
  const [open, setOpen] = useState(false)
  const none = changes.items.length === 0
  const when = changes.lastImportedAt ? new Date(changes.lastImportedAt).toLocaleDateString() : null
  return (
    <section className="af-ir-section af-ir-changes" aria-labelledby="af-ir-changes" data-testid="import-review-changes">
      <h3 id="af-ir-changes" className="af-ir-h3">
        Changes since your last import{when ? ` (${when})` : ''}
      </h3>
      {none ? (
        <p className="af-im-field-help">Nothing has changed — confirming will refresh the same data.</p>
      ) : (
        <>
          <p className="af-im-field-help">
            {[
              changes.playersAdded ? `${changes.playersAdded} players added` : null,
              changes.playersRemoved ? `${changes.playersRemoved} dropped` : null,
              changes.teamsChanged ? `${changes.teamsChanged} team changes` : null,
              changes.settingsChanged ? `${changes.settingsChanged} settings changed` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            . Nothing is overwritten until you confirm.
          </p>
          <button type="button" className="af-ir-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open ? (
            <ul className="af-ir-change-list">
              {changes.items.map((c, i) => (
                <li key={`${c.scope}-${c.label}-${i}`} className={`af-ir-change af-ir-change--${c.kind}`}>
                  <span className="af-ir-change-kind">{c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '~'}</span>
                  <span>
                    <strong>{c.label}</strong>
                    {c.detail ? ` — ${c.detail}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  )
}
