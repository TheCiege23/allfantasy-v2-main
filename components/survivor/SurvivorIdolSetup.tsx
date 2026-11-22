'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  SURVIVOR_IDOL_COUNT_OPTIONS,
  SURVIVOR_IDOL_PICK_COUNT_MAX,
  isSurvivorIdolTypePlayable,
  survivorIdolArt,
  type SurvivorIdolCategory,
  type SurvivorIdolTypeDef,
} from '@/lib/survivor/survivorIdolTypes'
import { browserRandomInt, drawBalancedIdolTypes, pickQuantities, playableIdolPool, validatePickedIdolTypes, withPickQuantity, type SurvivorIdolDrawMode } from '@/lib/survivor/survivorIdolDraw'
import { SurvivorIdolCard } from './SurvivorIdolCard'
import './survivorIdols.css'

type SetupConfig = {
  mode: SurvivorIdolDrawMode
  count: number
  hideFromCommish: boolean
  pickedTypeIds: string[]
  pointSurgePct: number
  tributePct: number
}

export type SurvivorIdolSetupData = {
  types: SurvivorIdolTypeDef[]
  isCommissioner: boolean
  locked: boolean
  config: SetupConfig
  resolvedTypeIds: string[] | null
  resolved: boolean
  saved: boolean
}

const PICK_FILTERS: Array<'All' | SurvivorIdolCategory> = ['All', 'Votes', 'Scoring', 'Roster', 'Game', 'Bluff']

/** One card per idol type, with a ×N badge when the draw repeats it. */
function groupRepeats(types: SurvivorIdolTypeDef[]): Array<{ type: SurvivorIdolTypeDef; copies: number }> {
  const groups: Array<{ type: SurvivorIdolTypeDef; copies: number }> = []
  for (const type of types) {
    const group = groups.find(entry => entry.type.id === type.id)
    if (group) group.copies += 1
    else groups.push({ type, copies: 1 })
  }
  return groups
}

function SealedCard() {
  return <div className="svi-sealed"><span className="svi-sealed-mark" aria-hidden>?</span><div><strong>Sealed idol</strong><span>Revealed when someone plays it</span></div></div>
}

/** How many copies of one idol hide in the draft (pick mode). */
function QuantityStepper({ name, value, min, max, disabled, onChange }: { name: string; value: number; min: number; max: number; disabled: boolean; onChange: (next: number) => void }) {
  return <span className="svs-qty" role="group" aria-label={`${name} quantity`}>
    <button type="button" className="svs-qty-btn" aria-label={`Fewer ${name}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}><Minus size={14} strokeWidth={3} /></button>
    <output className="svs-qty-val" aria-label={`${name} copies`}>{value}</output>
    <button type="button" className="svs-qty-btn" aria-label={`More ${name}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Plus size={14} strokeWidth={3} /></button>
  </span>
}

/**
 * Commissioner idol setup (survivor-theme handoff, IdolSetup): a random balanced draw of 6/7/8
 * with Immunity and Tribe immunity always in, an illustrative preview draw with Re-roll, sealed
 * cards for a playing commissioner, and the league's Point surge / Tribute values — or pick mode
 * (owner's call, 2026-10-20): a quantity per idol type, 1 to 12 idols in all. Only idols that can be
 * played today are listed. The server makes the real draw when the draft locks.
 */
export function SurvivorIdolSetup({ leagueId, leagueName, canEdit, initialData }: { leagueId: string; leagueName?: string; canEdit: boolean; initialData?: SurvivorIdolSetupData }) {
  const [data, setData] = useState<SurvivorIdolSetupData | null>(initialData ?? null)
  const [draft, setDraft] = useState<SetupConfig | null>(initialData?.config ?? null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'All' | SurvivorIdolCategory>('All')
  const [rollKey, setRollKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-setup`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Could not load idol setup')
      setData(payload)
      setDraft(payload.config)
      setLoadError(null)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load idol setup')
    }
  }, [leagueId])

  useEffect(() => { if (!initialData) void load() }, [initialData, load])

  // The server already hides catalogue-only types; this keeps an older payload honest.
  const types = useMemo(() => (data?.types ?? []).filter(isSurvivorIdolTypePlayable), [data?.types])
  const always = useMemo(() => playableIdolPool(types).always, [types])
  const others = types.filter(type => !type.alwaysIn)
  const byId = useMemo(() => new Map(types.map(type => [type.id, type])), [types])
  const editable = Boolean(canEdit && data?.isCommissioner && !data.locked)
  const surgeLive = Boolean(byId.get('point-surge') && isSurvivorIdolTypePlayable(byId.get('point-surge')!))
  const tributeLive = Boolean(byId.get('tribute') && isSurvivorIdolTypePlayable(byId.get('tribute')!))

  // Illustrative only: the real draw happens on the server at draft lock.
  const preview = useMemo(() => {
    if (!draft || draft.mode !== 'random' || !types.length) return []
    void rollKey
    const draw = drawBalancedIdolTypes(types, draft.count, browserRandomInt)
    return draw.ok ? draw.typeIds.flatMap(id => byId.get(id) ?? []).filter(type => !type.alwaysIn) : []
  }, [draft?.mode, draft?.count, types, byId, rollKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) return <p role="alert" className="svs-alert">{loadError} <button type="button" className="svs-btn" onClick={() => void load()}>Try again</button></p>
  if (!data || !draft) return <p role="status" className="svs-note">Loading idol setup…</p>

  const extraCount = Math.max(0, draft.count - always.length)
  // Pick mode: the list is the multiset of idols, one entry per copy; its length is the count.
  const picked = draft.mode === 'pick' ? draft.pickedTypeIds : []
  const quantities = pickQuantities(picked)
  const pickCheck = draft.mode === 'pick' ? validatePickedIdolTypes(types, picked.length, picked) : null
  const pickReady = draft.mode !== 'pick' || Boolean(pickCheck?.ok)
  const total = draft.mode === 'pick' ? picked.length : draft.count
  const sealed = draft.mode === 'random' && draft.hideFromCommish
  const update = (patch: Partial<SetupConfig>) => { setDraft(current => current ? { ...current, ...patch } : current); setMessage(null) }
  const setQuantity = (id: string, quantity: number) => {
    const next = withPickQuantity(picked, id, quantity)
    update({ pickedTypeIds: next, count: Math.max(1, next.length) })
  }
  const enterPickMode = () => {
    // Start from the always-in idols, once each; the commissioner adds copies and other types.
    const seed = picked.length ? picked : always.map(type => type.id)
    update({ mode: 'pick', hideFromCommish: false, pickedTypeIds: seed, count: Math.max(1, seed.length) })
  }

  // After lock the server's draw replaces the preview (or stays sealed).
  const lockedDraw = data.resolved && data.resolvedTypeIds ? data.resolvedTypeIds.flatMap(id => byId.get(id) ?? []).filter(type => !type.alwaysIn) : null
  const pickedShown = (pickCheck?.ok ? pickCheck.typeIds : picked).flatMap(id => byId.get(id) ?? []).filter(type => !type.alwaysIn)
  const drawShown = lockedDraw ?? (draft.mode === 'pick' ? pickedShown : preview)
  const alwaysShown = draft.mode === 'pick' && !lockedDraw ? picked.flatMap(id => byId.get(id) ?? []).filter(type => type.alwaysIn) : always
  const summaryIcons = [...alwaysShown, ...(sealed || (data.resolved && !data.resolvedTypeIds) ? [] : drawShown)]
  const sealedSlots = Math.max(0, total - summaryIcons.length)

  async function save() {
    if (!draft || !editable || !pickReady) return
    setSaving(true); setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-setup`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.mode === 'pick' ? { ...draft, count: picked.length } : draft),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Could not save idol setup')
      setData(payload)
      setDraft(payload.config)
      setMessage({ tone: 'ok', text: draft.mode === 'random' ? 'Locked in. The server makes the final draw when the draft locks.' : 'Locked in. These idols hide in the draft.' })
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not save idol setup' })
    } finally { setSaving(false) }
  }

  const status = data.locked
    ? data.resolved ? (data.resolvedTypeIds ? 'The draft has started. These idols are hidden in this league.' : 'The draft has started. The draw is sealed; you’ll learn what’s in play as idols are played.') : 'The draft has started. Idol settings are locked.'
    : !pickReady ? (pickCheck && !pickCheck.ok ? pickCheck.error : `Pick 1 to ${SURVIVOR_IDOL_PICK_COUNT_MAX} idols to lock.`)
      : sealed ? 'The draw is sealed. You’ll find out what’s in play when idols are played, like everyone else.'
        : draft.mode === 'random' ? 'Ready. The server makes the final draw when the draft locks.' : 'Ready to lock.'

  return (
    <div className="svs" data-testid="survivor-idol-setup">
      <div className="svs-main">
        <header className="svs-row">
          <div className="svs-grow">
            <span className="svs-lbl svs-gold">Commissioner{leagueName ? ` · ${leagueName}` : ''}</span>
            <h2 style={{ margin: '4px 0', fontSize: 24, fontWeight: 700, color: 'inherit' }}>Hidden idols</h2>
            <p className="svs-status">Choose which idol types are hidden in the draft. Which players hide them is always random and sealed at draft lock.</p>
          </div>
        </header>

        <section className="svs-panel svs-choose" aria-label="How idols are chosen">
          <div>
            <span className="svs-lbl" id="svs-mode-label">How idols are chosen</span>
            <div className="svs-seg" role="radiogroup" aria-labelledby="svs-mode-label" style={{ marginTop: 10 }}>
              <button type="button" role="radio" aria-checked={draft.mode === 'random'} disabled={!editable} onClick={() => update({ mode: 'random' })}>Random, balanced</button>
              <button type="button" role="radio" aria-checked={draft.mode === 'pick'} disabled={!editable} onClick={enterPickMode}>I’ll pick</button>
            </div>
          </div>
          <div>
            <span className="svs-lbl" id="svs-count-label">Idols in the draft</span>
            {draft.mode === 'random' ? (
              <div className="svs-seg" role="radiogroup" aria-labelledby="svs-count-label" style={{ marginTop: 10 }}>
                {SURVIVOR_IDOL_COUNT_OPTIONS.map(count => <button key={count} type="button" role="radio" aria-checked={draft.count === count} disabled={!editable} onClick={() => update({ count })}>{count}</button>)}
              </div>
            ) : (
              <p className="svs-status" style={{ marginTop: 10 }} aria-labelledby="svs-count-label" data-testid="svs-pick-total">{total} of {SURVIVOR_IDOL_PICK_COUNT_MAX} · set a quantity per idol below</p>
            )}
          </div>
        </section>

        <section aria-label="Always in every league" className="svs-main" style={{ gap: 10 }}>
          <span className="svs-lbl">Always in every league<small>{draft.mode === 'pick' ? 'At least one copy' : 'Can’t be removed'}</small></span>
          <div className="svs-grid">
            {always.map(type => <SurvivorIdolCard key={type.id} type={type} layout="row" values={draft} headingLevel="h4"
              aside={draft.mode === 'pick' && editable
                ? <QuantityStepper name={type.name} value={quantities.get(type.id) ?? 0} min={1} max={SURVIVOR_IDOL_PICK_COUNT_MAX} disabled={!editable} onChange={quantity => setQuantity(type.id, quantity)} />
                : <span className="svi-tag svi-tag-row" data-always>{draft.mode === 'pick' && (quantities.get(type.id) ?? 0) > 1 ? `Always in ×${quantities.get(type.id)}` : 'Always in'}</span>} />)}
          </div>
        </section>

        {draft.mode === 'random' ? (
          <section aria-label="This league's draw" className="svs-main" style={{ gap: 10 }}>
            <div className="svs-row">
              <span className="svs-lbl svs-grow">{lockedDraw || (data.locked && data.resolved) ? 'This league’s idols' : 'This league’s draw'} · {extraCount} more</span>
              <label className="svs-check"><input type="checkbox" checked={draft.hideFromCommish} disabled={!editable} onChange={event => update({ hideFromCommish: event.target.checked })} />Hide the draw from me too (I’m playing)</label>
              {!data.locked && <button type="button" className="svs-btn" disabled={!editable || sealed} onClick={() => setRollKey(key => key + 1)}>Re-roll</button>}
            </div>
            <div className="svs-grid">
              {sealed || (data.resolved && !data.resolvedTypeIds)
                ? Array.from({ length: extraCount }, (_, index) => <SealedCard key={index} />)
                : groupRepeats(drawShown).map(({ type, copies }) => <SurvivorIdolCard key={type.id} type={type} layout="row" values={draft} headingLevel="h4" aside={copies > 1 ? <span className="svi-tag svi-tag-row" aria-label={`${copies} copies`}>×{copies}</span> : undefined} />)}
            </div>
            <p className="svs-note">Only idols that can be played today are drawn. Balanced draw: no more than one heavy idol (three dots), no more than two from the same group, and at least one voting idol and one scoring or roster idol, wherever the playable idols allow it. While fewer idols are playable than there are slots, the draw repeats them (×2) instead. The final draw happens on the server when the draft locks. {lockedDraw ? '' : 'This preview shows what a draw looks like.'}</p>
          </section>
        ) : (
          <section aria-label="Pick idols" className="svs-main" style={{ gap: 10 }}>
            <div className="svs-row">
              <span className="svs-lbl svs-grow">Quantity per idol · {total} of {SURVIVOR_IDOL_PICK_COUNT_MAX} picked</span>
              <div className="svs-chips" role="group" aria-label="Filter by group">
                {PICK_FILTERS.map(name => <button key={name} type="button" className="svs-chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
              </div>
            </div>
            <p className="svs-note">Choose how many of each idol hide in the draft, up to {SURVIVOR_IDOL_PICK_COUNT_MAX} in all. Only idols that can be played today are listed.</p>
            <div className="svs-grid">
              {others.filter(type => filter === 'All' || type.category === filter).map(type => {
                const quantity = quantities.get(type.id) ?? 0
                const full = total >= SURVIVOR_IDOL_PICK_COUNT_MAX
                return <div key={type.id} className="svs-pick">
                  <SurvivorIdolCard type={type} layout="row" values={draft} headingLevel="h4" selected={quantity > 0} dimmed={quantity === 0 && full}
                    aside={<QuantityStepper name={type.name} value={quantity} min={0} max={full ? quantity : SURVIVOR_IDOL_PICK_COUNT_MAX} disabled={!editable} onChange={next => setQuantity(type.id, next)} />} />
                </div>
              })}
            </div>
          </section>
        )}
      </div>

      <aside className="svs-side" aria-label="Idol summary">
        <section className="svs-panel">
          <span className="svs-lbl">Summary</span>
          <div className="svs-count"><b>{draft.count}</b><span>idols hidden in the draft</span></div>
          <div className="svs-icons">
            {summaryIcons.map((type, index) => <span key={`${type.id}-${index}`} className="svs-icon" title={type.name}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={survivorIdolArt(type.id, 'icon') ?? ''} alt={type.name} /></span>)}
            {Array.from({ length: sealedSlots }, (_, index) => <span key={`sealed-${index}`} className="svs-icon" data-sealed aria-label="Sealed idol">?</span>)}
          </div>
          <p className="svs-status" role="status">{status}</p>
          {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'svs-alert' : 'svs-status'}>{message.text}</p>}
          {data.isCommissioner && !data.locked && <button type="button" className="svs-btn svs-btn-gold" disabled={!editable || !pickReady || saving} onClick={() => void save()}>{saving ? 'Locking…' : 'Lock idols for the draft'}</button>}
        </section>

        <section className="svs-panel" aria-label="League values">
          <span className="svs-lbl">League values</span>
          <div className="svs-values">
            <label>Point surge size (%){!surgeLive && <span className="svi-tag svi-soon">Coming soon</span>}
              <input type="number" inputMode="numeric" min={1} max={100} value={draft.pointSurgePct} disabled={!editable || !surgeLive} onChange={event => update({ pointSurgePct: Math.round(Number(event.target.value)) })} />
            </label>
            <label>Tribute (% of points){!tributeLive && <span className="svi-tag svi-soon">Coming soon</span>}
              <input type="number" inputMode="numeric" min={1} max={50} value={draft.tributePct} disabled={!editable || !tributeLive} onChange={event => update({ tributePct: Math.round(Number(event.target.value)) })} />
            </label>
          </div>
          <p className="svs-note">{surgeLive && tributeLive ? 'Point surge adds this much to a team’s score for one week. Tribute takes this share of one opponent’s points.' : 'These apply once Point surge and Tribute can be played. Until then they are not in any draw.'}</p>
        </section>

        <section className="svs-panel svs-know">
          <span className="svs-lbl">Good to know</span>
          <p>{always.length ? `${always.map(type => type.name).join(' and ')} ${always.length === 1 ? 'is' : 'are'} in every Survivor league.` : 'Every league gets a balanced draw of idols.'}</p>
          <p>Commissioners can see which idol types are in play, but never which players hide them.</p>
          <p>Settings lock when the draft starts. After that, idols only change hands when they’re found or played.</p>
        </section>
      </aside>
    </div>
  )
}
