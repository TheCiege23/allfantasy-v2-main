'use client'

import { useState } from 'react'
import { SURVIVOR_TRIBE_CATALOG, defaultTribeSlots, tribeCrestUrl, validateTribeSlots, type SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'

export function SurvivorTribePicker({ sport, managers, tribeCount, value, onChange, disabled = false }: {
  sport: string; managers: number; tribeCount: number; value?: SurvivorTribeSlot[];
  onChange: (slots: SurvivorTribeSlot[]) => void; disabled?: boolean
}) {
  const slots = value?.length === tribeCount ? value : defaultTribeSlots(managers, tribeCount)
  const [editing, setEditing] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const error = validateTribeSlots(slots, managers, tribeCount)
  const update = (index: number, patch: Partial<SurvivorTribeSlot>) => onChange(slots.map((s, i) => i === index ? { ...s, ...patch } : s))
  return <section className="space-y-3" aria-label="Tribe identities and capacities">
    <p className="text-sm text-white/60">Choose each tribe and its manager capacity. Capacities must total {managers}. Unequal tribes use the league's sit-out rules.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {slots.map((slot, index) => {
        const tribe = SURVIVOR_TRIBE_CATALOG.find(t => t.id === slot.catalogId)
        return <div key={index} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center gap-3">
            <img src={tribeCrestUrl(slot.catalogId, sport) ?? undefined} alt={`${tribe?.name ?? 'Selected'} tribe crest, ${tribe?.mascot ?? ''}`} width={88} height={88} className="h-[88px] w-[88px] object-contain" />
            <div className="min-w-0"><p className="text-xs text-white/50">Tribe {index + 1}</p><p className="font-semibold text-white">{tribe?.name}</p>
              <button type="button" disabled={disabled} onClick={() => { setEditing(editing === index ? null : index); setSearch('') }} aria-expanded={editing === index} className="mt-2 min-h-11 rounded border border-white/20 px-3 text-sm text-amber-200 disabled:opacity-40">Choose tribe</button>
            </div>
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm text-white/80">Managers in tribe {index + 1}
            <input type="number" min={1} max={managers} value={slot.managerCount} disabled={disabled} onChange={e => update(index, { managerCount: Number(e.target.value) })} className="min-h-11 w-20 rounded border border-white/20 bg-neutral-950 px-2" />
          </label>
        </div>
      })}
    </div>
    {editing !== null && !disabled && <div className="rounded-xl border border-amber-400/25 bg-neutral-950 p-3">
      <div className="flex gap-2"><input aria-label="Search tribe names or mascots" placeholder="Search names or mascots" value={search} onChange={e => setSearch(e.target.value)} className="min-h-11 flex-1 rounded border border-white/20 bg-neutral-900 px-3 text-white" /><button type="button" onClick={() => setEditing(null)} className="min-h-11 px-3 text-white">Done</button></div>
      <div className="mt-3 grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
        {SURVIVOR_TRIBE_CATALOG.filter(t => `${t.name} ${t.mascot}`.toLowerCase().includes(search.toLowerCase())).map(t => {
          const selected = slots[editing]?.catalogId === t.id
          const taken = slots.some((s, i) => i !== editing && s.catalogId === t.id)
          return <button key={t.id} type="button" aria-pressed={selected} disabled={taken} onClick={() => { update(editing, { catalogId: t.id }); setEditing(null) }} className={`rounded-lg border p-2 text-center text-xs text-white disabled:opacity-30 ${selected ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 hover:border-white/40'}`}>
            <img src={tribeCrestUrl(t.id, sport) ?? undefined} alt="" width={100} height={100} loading="lazy" className="mx-auto h-24 w-24 object-contain" />{t.name}<span className="block text-white/50">{t.mascot}{taken ? ' · Selected' : ''}</span>
          </button>
        })}
      </div>
    </div>}
    <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error ?? `${managers} managers assigned across ${tribeCount} tribes.`}</p>
    <button type="button" disabled={disabled} onClick={() => onChange(slots.map((slot, index) => ({ ...slot, managerCount: defaultTribeSlots(managers, tribeCount)[index].managerCount })))} className="min-h-11 rounded border border-white/20 px-3 text-sm text-white disabled:opacity-40">Balance capacities</button>
  </section>
}
