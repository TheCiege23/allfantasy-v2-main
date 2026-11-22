'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { SeasonIntegrityView } from '@/lib/tournament/seasonIntegrity'

const field = 'min-h-11 rounded-lg border border-white/25 bg-slate-950 px-2'
const types = { collusion: 'Collusion', duplicate_manager: 'Duplicate account', roster_dumping: 'Roster dumping', suspicious_trade: 'Suspicious trade' }

export function SeasonIntegrityPanel({ tournamentId }: { tournamentId: string }) {
  const url = '/api/tournament/' + encodeURIComponent(tournamentId) + '/season-recovery?integrity=1'
  const [board, setBoard] = useState<SeasonIntegrityView>()
  const [leagueId, setLeagueId] = useState('')
  const [rosterId, setRosterId] = useState('')
  const [type, setType] = useState('collusion')
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not load integrity reviews.')
      const data: SeasonIntegrityView = await response.json()
      if (!controller.signal.aborted) setBoard(data)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [url, revision])

  async function save(payload: Record<string, string>) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error((await response.json()).error)
      setRevision(value => value + 1)
      if (payload.action === 'flag') setReason('')

    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save integrity review.') }
    finally { setBusy(false) }
  }
  const league = board?.leagues.find(row => row.id === leagueId)
  return <details className="space-y-3 rounded-xl border border-white/20 bg-slate-950 p-4 text-white">
    <summary className="min-h-11 cursor-pointer text-xl font-semibold">Tournament integrity review</summary>
    <p className="text-sm text-slate-300">Signals and staff reports go to the tournament owner for review.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {board?.flags.map(flag => <article key={flag.id} className="space-y-2 rounded-xl border border-white/20 p-3">
      <h3>{types[flag.flagType as keyof typeof types] ?? flag.flagType} · {flag.severity} · {flag.status}</h3>
      <p>{flag.summary}</p>
      <p className="text-sm">{flag.affectedTeamNames.join(', ')} · <Link className="underline" href={'/league/' + flag.leagueId}>Open league</Link>{flag.tradeTransactionId && ' · Trade ' + flag.tradeTransactionId}</p>
      {flag.commissionerNote && <p>Owner review · {flag.commissionerNote}</p>}
      {board.isOwner && flag.status !== 'reviewed' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault()
        void save({ action: 'review', flagId: flag.id, reason: String(new FormData(event.currentTarget).get('reason') ?? '') })
      }}><label>Review reason<input className={field + ' block'} name="reason" required minLength={8} maxLength={500} /></label>
        <button className={field} disabled={busy}>Mark reviewed</button></form>}
    </article>)}
    {board && !board.flags.length && <p className="text-sm">No integrity flags in the assigned leagues.</p>}
    {!!board?.leagues.length && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault(); void save({ action: 'flag', leagueId, rosterId, type, reason })
    }}>
      <label>League<select className={field + ' block'} value={leagueId} required onChange={event => { setLeagueId(event.target.value); setRosterId('') }}>
        <option value="">Select league</option>{board.leagues.map(item => <option key={item.id} value={item.id}>Stage {item.stage} · {item.name}</option>)}
      </select></label>
      <label>Team<select className={field + ' block'} value={rosterId} required onChange={event => setRosterId(event.target.value)}>
        <option value="">Select team</option>{league?.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>
      <label>Concern<select className={field + ' block'} value={type} onChange={event => setType(event.target.value)}>
        {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Evidence or reason<input className={field + ' block'} value={reason} required minLength={8} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      <button className={field} disabled={busy}>Flag for review</button>
      <button type="button" className={field} disabled={busy || !leagueId || !rosterId} onClick={() => void save({ action: 'scan_identity', leagueId, rosterId })}>Check duplicate signals</button>
    </form>}
  </details>
}
