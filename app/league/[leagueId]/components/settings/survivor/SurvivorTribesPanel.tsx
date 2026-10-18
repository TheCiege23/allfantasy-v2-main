'use client'
import { useEffect, useState } from 'react'
import type { SurvivorSettingsPanelProps } from './types'
import { SurvivorTribePicker } from '@/components/league/survivor/SurvivorTribePicker'
import { SurvivorTribePlanSection } from './SurvivorTribePlanSection'
import { defaultTribeSlots, validateTribeSlots, type SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'
type Setup = { sport: string; managers: number; tribeCount: number; slots: SurvivorTribeSlot[]; locked: boolean; canEdit: boolean }
export function SurvivorTribesPanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const [data, setData] = useState<Setup | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; setData(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor-tribe-setup`, { credentials: 'include' }).then(async r => { const json = await r.json(); if (!r.ok) throw new Error(json.error); if (active) setData(json) }).catch(e => { if (active) setNote(e.message) })
    return () => { active = false }
  }, [leagueId])
  async function save() {
    if (!data) return
    setBusy(true); setNote('')
    try { const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor-tribe-setup`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tribeCount: data.tribeCount, slots: data.slots }) }); const json = await r.json(); if (!r.ok) throw new Error(json.error); setNote('Tribe choices saved. The system will use these capacities when the draft finishes.') }
    catch (e) { setNote(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }
  const disabled = !canEdit || !data?.canEdit || data.locked || busy
  return <div className="space-y-5 p-4 text-white">
    <h2 className="text-lg font-semibold">Tribe identities and capacities</h2>
    {!data && !note && <p role="status">Loading tribe setup…</p>}
    {data && <><p className="text-sm text-white/60">League size: {data.managers} managers. Choose league size during creation.</p>
      {data.locked && <p className="rounded border border-amber-400/30 p-3 text-sm text-amber-200">Tribe setup is locked because drafting or assignment has started.</p>}
      <label className="flex items-center gap-3 text-sm">Number of tribes<select value={data.tribeCount} disabled={disabled} onChange={e => { const count = Number(e.target.value); setData({ ...data, tribeCount: count, slots: defaultTribeSlots(data.managers, count) }) }} className="min-h-11 rounded border border-white/20 bg-neutral-950 px-3">{[2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <SurvivorTribePicker sport={data.sport} managers={data.managers} tribeCount={data.tribeCount} value={data.slots} onChange={slots => setData({ ...data, slots })} disabled={disabled} />
      <button type="button" disabled={disabled || !!validateTribeSlots(data.slots, data.managers, data.tribeCount)} onClick={save} className="min-h-11 rounded bg-amber-300 px-4 font-semibold text-black disabled:opacity-40">{busy ? 'Saving…' : 'Save tribe setup'}</button>
      <SurvivorTribePlanSection leagueId={leagueId} setup={data} disabled={!canEdit || !data.canEdit || busy || data.locked} />
    </>}
    {note && <p role="status" className="text-sm text-amber-200">{note}</p>}
  </div>
}
