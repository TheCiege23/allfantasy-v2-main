'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

export function NewTournamentClient({ leagues }: { leagues: PickableLeague[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [weekStart, setWeekStart] = useState('1')
  const [weekEnd, setWeekEnd] = useState('9')
  const [advancePerConference, setAdvancePerConference] = useState('64')
  const [bubbleSize, setBubbleSize] = useState('6')
  const [redraftWeek, setRedraftWeek] = useState('10')
  const [eliteWeek, setEliteWeek] = useState('15')
  const [championshipWeek, setChampionshipWeek] = useState('17')
  const [conferences, setConferences] = useState<ConferenceDraft[]>([
    { name: '', leagueIds: [] },
    { name: '', leagueIds: [] },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = leagues.filter((l) => !l.takenBy)
  const assigned = new Set(conferences.flatMap((c) => c.leagueIds))

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
    conferences.every((c) => c.name.trim().length > 0) &&
    conferences.some((c) => c.leagueIds.length > 0) &&
    !saving

  async function submit() {
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

  return (
    <main className="af-th">
      <header className="af-th-head">
        <div>
          <h1 className="af-th-title">Group leagues into a tournament</h1>
          <p className="af-th-sub">
            Pick the leagues you already run and say which conference each belongs to. Nothing is
            created on any platform and no league is changed — this records that they are one
            tournament so the standings can be worked out across all of them.
          </p>
        </div>
      </header>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}

      {available.length === 0 ? (
        <p className="af-th-note">
          Every league on your account is already part of a tournament, so there is nothing to
          group. A league can only belong to one.
        </p>
      ) : null}

      <section className="af-th-league">
        <h2 className="af-th-league-name">The basics</h2>
        <div className="af-th-fields">
          <label className="af-th-field">
            <span>Tournament name</span>
            <input
              className="af-th-input"
              value={name}
              placeholder="King Buffalo Invitational"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="af-th-field">
            <span>Regular season weeks</span>
            <span className="af-th-weeks">
              <input
                className="af-th-input af-th-input--num"
                inputMode="numeric"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
              <span>to</span>
              <input
                className="af-th-input af-th-input--num"
                inputMode="numeric"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
              />
            </span>
          </label>
          <label className="af-th-field">
            <span>Advance per conference</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              value={advancePerConference}
              onChange={(e) => setAdvancePerConference(e.target.value)}
            />
          </label>
          <label className="af-th-field">
            <span>Redraft week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              value={redraftWeek}
              onChange={(e) => setRedraftWeek(e.target.value)}
            />
          </label>
          <label className="af-th-field">
            <span>Elite redraft week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              value={eliteWeek}
              onChange={(e) => setEliteWeek(e.target.value)}
            />
          </label>
          <label className="af-th-field">
            <span>Championship week</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              value={championshipWeek}
              onChange={(e) => setChampionshipWeek(e.target.value)}
            />
          </label>
          <label className="af-th-field">
            <span>Bubble spots (0 for none)</span>
            <input
              className="af-th-input af-th-input--num"
              inputMode="numeric"
              value={bubbleSize}
              onChange={(e) => setBubbleSize(e.target.value)}
            />
          </label>
        </div>
        <p className="af-th-linknote">
          The cut is made across the whole conference on record, then points for — not per league.
        </p>
      </section>

      {conferences.map((conf, i) => (
        <section key={i} className="af-th-league">
          <h2 className="af-th-league-name">
            Conference {i + 1}
            <span className="af-th-linknote">{conf.leagueIds.length} leagues</span>
          </h2>
          <label className="af-th-field">
            <span>Name</span>
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
          <div className="af-th-picks">
            {leagues.map((l) => {
              const mine = conf.leagueIds.includes(l.id)
              const elsewhere = !mine && assigned.has(l.id)
              return (
                <label
                  key={l.id}
                  className={`af-th-pick${mine ? ' af-th-pick--on' : ''}${
                    l.takenBy || elsewhere ? ' af-th-pick--off' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="af-th-sr"
                    checked={mine}
                    disabled={Boolean(l.takenBy)}
                    onChange={() => toggle(i, l.id)}
                  />
                  <span className="af-th-pick-name">{l.name}</span>
                  <span className="af-th-pick-meta">
                    {l.platform}
                    {l.season != null ? ` · ${l.season}` : ''} · {l.teamCount} teams
                    {l.takenBy ? ` · already in ${l.takenBy}` : ''}
                    {elsewhere ? ' · in another conference' : ''}
                  </span>
                </label>
              )
            })}
          </div>
        </section>
      ))}

      <div className="af-th-actions">
        <button
          type="button"
          className="af-th-linkbtn"
          onClick={() => setConferences((prev) => [...prev, { name: '', leagueIds: [] }])}
        >
          + Add a conference
        </button>
        <button type="button" className="af-th-copy" disabled={!ready} onClick={submit}>
          {saving ? 'Creating…' : 'Create tournament'}
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
    </main>
  )
}
