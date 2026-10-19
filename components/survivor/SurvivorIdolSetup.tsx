'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import {
  SURVIVOR_IDOL_COUNT_OPTIONS,
  isSurvivorIdolTypePlayable,
  survivorIdolArt,
  type SurvivorIdolCategory,
  type SurvivorIdolTypeDef,
} from '@/lib/survivor/survivorIdolTypes'
import { browserRandomInt, drawBalancedIdolTypes, pickRequirement, playableIdolPool, validatePickedIdolTypes, type SurvivorIdolDrawMode } from '@/lib/survivor/survivorIdolDraw'
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
  /** Last week idols can be played; null = no week limit. Older servers omit it. */
  expiryWeek?: number | null
}

const EXPIRY_WEEKS = Array.from({ length: 30 }, (_, i) => i + 1)

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

const comingSoonTag = <span className="svi-tag svi-tag-row svi-soon">Coming soon</span>

function SealedCard() {
  return <div className="svi-sealed"><span className="svi-sealed-mark" aria-hidden>?</span><div><strong>Sealed idol</strong><span>Revealed when someone plays it</span></div></div>
}

/**
 * Commissioner idol setup (survivor-theme handoff, IdolSetup): random balanced draw or picks,
 * 6/7/8 idols with Immunity and Tribe immunity always in, an illustrative preview draw with
 * Re-roll, sealed cards for a playing commissioner, and the league's Point surge / Tribute values.
 * The server makes the real draw when the draft locks.
 */
export function SurvivorIdolSetup({ leagueId, leagueName, canEdit, initialData }: { leagueId: string; leagueName?: string; canEdit: boolean; initialData?: SurvivorIdolSetupData }) {
  const [data, setData] = useState<SurvivorIdolSetupData | null>(initialData ?? null)
  const [draft, setDraft] = useState<SetupConfig | null>(initialData?.config ?? null)
  const [expiryWeek, setExpiryWeek] = useState<number | null>(initialData?.expiryWeek ?? null)
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
      setExpiryWeek(payload.expiryWeek ?? null)
      setLoadError(null)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not load idol setup')
    }
  }, [leagueId])

  useEffect(() => { if (!initialData) void load() }, [initialData, load])

  const types = useMemo(() => data?.types ?? [], [data?.types])
  // Only playable types (play-engine registry) can be hidden in a league.
  const always = useMemo(() => playableIdolPool(types).always, [types])
  const comingSoonAlways = types.filter(type => type.alwaysIn && !isSurvivorIdolTypePlayable(type))
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
  const picked = draft.pickedTypeIds
  const need = pickRequirement(types, draft.count)
  const pickReady = draft.mode !== 'pick' || (need.min > 0 && picked.length >= need.min && picked.length <= need.max)
  const pickedFill = draft.mode === 'pick' && pickReady ? validatePickedIdolTypes(types, draft.count, picked) : null
  const sealed = draft.mode === 'random' && draft.hideFromCommish
  const update = (patch: Partial<SetupConfig>) => { setDraft(current => current ? { ...current, ...patch } : current); setMessage(null) }

  // After lock the server's draw replaces the preview (or stays sealed).
  const lockedDraw = data.resolved && data.resolvedTypeIds ? data.resolvedTypeIds.flatMap(id => byId.get(id) ?? []).filter(type => !type.alwaysIn) : null
  const pickedShown = pickedFill?.ok ? pickedFill.typeIds.flatMap(id => byId.get(id) ?? []).filter(type => !type.alwaysIn) : picked.flatMap(id => byId.get(id) ?? [])
  const drawShown = lockedDraw ?? (draft.mode === 'pick' ? pickedShown : preview)
  const summaryIcons = [...always, ...(sealed || (data.resolved && !data.resolvedTypeIds) ? [] : drawShown)]
  const sealedSlots = Math.max(0, draft.count - summaryIcons.length)

  async function save() {
    if (!draft || !editable || !pickReady) return
    setSaving(true); setMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/idol-setup`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, expiryWeek }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Could not save idol setup')
      setData(payload)
      setDraft(payload.config)
      setExpiryWeek(payload.expiryWeek ?? null)
      setMessage({ tone: 'ok', text: draft.mode === 'random' ? 'Locked in. The server makes the final draw when the draft locks.' : 'Locked in. These idols hide in the draft.' })
    } catch (cause) {
      setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not save idol setup' })
    } finally { setSaving(false) }
  }

  const status = data.locked
    ? data.resolved ? (data.resolvedTypeIds ? 'The draft has started. These idols are hidden in this league.' : 'The draft has started. The draw is sealed; you’ll learn what’s in play as idols are played.') : 'The draft has started. Idol settings are locked.'
    : !pickReady ? (need.min === need.max ? `Pick ${need.min - picked.length} more to lock.` : `Pick at least ${need.min} to lock.`)
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
              <button type="button" role="radio" aria-checked={draft.mode === 'pick'} disabled={!editable} onClick={() => update({ mode: 'pick', hideFromCommish: false })}>I’ll pick</button>
            </div>
          </div>
          <div>
            <span className="svs-lbl" id="svs-count-label">Idols in the draft</span>
            <div className="svs-seg" role="radiogroup" aria-labelledby="svs-count-label" style={{ marginTop: 10 }}>
              {SURVIVOR_IDOL_COUNT_OPTIONS.map(count => <button key={count} type="button" role="radio" aria-checked={draft.count === count} disabled={!editable} onClick={() => update({ count, pickedTypeIds: picked.slice(0, pickRequirement(types, count).max) })}>{count}</button>)}
            </div>
          </div>
        </section>

        <section aria-label="Always in every league" className="svs-main" style={{ gap: 10 }}>
          <span className="svs-lbl">Always in every league<small>Can’t be removed</small></span>
          <div className="svs-grid">
            {always.map(type => <SurvivorIdolCard key={type.id} type={type} layout="row" values={draft} headingLevel="h4" aside={<span className="svi-tag svi-tag-row" data-always>Always in</span>} />)}
          </div>
          {comingSoonAlways.length > 0 && <p className="svs-note">{comingSoonAlways.map(type => type.name).join(' and ')} {comingSoonAlways.length === 1 ? 'is' : 'are'} coming soon. {comingSoonAlways.length === 1 ? 'It joins' : 'They join'} every league once {comingSoonAlways.length === 1 ? 'its' : 'their'} play engine is ready, so {comingSoonAlways.length === 1 ? 'it is' : 'they are'} not included for now.</p>}
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
              <span className="svs-lbl svs-grow">{need.min === need.max ? `Pick ${need.min} more` : `Pick ${need.min} to ${need.max}`} · {picked.length} picked</span>
              <div className="svs-chips" role="group" aria-label="Filter by group">
                {PICK_FILTERS.map(name => <button key={name} type="button" className="svs-chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
              </div>
            </div>
            {need.min !== need.max && <p className="svs-note">Only {need.max} idol {need.max === 1 ? 'type can' : 'types can'} be played today, fewer than the {need.slots} open slots. Pick the ones you want; the empty slots repeat your picks in order.</p>}
            <div className="svs-grid">
              {others.filter(type => filter === 'All' || type.category === filter).map(type => {
                const playable = isSurvivorIdolTypePlayable(type)
                const checked = picked.includes(type.id)
                const full = picked.length >= need.max
                return <label key={type.id} className="svs-pick">
                  <input type="checkbox" checked={checked} disabled={!editable || !playable || (!checked && full)} aria-label={playable ? type.name : `${type.name} (coming soon)`}
                    onChange={() => update({ pickedTypeIds: checked ? picked.filter(id => id !== type.id) : [...picked, type.id] })} />
                  <SurvivorIdolCard type={type} layout="row" values={draft} headingLevel="h4" selected={checked} dimmed={!playable || (!checked && full)}
                    lead={<span className="svs-box" aria-hidden>{checked && <Check size={14} strokeWidth={3} />}</span>}
                    aside={playable ? undefined : comingSoonTag} />
                </label>
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
          <div className="svs-values">
            <label>Idols expire
              <select value={expiryWeek ?? ''} disabled={!editable} data-testid="svs-idol-expiry" onChange={event => { setExpiryWeek(event.target.value ? Number(event.target.value) : null); setMessage(null) }}>
                <option value="">No week limit</option>
                {EXPIRY_WEEKS.map(week => <option key={week} value={week}>After week {week}</option>)}
              </select>
            </label>
          </div>
          <p className="svs-note">{expiryWeek ? `An unplayed idol can be played through week ${expiryWeek}, then it is gone. Managers see this in the league rules.` : 'Idols stay playable all season, except any that expire at the merge.'}</p>
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
