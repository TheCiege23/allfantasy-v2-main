'use client'

import { useState } from 'react'

type Preview = {
  powerType: 'triple_steal' | 'island_raid'
  teams: Array<{ rosterId: string; teamName: string; players: Array<{ id: string; playerName: string; position: string; team: string | null; disabled: boolean }> }>
  myBench: Array<{ id: string; playerName: string; position: string }>
  requiredDrops: number
  lockWarnings: string[]
}

export function SurvivorIdolPlay({ leagueId, idolId, powerType, onFinished }: { leagueId: string; idolId: string; powerType: string; onFinished: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [step, setStep] = useState(0)
  const [teamId, setTeamId] = useState('')
  const [playerIds, setPlayerIds] = useState<string[]>([])
  const [dropIds, setDropIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function request(action: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/leagues/${leagueId}/survivor/${action}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw Object.assign(new Error(result.error ?? 'The action could not be completed.'), { code: result.code })
    return result
  }

  async function open() {
    setBusy(true); setError(null)
    try { const result = await request('steal-three-preview', { idolId }); setPreview(result as Preview); setStep(1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load available players.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    setBusy(true); setError(null)
    try { await request('play-steal-three', { idolId, playerRowIds: playerIds, dropRowIds: dropIds }); setDone(true); onFinished() }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The raid could not be completed.')
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null
      if (code === 'player_locked' || code === 'roster_changed' || code === 'player_changed') {
        setStep(2); setPlayerIds([]); setDropIds([])
        try { setPreview(await request('steal-three-preview', { idolId }) as Preview) } catch { /* keep the server error visible */ }
      }
    } finally { setBusy(false) }
  }

  function toggle(value: string, current: string[], setter: (next: string[]) => void, max: number) {
    if (current.includes(value)) setter(current.filter(id => id !== value))
    else if (current.length < max) setter([...current, value])
  }

  const title = powerType === 'island_raid' ? 'Island Raid · three players across teams' : 'Triple Raid · three players from one team'
  if (done) return <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm text-emerald-100">The raid is complete. AF Host has announced it in league chat.</p>
  if (!preview) return <div className="space-y-2"><button type="button" onClick={open} disabled={busy} className="rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Checking…' : `Play ${title}`}</button>{error && <p role="alert" className="text-sm text-rose-300">{error}</p>}</div>

  const visibleTeams = preview.powerType === 'island_raid' ? preview.teams : preview.teams.filter(team => team.rosterId === teamId)
  const selectedNames = preview.teams.flatMap(team => team.players).filter(player => playerIds.includes(player.id)).map(player => player.playerName)
  const canContinue = preview.lockWarnings.length === 0 && (step === 1 ? preview.powerType === 'island_raid' || Boolean(teamId) : step === 2 ? playerIds.length === 3 : step === 3 ? dropIds.length === preview.requiredDrops : true)
  return <section aria-label="Play Steal 3 idol" className="space-y-4 rounded-2xl border border-amber-400/30 bg-[#10162a] p-4 text-white sm:p-6">
    <div className="flex items-center gap-3"><img src="/survivor/idols/steal-three-icon.svg" alt="" width={44} height={44} /><div><h3 className="text-lg font-bold">{title}</h3><p className="text-xs text-amber-200">Step {step} of 4 · This move becomes public when confirmed.</p></div></div>
    {preview.lockWarnings.length > 0 && <p role="alert" className="rounded bg-rose-950/50 p-3 text-sm">Player locks cannot be verified right now. Try again when NBA schedule data is available.</p>}
    {step === 1 && <div className="space-y-3"><h4 className="font-semibold">Pick a team</h4>{preview.powerType === 'island_raid' ? <p className="text-sm text-white/70">Island Raid lets you select three players across any opposing teams.</p> : <div className="grid gap-2 sm:grid-cols-2">{preview.teams.map(team => <button key={team.rosterId} type="button" onClick={() => { setTeamId(team.rosterId); setPlayerIds([]) }} aria-pressed={teamId === team.rosterId} className={`rounded-lg border p-3 text-left text-sm ${teamId === team.rosterId ? 'border-amber-300 bg-amber-500/20' : 'border-white/15'}`}>{team.teamName}<span className="ml-2 text-white/60">{team.players.filter(player => !player.disabled).length} available</span></button>)}</div>}</div>}
    {step === 2 && <div className="space-y-3"><h4 className="font-semibold">Pick exactly 3 players <span className="text-amber-300">({playerIds.length}/3)</span></h4><div className="max-h-80 space-y-2 overflow-y-auto">{visibleTeams.map(team => <div key={team.rosterId}><p className="mb-1 text-xs font-bold uppercase text-amber-300">{team.teamName}</p>{team.players.map(player => <label key={player.id} className={`flex items-center gap-3 rounded-lg border p-2 text-sm ${player.disabled ? 'border-white/5 text-white/40' : 'border-white/15'}`}><input type="checkbox" checked={playerIds.includes(player.id)} disabled={player.disabled || (!playerIds.includes(player.id) && playerIds.length >= 3)} onChange={() => toggle(player.id, playerIds, setPlayerIds, 3)} /><span>{player.playerName} · {player.position} · {player.team ?? 'NBA'}</span>{player.disabled && <span className="ml-auto text-xs">Locked or IR</span>}</label>)}</div>)}</div></div>}
    {step === 3 && <div className="space-y-3"><h4 className="font-semibold">Make room on your bench</h4><p className="text-sm text-white/70">Choose {preview.requiredDrops} unlocked bench player{preview.requiredDrops === 1 ? '' : 's'} to drop. {preview.requiredDrops === 0 ? 'You have room, so this step is skipped.' : ''}</p>{preview.myBench.map(player => <label key={player.id} className="flex items-center gap-3 rounded-lg border border-white/15 p-2 text-sm"><input type="checkbox" checked={dropIds.includes(player.id)} disabled={!dropIds.includes(player.id) && dropIds.length >= preview.requiredDrops} onChange={() => toggle(player.id, dropIds, setDropIds, preview.requiredDrops)} />{player.playerName} · {player.position}</label>)}</div>}
    {step === 4 && <div className="space-y-3"><h4 className="font-semibold">Confirm the raid</h4><p className="text-sm text-white/75">Taking {selectedNames.join(', ')}. Dropping {dropIds.length} bench player{dropIds.length === 1 ? '' : 's'}. The raided team gets top waiver priority for this week.</p><p className="text-xs text-amber-200">The server checks locks and roster capacity again before moving anyone.</p></div>}
    {error && <p role="alert" className="rounded bg-rose-950/40 p-2 text-sm text-rose-200">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => step === 1 ? setPreview(null) : setStep(step - 1)} disabled={busy} className="rounded-lg border border-white/25 px-4 py-2 text-sm">Back</button><button type="button" disabled={busy || !canContinue} onClick={() => step === 4 ? void confirm() : setStep(step === 2 && preview.requiredDrops === 0 ? 4 : step + 1)} className="rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-bold disabled:opacity-50">{step === 4 ? busy ? 'Confirming…' : 'Confirm and play idol' : 'Continue'}</button></div>
  </section>
}
