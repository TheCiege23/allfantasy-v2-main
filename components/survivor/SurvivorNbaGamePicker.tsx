'use client'

import { useCallback, useEffect, useState } from 'react'

type Game = { gameKey: string; startAt: string; opponent: string }
type Player = { playerId: string; playerName: string; position: string; team: string | null; games: Game[]; selectedGameKey: string | null; countingGameKey: string | null; canChange: boolean }

export function SurvivorNbaGamePicker({ leagueId, week }: { leagueId: string; week: number }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPlayer, setSavingPlayer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/nba-game-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'Could not load this week’s NBA games.')
      setPlayers(result.players)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this week’s NBA games.')
    } finally {
      setLoading(false)
    }
  }, [leagueId, week])
  useEffect(() => { void load() }, [load])

  async function choose(playerId: string, gameKey: string) {
    setSavingPlayer(playerId)
    setError(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/nba-game-pick`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week, playerId, gameKey }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'Could not save this game.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this game.')
    } finally {
      setSavingPlayer(null)
    }
  }

  return <section className="rounded-2xl border border-cyan-500/25 bg-[#07151b] p-4 sm:p-5" aria-label="NBA counting games">
    <h2 className="text-base font-semibold text-white">Choose one NBA game per player · Week {week}</h2>
    <p className="mt-1 text-sm text-white/65">This week runs Tuesday through Monday, Eastern time. Choose before the player’s first game starts. If you make no choice, their first game counts automatically. Their starter or bench position locks when the counting game begins.</p>
    {loading && <p role="status" className="mt-3 text-sm text-white/50">Loading games…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    {!loading && players.length === 0 && <p className="mt-3 text-sm text-white/60">Your drafted players will appear here when your roster is ready.</p>}
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {players.map(player => {
        const counting = player.games.find(game => game.gameKey === player.countingGameKey)
        return <div key={player.playerId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="font-medium text-white">{player.playerName} <span className="text-xs text-white/50">{player.position} · {player.team ?? 'Team TBD'}</span></p>
          <p className="mt-1 text-xs text-cyan-100/70">{player.selectedGameKey ? 'Your choice' : 'Automatic first game'}: {counting ? `vs ${counting.opponent} · ${new Date(counting.startAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET` : 'Awaiting schedule'}</p>
          <label className="mt-2 block text-xs text-white/60" htmlFor={`nba-game-${player.playerId}`}>Counting game</label>
          <select id={`nba-game-${player.playerId}`} value={player.selectedGameKey ?? player.countingGameKey ?? ''} disabled={!player.canChange || savingPlayer === player.playerId || player.games.length === 0} onChange={event => void choose(player.playerId, event.target.value)} className="mt-1 w-full rounded-lg border border-white/20 bg-[#0d1d28] px-3 py-2 text-sm text-white disabled:opacity-50">
            {player.games.length === 0 && <option value="">No scheduled game</option>}
            {player.games.map(game => <option key={game.gameKey} value={game.gameKey}>vs {game.opponent} · {new Date(game.startAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</option>)}
          </select>
          {!player.canChange && counting && <p className="mt-1 text-xs text-white/50">Locked for this week</p>}
        </div>
      })}
    </div>
  </section>
}
