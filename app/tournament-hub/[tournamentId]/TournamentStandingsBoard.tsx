'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { BoardLeague, BoardRow, StandingsBoard } from '@/lib/tournament/standingsBoard'
import {
  buildConferenceStandingsExport,
  buildTopScorers,
  buildTopScorersExport,
  formatPoints,
  formatRecord,
} from '@/lib/tournament/standingsExport'
import { BroadcastPanel } from './BroadcastPanel'
import './tournament-hub.css'

/**
 * The commissioner's twenty leagues, scored, on one screen.
 *
 * 🛑 THE COPY BUTTON IS THE FEATURE, NOT A CONVENIENCE. The commissioner keeps
 * their own workbook — banners, formatting, hand-added notes — so this does not
 * generate a file to replace it. It puts the block on the clipboard in the
 * sheet's own column order, to paste into the sheet they already have.
 */

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    const text = getText()
    try {
      /*
       * ⚠ `navigator.clipboard` IS NOT ALWAYS THERE. It is undefined on an
       * insecure origin and can reject when the document is not focused — and a
       * copy button that silently does nothing is worse than one that admits it,
       * because the commissioner pastes stale content and does not know.
       */
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard api')
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2400)
  }

  return (
    <button type="button" className="af-th-copy" onClick={copy}>
      {state === 'copied' ? '✓ Copied' : state === 'failed' ? 'Copy failed — select below' : label}
    </button>
  )
}

/**
 * The manual override for a manager the automatic match missed.
 *
 * 🛑 ONLY UNCLAIMED TEAMS ARE OFFERED. Listing every team in the league would let
 * a commissioner hand one manager's season to another with a single wrong click,
 * and the wrong pick is not obvious afterwards — both managers then show a
 * record, one of them somebody else's.
 */
function LinkPicker({
  tournamentId,
  row,
  league,
  onLinked,
}: {
  tournamentId: string
  row: BoardRow
  league: BoardLeague
  onLinked: () => void
}) {
  const [externalId, setExternalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (league.unclaimedTeams.length === 0) {
    /* No free team means the roster and the import disagree about who is in this
       league — a different problem, and saying so beats an empty dropdown. */
    return <span className="af-th-linknote">No unclaimed team in this league</span>
  }

  async function submit() {
    if (!externalId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/link-manager`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueParticipantId: row.leagueParticipantId, externalId }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not link that manager')
      onLinked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link that manager')
      setBusy(false)
    }
  }

  return (
    <span className="af-th-link">
      <label className="af-th-sr" htmlFor={`link-${row.leagueParticipantId}`}>
        Team for {row.displayName}
      </label>
      <select
        id={`link-${row.leagueParticipantId}`}
        className="af-th-select"
        value={externalId}
        disabled={busy}
        onChange={(e) => setExternalId(e.target.value)}
      >
        <option value="">Link to team…</option>
        {league.unclaimedTeams.map((t) => (
          <option key={t.externalId} value={t.externalId}>
            {t.teamName || t.ownerName || `Team ${t.externalId}`}
            {t.ownerName && t.teamName && t.ownerName !== t.teamName ? ` (${t.ownerName})` : ''} ·{' '}
            {t.wins}-{t.losses}
          </option>
        ))}
      </select>
      <button type="button" className="af-th-linkbtn" disabled={!externalId || busy} onClick={submit}>
        {busy ? 'Linking…' : 'Link'}
      </button>
      {error ? (
        <span className="af-th-linkerr" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}

function StandingChip({ standing }: { standing: 'in' | 'bubble' | 'out' }) {
  const label = standing === 'in' ? 'In' : standing === 'bubble' ? 'Bubble' : 'Out'
  return <span className={`af-th-chip af-th-chip--${standing}`}>{label}</span>
}

export function TournamentStandingsBoard({ board }: { board: StandingsBoard }) {
  const router = useRouter()
  const [conferenceId, setConferenceId] = useState(board.conferences[0]?.id ?? '')
  const conference = board.conferences.find((c) => c.id === conferenceId) ?? board.conferences[0]

  const blocks = useMemo(
    () =>
      (conference?.leagues ?? []).map((l) => ({
        leagueName: l.name,
        rows: l.rows.map((r) => ({
          rank: r.leagueRank,
          teamName: r.displayName,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          pointsFor: r.pointsFor,
          unmatched: r.unmatched,
        })),
      })),
    [conference],
  )

  if (!conference) {
    /* No conferences is a setup state, not a failure — say which step is missing. */
    return (
      <main className="af-th">
        <h1 className="af-th-title">{board.name}</h1>
        <p className="af-th-note">
          This tournament has no conferences yet, so there is nothing to rank. Add them in setup and
          the standings appear here.
        </p>
      </main>
    )
  }

  return (
    <main className="af-th">
      <header className="af-th-head">
        <div>
          <h1 className="af-th-title">{board.name}</h1>
          <p className="af-th-sub">
            Round {board.roundNumber || 1} · {conference.leagues.length} leagues ·{' '}
            {conference.qualifyingCount} advance from {conference.name}
          </p>
        </div>
        <div className="af-th-actions">
          <CopyButton
            label="Copy standings for Excel"
            getText={() => buildConferenceStandingsExport(blocks).tsv}
          />
          <CopyButton
            label="Copy top scorers"
            getText={() => buildTopScorersExport(buildTopScorers(blocks, 10))}
          />
        </div>
      </header>

      {/*
        ⚠ STALENESS IS STATED, NOT IMPLIED. These numbers are as fresh as the last
        sync of the STALEST league, and a commissioner about to cut 176 managers
        on them is entitled to know that rather than assume "now".
      */}
      {board.oldestUpdatedAt ? (
        <p className="af-th-note">
          Records as last synced. Oldest league last updated{' '}
          {new Date(board.oldestUpdatedAt).toLocaleString()}.
        </p>
      ) : null}

      {/*
        🛑 UNMATCHED MANAGERS ARE NAMED UP FRONT. They are not scored, so they are
        not ranked, and a commissioner who exports without noticing cuts people
        whose record we simply could not read.
      */}
      {board.unmatchedTotal > 0 ? (
        <p className="af-th-warn" role="alert">
          {board.unmatchedTotal} {board.unmatchedTotal === 1 ? 'manager has' : 'managers have'} no
          matching team in the imported league. They are shown without a record and are excluded
          from the cut and from conference points — link them before advancing anyone.
        </p>
      ) : null}

      <BroadcastPanel board={board} />

      {board.conferences.length > 1 ? (
        <div className="af-th-tabs" role="tablist">
          {board.conferences.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === conference.id}
              className={`af-th-tab${c.id === conference.id ? ' af-th-tab--on' : ''}`}
              onClick={() => setConferenceId(c.id)}
              style={c.colorHex ? { borderColor: c.colorHex } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      <p className="af-th-note">
        {conference.name} combined points: <strong>{formatPoints(conference.conferencePoints)}</strong>
      </p>

      {conference.leagues.map((league) => (
        <section key={league.tournamentLeagueId} className="af-th-league">
          <h2 className="af-th-league-name">
            {league.name}
            {league.unmatchedCount > 0 ? (
              <span className="af-th-league-warn">{league.unmatchedCount} unlinked</span>
            ) : null}
          </h2>
          <div className="af-th-scroll">
            <table className="af-th-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Team Name</th>
                  <th scope="col">W/L</th>
                  <th scope="col">Total Pts</th>
                  <th scope="col">Conf. Rank</th>
                  <th scope="col">Standing</th>
                  <th scope="col">Link</th>
                </tr>
              </thead>
              <tbody>
                {league.rows.map((row) => (
                  <tr key={row.participantId} className={row.unmatched ? 'af-th-row--unmatched' : undefined}>
                    <td>{row.leagueRank}</td>
                    <td>{row.displayName}</td>
                    {/*
                      ⚠ BLANK, NOT `0-0` / `0.00`. Missing is not zero, and in a
                      240-manager field where points-for is the first tiebreaker,
                      a placeholder zero eliminates the wrong person.
                    */}
                    <td>{row.unmatched ? '—' : formatRecord(row.wins, row.losses, row.ties)}</td>
                    <td>{row.unmatched ? '—' : formatPoints(row.pointsFor)}</td>
                    <td>{row.unmatched ? '—' : row.conferenceRank}</td>
                    <td>
                      {row.unmatched ? (
                        <span className="af-th-chip af-th-chip--unmatched">Not linked</span>
                      ) : (
                        <StandingChip standing={row.standing} />
                      )}
                    </td>
                    <td>
                      {row.unmatched ? (
                        <LinkPicker
                          tournamentId={board.tournamentId}
                          row={row}
                          league={league}
                          /* ⚠ `refresh()` rather than local state: the link changes
                             the CONFERENCE ranking, so every other league's cut
                             line moves too. Patching this row would leave the
                             rest of the board quietly wrong. */
                          onLinked={() => router.refresh()}
                        />
                      ) : row.matchedBy === 'commissionerLink' ? (
                        <span className="af-th-linknote">Linked by you</span>
                      ) : row.matchedBy === 'ownerName' || row.matchedBy === 'teamName' ? (
                        /* A name match is a guess that happened to land — say so,
                           because a manager who renames their team breaks it. */
                        <span className="af-th-linknote af-th-linknote--soft">Matched by name</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/*
        ⚠ NOTHING ON THIS SCREEN ADVANCES ANYBODY. `identifyQualifiers` writes
        `advancementStatus`; this recomputes the same ranking with the same
        comparator and persists none of it. Opening a dashboard must not end
        someone's season.
      */}
      <p className="af-th-foot">
        This view is read-only — it shows where everyone stands right now. Advancing and eliminating
        managers stays a separate, deliberate step.
      </p>
    </main>
  )
}
