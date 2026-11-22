'use client'

import './survivor-tribe-plan.css'

import { useMemo, useState } from 'react'
import { SURVIVOR_TRIBE_CATALOG, type SurvivorTribeSlot } from '@/lib/survivor/survivorTribeIdentity'
import {
  DEFAULT_TRIBE_PLAN,
  TRIBE_MAX_MANAGERS,
  TRIBE_MIN_MANAGERS,
  normalizeTribePlan,
  planBalanced,
  planRandom,
  tribeStrengths,
  validateTribePlan,
  type PlanParticipant,
  type SurvivorTribePlan,
  type TribePlanMode,
} from '@/lib/survivor/survivorTribePlan'

/**
 * Tribe plan (native league handoff §5.4, TribeSetup.png): assign managers by Random (seeded,
 * re-rollable), Balanced by AF, or Manual moves; see each tribe's AF strength; choose the three
 * announce toggles; then "Lock tribes & announce". Additive to SurvivorTribesPanel — the count,
 * identities and capacities above it stay where they were (the tribe picker is not touched).
 */

type SetupWithPlan = {
  managers: number
  tribeCount: number
  slots: SurvivorTribeSlot[]
  participants?: PlanParticipant[]
  plan?: unknown
  planLocked?: boolean
}

const MODES: Array<{ id: TribePlanMode; label: string }> = [
  { id: 'random', label: 'Random' },
  { id: 'balanced', label: 'Balanced by AF' },
  { id: 'manual', label: 'Manual' },
]

const newSeed = () => 1 + Math.floor(Math.random() * 2_147_483_646)
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] ?? '').join('').toUpperCase() || 'M'

export function SurvivorTribePlanSection({ leagueId, setup, disabled }: { leagueId: string; setup: SetupWithPlan; disabled: boolean }) {
  const participants = useMemo(() => setup.participants ?? [], [setup.participants])
  const capacities = useMemo(() => setup.slots.map(s => s.managerCount), [setup.slots])
  const saved = normalizeTribePlan(setup.plan)
  const [plan, setPlan] = useState<SurvivorTribePlan>(() => saved ?? { ...DEFAULT_TRIBE_PLAN, seed: newSeed(), mapping: {} })
  const [locked, setLocked] = useState(Boolean(setup.planLocked))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const hasStrength = participants.some(p => p.strength != null)
  const mapping = useMemo(() => {
    if (plan.mode === 'manual') return plan.mapping
    if (plan.mode === 'balanced' && hasStrength) return planBalanced(participants, capacities) ?? {}
    return planRandom(participants, capacities, plan.seed) ?? {}
  }, [plan.mode, plan.mapping, plan.seed, participants, capacities, hasStrength])
  const strengths = tribeStrengths(mapping, participants, capacities.length)
  const seatsOpen = setup.managers - participants.length
  const invalid = seatsOpen > 0
    ? `${participants.length} of ${setup.managers} seats are claimed. Tribes lock once every seat has a manager.`
    : validateTribePlan(mapping, participants, capacities)
  const frozen = disabled || locked || busy
  const sizes = strengths.tribes.map(t => t.size)

  const move = (userId: string, slot: number) => setPlan(p => ({ ...p, mode: 'manual', mapping: { ...mapping, [userId]: slot } }))
  const setMode = (mode: TribePlanMode) => setPlan(p => ({ ...p, mode, mapping: mode === 'manual' ? mapping : p.mapping }))
  const current = (): SurvivorTribePlan => ({ ...plan, mapping })

  async function send(method: 'PUT' | 'POST') {
    setBusy(true); setNote('')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor-tribe-setup`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'PUT' ? { tribeCount: setup.tribeCount, slots: setup.slots, plan: current() } : { plan: current() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Save failed')
      if (method === 'POST') {
        setLocked(true)
        setNote(json.announced ? 'Tribes are locked and announced in league chat.' : 'Tribes are locked.')
      } else setNote('Tribe plan saved.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stp" aria-labelledby="stp-title" data-testid="survivor-tribe-plan">
      <header className="stp-head">
        <h3 id="stp-title">Who goes where</h3>
        <span className="stp-pill">Draft order stays random · tribes lock before the draft</span>
      </header>

      <div className="stp-controls">
        <div>
          <p className="stp-label">Assign by</p>
          <div className="stp-seg" role="radiogroup" aria-label="Assign managers by">
            {MODES.map(m => (
              <button key={m.id} type="button" role="radio" aria-checked={plan.mode === m.id} disabled={frozen || (m.id === 'balanced' && !hasStrength)} onClick={() => setMode(m.id)} data-testid={`stp-mode-${m.id}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <fieldset className="stp-toggles" disabled={frozen}>
          <legend className="stp-label">On the board and in chat</legend>
          <label><input type="checkbox" checked={plan.showOnBoard} onChange={e => setPlan(p => ({ ...p, showOnBoard: e.target.checked }))} /> Show tribes on the draft board</label>
          <label><input type="checkbox" checked={plan.tribeChatDuringDraft} onChange={e => setPlan(p => ({ ...p, tribeChatDuringDraft: e.target.checked }))} /> Tribe chat open during the draft</label>
          <label><input type="checkbox" checked={plan.announceInChat} onChange={e => setPlan(p => ({ ...p, announceInChat: e.target.checked }))} /> Announce tribes in league chat when locked</label>
        </fieldset>
      </div>

      <div className="stp-actions">
        <button type="button" className="stp-btn" disabled={frozen} onClick={() => setPlan(p => ({ ...p, mode: 'random', seed: newSeed() }))} data-testid="stp-randomize">Randomize</button>
        <button type="button" className="stp-btn" disabled={frozen || !hasStrength} onClick={() => setMode('balanced')} data-testid="stp-balance">Balance with AF</button>
        <button type="button" className="stp-btn" disabled={frozen} onClick={() => send('PUT')}>Save plan</button>
        <button type="button" className="stp-btn stp-primary" disabled={frozen || invalid != null} onClick={() => send('POST')} data-testid="stp-lock">
          {locked ? 'Tribes locked' : busy ? 'Locking…' : 'Lock tribes & announce'}
        </button>
      </div>

      <p className="stp-summary" data-state={invalid ? 'warn' : 'ok'} role="status" data-testid="stp-summary">
        {participants.length} managers → {capacities.length} tribes of {sizes.join(' / ')}
        {strengths.spread != null ? ` · AF strength spread ${strengths.spread} points` : ''}
        {strengths.spread != null && strengths.spread > 10 && plan.mode !== 'balanced' ? ' · try Balance with AF' : ''}
        {invalid ? ` · ${invalid}` : ''}
      </p>
      {!hasStrength ? (
        <p className="stp-help">AF strength comes from the ADP of players already on each roster. Before the draft a redraft roster is empty, so Balanced by AF waits; Random and Manual work now. Tribes are equal shares of the cast (at least {TRIBE_MIN_MANAGERS}, at most {TRIBE_MAX_MANAGERS} managers each).</p>
      ) : null}

      <div className="stp-grid">
        {capacities.map((cap, slot) => {
          const identity = SURVIVOR_TRIBE_CATALOG.find(t => t.id === setup.slots[slot]?.catalogId)
          const members = participants.filter(p => mapping[p.userId] === slot)
          const avg = strengths.tribes[slot]?.average ?? null
          return (
            <article key={slot} className="stp-tribe" style={{ ['--tribe' as string]: identity?.primary }} data-testid={`stp-tribe-${slot}`}>
              <header>
                <span className="stp-swatch" aria-hidden />
                <h4>Tribe {identity?.name ?? slot + 1}</h4>
                <span className="stp-count" data-off={members.length !== cap ? 'true' : undefined}>{members.length} / {cap}</span>
              </header>
              <ul>
                {members.map(p => (
                  <li key={p.userId}>
                    <span className="stp-avatar" aria-hidden>{initials(p.displayName)}</span>
                    <span className="stp-name">{p.displayName}</span>
                    <span className="stp-af">AF {p.strength ?? '—'}</span>
                    <label className="stp-move">
                      <span className="sr-only">Move {p.displayName} to</span>
                      <select value={slot} disabled={frozen} onChange={e => move(p.userId, Number(e.target.value))} data-testid={`stp-move-${p.userId}`}>
                        {capacities.map((_, s) => (
                          <option key={s} value={s}>{s === slot ? 'Move ▸' : `Tribe ${SURVIVOR_TRIBE_CATALOG.find(t => t.id === setup.slots[s]?.catalogId)?.name ?? s + 1}`}</option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
                {!members.length ? <li className="stp-empty">No managers yet</li> : null}
              </ul>
              <footer>
                <span className="stp-label">AF tribe strength</span>
                <span className="stp-avg">{avg == null ? '—' : `avg ${avg}`}</span>
                <div className="stp-bar" aria-hidden><span style={{ width: `${avg ?? 0}%` }} /></div>
              </footer>
            </article>
          )
        })}
      </div>
      {note ? <p className="stp-note" role="status">{note}</p> : null}
    </section>
  )
}
