'use client'

import { useState } from 'react'
import {
  SURVIVOR_TRIBE_CATALOG, SURVIVOR_TRIBE_SPORTS, defaultTribeSlots, isTribeHex, tribeCrestAlt, tribeCrestUrl, tribeSportKey,
  validateTribeSlots, type SurvivorTribeSlot, type SurvivorTribeSportKey,
} from '@/lib/survivor/survivorTribeIdentity'

const SPORT_LABEL: Record<SurvivorTribeSportKey, string> = { nfl: 'NFL', ncaaf: 'NCAAF', nba: 'NBA', ncaab: 'NCAAB', mlb: 'MLB', nhl: 'NHL', soccer: 'Soccer' }

function slotColors(slot: SurvivorTribeSlot | undefined) {
  return { primaryColor: slot?.primaryColor, secondaryColor: slot?.secondaryColor }
}

/** The tribe being edited: large crest, sport preview, and the commissioner's colour overrides. */
function SelectedTribePanel({ slot, index, sport, onColors }: {
  slot: SurvivorTribeSlot; index: number; sport: string
  onColors: (patch: Pick<SurvivorTribeSlot, 'primaryColor' | 'secondaryColor'>) => void
}) {
  const leagueSport = tribeSportKey(sport) ?? 'nfl'
  const [preview, setPreview] = useState<SurvivorTribeSportKey>(leagueSport)
  const tribe = SURVIVOR_TRIBE_CATALOG.find(t => t.id === slot.catalogId)
  if (!tribe) return null
  const primary = isTribeHex(slot.primaryColor) ? slot.primaryColor : tribe.primary
  const secondary = isTribeHex(slot.secondaryColor) ? slot.secondaryColor : tribe.secondary
  const customised = isTribeHex(slot.primaryColor) || isTribeHex(slot.secondaryColor)
  return <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/30 p-3 sm:flex-row" data-testid="survivor-selected-tribe">
    <img src={tribeCrestUrl(tribe.id, preview, slotColors(slot)) ?? undefined} alt={tribeCrestAlt(tribe.name, tribe.mascot)} width={180} height={214} className="mx-auto h-[214px] w-[180px] shrink-0 object-contain sm:mx-0" />
    <div className="min-w-0 flex-1 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-widest text-white/50">Tribe {index + 1}</p>
        <p className="text-lg font-semibold text-white">{tribe.name}</p>
        <p className="text-sm text-white/60">{tribe.mascot}</p>
      </div>
      <fieldset>
        <legend className="text-xs uppercase tracking-widest text-white/50">Preview sport</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {SURVIVOR_TRIBE_SPORTS.map(key => <button key={key} type="button" aria-pressed={preview === key} onClick={() => setPreview(key)}
            className={`min-h-11 min-w-11 rounded border px-2 text-xs font-semibold ${preview === key ? 'border-amber-400 bg-amber-400/10 text-amber-100' : 'border-white/15 text-white/70 hover:border-white/40'}`}>
            {SPORT_LABEL[key]}{key === leagueSport ? <span className="sr-only"> (this league)</span> : null}
          </button>)}
        </div>
        <p className="mt-1 text-xs text-white/45">Gear changes with the sport. Your league plays {SPORT_LABEL[leagueSport]}.</p>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/70">Primary colour
          <input type="color" value={primary} onChange={e => onColors({ primaryColor: e.target.value.toLowerCase(), secondaryColor: slot.secondaryColor })} className="h-11 w-16 cursor-pointer rounded border border-white/20 bg-transparent" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/70">Secondary colour
          <input type="color" value={secondary} onChange={e => onColors({ primaryColor: slot.primaryColor, secondaryColor: e.target.value.toLowerCase() })} className="h-11 w-16 cursor-pointer rounded border border-white/20 bg-transparent" />
        </label>
        <button type="button" disabled={!customised} onClick={() => onColors({ primaryColor: undefined, secondaryColor: undefined })} className="min-h-11 rounded border border-white/20 px-3 text-sm text-white disabled:opacity-40">Use tribe colours</button>
      </div>
    </div>
  </div>
}

export function SurvivorTribePicker({ sport, managers, tribeCount, value, onChange, disabled = false }: {
  sport: string; managers: number; tribeCount: number; value?: SurvivorTribeSlot[];
  onChange: (slots: SurvivorTribeSlot[]) => void; disabled?: boolean
}) {
  const slots = value?.length === tribeCount ? value : defaultTribeSlots(managers, tribeCount)
  const [editing, setEditing] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const error = validateTribeSlots(slots, managers, tribeCount)
  const update = (index: number, patch: Partial<SurvivorTribeSlot>) => onChange(slots.map((s, i) => {
    if (i !== index) return s
    const next: SurvivorTribeSlot = { ...s, ...patch }
    if (!next.primaryColor) delete next.primaryColor
    if (!next.secondaryColor) delete next.secondaryColor
    return next
  }))
  return <section className="space-y-3" aria-label="Tribe identities and capacities">
    <p className="text-sm text-white/60">Choose each tribe and its manager capacity. Capacities must total {managers}. Unequal tribes use the league's sit-out rules.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {slots.map((slot, index) => {
        const tribe = SURVIVOR_TRIBE_CATALOG.find(t => t.id === slot.catalogId)
        return <div key={index} className={`rounded-xl border bg-black/20 p-3 ${editing === index ? 'border-amber-400/60' : 'border-white/10'}`}>
          <div className="flex items-center gap-3">
            <img src={tribeCrestUrl(slot.catalogId, sport, slotColors(slot)) ?? undefined} alt={tribeCrestAlt(tribe?.name ?? 'Selected', tribe?.mascot)} width={88} height={104} className="h-[104px] w-[88px] object-contain" />
            <div className="min-w-0"><p className="text-xs text-white/50">Tribe {index + 1}</p><p className="font-semibold text-white">{tribe?.name}</p>
              <button type="button" disabled={disabled} onClick={() => { setEditing(editing === index ? null : index); setSearch('') }} aria-expanded={editing === index} className="mt-2 min-h-11 rounded border border-white/20 px-3 text-sm text-amber-200 disabled:opacity-40">{editing === index ? 'Close' : 'Choose tribe'}</button>
            </div>
          </div>
          <label className="mt-3 flex items-center justify-between gap-3 text-sm text-white/80">Managers in tribe {index + 1}
            <input type="number" min={1} max={managers} value={slot.managerCount} disabled={disabled} onChange={e => update(index, { managerCount: Number(e.target.value) })} className="min-h-11 w-20 rounded border border-white/20 bg-neutral-950 px-2" />
          </label>
        </div>
      })}
    </div>
    {editing !== null && !disabled && slots[editing] && <div className="space-y-3 rounded-xl border border-amber-400/25 bg-neutral-950 p-3">
      <SelectedTribePanel key={`${editing}:${slots[editing].catalogId}`} slot={slots[editing]} index={editing} sport={sport}
        onColors={colors => update(editing, { primaryColor: colors.primaryColor, secondaryColor: colors.secondaryColor })} />
      <div className="flex gap-2"><input aria-label="Search tribe names or mascots" placeholder="Search names or mascots" value={search} onChange={e => setSearch(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded border border-white/20 bg-neutral-900 px-3 text-white" /><button type="button" onClick={() => setEditing(null)} className="min-h-11 px-3 text-white">Done</button></div>
      <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
        {SURVIVOR_TRIBE_CATALOG.filter(t => `${t.name} ${t.mascot}`.toLowerCase().includes(search.toLowerCase())).map(t => {
          const selected = slots[editing]?.catalogId === t.id
          const taken = slots.some((s, i) => i !== editing && s.catalogId === t.id)
          // A new identity starts from its own catalogue colours.
          return <button key={t.id} type="button" aria-pressed={selected} disabled={taken} onClick={() => update(editing, { catalogId: t.id, primaryColor: undefined, secondaryColor: undefined })} className={`rounded-lg border p-2 text-center text-xs text-white disabled:opacity-30 ${selected ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 hover:border-white/40'}`}>
            <img src={tribeCrestUrl(t.id, sport) ?? undefined} alt="" width={100} height={119} loading="lazy" className="mx-auto h-[119px] w-[100px] object-contain" />{t.name}<span className="block text-white/50">{t.mascot}{taken ? ' · Selected' : ''}</span>
          </button>
        })}
      </div>
    </div>}
    <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error ?? `${managers} managers assigned across ${tribeCount} tribes.`}</p>
    <button type="button" disabled={disabled} onClick={() => onChange(slots.map((slot, index) => ({ ...slot, managerCount: defaultTribeSlots(managers, tribeCount)[index].managerCount })))} className="min-h-11 rounded border border-white/20 px-3 text-sm text-white disabled:opacity-40">Balance capacities</button>
  </section>
}
