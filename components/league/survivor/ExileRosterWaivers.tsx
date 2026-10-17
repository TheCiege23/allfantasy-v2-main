'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ExileWeeklyRoster } from '@/lib/survivor/exileRosterRules'

type Board = {
  week: number; sport: string; anchor: { code: string; label: string }; roster: ExileWeeklyRoster;
  takenTeamIds: string[]; players: { id: string; name: string; position: string; team: string | null }[];
  slots: string[]; endsAt: string; locked: boolean
}

export function ExileRosterWaivers({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/survivor/exile', { method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'waivers', leagueId, search }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Could not load Exile waivers.')
    setBoard(data)
  }, [leagueId, search])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => { load(controller.signal).then(() => setError(null)).catch(e => { if (!controller.signal.aborted) setError(e.message) }) }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [load])

  async function change(intent: string, playerId: string, slot?: string) {
    if (!board) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/survivor/exile', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent, leagueId, week: board.week, playerId, slot }) })
      const data = await response.json()
      if (!response.ok || data.ok === false) throw new Error(data.error ?? 'Roster update failed.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Roster update failed.') }
    finally { setBusy(false) }
  }

  return <section className="relative mt-6 rounded-2xl border border-violet-400/25 bg-black/30 p-4" aria-label="Your Exile roster and waivers">
    <h2 className="text-lg font-bold text-violet-100">Exile roster &amp; waivers</h2>
    <p className="mt-2 text-sm text-white/65">No draft. Claim a {board?.anchor.label ?? 'team anchor'} to reserve its real-world team, then pick up teammates individually. Your Exile pool is separate from main-island waivers.</p>
    <p className="mt-2 text-sm text-white/65">Dropping the anchor releases every teammate and lets you choose another team. Team rosters lock at their first game and reset after the scoring week; a snapshot is kept for scoring.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {!board && !error && <p role="status" className="mt-3 text-sm text-white/60">Loading Exile waivers…</p>}
    {board && <>
      <p className="mt-4 text-sm text-violet-200">Week {board.week} · {board.roster.team ? `${board.roster.team} reserved for you` : `Choose your ${board.anchor.label}`} {board.locked ? '· Locked' : ''}</p>
      <div className="mt-3 space-y-2">
        {board.roster.players.map(player => <div key={player.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-3">
          <div className="min-w-40 flex-1"><p className="font-semibold text-white">{player.name}</p><p className="text-xs text-white/60">{player.position} · {player.team}{board.roster.anchorId === player.id ? ' · Team anchor' : ''}</p></div>
          <select aria-label={`Roster slot for ${player.name}`} value={player.slot} disabled={busy || board.locked} onChange={e => change('move_player', player.id, e.target.value)} className="min-h-11 rounded border border-white/20 bg-neutral-950 px-2 text-sm text-white disabled:opacity-50">
            {board.slots.map(slot => <option key={slot} value={slot}>{slot}</option>)}
          </select>
          <button type="button" disabled={busy || board.locked} onClick={() => change('drop_player', player.id)} className="min-h-11 rounded border border-rose-400/30 px-3 text-sm text-rose-200 disabled:opacity-40">{board.roster.anchorId === player.id ? 'Release team' : 'Drop'}</button>
        </div>)}
      </div>
      {!board.locked && <>
        <label className="mt-4 block text-sm text-white/80">{board.roster.anchorId ? 'Find teammates' : `Find a ${board.anchor.label}`}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player names" className="mt-2 min-h-11 w-full rounded border border-white/20 bg-neutral-950 px-3 text-white" />
        </label>
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
          {board.players.filter(p => !board.roster.players.some(own => own.id === p.id)).map(player => {
            const taken = board.takenTeamIds.includes(player.team?.trim().toUpperCase() ?? '')
            return <div key={player.id} className="flex items-center gap-3 rounded-lg border border-white/10 p-3">
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">{player.name}</p><p className="text-xs text-white/60">{player.position} · {player.team}</p></div>
              <button type="button" disabled={busy || taken} onClick={() => change('claim_team', player.id)} className="min-h-11 rounded border border-violet-300/30 bg-violet-500/10 px-3 text-sm text-violet-100 disabled:opacity-40">{taken ? 'Reserved' : 'Claim'}</button>
            </div>
          })}
          {!board.players.length && <p className="text-sm text-white/60">No matching players are available in the current player catalogue.</p>}
        </div>
      </>}
    </>}
  </section>
}
