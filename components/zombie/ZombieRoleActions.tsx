'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Workflow = { id: string; kind: string; status: string; week: number | null; deadlineAt: string | null; canRespond: boolean; choices: string[]; offerIndex?: number }
type Pack = { supported: boolean; owner?: boolean; canStartDraw?: boolean; canAmbush?: boolean; correctionHoldFromWeek?: number | null; nominees?: Array<{ id: string; name: string; veteran?: boolean }>; workflows: Workflow[] }
type Match = { id: string; homeRosterId: string; awayRosterId: string; homeName: string; awayName: string; locked: boolean }
type Preview = { week: number; previewHash: string; remaining: number; matches: Match[] }
const labels: Record<string, string> = { accept: 'Accept role', decline: 'Decline', spare: 'Spare', infect: 'Turn into Zombie', replace: 'Become Whisperer', become_whisperer: 'Become Whisperer' }
const titles: Record<string, string> = { initial_offer: 'Whisperer offer', survivor_bash: 'You bashed a Survivor', whisperer_bash: 'You bashed the Whisperer', whisperer_maul: 'Whisperer succession after revival' }
const control = 'min-h-11 rounded-xl border border-emerald-400/30 bg-[#081b18] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50'

export function ZombieRoleActions({ leagueId, onChanged }: { leagueId: string; onChanged?: () => void }) {
  const [pack, setPack] = useState<Pack | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [nominee, setNominee] = useState('')
  const [reason, setReason] = useState('')
  const [veterans, setVeterans] = useState<string[] | null>(null)
  const requestId = useRef<string | null>(null)
  const generation = useRef(0)
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/zombie/role-workflows?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', signal })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load role decisions.')
    if (typeof result.supported !== 'boolean' || !Array.isArray(result.workflows)) throw new Error('Role decisions returned an incomplete response. Refresh to retry.')
    if (!signal?.aborted) setPack(result)
  }, [leagueId])
  useEffect(() => {
    const controller = new AbortController()
    generation.current += 1
    setPack(null); setPreview(null); setSlots([]); setMessage(''); requestId.current = null
    void load(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(error.message) })
    const timer = setInterval(() => { void load(controller.signal).catch(() => {}) }, 30_000)
    setNominee(''); setReason(''); setVeterans(null); setBusy(false)
    return () => { generation.current += 1; controller.abort(); clearInterval(timer) }
  }, [load])
  async function post(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setMessage('')
    const version = generation.current
    try {
      const response = await fetch('/api/zombie/role-workflows', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...body }) })
      const result = await response.json()
      if (version !== generation.current) return
      if (!response.ok) throw new Error(result.error || 'Decision could not be saved.')
      setMessage('Saved. Your league status is up to date.'); setVeterans(null); await load(); onChanged?.()
    } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : 'Could not save. Refresh and try again.') }
    finally { if (version === generation.current) setBusy(false) }
  }
  async function openAmbush() {
    setBusy(true); setMessage('')
    const version = generation.current
    try {
      const response = await fetch(`/api/zombie/ambush?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      const result = await response.json()
      if (version !== generation.current) return
      if (!response.ok) throw new Error(result.error || 'Could not preview matchups.')
      setPreview(result); setSlots(result.matches.flatMap((m: Match) => [m.homeRosterId, m.awayRosterId])); requestId.current = null
    } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : 'Could not preview matchups.') }
    finally { if (version === generation.current) setBusy(false) }
  }
  async function confirmAmbush() {
    if (!preview || busy) return
    requestId.current ??= crypto.randomUUID()
    setBusy(true); setMessage('')
    const version = generation.current
    try {
      const response = await fetch('/api/zombie/ambush', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, week: preview.week, previewHash: preview.previewHash, requestId: requestId.current,
          pairs: preview.matches.map((_, i) => ({ homeRosterId: slots[i * 2], awayRosterId: slots[i * 2 + 1] })) }) })
      const result = await response.json()
      if (version !== generation.current) return
      if (!response.ok) throw new Error(result.error || 'Ambush could not be confirmed.')
      setMessage(result.scoreRefreshPending ? 'Ambush saved. Score refresh is pending; the ambush was spent only once.' : 'Ambush saved. Matchups updated.')
      setPreview(null); requestId.current = null; await load(); onChanged?.()
    } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : 'Connection interrupted. Retry this same plan to check its saved result.') }
    finally { if (version === generation.current) setBusy(false) }
  }
  if (pack && !pack.supported) return null
  if (!pack && !message) return null
  const names = new Map(preview?.matches.flatMap(m => [[m.homeRosterId, m.homeName], [m.awayRosterId, m.awayName]] as Array<[string, string]>))
  const locked = new Set(preview?.matches.filter(m => m.locked).flatMap(m => [m.homeRosterId, m.awayRosterId]))
  return <section aria-label="Zombie combat and role decisions" className="space-y-4 rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-950/70 to-[#090c18] p-4 text-white sm:p-5">
    <header><h2 className="font-black">Combat &amp; Whisperer command</h2><p className="mt-1 text-sm text-white/65">2025 NFL rules · role choices and matchup control</p></header>
    {message && <p role="status" aria-live="polite" className="text-sm text-emerald-100">{message}</p>}
    {pack?.correctionHoldFromWeek != null && <p role="alert" className="text-sm text-amber-200">A stat correction from Week {pack.correctionHoldFromWeek} is awaiting commissioner recovery. Combat decisions and ambushes are held.</p>}
    {pack?.canStartDraw && <div className="space-y-3"><p className="text-sm text-white/70">Fill all seats, then run an independent random draw. Veterans receive sequential 24-hour offers; if there are no veterans, every manager is eligible.</p>
      <details className="rounded-xl border border-white/10 p-3"><summary className="min-h-11 cursor-pointer text-sm">Review returning-manager eligibility</summary><p className="mb-2 text-sm text-white/65">A veteran completed at least one full prior year in this Zombie universe. Review historical or imported membership before offers begin; eligibility is then sealed.</p>
        {pack.nominees?.map(n => <label key={n.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={(veterans ?? pack.nominees?.filter(m => m.veteran).map(m => m.id) ?? []).includes(n.id)} onChange={e => { const selected = veterans ?? pack.nominees?.filter(m => m.veteran).map(m => m.id) ?? []; setVeterans(e.target.checked ? [...selected, n.id] : selected.filter(id => id !== n.id)) }} />{n.name}</label>)}
        <label className="block text-sm">Historical review reason<input className={`${control} mt-1 w-full`} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button className={`${control} mt-2`} disabled={busy || veterans === null || reason.trim().length < 8} onClick={() => void post({ action: 'eligibility', veteranUserIds: veterans, reason })}>Save eligibility review</button>
      </details><button className={control} disabled={busy || veterans !== null} onClick={() => void post({ action: 'start' })}>Start Whisperer offers</button></div>}
    {pack?.workflows.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <h3 className="font-semibold">{titles[row.kind] || 'Role decision'}{row.week ? ` · Week ${row.week}` : ''}</h3>
      {row.deadlineAt && <p className="text-sm text-white/70">Deadline: {new Date(row.deadlineAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} Eastern</p>}
      <p className="text-sm text-white/65">{row.kind === 'initial_offer' ? 'Accepting grants two seasonal ambushes. Declining or timing out moves to the next eligible manager.' : row.kind === 'whisperer_maul' ? 'Your two serums were already spent to revive. Accept the Whisperer role with its remaining ambushes, or decline and stay a Survivor. No response leaves the role vacant.' : row.kind === 'whisperer_bash' ? 'Spare the current Whisperer or turn them into a Zombie and inherit their remaining ambushes. No response means spare.' : 'Spare your opponent or turn them into a Zombie. No response means spare.'}</p>
      {row.canRespond ? <div className="flex flex-wrap gap-2">{row.choices.map(choice => <button key={choice} className={control} disabled={busy || Boolean(row.deadlineAt && Date.parse(row.deadlineAt) <= Date.now())}
        onClick={() => void post({ workflowId: row.id, decision: choice, offerIndex: row.offerIndex })}>{labels[choice] || choice}</button>)}</div> : <p className="text-sm text-white/55">{row.status === 'review_required' ? 'Commissioner review required: the eligible offer list is exhausted.' : 'Waiting for the eligible manager’s response.'}</p>}
      {pack.owner && row.kind === 'initial_offer' && row.status === 'review_required' && <div className="space-y-2">
        <label className="block text-sm">Nominate a manager<select className={`${control} mt-1 w-full`} value={nominee} onChange={e => setNominee(e.target.value)}><option value="">Choose a manager</option>{pack.nominees?.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <label className="block text-sm">Review reason<input className={`${control} mt-1 w-full`} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button className={control} disabled={busy || !nominee || reason.trim().length < 8} onClick={() => void post({ action: 'nominate', nomineeId: nominee, reason })}>Send reviewed offer</button>
      </div>}
    </article>)}
    {pack?.canAmbush && <div><p className="mb-2 text-sm text-white/65">Remap any unlocked matchups. Teams with a starter already playing stay in place. One confirmation uses one seasonal ambush.</p><button className={control} disabled={busy} onClick={() => void openAmbush()}>Review ambush matchups</button></div>}
    {preview && <div className="space-y-3 rounded-xl border border-rose-400/30 p-3"><h3 className="font-bold">Week {preview.week} · {preview.remaining} ambushes remaining</h3>
      {preview.matches.map((m, row) => <div key={m.id} className="grid gap-2 sm:grid-cols-2">{[0, 1].map(side => {
        const index = row * 2 + side
        return <label key={side} className="text-xs text-white/65">Matchup {row + 1} · {side ? 'Away' : 'Home'}{m.locked ? ' · Locked' : ''}<select aria-label={`Matchup ${row + 1} ${side ? 'away' : 'home'}`} className={`${control} mt-1 w-full`} value={slots[index]} disabled={busy || m.locked}
          onChange={e => { const other = slots.indexOf(e.target.value); const changed = [...slots]; [changed[index], changed[other]] = [changed[other], changed[index]]; setSlots(changed); requestId.current = null }}>
          {slots.filter(id => !locked.has(id) || id === slots[index]).map(id => <option key={id} value={id}>{names.get(id) || 'Team'}</option>)}
        </select></label>
      })}</div>)}
      <button className={control} disabled={busy} onClick={() => void confirmAmbush()}>{busy ? 'Saving…' : 'Confirm remap · use 1 ambush'}</button>
      <button className={`${control} ml-2`} disabled={busy} onClick={() => { setPreview(null); requestId.current = null }}>Close editor</button>
    </div>}
    <button className="min-h-11 text-sm text-emerald-200 underline" disabled={busy} onClick={() => { void load().catch(e => setMessage(e.message)) }}>Refresh decisions</button>
  </section>
}
