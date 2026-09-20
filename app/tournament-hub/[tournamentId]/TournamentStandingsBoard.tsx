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
import {
  avatarInitialsForName,
  badgeColorForIndex,
  badgeColorForName,
  initialsForName,
} from '@/lib/tournament/badgeColors'
import { BroadcastPanel } from './BroadcastPanel'
import { SettingsPanel } from './SettingsPanel'
import { AdvancementPanel } from './AdvancementPanel'
import { RedraftPanel } from './RedraftPanel'
import { CompliancePanel } from './CompliancePanel'
import { TopPerformersPanel } from './TopPerformersPanel'
import { WeeklyReportPanel } from './WeeklyReportPanel'
import { ManageConferencesPanel } from './ManageConferencesPanel'
import './tournament-hub.css'

/**
 * The commissioner's twenty leagues, scored, on one screen.
 *
 * 🛑 THE COPY BUTTON IS THE FEATURE, NOT A CONVENIENCE. The commissioner keeps
 * their own workbook — banners, formatting, hand-added notes — so this does not
 * generate a file to replace it. It puts the block on the clipboard in the
 * sheet's own column order, to paste into the sheet they already have.
 */

function TrophyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M7 5H4a2 2 0 002 4M17 5h3a2 2 0 01-2 4" />
    </svg>
  )
}

/** The page's own top bar. This route renders outside the app shell's nav. */
function HubTopBar() {
  return (
    <div className="af-th-topbar">
      <a className="af-th-back" href="/tournament-hub">
        ← Tournament Hub
      </a>
      <div className="af-th-brand">
        <span className="af-th-brand-mark" aria-hidden="true">
          AF
        </span>
        <span className="af-th-brand-word">ALLFANTASY</span>
      </div>
    </div>
  )
}

/**
 * An initials tile.
 *
 * ⚠ `aria-hidden`, ALWAYS. It repeats the name that sits beside it in every
 * caller, and a screen reader announcing "K B, KBI Beast Gold" on each of
 * twenty rows is noise, not information.
 */
function Tile({
  label,
  size,
  round,
  bg,
  fg,
}: {
  label: string
  size: number
  round?: boolean
  bg: string
  fg: string
}) {
  return (
    <span
      className={`af-th-tile${round ? ' af-th-tile--round' : ''}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.3),
        lineHeight: `${size}px`,
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  )
}

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
    <button type="button" className="af-th-copy af-th-copy--ghost" onClick={copy}>
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

/** A manager's avatar + handle, the shape the name column takes everywhere. */
function TeamCell({ name }: { name: string }) {
  const colour = badgeColorForName(name)
  return (
    <span className="af-th-teamcell">
      <Tile label={avatarInitialsForName(name)} size={22} round bg={colour.bg} fg={colour.fg} />
      <span className="af-th-teamcell-name">{name}</span>
    </span>
  )
}

/** Every manager in the tournament, flattened, for the combined views. */
type CombinedRow = {
  key: string
  name: string
  league: string
  conference: string
  /** The accent belongs to the first conference only — see the CSS note. */
  accent: boolean
  wins: number
  losses: number
  ties: number
  pointsFor: number
  standing: 'in' | 'bubble' | 'out'
  unmatched: boolean
}

export function TournamentStandingsBoard({ board }: { board: StandingsBoard }) {
  const router = useRouter()
  /*
   * ⚠ ONE PIECE OF STATE FOR BOTH KINDS OF TAB. A conference id and the literal
   * 'combined' share this slot, so there is no way to express "combined AND a
   * conference" — a second boolean would eventually disagree with this and
   * render a conference table under the combined heading.
   */
  const [view, setView] = useState<string>(board.conferences[0]?.id ?? '')
  const isCombined = view === 'combined'
  const conference = board.conferences.find((c) => c.id === view) ?? board.conferences[0]

  /*
   * 🛑 THE EXPORT FOLLOWS THE TAB. On Combined this has to cover EVERY
   * conference — scoping it to `conference` (which falls back to the first one
   * when the combined tab is open) would hand a commissioner looking at all 240
   * managers a clipboard holding only Gold, with nothing on screen to say so.
   * `buildTopScorers` already ranks across blocks, so passing every league
   * turns "Copy top scorers" into the cross-conference list the tab is showing.
   */
  const blocks = useMemo(() => {
    const leagues = isCombined
      ? board.conferences.flatMap((c) => c.leagues)
      : (conference?.leagues ?? [])
    return leagues.map((l) => ({
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
    }))
  }, [conference, isCombined, board.conferences])

  /*
   * The combined field, ordered by points across every conference.
   *
   * 🛑 UNMATCHED MANAGERS SORT TO THE BOTTOM AND CARRY NO RANK. They have no
   * record to rank, and giving them `0.00` would place them last on merit —
   * which reads as "scored nothing" rather than "we could not read this".
   * They are listed rather than dropped because a commissioner exporting a
   * 240-manager field must still be able to see who is missing.
   */
  const combined = useMemo<CombinedRow[]>(() => {
    const rows: CombinedRow[] = []
    board.conferences.forEach((c, confIndex) => {
      c.leagues.forEach((l) => {
        l.rows.forEach((r) => {
          rows.push({
            key: r.participantId,
            name: r.displayName,
            league: l.name,
            conference: c.name,
            accent: confIndex === 0,
            wins: r.wins,
            losses: r.losses,
            ties: r.ties,
            pointsFor: r.pointsFor,
            standing: r.standing,
            unmatched: r.unmatched,
          })
        })
      })
    })
    return rows.sort((a, b) => {
      if (a.unmatched !== b.unmatched) return a.unmatched ? 1 : -1
      return b.pointsFor - a.pointsFor
    })
  }, [board.conferences])

  const ranked = combined.filter((r) => !r.unmatched)
  const counts = {
    in: ranked.filter((r) => r.standing === 'in').length,
    bubble: ranked.filter((r) => r.standing === 'bubble').length,
    out: ranked.filter((r) => r.standing === 'out').length,
  }

  const totalLeagues = board.conferences.reduce((sum, c) => sum + c.leagues.length, 0)

  if (!conference) {
    /* No conferences is a setup state, not a failure — say which step is missing. */
    return (
      <main className="af-th">
        <HubTopBar />
        <h1 className="af-th-title">{board.name}</h1>
        <p className="af-th-note">
          This tournament has no conferences yet, so there is nothing to rank. Add them in setup and
          the standings appear here.
        </p>
      </main>
    )
  }

  const crest = badgeColorForName(board.name)

  return (
    <main className="af-th">
      <HubTopBar />

      <header className="af-th-head">
        <div className="af-th-identity">
          <span className="af-th-crest">
            <span className="af-th-crest-face" aria-hidden="true">
              {initialsForName(board.name)}
            </span>
            <span className="af-th-crest-badge" aria-hidden="true">
              <TrophyIcon />
            </span>
          </span>
          <div>
            <h1 className="af-th-title">{board.name}</h1>
            <p className="af-th-sub">
              Round {board.roundNumber || 1} · {totalLeagues}{' '}
              {totalLeagues === 1 ? 'league' : 'leagues'} ·{' '}
              {isCombined
                ? `${board.conferences.length} conferences`
                : `${conference.qualifyingCount} advance from ${conference.name}`}
            </p>
          </div>
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
        on them is entitled to know that rather than assume "now". It rides in
        the weekly-report card's control row, beside the week it qualifies.
      */}
      <WeeklyReportPanel
        tournamentId={board.tournamentId}
        oldestUpdatedAt={board.oldestUpdatedAt}
      />

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

      {board.conferences.length > 1 ? (
        <div className="af-th-tabs" role="tablist">
          {board.conferences.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={!isCombined && c.id === conference.id}
              className={`af-th-tab${!isCombined && c.id === conference.id ? ' af-th-tab--on' : ''}`}
              onClick={() => setView(c.id)}
            >
              {c.name}
            </button>
          ))}
          {/*
            The cut is made per conference, so Combined is a READING of the
            field rather than a third bracket — it ranks everyone together to
            show where the tournament as a whole stands.
          */}
          <button
            type="button"
            role="tab"
            aria-selected={isCombined}
            className={`af-th-tab${isCombined ? ' af-th-tab--on' : ''}`}
            onClick={() => setView('combined')}
          >
            Combined
          </button>
        </div>
      ) : null}

      {isCombined ? (
        <>
          <div className="af-th-stats">
            <div className="af-th-stat af-th-stat--in">
              <span className="af-th-stat-label">In</span>
              <span className="af-th-stat-value">{counts.in}</span>
              <span className="af-th-stat-note">
                {counts.in === 1 ? 'manager is' : 'managers are'} inside the cut across every
                conference
              </span>
            </div>
            <div className="af-th-stat af-th-stat--bubble">
              <span className="af-th-stat-label">Bubble</span>
              <span className="af-th-stat-value">{counts.bubble}</span>
              <span className="af-th-stat-note">still fighting for the last spots</span>
            </div>
            <div className="af-th-stat">
              <span className="af-th-stat-label">Out</span>
              <span className="af-th-stat-value">{counts.out}</span>
              <span className="af-th-stat-note">outside the cut as things stand</span>
            </div>
          </div>

          {/*
            ⚠ THE COUNTS ARE OF RANKED MANAGERS, and say so when some are not.
            Three numbers that do not add up to the field is the kind of thing a
            commissioner notices at the worst possible moment.
          */}
          {board.unmatchedTotal > 0 ? (
            <p className="af-th-note">
              Counts cover the {ranked.length} ranked{' '}
              {ranked.length === 1 ? 'manager' : 'managers'}. The {board.unmatchedTotal} without a
              matched team {board.unmatchedTotal === 1 ? 'is' : 'are'} listed at the bottom,
              unranked.
            </p>
          ) : null}

          <section className="af-th-league af-th-league--accent">
            <p className="af-th-eyebrow">Top of the standings · every conference</p>
            <div className="af-th-top">
              {ranked.slice(0, 8).map((row, i) => {
                const colour = badgeColorForName(row.name)
                return (
                  <div key={row.key} className="af-th-top-row">
                    <span className="af-th-top-rank">{i + 1}</span>
                    <Tile
                      label={avatarInitialsForName(row.name)}
                      size={44}
                      round
                      bg={colour.bg}
                      fg={colour.fg}
                    />
                    <span className="af-th-top-id">
                      <span className="af-th-top-name">{row.name}</span>
                      <span className="af-th-top-league">{row.league}</span>
                    </span>
                    <span
                      className={`af-th-conftag${row.accent ? ' af-th-conftag--accent' : ''}`}
                    >
                      {row.conference}
                    </span>
                    <span className="af-th-top-pts">{formatPoints(row.pointsFor)}</span>
                  </div>
                )
              })}
              {ranked.length === 0 ? (
                <p className="af-th-note">
                  No manager has a matched team yet, so there is nothing to rank.
                </p>
              ) : null}
            </div>
          </section>

          <section className="af-th-league">
            <h2 className="af-th-league-name">Full combined standings</h2>
            <div className="af-th-scroll">
              <table className="af-th-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Team Name</th>
                    <th scope="col">League</th>
                    <th scope="col">Conf</th>
                    <th scope="col">W/L</th>
                    <th scope="col">Total Pts</th>
                    <th scope="col">Standing</th>
                  </tr>
                </thead>
                <tbody>
                  {combined.map((row, i) => (
                    <tr key={row.key} className={row.unmatched ? 'af-th-row--unmatched' : undefined}>
                      <td>{row.unmatched ? '—' : i + 1}</td>
                      <td className="af-th-cell--name">
                        <TeamCell name={row.name} />
                      </td>
                      <td className="af-th-cell--plain">{row.league}</td>
                      <td>
                        <span
                          className={`af-th-conftag${row.accent ? ' af-th-conftag--accent' : ''}`}
                        >
                          {row.conference}
                        </span>
                      </td>
                      <td>{row.unmatched ? '—' : formatRecord(row.wins, row.losses, row.ties)}</td>
                      <td>{row.unmatched ? '—' : formatPoints(row.pointsFor)}</td>
                      <td>
                        {row.unmatched ? (
                          <span className="af-th-chip af-th-chip--unmatched">Not linked</span>
                        ) : (
                          <StandingChip standing={row.standing} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <p className="af-th-note">
            {conference.name} combined points:{' '}
            <strong>{formatPoints(conference.conferencePoints)}</strong>
          </p>

          {/*
            ⚠ A CONFERENCE WITH NO LEAGUES IS A SETUP STATE, NOT A BUG, and it must
            say which. Rendering the heading and combined-points line above an empty
            space reads as a table that failed to load.
          */}
          {conference.leagues.length === 0 ? (
            <p className="af-th-note">
              No leagues in {conference.name} yet — add them and its standings appear here.
            </p>
          ) : null}

          {conference.leagues.map((league, leagueIndex) => {
            const colour = badgeColorForIndex(leagueIndex)
            return (
              <section key={league.tournamentLeagueId} className="af-th-league">
                <div className="af-th-league-head">
                  <Tile
                    label={initialsForName(league.name)}
                    size={44}
                    bg={colour.bg}
                    fg={colour.fg}
                  />
                  <h2 className="af-th-league-name">
                    {league.name}
                    {league.unmatchedCount > 0 ? (
                      <span className="af-th-league-warn">{league.unmatchedCount} unlinked</span>
                    ) : null}
                  </h2>
                </div>
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
                        <tr
                          key={row.participantId}
                          className={row.unmatched ? 'af-th-row--unmatched' : undefined}
                        >
                          <td>{row.leagueRank}</td>
                          <td className="af-th-cell--name">
                            <TeamCell name={row.displayName} />
                          </td>
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
                              <span className="af-th-linknote af-th-linknote--soft">
                                Matched by name
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </>
      )}

      {/*
        ⚠ THE NOTE BELONGS TO THE TABLE, NOT TO THE SCREEN — AND IT USED TO SAY
        THE SCREEN. "This view is read-only" was true when the board was all
        there was; it now sits on a page carrying a button that ends 176 seasons,
        so as written it was a false reassurance. Reordering the page is what
        made that visible.
      */}
      {conference.leagues.length > 0 || isCombined ? (
        <p className="af-th-foot">
          The table above is a live read — it shows where everyone stands right now, and nothing
          here has been recorded. Advancing and eliminating managers is a separate, deliberate step
          below.
        </p>
      ) : null}

      {/*
        🛑 THE STANDINGS COME FIRST, AND THAT ORDER WAS WRONG UNTIL SOMEBODY
        LOOKED AT THE PAGE. The panels below are things a commissioner does
        occasionally — cut the field, plan a redraft, change a setting. The table
        is what they open this screen for every week, and it was sitting under
        five cards, off the bottom of the first screen.
      */}
      <BroadcastPanel board={board} />

      <AdvancementPanel tournamentId={board.tournamentId} />

      <RedraftPanel tournamentId={board.tournamentId} />

      <CompliancePanel tournamentId={board.tournamentId} />

      <TopPerformersPanel tournamentId={board.tournamentId} />

      <SettingsPanel board={board} />

      <ManageConferencesPanel
        key={JSON.stringify({
          conferences: board.conferences.map((conference) => ({
            id: conference.id,
            name: conference.name,
            leagues: conference.leagues.map((league) => league.tournamentLeagueId),
          })),
          archived: board.archivedConferences,
          locked: board.conferenceMembershipLocked,
        })}
        board={board}
      />
    </main>
  )
}
