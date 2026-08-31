'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StandingsBoard } from '@/lib/tournament/standingsBoard'

/**
 * Change the rules after the tournament exists.
 *
 * 🛑 THE CUT IS ENTERED BEFORE ANYBODY HAS PLAYED, and the first time it meets
 * reality is when the board draws the line. Without this, fixing a number meant
 * rebuilding the tournament and re-linking every manager.
 *
 * ⚠ COLLAPSED BY DEFAULT. This sits on the screen a commissioner opens to read
 * standings; the settings that decide the cut should not be one stray click away
 * from the thing they came to look at.
 */
export function SettingsPanel({ board }: { board: StandingsBoard }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(board.name)
  const [wildcardCount, setWildcardCount] = useState(String(board.wildcardCount))
  const [advancersPerLeague, setAdvancersPerLeague] = useState(String(board.advancersPerLeague))
  const [bubbleEnabled, setBubbleEnabled] = useState(board.bubbleEnabled)
  const [bubbleSize, setBubbleSize] = useState(String(board.bubbleSize))
  const [names, setNames] = useState(
    Object.fromEntries(board.conferences.map((c) => [c.id, c.name])) as Record<string, string>,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(board.tournamentId)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          advancersPerLeague: Number(advancersPerLeague),
          wildcardCount: Number(wildcardCount),
          bubbleEnabled,
          bubbleSize: Number(bubbleSize),
          conferenceNames: board.conferences.map((c) => ({ id: c.id, name: names[c.id] ?? c.name })),
        }),
      })
      const body = (await res.json()) as { error?: string; note?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not save those settings')
      setNote(body.note ?? 'Saved.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save those settings')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="af-th-actions">
        <button type="button" className="af-th-linkbtn" onClick={() => setOpen(true)}>
          Settings
        </button>
      </div>
    )
  }

  return (
    <section className="af-th-league">
      <h2 className="af-th-league-name">
        Settings
        <button type="button" className="af-th-linkbtn" onClick={() => setOpen(false)}>
          Close
        </button>
      </h2>

      <div className="af-th-fields">
        <label className="af-th-field">
          <span>Tournament name</span>
          <input className="af-th-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="af-th-field">
          <span>Advance per conference</span>
          <input
            className="af-th-input af-th-input--num"
            inputMode="numeric"
            value={wildcardCount}
            onChange={(e) => setWildcardCount(e.target.value)}
          />
        </label>
        <label className="af-th-field">
          <span>Auto-advance per league</span>
          <input
            className="af-th-input af-th-input--num"
            inputMode="numeric"
            value={advancersPerLeague}
            onChange={(e) => setAdvancersPerLeague(e.target.value)}
          />
        </label>
        <label className="af-th-field">
          <span>Bubble spots</span>
          <input
            className="af-th-input af-th-input--num"
            inputMode="numeric"
            value={bubbleSize}
            onChange={(e) => setBubbleSize(e.target.value)}
          />
        </label>
        <label className="af-th-field">
          <span>Bubble</span>
          <span className="af-th-weeks">
            <input
              type="checkbox"
              checked={bubbleEnabled}
              onChange={(e) => setBubbleEnabled(e.target.checked)}
            />
            <span className="af-th-linknote">Run a bubble round</span>
          </span>
        </label>
      </div>

      <div className="af-th-fields">
        {board.conferences.map((c) => (
          <label key={c.id} className="af-th-field">
            <span>Conference name</span>
            <input
              className="af-th-input"
              value={names[c.id] ?? c.name}
              onChange={(e) => setNames((prev) => ({ ...prev, [c.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      {/*
        ⚠ SAID BEFORE SAVING, NOT AFTER. Changing the cut moves where the LINE is
        drawn from here; it does not un-advance anyone already advanced. A
        commissioner editing this mid-tournament is entitled to know that before
        they click, not in the confirmation.
      */}
      <p className="af-th-linknote">
        Changing these redraws the line on this screen. It does not move anyone who has already
        been advanced or eliminated.
      </p>

      <div className="af-th-actions">
        <button type="button" className="af-th-copy" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {error ? (
        <p className="af-th-warn" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="af-th-note">{note}</p> : null}
    </section>
  )
}
