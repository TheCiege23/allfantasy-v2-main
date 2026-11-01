'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import {
  describeSurvivorReward,
  SURVIVOR_REWARD_ADVANTAGE_POWERS,
  SURVIVOR_REWARD_TYPES,
  type SurvivorRewardRecord,
  type SurvivorRewardSpec,
  type SurvivorRewardType,
} from '@/lib/survivor/survivorRewardModel'

/**
 * Commissioner Hub → Rewards: every Survivor reward in the league (GET `type=rewards`), a form to
 * grant one by hand (`grant_reward`), a confirm step before reversing one (`reverse_reward`), and
 * the target pick for a reward waiting on a choice (`choose_reward_target`). The server validates
 * everything again (the reward API and the league's per-phase prize rules).
 */
export const rewardsHubMessages = defineMessages({
  en: {
    lang: 'en',
    heading: 'Rewards',
    sub: 'Every reward in the league: challenge prizes, weekly tribe prizes, side games and your own grants. Grant one by hand, settle a pending choice, or reverse one.',
    grant: 'Grant a reward', grantHint: 'Paid at once (or in a later week if you defer it). Each grant is paid once, even if you click twice.',
    type: 'Reward', recipient: 'Manager', fromTribe: 'From tribe', toTribe: 'To tribe', amount: 'Amount', points: 'Points',
    basis: 'Split', perMember: 'Per member', total: 'Total', what: 'Steal what', faab: 'FAAB',
    target: 'Target (optional — leave empty to let the winner choose)', samePos: 'Same position only', power: 'Advantage',
    week: 'Week won', defer: 'Pay in week (optional)', notes: 'Note (shown on the record)',
    submit: 'Grant reward', granting: 'Granting…', granted: 'Reward granted.',
    types: (t: string): string => ({
      score_bonus: 'Points added', score_penalty: 'Points taken', faab_grant: 'FAAB given', faab_penalty: 'FAAB taken',
      faab_transfer: 'FAAB from one tribe to another', tribemate_points: 'Points on a tribemate', free_trade_token: 'Free trade',
      steal_blocker: 'Steal blocker', steal: 'Steal', advantage: 'Advantage',
    } as Record<string, string>)[t] ?? t,
    status: (s: string): string => ({ applied: 'Paid', awaiting_choice: 'Waiting for a choice', deferred: 'Deferred', available: 'Held', consumed: 'Used', blocked: 'Blocked', reversed: 'Reversed', expired: 'Lapsed' } as Record<string, string>)[s] ?? s,
    source: (k: string): string => ({ challenge: 'Challenge', weekly_prize: 'Weekly prize', auction: 'Auction', pool: 'Survivor Pool', exile: 'Exile', commissioner: 'Commissioner', other: 'Other' } as Record<string, string>)[k] ?? k,
    weekN: (n: number): string => `Week ${n}`,
    holder: 'Holder', none: 'No rewards yet.', loading: 'Loading rewards…',
    reverse: 'Reverse', reverseConfirm: 'Reverse this reward? Points and FAAB it moved are taken back (FAAB never below $0).',
    reason: 'Reason (optional)', confirmReverse: 'Yes, reverse it', cancel: 'Keep it', reversed: 'Reward reversed.',
    choose: 'Choose target', chooseWho: 'Choose who', chosen: 'Target chosen.',
    failed: 'That did not go through.',
    phaseNote: (types: string): string => `Allowed as prizes this phase: ${types}. Penalties are always allowed.`,
  },
  es: {
    lang: 'es',
    heading: 'Recompensas',
    sub: 'Todas las recompensas de la liga: premios de retos, premios semanales de tribu, juegos paralelos y las tuyas. Concede una a mano, resuelve una elección pendiente o anula una.',
    grant: 'Conceder una recompensa', grantHint: 'Se paga al momento (o en una semana posterior si la aplazas). Cada concesión se paga una sola vez, aunque hagas doble clic.',
    type: 'Recompensa', recipient: 'Mánager', fromTribe: 'De la tribu', toTribe: 'A la tribu', amount: 'Cantidad', points: 'Puntos',
    basis: 'Reparto', perMember: 'Por miembro', total: 'Total', what: 'Qué robar', faab: 'FAAB',
    target: 'Objetivo (opcional: déjalo vacío para que elija el ganador)', samePos: 'Solo misma posición', power: 'Ventaja',
    week: 'Semana ganada', defer: 'Pagar en la semana (opcional)', notes: 'Nota (aparece en el registro)',
    submit: 'Conceder recompensa', granting: 'Concediendo…', granted: 'Recompensa concedida.',
    types: (t: string): string => ({
      score_bonus: 'Puntos sumados', score_penalty: 'Puntos restados', faab_grant: 'FAAB entregado', faab_penalty: 'FAAB retirado',
      faab_transfer: 'FAAB de una tribu a otra', tribemate_points: 'Puntos para un compañero', free_trade_token: 'Intercambio libre',
      steal_blocker: 'Bloqueador de robos', steal: 'Robo', advantage: 'Ventaja',
    } as Record<string, string>)[t] ?? t,
    status: (s: string): string => ({ applied: 'Pagada', awaiting_choice: 'Esperando una elección', deferred: 'Aplazada', available: 'En poder', consumed: 'Usada', blocked: 'Bloqueada', reversed: 'Anulada', expired: 'Vencida' } as Record<string, string>)[s] ?? s,
    source: (k: string): string => ({ challenge: 'Reto', weekly_prize: 'Premio semanal', auction: 'Subasta', pool: 'Pozo Survivor', exile: 'Exilio', commissioner: 'Comisionado', other: 'Otro' } as Record<string, string>)[k] ?? k,
    weekN: (n: number): string => `Semana ${n}`,
    holder: 'Titular', none: 'Aún no hay recompensas.', loading: 'Cargando recompensas…',
    reverse: 'Anular', reverseConfirm: '¿Anular esta recompensa? Se devuelven los puntos y el FAAB que movió (el FAAB nunca baja de $0).',
    reason: 'Motivo (opcional)', confirmReverse: 'Sí, anularla', cancel: 'Mantenerla', reversed: 'Recompensa anulada.',
    choose: 'Elegir objetivo', chooseWho: 'Elige a quién', chosen: 'Objetivo elegido.',
    failed: 'No se pudo completar.',
    phaseNote: (types: string): string => `Permitidos como premio en esta fase: ${types}. Las penalizaciones siempre se permiten.`,
  },
})

type Castaway = { rosterId: string; name: string; tribeId: string | null; state: string }
type Tribe = { id: string; name: string }
type CastInfo = { cast: Castaway[]; tribes: Tribe[]; currentWeek: number; phase: string; allowedPrizeTypes: string[] }

type GrantDraft = {
  type: SurvivorRewardType
  rosterId: string
  fromTribeId: string
  toTribeId: string
  amount: string
  basis: 'per_member' | 'total'
  what: 'faab' | 'points'
  targetRosterId: string
  samePositionOnly: boolean
  powerType: (typeof SURVIVOR_REWARD_ADVANTAGE_POWERS)[number]
  week: string
  deferToWeek: string
  notes: string
}

const inputCls = 'w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white'
const POINT_TYPES = new Set(['score_bonus', 'score_penalty', 'tribemate_points'])
const AMOUNT_TYPES = new Set(['score_bonus', 'score_penalty', 'faab_grant', 'faab_penalty', 'faab_transfer', 'tribemate_points', 'steal'])

/** The reward spec the server's reward API takes, from the form. Pure; exported for tests. */
export function grantDraftToSpec(d: GrantDraft): SurvivorRewardSpec {
  const n = Number(d.amount)
  const target = d.targetRosterId || null
  switch (d.type) {
    case 'score_bonus': return { type: 'score_bonus', rosterId: d.rosterId, points: n }
    case 'score_penalty': return { type: 'score_penalty', rosterId: d.rosterId, points: n }
    case 'faab_grant': return { type: 'faab_grant', rosterId: d.rosterId, amount: n }
    case 'faab_penalty': return { type: 'faab_penalty', rosterId: d.rosterId, amount: n }
    case 'faab_transfer': return { type: 'faab_transfer', fromTribeId: d.fromTribeId, toTribeId: d.toTribeId, amount: n, basis: d.basis }
    case 'tribemate_points': return { type: 'tribemate_points', chooserRosterId: d.rosterId, points: n, targetRosterId: target }
    case 'free_trade_token': return { type: 'free_trade_token', rosterId: d.rosterId, samePositionOnly: d.samePositionOnly }
    case 'steal_blocker': return { type: 'steal_blocker', rosterId: d.rosterId }
    case 'steal': return { type: 'steal', thiefRosterId: d.rosterId, what: d.what, amount: n, targetRosterId: target }
    case 'advantage': return { type: 'advantage', rosterId: d.rosterId, powerType: d.powerType }
  }
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function blankGrant(week: number): GrantDraft {
  return { type: 'score_bonus', rosterId: '', fromTribeId: '', toTribeId: '', amount: '10', basis: 'per_member', what: 'faab', targetRosterId: '', samePositionOnly: true, powerType: 'extra_vote', week: String(week), deferToWeek: '', notes: '' }
}

async function postAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/survivor/commissioner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const j = res ? await res.json().catch(() => ({})) : {}
  return res?.ok ? { ok: true } : { ok: false, error: typeof j.error === 'string' ? j.error : undefined }
}

function GrantForm({ leagueId, info, onDone }: { leagueId: string; info: CastInfo; onDone: (msg: string) => void }) {
  const m = useMessages(rewardsHubMessages)
  const [d, setD] = useState<GrantDraft>(() => blankGrant(info.currentWeek))
  const [requestId, setRequestId] = useState(newRequestId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof GrantDraft>(k: K, v: GrantDraft[K]) => { setError(null); setD((cur) => ({ ...cur, [k]: v })) }
  const active = info.cast.filter((c) => c.state === 'active')
  const isTransfer = d.type === 'faab_transfer'
  const needsTarget = d.type === 'steal' || d.type === 'tribemate_points'
  const ready = isTransfer ? Boolean(d.fromTribeId && d.toTribeId && d.fromTribeId !== d.toTribeId) : Boolean(d.rosterId)
  async function submit() {
    setBusy(true)
    const result = await postAction({
      leagueId, action: 'grant_reward', requestId, week: Number(d.week), reward: grantDraftToSpec(d),
      deferToWeek: d.deferToWeek.trim() ? Number(d.deferToWeek) : null, notes: d.notes.trim() || undefined,
    })
    setBusy(false)
    if (!result.ok) { setError(result.error ?? m.failed); return }
    setD(blankGrant(info.currentWeek))
    setRequestId(newRequestId())
    onDone(m.granted)
  }
  return (
    <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-black/20 p-3" data-testid="rewards-grant-form">
      <p className="text-sm font-semibold text-white">{m.grant}</p>
      <p className="text-xs text-white/55">{m.grantHint}</p>
      <p className="text-[11px] text-white/45" data-testid="rewards-phase-note">{m.phaseNote(info.allowedPrizeTypes.map((t) => m.types(t)).join(', '))}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-white/70">{m.type}
          <select className={inputCls} value={d.type} onChange={(e) => set('type', e.target.value as SurvivorRewardType)} data-testid="rewards-grant-type">
            {SURVIVOR_REWARD_TYPES.map((t) => <option key={t} value={t}>{m.types(t)}</option>)}
          </select>
        </label>
        {isTransfer ? (
          <>
            <label className="block text-xs text-white/70">{m.fromTribe}
              <select className={inputCls} value={d.fromTribeId} onChange={(e) => set('fromTribeId', e.target.value)}><option value="">—</option>{info.tribes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="block text-xs text-white/70">{m.toTribe}
              <select className={inputCls} value={d.toTribeId} onChange={(e) => set('toTribeId', e.target.value)}><option value="">—</option>{info.tribes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
          </>
        ) : (
          <label className="block text-xs text-white/70">{m.recipient}
            <select className={inputCls} value={d.rosterId} onChange={(e) => set('rosterId', e.target.value)} data-testid="rewards-grant-recipient">
              <option value="">—</option>
              {active.map((c) => <option key={c.rosterId} value={c.rosterId}>{c.name}</option>)}
            </select>
          </label>
        )}
        {AMOUNT_TYPES.has(d.type) ? (
          <label className="block text-xs text-white/70">{POINT_TYPES.has(d.type) || (d.type === 'steal' && d.what === 'points') ? m.points : m.amount}
            <input className={inputCls} type="number" min={0} step={POINT_TYPES.has(d.type) ? 0.5 : 1} value={d.amount} onChange={(e) => set('amount', e.target.value)} data-testid="rewards-grant-amount" />
          </label>
        ) : null}
        {isTransfer ? <label className="block text-xs text-white/70">{m.basis}<select className={inputCls} value={d.basis} onChange={(e) => set('basis', e.target.value as GrantDraft['basis'])}><option value="per_member">{m.perMember}</option><option value="total">{m.total}</option></select></label> : null}
        {d.type === 'steal' ? <label className="block text-xs text-white/70">{m.what}<select className={inputCls} value={d.what} onChange={(e) => set('what', e.target.value as GrantDraft['what'])}><option value="faab">{m.faab}</option><option value="points">{m.points}</option></select></label> : null}
        {needsTarget ? (
          <label className="block text-xs text-white/70">{m.target}
            <select className={inputCls} value={d.targetRosterId} onChange={(e) => set('targetRosterId', e.target.value)}>
              <option value="">—</option>
              {active.filter((c) => c.rosterId !== d.rosterId).map((c) => <option key={c.rosterId} value={c.rosterId}>{c.name}</option>)}
            </select>
          </label>
        ) : null}
        {d.type === 'advantage' ? <label className="block text-xs text-white/70">{m.power}<select className={inputCls} value={d.powerType} onChange={(e) => set('powerType', e.target.value as GrantDraft['powerType'])}>{SURVIVOR_REWARD_ADVANTAGE_POWERS.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}</select></label> : null}
        {d.type === 'free_trade_token' ? <label className="text-xs text-white/70"><input type="checkbox" checked={d.samePositionOnly} onChange={(e) => set('samePositionOnly', e.target.checked)} /> {m.samePos}</label> : null}
        <label className="block text-xs text-white/70">{m.week}<input className={inputCls} type="number" min={0} value={d.week} onChange={(e) => set('week', e.target.value)} /></label>
        <label className="block text-xs text-white/70">{m.defer}<input className={inputCls} type="number" min={0} value={d.deferToWeek} onChange={(e) => set('deferToWeek', e.target.value)} /></label>
      </div>
      <label className="block text-xs text-white/70">{m.notes}<input className={inputCls} maxLength={120} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      {error ? <p role="alert" className="text-xs text-red-300" data-testid="rewards-grant-error">{error}</p> : null}
      <button type="button" disabled={!ready || busy} onClick={() => void submit()} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-40" data-testid="rewards-grant-submit">{busy ? m.granting : m.submit}</button>
    </div>
  )
}

function RewardRow({ r, leagueId, names, info, onDone }: { r: SurvivorRewardRecord; leagueId: string; names: Map<string, string>; info: CastInfo; onDone: (msg: string) => void }) {
  const m = useMessages(rewardsHubMessages)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const holder = r.holderRosterIds.map((id) => names.get(id) ?? id).join(', ')
  const choices = useMemo(() => {
    const holderId = r.holderRosterIds[0]
    const holderTribe = info.cast.find((c) => c.rosterId === holderId)?.tribeId ?? null
    return info.cast.filter((c) => c.state === 'active' && c.rosterId !== holderId && (r.spec.type !== 'tribemate_points' || !holderTribe || c.tribeId === holderTribe))
  }, [r, info.cast])
  async function reverse() {
    const result = await postAction({ leagueId, action: 'reverse_reward', rewardId: r.rewardId, notes: reason.trim() || undefined })
    if (!result.ok) { setError(result.error ?? m.failed); return }
    setConfirming(false)
    onDone(m.reversed)
  }
  async function choose() {
    const result = await postAction({ leagueId, action: 'choose_reward_target', rewardId: r.rewardId, targetRosterId: target })
    if (!result.ok) { setError(result.error ?? m.failed); return }
    onDone(m.chosen)
  }
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid={`reward-row-${r.rewardId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white">{describeSurvivorReward(r, m.lang)}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{m.status(r.status)}</span>
      </div>
      <p className="mt-1 text-[11px] text-white/50">{m.source(r.source.kind)}{r.source.label ? ` · ${r.source.label}` : ''} · {m.weekN(r.week)}{holder ? ` · ${m.holder}: ${holder}` : ''}</p>
      {r.status === 'awaiting_choice' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select aria-label={m.chooseWho} value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" data-testid={`reward-choose-${r.rewardId}`}>
            <option value="">{m.chooseWho}</option>
            {choices.map((c) => <option key={c.rosterId} value={c.rosterId}>{c.name}</option>)}
          </select>
          <button type="button" disabled={!target} onClick={() => void choose()} className="rounded-lg bg-amber-400 px-3 py-1 text-sm font-semibold text-black disabled:opacity-40">{m.choose}</button>
        </div>
      ) : null}
      {r.status !== 'reversed' ? (
        confirming ? (
          <div className="mt-2 space-y-2 rounded-lg border border-red-300/30 p-2" data-testid={`reward-reverse-confirm-${r.rewardId}`}>
            <p className="text-xs text-red-100">{m.reverseConfirm}</p>
            <input aria-label={m.reason} className={inputCls} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={m.reason} />
            <div className="flex gap-2">
              <button type="button" onClick={() => void reverse()} className="rounded-lg bg-red-400 px-3 py-1 text-sm font-semibold text-black">{m.confirmReverse}</button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-white/15 px-3 py-1 text-sm text-white/80">{m.cancel}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="mt-2 rounded border border-red-300/40 px-2 py-1 text-xs text-red-200" data-testid={`reward-reverse-${r.rewardId}`}>{m.reverse}</button>
        )
      ) : null}
      {error ? <p role="alert" className="mt-1 text-xs text-red-300">{error}</p> : null}
    </li>
  )
}

export function SurvivorRewardsHubPanel({ leagueId }: { leagueId: string }) {
  const m = useMessages(rewardsHubMessages)
  const [rewards, setRewards] = useState<SurvivorRewardRecord[] | null>(null)
  const [info, setInfo] = useState<CastInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const load = useCallback(async () => {
    const q = `/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}`
    const [list, cast] = await Promise.all([
      fetch(`${q}&type=rewards`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${q}&type=reward_cast`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setRewards(Array.isArray(list?.rewards) ? list.rewards : [])
    setInfo(cast && Array.isArray(cast.cast) ? cast : { cast: [], tribes: [], currentWeek: 1, phase: 'pre_merge', allowedPrizeTypes: [] })
  }, [leagueId])
  useEffect(() => { void load() }, [load])
  const names = useMemo(() => new Map((info?.cast ?? []).map((c) => [c.rosterId, c.name])), [info])
  const done = (msg: string) => { setNotice(msg); void load() }
  return (
    <div className="space-y-3" data-testid="survivor-rewards-hub">
      <div>
        <h3 className="text-sm font-semibold text-white">{m.heading}</h3>
        <p className="text-xs text-white/55">{m.sub}</p>
      </div>
      {notice ? <p role="status" className="text-xs text-emerald-200">{notice}</p> : null}
      {info ? <GrantForm leagueId={leagueId} info={info} onDone={done} /> : null}
      {rewards === null ? <p className="text-xs text-white/50">{m.loading}</p> : null}
      {rewards && !rewards.length ? <p className="text-xs text-white/50">{m.none}</p> : null}
      <ul className="space-y-2" data-testid="survivor-rewards-list">
        {info ? (rewards ?? []).map((r) => <RewardRow key={r.rewardId} r={r} leagueId={leagueId} names={names} info={info} onDone={done} />) : null}
      </ul>
    </div>
  )
}
