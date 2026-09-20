'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { badgeColorForIndex, initialsForName } from '@/lib/tournament/badgeColors'
import '../[tournamentId]/tournament-hub.css'

/**
 * Group leagues you already have into one tournament.
 *
 * 🛑 EXPLICIT PICKING, NOT AUTO-DETECTION. An import cannot tell which of a
 * commissioner's leagues belong to the same tournament — the leagues carry no
 * such relationship on any platform — and guessing wrong here puts a stranger's
 * league into someone's cut. The commissioner knows; this asks them.
 */

export type PickableLeague = {
  id: string
  name: string
  platform: string
  season: number | null
  teamCount: number
  /** Already in a tournament — shown, but not selectable. */
  takenBy: string | null
}

type ConferenceDraft = { name: string; leagueIds: string[] }

function TrophyIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
      <path d="M7 5H4a2 2 0 002 4M17 5h3a2 2 0 01-2 4" />
    </svg>
  )
}

export function NewTournamentClient({ leagues }: { leagues: PickableLeague[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [weekStart, setWeekStart] = useState('1')
  const [weekEnd, setWeekEnd] = useState('9')
  const [advancePerConference, setAdvancePerConference] = useState('64')
  const [bubbleSize, setBubbleSize] = useState('6')
  const [redraftWeek, setRedraftWeek] = useState('10')
  const [eliteWeek, setEliteWeek] = useState('15')
  const [championshipWeek, setChampionshipWeek] = useState('17')
  const [conferences, setConferences] = useState<ConferenceDraft[]>([
    { name: 'Conference 1', leagueIds: [] },
  ])
  /*
   * ⚠ ONE PANEL OPEN AT A TIME, BY INDEX. Two open add-panels put the same
   * league in front of the commissioner twice with different buttons, and the
   * second click then silently moves it rather than adding it.
   */
  const [openPanel, setOpenPanel] = useState<number | null>(0)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = leagues.filter((l) => !l.takenBy)
  const assigned = new Set(conferences.flatMap((c) => c.leagueIds))
  const byId = new Map(leagues.map((l) => [l.id, l]))

  /*
   * The season is DERIVED, never typed. It is a fact about the leagues that were
   * picked, and a field the commissioner can contradict is a field that will be
   * wrong — the create API takes no season, so a typed one would be decoration.
   */
  const seasons = [
    ...new Set(
      [...assigned].map((id) => byId.get(id)?.season).filter((s): s is number => s != null),
    ),
  ].sort((a, b) => a - b)
  const seasonLabel =
    seasons.length === 0 ? '—' : seasons.length === 1 ? String(seasons[0]) : `${seasons[0]}–${seasons[seasons.length - 1]}`

  function toggle(confIndex: number, leagueId: string) {
    setConferences((prev) =>
      prev.map((c, i) => {
        if (i !== confIndex) {
          /* ⚠ Selecting a league in one conference removes it from any other.
             A league in two conferences is scored twice and its managers ranked
             against two different cuts — the API refuses it, and the UI should
             never let it be expressed in the first place. */
          return { ...c, leagueIds: c.leagueIds.filter((id) => id !== leagueId) }
        }
        return c.leagueIds.includes(leagueId)
          ? { ...c, leagueIds: c.leagueIds.filter((id) => id !== leagueId) }
          : { ...c, leagueIds: [...c.leagueIds, leagueId] }
      }),
    )
  }

  const ready =
    name.trim().length > 0 &&
    conferences.filter((c) => c.leagueIds.length > 0).every((c) => c.name.trim().length > 0) &&
    conferences.some((c) => c.leagueIds.length > 0) &&
    !saving

  async function submit() {
    if (!ready || !reviewing) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tournament/import-from-leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          openingWeekStart: Number(weekStart),
          openingWeekEnd: Number(weekEnd),
          conferences: conferences
            .filter((c) => c.leagueIds.length > 0)
            .map((c) => ({ name: c.name.trim(), leagueIds: c.leagueIds })),
          /* KBI's cut is conference-wide, so nobody auto-advances by winning
             their own league. That is what `advancersPerLeague: 0` means. */
          advancersPerLeague: 0,
          wildcardCount: Number(advancePerConference),
          bubbleEnabled: Number(bubbleSize) > 0,
          bubbleSize: Number(bubbleSize),
          /*
           * ⚠ THE REST OF THE CALENDAR, OR THE TOURNAMENT ENDS AT WEEK 9.
           * A shell with only an opening round is marked complete the first time
           * the cut runs, because the engine finds no next round to move into.
           */
          bubbleWeek: Number(bubbleSize) > 0 ? Number(weekEnd) : undefined,
          redraftWeek: redraftWeek ? Number(redraftWeek) : undefined,
          eliteRedraftWeek: eliteWeek ? Number(eliteWeek) : undefined,
          championshipWeek: championshipWeek ? Number(championshipWeek) : undefined,
        }),
      })
      const body = (await res.json()) as { error?: string; tournamentId?: string }
      if (!res.ok || !body.tournamentId) {
        throw new Error(body.error ?? 'Could not create that tournament')
      }
      router.push(`/tournament-hub/${body.tournamentId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that tournament')
      setSaving(false)
    }
  }

  const matchesSearch = (l: PickableLeague) =>
    `${l.name} ${l.season ?? ''}`.toLowerCase().includes(search.toLowerCase())

  return (
    <main className="af-th af-th--setup">
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

      <header className="af-th-head">
        <div className="af-th-identity">
          <span className="af-th-icon">
            <TrophyIcon />
          </span>
          <div>
            <h1 className="af-th-title">Create a tournament</h1>
            <p className="af-th-sub">
              Split your connected leagues into conferences and set the road to the trophy.
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {available.length === 0 ? (
        <p className="af-th-note">
          {leagues.length === 0 ? 'No imported leagues found on this account.' : 'All your leagues are already connected to a tournament.'}
          {' '}<a href="/tournament-hub">View your tournaments</a>
        </p>
      ) : null}

      {!reviewing && <>
      <section className="af-th-league">
        <p className="af-th-eyebrow">Tournament basics</p>
        <div className="af-th-basics">
          <label className="af-th-field">
            <span>Name</span>
            <input
              className="af-th-input"
              value={name}
              placeholder="King Buffalo Invitational"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="af-th-field">
            <span>Season</span>
            <div className="af-th-readonly">{seasonLabel}</div>
          </div>
        </div>
        <p className="af-th-foot">
          Conferences, round-robin scoring, then the cut for whoever advances. The season is taken
          from the leagues you pick. You can rename anything later from tournament settings.
        </p>
      </section>

      <div className="af-th-confgrid">
        {conferences.map((conf, i) => {
          const rows = conf.leagueIds.map((id) => byId.get(id)).filter(Boolean) as PickableLeague[]
          const panelOpen = openPanel === i
          const connectable = leagues.filter((l) => !conf.leagueIds.includes(l.id) && matchesSearch(l))
          return (
            <section
              key={i}
              className={`af-th-confcard${i === 0 ? ' af-th-confcard--accent' : ''}`}
              aria-label={conf.name.trim() || `Conference ${i + 1}`}
            >
              <div className="af-th-conf-head">
                <span className="af-th-conf-label">{conf.name.trim() || `Conference ${i + 1}`}</span>
                <span className="af-th-conf-count">
                  {rows.length} {rows.length === 1 ? 'league' : 'leagues'} connected
                </span>
                <button
                  type="button"
                  className="af-th-linkbtn"
                  aria-expanded={panelOpen}
                  onClick={() => setOpenPanel(panelOpen ? null : i)}
                >
                  {panelOpen ? 'Done adding' : '+ Add league'}
                </button>
              </div>

              <label className="af-th-field">
                <span>Conference name</span>
                <input
                  className="af-th-input"
                  value={conf.name}
                  placeholder={i === 0 ? 'BLACK' : 'GOLD'}
                  onChange={(e) =>
                    setConferences((prev) =>
                      prev.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)),
                    )
                  }
                />
              </label>

              {rows.length === 0 ? (
                <p className="af-th-empty">No leagues yet — add one to fill this conference.</p>
              ) : null}

              {rows.map((l, rowIndex) => {
                const colour = badgeColorForIndex(rowIndex)
                return (
                  <div key={l.id} className="af-th-leaguerow">
                    <span
                      className="af-th-tile"
                      aria-hidden="true"
                      style={{
                        width: 32,
                        height: 32,
                        background: colour.bg,
                        color: colour.fg,
                        fontSize: 11,
                        lineHeight: '32px',
                        display: 'inline-block',
                        borderRadius: 8,
                      }}
                    >
                      {initialsForName(l.name)}
                    </span>
                    <span className="af-th-leaguerow-id">
                      <span className="af-th-leaguerow-name">{l.name}</span>
                      <span className="af-th-leaguerow-meta">
                        {l.platform}
                        {l.season != null ? ` · ${l.season}` : ''} · {l.teamCount} teams
                      </span>
                    </span>
                    {/*
                      ⚠ SEED IS POSITION IN THIS LIST, so removing a league
                      renumbers the rest. Nothing is stored against it — the cut
                      is made on record then points for — so it reads as order,
                      which is exactly what it is.
                    */}
                    <span className="af-th-seed">SEED {rowIndex + 1}</span>
                    <button
                      type="button"
                      className="af-th-remove"
                      aria-label={`Remove ${l.name} from ${conf.name.trim() || `Conference ${i + 1}`}`}
                      onClick={() => toggle(i, l.id)}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}

              {panelOpen ? (
                <div className="af-th-addpanel">
                  <p className="af-th-eyebrow">Connectable leagues</p>
                  <label className="af-th-field">
                    <span>Search · {assigned.size} selected in total</span>
                    <input
                      className="af-th-input"
                      type="search"
                      placeholder="Search league name or season"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="af-th-actions">
                    <button
                      type="button"
                      className="af-th-linkbtn"
                      onClick={() => setConferences((prev) => prev.map((c, j) => j === i ? { ...c, leagueIds: [...new Set([...c.leagueIds, ...available.filter((l) => !assigned.has(l.id) && matchesSearch(l)).map((l) => l.id)])] } : c))}
                    >
                      Select all matching unassigned leagues
                    </button>
                    <button
                      type="button"
                      className="af-th-linkbtn"
                      onClick={() => setConferences((prev) => prev.map((c, j) => j === i ? { ...c, leagueIds: [] } : c))}
                    >
                      Clear selection
                    </button>
                  </div>
                  {connectable.length === 0 ? (
                    <p className="af-th-empty">No leagues match that search.</p>
                  ) : null}
                  {connectable.map((l) => {
                    const elsewhere = assigned.has(l.id)
                    const blocked = Boolean(l.takenBy)
                    return (
                      <label
                        key={l.id}
                        className={`af-th-pick${blocked || elsewhere ? ' af-th-pick--off' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="af-th-sr"
                          checked={false}
                          disabled={blocked}
                          onChange={() => toggle(i, l.id)}
                        />
                        <span className="af-th-pick-id">
                          <span className="af-th-pick-name">{l.name}</span>
                          <span className="af-th-pick-meta">
                            {l.platform}
                            {l.season != null ? ` · ${l.season}` : ''} · {l.teamCount} teams
                            {l.takenBy ? ` · already in ${l.takenBy}` : ''}
                            {elsewhere ? ' · in another conference' : ''}
                          </span>
                        </span>
                        {!blocked ? <span className="af-th-pick-add">{elsewhere ? 'Move' : 'Add'}</span> : null}
                      </label>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="af-th-grid2">
        <section className="af-th-league">
          <p className="af-th-eyebrow">Advancement rules</p>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Advance per conference</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              aria-label="Advance per conference"
              value={advancePerConference}
              onChange={(e) => setAdvancePerConference(e.target.value)}
            />
          </div>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Bubble spots (0 for none)</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              aria-label="Bubble spots"
              value={bubbleSize}
              onChange={(e) => setBubbleSize(e.target.value)}
            />
          </div>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Tie-break rule</span>
            <span className="af-th-rule-value">Total points</span>
          </div>
          <p className="af-th-foot">
            The cut is made across the whole conference on record, then points for — not per league.
          </p>
        </section>

        <section className="af-th-league">
          <p className="af-th-eyebrow">Schedule</p>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Regular season weeks</span>
            <span className="af-th-weeks">
              <input
                className="af-th-input af-th-input--num"
                inputMode="numeric"
                aria-label="Regular season first week"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
              <span>to</span>
              <input
                className="af-th-input af-th-input--num"
                inputMode="numeric"
                aria-label="Regular season last week"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
              />
            </span>
          </div>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Redraft week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              aria-label="Redraft week"
              value={redraftWeek}
              onChange={(e) => setRedraftWeek(e.target.value)}
            />
          </div>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Elite redraft week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              aria-label="Elite redraft week"
              value={eliteWeek}
              onChange={(e) => setEliteWeek(e.target.value)}
            />
          </div>
          <div className="af-th-rule">
            <span className="af-th-rule-label">Championship week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              aria-label="Championship week"
              value={championshipWeek}
              onChange={(e) => setChampionshipWeek(e.target.value)}
            />
          </div>
          {/*
            ⚠ THE REST OF THE CALENDAR, OR THE TOURNAMENT ENDS AT WEEK 9 — said
            here rather than only in the request builder, because this is where
            a commissioner can still act on it.
          */}
          <p className="af-th-foot">
            Standings sync automatically each week — nobody has to enter scores by hand. Leave the
            later weeks set, or the tournament finishes the first time the cut runs.
          </p>
        </section>
      </div>

      <div className="af-th-footer">
        <button
          type="button"
          className="af-th-copy af-th-copy--ghost"
          onClick={() => {
            setConferences((prev) => [...prev, { name: `Conference ${prev.length + 1}`, leagueIds: [] }])
            setOpenPanel(conferences.length)
          }}
        >
          + Add a conference
        </button>
        <button type="button" className="af-th-copy" disabled={!ready} onClick={() => { setError(null); setReviewing(true) }}>
          {`Review ${assigned.size} ${assigned.size === 1 ? 'league' : 'leagues'}`}
        </button>
      </div>

      {/*
        ⚠ SAID BEFORE THE CLICK, NOT AFTER. Two leagues called BEAST is the normal
        case here — KBI runs the same ten names in both conferences — and a
        commissioner who finds "GOLD BEAST" in the app afterwards should already
        know why.
      */}
      <p className="af-th-foot">
        If the same league name appears in two conferences, the second is prefixed with its
        conference so both can exist. You will be told which were changed.
      </p>
      </>}

      {reviewing && <section className="af-th-league" aria-label="Review tournament connection">
        <p className="af-th-eyebrow">Review and connect</p>
        <h2 className="af-th-league-name">{name.trim()}</h2>
        <p className="af-th-note">{assigned.size} leagues across {conferences.filter((c) => c.leagueIds.length > 0).length} conferences, season {seasonLabel}. This groups your imported leagues in AllFantasy; it does not change their settings on Sleeper or another host.</p>
        {conferences.filter((c) => c.leagueIds.length > 0).map((conf, i) => {
          const selected = leagues.filter((l) => conf.leagueIds.includes(l.id))
          const teams = selected.reduce((sum, l) => sum + l.teamCount, 0)
          return <section key={i} className="af-th-manage-review-conf" aria-label={conf.name.trim()}>
            <h4>{conf.name.trim()} · {selected.length} leagues · {teams} teams</h4>
            <ul>{selected.map((l) => <li key={l.id}>{l.name} · {l.platform}{l.season ? ` · ${l.season}` : ''} · {l.teamCount} teams</li>)}</ul>
            {Number(advancePerConference) >= teams && teams > 0 && <p className="af-th-warn">The advance count ({advancePerConference}) is at least this conference’s team count ({teams}). Review it if you intend to eliminate teams.</p>}
          </section>
        })}
        <div className="af-th-rule">
          <span className="af-th-rule-label">Regular season</span>
          <span className="af-th-rule-value">Weeks {weekStart}–{weekEnd}</span>
        </div>
        <div className="af-th-rule">
          <span className="af-th-rule-label">Advance per conference · bubble spots</span>
          <span className="af-th-rule-value af-th-rule-value--accent">{advancePerConference} · {bubbleSize}</span>
        </div>
        <div className="af-th-rule">
          <span className="af-th-rule-label">Redraft · elite redraft · championship</span>
          <span className="af-th-rule-value">{redraftWeek || '—'} · {eliteWeek || '—'} · {championshipWeek || '—'}</span>
        </div>
        <div className="af-th-footer">
          <button type="button" className="af-th-copy af-th-copy--ghost" disabled={saving} onClick={() => setReviewing(false)}>Edit selections and schedule</button>
          <button type="button" className="af-th-copy" disabled={!ready} onClick={submit}>{saving ? 'Connecting…' : `Connect ${assigned.size} ${assigned.size === 1 ? 'league' : 'leagues'}`}</button>
        </div>
      </section>}
    </main>
  )
}
