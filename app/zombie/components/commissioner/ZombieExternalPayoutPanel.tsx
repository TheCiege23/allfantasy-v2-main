'use client'

import { useEffect, useState } from 'react'

type Team = { rosterId: string; fantasyTeamName?: string | null; displayName?: string | null }
type Week = { week: number; status: string }
type Payout = {
  week: number; winnerRosterId: string; amountCents: number;
  providerName: string; status: string; reference?: string | null
}

export function ZombieExternalPayoutPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [week, setWeek] = useState(1)
  const [winnerRosterId, setWinnerRosterId] = useState('')
  const [dollars, setDollars] = useState('')
  const [providerName, setProviderName] = useState('LeagueSafe')
  const [status, setStatus] = useState('recorded')
  const [reference, setReference] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [payouts, setPayouts] = useState<Payout[]>([])

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`/api/zombie/weekly-payout?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' }).then((r) => r.json()),
    ]).then(([leagueData, payoutData]) => {
      if (!active) return
      const nextTeams = (leagueData.league?.teams ?? []) as Team[]
      const resolved = ((leagueData.league?.weeklyResolutions ?? []) as Week[]).find((row) => row.status === 'complete')
      setTeams(nextTeams)
      setWinnerRosterId(nextTeams[0]?.rosterId ?? '')
      if (resolved) setWeek(resolved.week)
      setPayouts((payoutData.payouts ?? []) as Payout[])
    }).catch(() => { if (active) setMessage('Could not load weekly prizes.') })
    return () => { active = false }
  }, [leagueId])

  useEffect(() => {
    const existing = payouts.find((p) => p.week === week)
    if (!existing) return
    setWinnerRosterId(existing.winnerRosterId)
    setDollars((existing.amountCents / 100).toFixed(2))
    setProviderName(existing.providerName)
    setStatus(existing.status)
    setReference(existing.reference ?? '')
  }, [week, payouts])

  async function save() {
    const parsed = Number(dollars)
    if (!Number.isFinite(parsed) || parsed < 0 || !winnerRosterId) {
      setMessage('Choose a winner and enter a valid dollar amount.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/zombie/weekly-payout', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, week, winnerRosterId, amountCents: Math.round(parsed * 100), providerName, status, reference }),
      })
      const data = (await response.json()) as { error?: string; payout?: Payout; reportRefreshPending?: boolean }
      if (!response.ok || !data.payout) throw new Error(data.error ?? 'Could not record prize.')
      setPayouts((current) => [data.payout!, ...current.filter((p) => p.week !== week)])
      setMessage(data.reportRefreshPending
        ? 'Prize recorded, but the existing report could not refresh. Save again to retry.'
        : 'External prize recorded. The weekly report shows this amount when generated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not record prize.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'min-h-[44px] rounded-lg border border-white/15 bg-[#050a18] px-3 text-white disabled:opacity-50'
  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <h3 className="font-semibold text-white">Third-party weekly prize</h3>
      <p className="text-white/65">Record the amount won on the external platform. “Confirmed” means you verified it there; this screen does not send money.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">Resolved week<input className={inputClass} type="number" min={1} value={week} onChange={(e) => setWeek(Number(e.target.value))} disabled={!canEdit} /></label>
        <label className="flex flex-col gap-1">Winning manager<select className={inputClass} value={winnerRosterId} onChange={(e) => setWinnerRosterId(e.target.value)} disabled={!canEdit}>{teams.map((team) => <option key={team.rosterId} value={team.rosterId}>{team.fantasyTeamName || team.displayName || team.rosterId}</option>)}</select></label>
        <label className="flex flex-col gap-1">Amount won ($)<input className={inputClass} inputMode="decimal" type="number" min={0} step="0.01" value={dollars} onChange={(e) => setDollars(e.target.value)} disabled={!canEdit} /></label>
        <label className="flex flex-col gap-1">Platform<select className={inputClass} value={providerName} onChange={(e) => setProviderName(e.target.value)} disabled={!canEdit}><option>LeagueSafe</option><option>Fancred</option><option>Other</option></select></label>
        <label className="flex flex-col gap-1">Verification<select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)} disabled={!canEdit}><option value="recorded">Recorded</option><option value="confirmed">Confirmed on platform</option></select></label>
        <label className="flex flex-col gap-1">External reference (optional)<input className={inputClass} maxLength={160} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canEdit} /></label>
      </div>
      <button type="button" className="min-h-[44px] rounded-lg bg-amber-600/25 px-4 font-semibold text-amber-100 disabled:opacity-40" onClick={() => void save()} disabled={!canEdit || saving}>{saving ? 'Saving…' : 'Record weekly prize'}</button>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
