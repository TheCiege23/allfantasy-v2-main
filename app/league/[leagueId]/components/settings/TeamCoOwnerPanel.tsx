'use client'

import { useCallback, useEffect, useState } from 'react'

type Invite = { id: string; acceptedAt: string | null; user: { username: string | null; displayName: string | null } }

export function TeamCoOwnerPanel({ leagueId, rosterId }: { leagueId: string; rosterId: string }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/team-coowners`
  const load = useCallback(async () => {
    const response = await fetch(`${endpoint}?rosterId=${encodeURIComponent(rosterId)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setError(result.error ?? 'Could not load co-owners'); return }
    setInvites(result.invitations ?? [])
  }, [endpoint, rosterId])
  useEffect(() => { void load() }, [load])
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rosterId, username }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setError(result.error ?? 'Could not invite co-owner'); return }
      setUsername(''); await load()
    } catch { setError('Could not invite co-owner') } finally { setBusy(false) }
  }
  async function remove(id: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { setError(result.error ?? 'Could not remove co-owner'); return }
      await load()
    } catch { setError('Could not remove co-owner') } finally { setBusy(false) }
  }
  return <section className="space-y-2 border-t border-white/10 pt-3 text-sm">
    <h4 className="font-semibold text-white">Team co-owners</h4>
    <p className="text-white/60">Co-owners can manage the team lineup, draft, waivers, and trades. Some specialty game actions remain with the primary owner. Co-owners do not receive commissioner access.</p>
    {invites.map((item) => <div key={item.id} className="flex items-center gap-3 text-white/80">
      <span>{item.user.displayName ?? item.user.username ?? 'Member'} — {item.acceptedAt ? 'Accepted' : 'Invited'}</span>
      <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="text-red-300">Remove</button>
    </div>)}
    <form onSubmit={invite} className="flex flex-wrap gap-2">
      <label className="sr-only" htmlFor={`coowner-${rosterId}`}>AllFantasy username</label>
      <input id={`coowner-${rosterId}`} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="AllFantasy username" className="rounded border border-white/20 bg-slate-900 px-2 py-1 text-white" />
      <button disabled={busy || !username.trim()} className="rounded bg-teal-800 px-3 py-1 text-white disabled:opacity-40">Invite</button>
    </form>
    <p className="text-white/50">Share this invitation link with the invited user: <a className="text-teal-300 underline" href={`/team-invitation/${encodeURIComponent(leagueId)}`}>{`/team-invitation/${leagueId}`}</a></p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>
}
