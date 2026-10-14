'use client'
import { useEffect, useState } from 'react'
import { SeasonNativeSetup } from './SeasonNativeSetup'
import type { SeasonRegistrationBoard } from '@/lib/tournament/seasonRegistration'

const field = 'min-h-11 w-full rounded-xl border border-white/20 bg-slate-900 px-3 py-2'
function localDateTimeValue(instant: string | Date) {
  const date = new Date(instant)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function SeasonRegistrationManager({ tournamentId, publicationId }: { tournamentId: string; publicationId: string }) {
  const [board, setBoard] = useState<SeasonRegistrationBoard | null>(null)
  const [closes, setCloses] = useState('')
  const [limit, setLimit] = useState(64)
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmFreeze, setConfirmFreeze] = useState(false)
  const [reason, setReason] = useState('')
  async function reload(initial = false) {
    const response = await fetch('/api/tournament/season-registration?tournamentId=' + encodeURIComponent(tournamentId), { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Could not load registration.')
    setBoard(body.board)
    if (initial && body.board) {
      setLimit(body.board.waitlistLimit)
      if (body.board.closesAt) setCloses(localDateTimeValue(body.board.closesAt))
      else if (body.board.openingDraftAt) setCloses(localDateTimeValue(new Date(Date.parse(body.board.openingDraftAt) - 24 * 3600000)))
    }
  }
  useEffect(() => { let live = true; reload(true).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [tournamentId])
  async function action(name: string, details: Record<string, unknown> = {}) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/tournament/season-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, tournamentId, ...details }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not update registration.')
      if (body.invitePath) setInvite(new URL(body.invitePath, window.location.origin).toString())
      if (name === 'pause' || name === 'freeze') setInvite('')
      setNotice(name === 'open' ? 'Invite created. Copy it below; replacing it invalidates the previous link.' : 'Registration updated.')
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Registration failed.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 rounded-2xl border border-white/15 p-4 sm:p-6" aria-label="Tournament registration management">
    <h2 className="text-xl font-semibold">Registration and entrants</h2>
    <p className="text-sm text-slate-300">Entrants accept the frozen rules. The owner controls invites and removals. Freeze a full accepted field to record opening league assignments and draft order. Native league and draft setup follows this step.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}
    {notice && <p role="status" className="text-cyan-200">{notice}</p>}
    {board && <>
      <p>{board.registered}/{board.capacity} registered · {board.waitlisted} waiting · {board.state.replaceAll('_', ' ')}</p>
      <p className="text-sm text-amber-200">{board.fullField ? 'The field is full. League provisioning and draft readiness checks still need to pass.' : 'The full configured field is required before leagues and drafts can launch.'}</p>
      {board.frozenField ? <section className="space-y-3 rounded-xl border border-cyan-300/30 p-4" aria-label="Frozen opening field">
        <h3 className="font-semibold">Opening field frozen</h3><p>Registration and participant changes are locked. These assignments will be reused for setup retries. Drafts are not yet ready to launch.</p>
        <p className="break-all text-xs text-slate-400">Manifest: {board.frozenField.manifestHash}</p>
        {board.frozenField.leagues.map(league => <details key={league.key}><summary className="min-h-11 cursor-pointer py-2">{league.name} · {league.slots} teams{league.division ? ' · ' + league.division : ''}</summary><ol className="space-y-2 pl-4">{league.members.map(member => <li key={member.id}>Draft slot {member.draftSlot}: {member.displayName} · waiver priority {member.waiverPriority}</li>)}</ol></details>)}
      </section> : <div className="space-y-3 rounded-xl border border-amber-300/30 p-4">
        <p>Freezing closes registration, locks withdrawals and records a single random opening assignment. Review the full roster first; this step cannot be undone in this workflow.</p>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmFreeze} disabled={busy || !board.fullField} onChange={e => setConfirmFreeze(e.target.checked)} />I have reviewed the full field and want to lock these entrants.</label>
        <button className="min-h-11 rounded-xl border border-amber-300/50 px-4 disabled:opacity-40" disabled={busy || !board.fullField || !confirmFreeze} onClick={() => action('freeze', { publicationId })}>Freeze field and assign opening leagues</button>
      </div>}
      {board.frozenField && <SeasonNativeSetup tournamentId={tournamentId} />}
      <fieldset disabled={busy || !!board.frozenField} className="space-y-4">
      <label className="block">Registration closes (your local time)<input type="datetime-local" className={field} value={closes} onChange={e => setCloses(e.target.value)} disabled={busy} /></label>
      <label className="block">Waitlist capacity<input type="number" className={field} min={0} max={192} value={limit} onChange={e => setLimit(Number(e.target.value))} disabled={busy} /></label>
      <div className="flex flex-wrap gap-3">
        <button className="min-h-11 rounded-xl bg-cyan-300 px-4 font-semibold text-slate-950 disabled:opacity-40" disabled={busy || !closes} onClick={() => action('open', { publicationId, closesAt: new Date(closes).toISOString(), waitlistLimit: limit })}>{board.state === 'not_opened' ? 'Open registration and create invite' : 'Reopen and replace invite link'}</button>
        <button className="min-h-11 rounded-xl border border-white/20 px-4" disabled={busy || board.state !== 'open'} onClick={() => action('pause')}>Pause new joins</button>
        <button className="min-h-11 rounded-xl border border-white/20 px-4" disabled={busy} onClick={() => reload().catch(e => setError(e.message))}>Refresh entrants</button>
      </div>
      {invite && <><label className="block">Tournament invite link<input className={field} readOnly value={invite} onFocus={e => e.target.select()} /></label><button className="min-h-11 rounded-xl border border-cyan-300/40 px-4 text-cyan-200" onClick={async () => { try { await navigator.clipboard.writeText(invite); setNotice('Invite copied.') } catch { setNotice('Select the link above to copy it.') } }}>Copy invite link</button></>}
      <p className="text-xs text-slate-400">Invite links are shown when created. If you lose the link, replace it to get a new one. Pausing blocks new joins; entrants can still withdraw before the deadline and the queue can still advance.</p>
      <label className="block">Reason for removing an entrant<input className={field} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
      <ul className="space-y-3" aria-label="Tournament entrants">{board.entrants.map(e => <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 p-3"><span className="break-words">{e.displayName} · {e.status}</span>{['registered', 'waitlisted'].includes(e.status) && <button className="min-h-11 rounded-lg border border-red-300/30 px-3 text-red-200" disabled={busy || !reason.trim()} onClick={() => action('remove', { participantId: e.id, reason: reason.trim() })}>Remove {e.displayName}</button>}{e.status === 'removed' && <button className="min-h-11 rounded-lg border border-cyan-300/30 px-3" disabled={busy} onClick={() => action('restore', { participantId: e.id })}>Restore eligibility for {e.displayName}</button>}</li>)}</ul>
      <p className="text-xs text-slate-400">Restoring eligibility lets someone rejoin with an active invite and accept the rules again; it does not take a seat from another entrant.</p>
      </fieldset>
    </>}
  </section>
}
