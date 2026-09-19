'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { StandingsBoard } from '@/lib/tournament/standingsBoard'

type DraftConference = {
  id?: string
  clientId: string
  name: string
  colorHex: string | null
  active: boolean
  leagueIds: string[]
}

function initialPlan(board: StandingsBoard): DraftConference[] {
  return [
    ...board.conferences.map((conference) => ({
      id: conference.id,
      clientId: conference.id,
      name: conference.name,
      colorHex: conference.colorHex,
      active: true,
      leagueIds: conference.leagues.map((league) => league.tournamentLeagueId),
    })),
    ...board.archivedConferences.map((conference) => ({
      id: conference.id,
      clientId: conference.id,
      name: conference.name,
      colorHex: conference.colorHex,
      active: false,
      leagueIds: [],
    })),
  ]
}

function fingerprint(plan: DraftConference[]): string {
  return JSON.stringify(
    plan.map((conference) => ({
      id: conference.id ?? null,
      name: conference.name.trim(),
      colorHex: conference.colorHex,
      active: conference.active,
      leagueIds: conference.leagueIds,
    })),
  )
}

export function ManageConferencesPanel({ board }: { board: StandingsBoard }) {
  const router = useRouter()
  const baseline = useMemo(() => initialPlan(board), [board])
  const baselineFingerprint = useMemo(() => fingerprint(baseline), [baseline])
  const [plan, setPlan] = useState<DraftConference[]>(baseline)
  const [open, setOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [query, setQuery] = useState('')
  const [draggedLeagueId, setDraggedLeagueId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const leagues = useMemo(
    () =>
      board.conferences.flatMap((conference) =>
        conference.leagues.map((league) => ({
          id: league.tournamentLeagueId,
          name: league.name,
          teams: league.rows.length,
          originalConferenceId: conference.id,
          originalConferenceName: conference.name,
        })),
      ),
    [board],
  )
  const leagueById = useMemo(() => new Map(leagues.map((league) => [league.id, league])), [leagues])
  const active = plan.filter((conference) => conference.active)
  const changed = fingerprint(plan) !== baselineFingerprint
  const duplicateName = active.some(
    (conference, index) =>
      active.findIndex(
        (candidate) => candidate.name.trim().toLocaleLowerCase() === conference.name.trim().toLocaleLowerCase(),
      ) !== index,
  )
  const invalidColor = active.some(
    (conference) => conference.colorHex !== null && !/^#[0-9a-f]{6}$/i.test(conference.colorHex.trim()),
  )
  const ready =
    changed &&
    active.length > 0 &&
    active.length <= 8 &&
    active.every((conference) => conference.name.trim().length > 0 && conference.name.trim().length <= 64) &&
    !duplicateName &&
    !invalidColor &&
    !saving

  function updateConference(clientId: string, patch: Partial<DraftConference>) {
    setPlan((current) =>
      current.map((conference) =>
        conference.clientId === clientId ? { ...conference, ...patch } : conference,
      ),
    )
  }

  function moveLeague(leagueId: string, destinationClientId: string, destinationIndex?: number) {
    if (board.conferenceMembershipLocked) return
    setPlan((current) => {
      const without = current.map((conference) => ({
        ...conference,
        leagueIds: conference.leagueIds.filter((id) => id !== leagueId),
      }))
      return without.map((conference) => {
        if (conference.clientId !== destinationClientId) return conference
        const next = [...conference.leagueIds]
        next.splice(destinationIndex ?? next.length, 0, leagueId)
        return { ...conference, leagueIds: next }
      })
    })
  }

  function reorder(clientId: string, leagueId: string, direction: -1 | 1) {
    setPlan((current) =>
      current.map((conference) => {
        if (conference.clientId !== clientId) return conference
        const index = conference.leagueIds.indexOf(leagueId)
        const nextIndex = index + direction
        if (index < 0 || nextIndex < 0 || nextIndex >= conference.leagueIds.length) return conference
        const leagueIds = [...conference.leagueIds]
        ;[leagueIds[index], leagueIds[nextIndex]] = [leagueIds[nextIndex]!, leagueIds[index]!]
        return { ...conference, leagueIds }
      }),
    )
  }

  function addConference() {
    if (active.length >= 8) return
    const clientId = `new-${Date.now()}-${plan.length}`
    setPlan((current) => [
      ...current,
      {
        clientId,
        name: `Conference ${active.length + 1}`,
        colorHex: '#22d3ee',
        active: true,
        leagueIds: [],
      },
    ])
  }

  function archiveOrRemove(conference: DraftConference) {
    if (conference.leagueIds.length > 0) return
    if (!conference.id) {
      setPlan((current) => current.filter((candidate) => candidate.clientId !== conference.clientId))
      return
    }
    updateConference(conference.clientId, { active: false })
  }

  function reset() {
    setPlan(initialPlan(board))
    setReviewing(false)
    setError(null)
  }

  const originalConferenceByLeague = new Map(
    baseline.flatMap((conference) => conference.leagueIds.map((leagueId) => [leagueId, conference.clientId] as const)),
  )
  const currentConferenceByLeague = new Map(
    active.flatMap((conference) => conference.leagueIds.map((leagueId) => [leagueId, conference.clientId] as const)),
  )
  const moved = leagues.filter(
    (league) => originalConferenceByLeague.get(league.id) !== currentConferenceByLeague.get(league.id),
  )
  const renamed = plan.filter((conference) => {
    const original = baseline.find((candidate) => candidate.id && candidate.id === conference.id)
    return original && original.name.trim() !== conference.name.trim()
  })
  const created = plan.filter((conference) => !conference.id && conference.active)
  const archived = plan.filter((conference) => {
    const original = baseline.find((candidate) => candidate.id === conference.id)
    return original?.active && !conference.active
  })
  const restored = plan.filter((conference) => {
    const original = baseline.find((candidate) => candidate.id === conference.id)
    return original && !original.active && conference.active
  })

  async function save() {
    if (!ready || !reviewing) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/tournament/${encodeURIComponent(board.tournamentId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conferencePlan: plan, expectedConferencePlan: baseline }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Could not save conference setup')
      setOpen(false)
      setReviewing(false)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save conference setup')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="af-th-actions">
        <button type="button" className="af-th-copy" onClick={() => setOpen(true)}>
          Manage conferences
        </button>
      </div>
    )
  }

  return (
    <section className="af-th-league" aria-label="Manage conferences">
      <div className="af-th-manage-head">
        <div>
          <h2 className="af-th-league-name">Manage conferences</h2>
          <p className="af-th-note">
            Rename conferences, move leagues, and set their display order. The source leagues are never changed.
          </p>
        </div>
        <button type="button" className="af-th-linkbtn" onClick={() => setOpen(false)} disabled={saving}>
          Close
        </button>
      </div>

      {board.conferenceMembershipLocked ? (
        <p className="af-th-warn" role="status">
          Round {board.roundNumber} advancement is recorded. League membership is locked to protect those results;
          names and league display order can still be corrected.
        </p>
      ) : (
        <p className="af-th-note">Moves update conference standings and reports immediately after the final save.</p>
      )}

      {!reviewing ? (
        <>
          <div className="af-th-manage-toolbar">
            <label className="af-th-field af-th-manage-search">
              <span>Find a league</span>
              <input
                className="af-th-input"
                type="search"
                value={query}
                placeholder="League name"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" className="af-th-linkbtn" onClick={addConference} disabled={active.length >= 8}>
              + Add conference
            </button>
          </div>

          <div className="af-th-manage-grid">
            {active.map((conference) => {
              const visibleLeagueIds = conference.leagueIds.filter((leagueId) =>
                (leagueById.get(leagueId)?.name ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
              )
              const teamCount = conference.leagueIds.reduce(
                (sum, leagueId) => sum + (leagueById.get(leagueId)?.teams ?? 0),
                0,
              )
              return (
                <section
                  key={conference.clientId}
                  className="af-th-manage-conf"
                  aria-label={conference.name || 'Unnamed conference'}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (draggedLeagueId) moveLeague(draggedLeagueId, conference.clientId)
                    setDraggedLeagueId(null)
                  }}
                >
                  <label className="af-th-field">
                    <span>Conference name</span>
                    <input
                      className="af-th-input"
                      value={conference.name}
                      maxLength={64}
                      onChange={(event) => updateConference(conference.clientId, { name: event.target.value })}
                    />
                  </label>
                  <label className="af-th-field af-th-manage-color">
                    <span>Conference color</span>
                    <span className="af-th-weeks">
                      <input
                        type="color"
                        value={conference.colorHex ?? '#22d3ee'}
                        aria-label={`${conference.name || 'Conference'} color`}
                        onChange={(event) => updateConference(conference.clientId, { colorHex: event.target.value })}
                      />
                      <input
                        className="af-th-input"
                        value={conference.colorHex ?? ''}
                        placeholder="#22d3ee"
                        aria-label={`${conference.name || 'Conference'} color value`}
                        onChange={(event) => updateConference(conference.clientId, { colorHex: event.target.value })}
                      />
                    </span>
                  </label>
                  <p className="af-th-linknote">
                    {conference.leagueIds.length} {conference.leagueIds.length === 1 ? 'league' : 'leagues'} · {teamCount}{' '}
                    {teamCount === 1 ? 'team' : 'teams'}
                  </p>

                  <ol className="af-th-manage-list">
                    {visibleLeagueIds.map((leagueId) => {
                      const league = leagueById.get(leagueId)
                      if (!league) return null
                      const position = conference.leagueIds.indexOf(leagueId)
                      return (
                        <li
                          key={leagueId}
                          className="af-th-manage-league"
                          draggable={!board.conferenceMembershipLocked}
                          onDragStart={(event: DragEvent<HTMLLIElement>) => {
                            event.dataTransfer.effectAllowed = 'move'
                            setDraggedLeagueId(leagueId)
                          }}
                          onDragEnd={() => setDraggedLeagueId(null)}
                        >
                          <span className="af-th-manage-grip" aria-hidden>⋮⋮</span>
                          <span className="af-th-manage-league-name">
                            <strong>{league.name}</strong>
                            <small>{league.teams} {league.teams === 1 ? 'team' : 'teams'}</small>
                          </span>
                          <span className="af-th-manage-order">
                            <button
                              type="button"
                              className="af-th-linkbtn"
                              aria-label={`Move ${league.name} up`}
                              disabled={position === 0}
                              onClick={() => reorder(conference.clientId, leagueId, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="af-th-linkbtn"
                              aria-label={`Move ${league.name} down`}
                              disabled={position === conference.leagueIds.length - 1}
                              onClick={() => reorder(conference.clientId, leagueId, 1)}
                            >
                              ↓
                            </button>
                          </span>
                          <label className="af-th-sr" htmlFor={`move-${leagueId}`}>Move {league.name}</label>
                          <select
                            id={`move-${leagueId}`}
                            className="af-th-select"
                            value={conference.clientId}
                            disabled={board.conferenceMembershipLocked}
                            onChange={(event) => moveLeague(leagueId, event.target.value)}
                          >
                            {active.map((destination) => (
                              <option key={destination.clientId} value={destination.clientId}>
                                {destination.name || 'Unnamed conference'}
                              </option>
                            ))}
                          </select>
                        </li>
                      )
                    })}
                  </ol>
                  {conference.leagueIds.length === 0 ? (
                    <p className="af-th-note">Empty conference — move a league here or archive it.</p>
                  ) : null}
                  <button
                    type="button"
                    className="af-th-linkbtn af-th-linkbtn--danger"
                    disabled={conference.leagueIds.length > 0 || active.length === 1}
                    onClick={() => archiveOrRemove(conference)}
                  >
                    {conference.id ? 'Archive empty conference' : 'Remove empty conference'}
                  </button>
                </section>
              )
            })}
          </div>

          {plan.some((conference) => !conference.active) ? (
            <details className="af-th-manage-archived">
              <summary>Archived conferences ({plan.filter((conference) => !conference.active).length})</summary>
              {plan.filter((conference) => !conference.active).map((conference) => (
                <div key={conference.clientId} className="af-th-manage-archive-row">
                  <span>{conference.name}</span>
                  <button
                    type="button"
                    className="af-th-linkbtn"
                    disabled={active.length >= 8}
                    onClick={() => updateConference(conference.clientId, { active: true })}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </details>
          ) : null}

          {duplicateName ? <p className="af-th-warn" role="alert">Conference names must be unique.</p> : null}
          {invalidColor ? (
            <p className="af-th-warn" role="alert">Conference colors must use a six-digit hex value, such as #22d3ee.</p>
          ) : null}
          <div className="af-th-actions">
            <button type="button" className="af-th-linkbtn" disabled={!changed} onClick={reset}>Reset changes</button>
            <button
              type="button"
              className="af-th-copy"
              disabled={!ready}
              onClick={() => { setError(null); setReviewing(true) }}
            >
              Review conference changes
            </button>
          </div>
        </>
      ) : (
        <section aria-label="Review conference changes" className="af-th-manage-review">
          <h3>Review before saving</h3>
          <p className="af-th-note">Nothing changes on Sleeper, ESPN, Fantrax, or another source platform.</p>
          <ul className="af-th-manage-summary">
            <li>{moved.length} {moved.length === 1 ? 'league changes' : 'leagues change'} conference</li>
            <li>{renamed.length} {renamed.length === 1 ? 'conference is' : 'conferences are'} renamed</li>
            <li>{created.length} created · {archived.length} archived · {restored.length} restored</li>
          </ul>
          {active.map((conference) => {
            const teams = conference.leagueIds.reduce(
              (sum, leagueId) => sum + (leagueById.get(leagueId)?.teams ?? 0),
              0,
            )
            return (
              <section
                key={conference.clientId}
                className="af-th-manage-review-conf"
                style={conference.colorHex ? { borderColor: conference.colorHex } : undefined}
              >
                <h4>{conference.name} · {conference.leagueIds.length} leagues · {teams} teams</h4>
                <ol>
                  {conference.leagueIds.map((leagueId) => (
                    <li key={leagueId}>
                      {leagueById.get(leagueId)?.name ?? 'League'}
                      {originalConferenceByLeague.get(leagueId) !== conference.clientId ? (
                        <span className="af-th-chip af-th-chip--bubble">Moved</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {board.wildcardCount >= teams && teams > 0 ? (
                  <p className="af-th-warn">
                    The advance count ({board.wildcardCount}) is at least this conference’s team count ({teams}).
                  </p>
                ) : null}
              </section>
            )
          })}
          {moved.length > 0 ? (
            <p className="af-th-warn" role="status">
              Moving a league recalculates today’s conference ranks and cut line for both conferences. No manager’s
              source-league record changes.
            </p>
          ) : null}
          <div className="af-th-actions">
            <button type="button" className="af-th-linkbtn" disabled={saving} onClick={() => setReviewing(false)}>
              Edit changes
            </button>
            <button type="button" className="af-th-copy" disabled={!ready} onClick={save}>
              {saving ? 'Saving…' : 'Save conference setup'}
            </button>
          </div>
        </section>
      )}

      {error ? <p className="af-th-warn" role="alert">{error}</p> : null}
    </section>
  )
}
