'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import type { BuilderChallengeView } from '@/lib/survivor/survivorChallengeBuilder'

/**
 * The Camp card for commissioner challenges: what is open, one answer each (the first stands), your
 * own answer, and the result once settled. Below it, "My rewards" — every Survivor reward you hold —
 * with the choice a reward may wait on ("points on a tribemate", "steal from"), sent to
 * `POST /api/survivor/rewards`. Times show in the reader's own zone.
 */
export const challengeBoardMessages = defineMessages({
  en: {
    heading: 'Island challenges',
    empty: 'No commissioner challenge is open right now.',
    tribe: 'Tribe challenge — the first answer from your tribe counts for everyone.',
    individual: 'Individual challenge — one answer, the first one stands.',
    locks: (when: string): string => `Locks ${when}`,
    prize: 'Prize',
    yourAnswer: 'Your answer',
    tribeAnswer: 'Your tribe’s answer',
    submit: 'Submit — no take backs',
    sending: 'Sending…',
    number: 'Your number',
    stake: (min: number, max: number, cur: string): string => `Your stake (${min}–${max} ${cur})`,
    unique: 'No two entries may give the same answer.',
    sealed: 'Sealed: answers stay hidden until the result.',
    locked: 'Answers are locked. The result comes once it is final.',
    answers: 'Answers',
    won: 'You won',
    lost: 'Not this time',
    void: 'Void — nobody won or lost',
    rewards: 'My rewards',
    noRewards: 'No rewards yet.',
    choose: 'Choose',
    chooseWho: 'Choose who',
    saved: 'Saved.',
    failed: 'That did not go through.',
    points: 'points',
    textAnswer: 'Your answer',
    sweepHint: (n: number): string => `Pick one answer on each of the ${n} props — every one must hit.`,
  },
  es: {
    heading: 'Retos de la isla',
    empty: 'No hay ningún reto del comisionado abierto ahora.',
    tribe: 'Reto por tribu: la primera respuesta de tu tribu cuenta para todos.',
    individual: 'Reto individual: una respuesta, la primera cuenta.',
    locks: (when: string): string => `Se cierra ${when}`,
    prize: 'Premio',
    yourAnswer: 'Tu respuesta',
    tribeAnswer: 'La respuesta de tu tribu',
    submit: 'Enviar — sin vuelta atrás',
    sending: 'Enviando…',
    number: 'Tu número',
    stake: (min: number, max: number, cur: string): string => `Tu apuesta (${min}–${max} ${cur})`,
    unique: 'Dos entradas no pueden dar la misma respuesta.',
    sealed: 'Sellado: las respuestas se ocultan hasta el resultado.',
    locked: 'Las respuestas están cerradas. El resultado llega cuando sea definitivo.',
    answers: 'Respuestas',
    won: 'Ganaste',
    lost: 'Esta vez no',
    void: 'Anulado: nadie gana ni pierde',
    rewards: 'Mis recompensas',
    noRewards: 'Aún no tienes recompensas.',
    choose: 'Elegir',
    chooseWho: 'Elige a quién',
    saved: 'Guardado.',
    failed: 'No se pudo completar.',
    points: 'puntos',
    textAnswer: 'Tu respuesta',
    sweepHint: (n: number): string => `Elige una respuesta en cada una de las ${n} apuestas: hay que acertarlas todas.`,
  },
})

type Reward = { rewardId: string; status: string; text: string; holder: boolean; targets?: { rosterId: string; name: string }[] }

export function formatLocalTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(getAppIntlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

function answerLabel(c: BuilderChallengeView, answer: unknown): string {
  const a = answer as { optionId?: string; value?: number; text?: string; picks?: Record<string, string> } | null
  if (!a) return '—'
  if (typeof a.value === 'number') return String(a.value)
  if (typeof a.text === 'string') return a.text
  if (a.picks) return (c.props ?? []).map((p) => p.options.find((o) => o.id === a.picks![p.id])?.label ?? '—').join(' · ')
  return c.options.find((o) => o.id === a.optionId)?.label ?? String(a.optionId ?? '—')
}

function ChallengeItem({ c, leagueId, onDone }: { c: BuilderChallengeView; leagueId: string; onDone: () => void }) {
  const m = useMessages(challengeBoardMessages)
  const [optionId, setOptionId] = useState('')
  const [value, setValue] = useState('')
  const [stake, setStake] = useState(c.wager ? String(c.wager.min) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const canAnswer = c.status === 'open' && !c.mine
  const props = c.props ?? []
  const ready = c.inputKind === 'number' || c.inputKind === 'text' ? value.trim() !== ''
    : c.inputKind === 'sweep' ? props.length > 0 && props.every((p) => picks[p.id])
      : Boolean(optionId)
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const answer: Record<string, unknown> = c.inputKind === 'number' ? { value: Number(value) }
        : c.inputKind === 'text' ? { text: value }
          : c.inputKind === 'sweep' ? { picks }
            : { optionId }
      if (c.wager) answer.wager = Number(stake)
      const res = await fetch('/api/survivor/challenge-board', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leagueId, challengeId: c.id, answer }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setError(typeof j.error === 'string' ? j.error : m.failed)
      else onDone()
    } catch {
      setError(m.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-3" data-testid={`challenge-${c.id}`}>
      <p className="text-[15px] font-bold text-white">{c.title}</p>
      <p className="mt-1 text-[13px] text-white/75 whitespace-pre-line">{c.question}</p>
      <p className="mt-1 text-[11px] text-white/50">{c.scope === 'tribe' ? m.tribe : m.individual}{c.status === 'open' ? ` · ${m.locks(formatLocalTime(c.locksAt))}` : ''}</p>
      <p className="mt-1 text-[12px] text-amber-200/90">{m.prize}: {c.prizeText}</p>
      {c.uniqueAnswers ? <p className="mt-1 text-[11px] text-white/45">{m.unique}</p> : null}
      {c.sealed ? <p className="mt-1 text-[11px] text-white/45">{m.sealed}</p> : null}
      {c.mine ? (
        <p className="mt-2 text-[13px] text-emerald-200" data-testid="challenge-mine">
          {c.scope === 'tribe' ? m.tribeAnswer : m.yourAnswer}: <b>{answerLabel(c, c.mine.answer)}</b>{c.mine.wager != null ? ` · ${c.mine.wager}` : ''}
        </p>
      ) : null}
      {canAnswer ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {c.inputKind === 'number' ? (
            <input aria-label={m.number} type="number" min={0} step="0.5" value={value} onChange={(e) => setValue(e.target.value)} className="w-28 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" />
          ) : c.inputKind === 'text' ? (
            <input aria-label={m.textAnswer} maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} className="w-56 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" />
          ) : c.inputKind === 'sweep' ? (
            <div className="w-full space-y-2" data-testid="challenge-sweep">
              <p className="text-[11px] text-white/50">{m.sweepHint(props.length)}</p>
              {props.map((p) => (
                <div key={p.id} role="radiogroup" aria-label={p.question} className="space-y-1">
                  <p className="text-[13px] text-white/80">{p.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {p.options.map((o) => (
                      <button key={o.id} type="button" role="radio" aria-checked={picks[p.id] === o.id} onClick={() => setPicks((cur) => ({ ...cur, [p.id]: o.id }))} className={`rounded-lg border px-3 py-1 text-sm ${picks[p.id] === o.id ? 'border-emerald-400 bg-emerald-500/20 text-white' : 'border-white/15 text-white/80'}`}>{o.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div role="radiogroup" aria-label={c.title} className="flex flex-wrap gap-2">
              {c.options.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={optionId === o.id} onClick={() => setOptionId(o.id)} className={`rounded-lg border px-3 py-1 text-sm ${optionId === o.id ? 'border-emerald-400 bg-emerald-500/20 text-white' : 'border-white/15 text-white/80'}`}>{o.label}</button>
              ))}
            </div>
          )}
          {c.wager ? (
            <input aria-label={m.stake(c.wager.min, c.wager.max, c.wager.currency === 'faab' ? 'FAAB' : m.points)} type="number" min={c.wager.min} max={c.wager.max} value={stake} onChange={(e) => setStake(e.target.value)} className="w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white" />
          ) : null}
          <button type="button" disabled={busy || !ready} onClick={() => void submit()} className="rounded-lg bg-emerald-500 px-3 py-1 text-sm font-semibold text-black disabled:opacity-40">{busy ? m.sending : m.submit}</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-[12px] text-red-300">{error}</p> : null}
      {c.status === 'locked' || c.status === 'settling' ? <p className="mt-2 text-[12px] text-white/55">{m.locked}</p> : null}
      {c.answers ? (
        <details className="mt-2 text-[12px] text-white/65">
          <summary>{m.answers} ({c.answers.length})</summary>
          <ul className="mt-1 space-y-0.5">{c.answers.map((a, i) => <li key={i}>{a.name}: {a.answer}</li>)}</ul>
        </details>
      ) : null}
      {c.status === 'complete' ? (
        <div className="mt-2 text-[13px]">
          {c.resultSummary ? <p className="text-white/80">{c.resultSummary}</p> : null}
          {c.myResult ? <p className={c.myResult === 'won' ? 'font-semibold text-emerald-300' : 'text-white/55'} data-testid="challenge-my-result">{c.myResult === 'won' ? m.won : c.myResult === 'void' ? m.void : m.lost}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

function RewardChoice({ r, leagueId, onDone }: { r: Reward; leagueId: string; onDone: () => void }) {
  const m = useMessages(challengeBoardMessages)
  const [target, setTarget] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  async function choose() {
    setState('busy')
    const res = await fetch('/api/survivor/rewards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ leagueId, rewardId: r.rewardId, targetRosterId: target }) }).catch(() => null)
    if (res?.ok) { setState('idle'); onDone() } else setState('error')
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <select aria-label={m.chooseWho} value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-sm text-white">
        <option value="">{m.chooseWho}</option>
        {(r.targets ?? []).map((t) => <option key={t.rosterId} value={t.rosterId}>{t.name}</option>)}
      </select>
      <button type="button" disabled={!target || state === 'busy'} onClick={() => void choose()} className="rounded-lg bg-amber-400 px-3 py-1 text-sm font-semibold text-black disabled:opacity-40">{m.choose}</button>
      {state === 'error' ? <span role="alert" className="text-[12px] text-red-300">{m.failed}</span> : null}
    </div>
  )
}

export function SurvivorChallengeBoardCard({ leagueId }: { leagueId: string }) {
  const m = useMessages(challengeBoardMessages)
  const [challenges, setChallenges] = useState<BuilderChallengeView[] | null>(null)
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const load = useCallback(async () => {
    const [board, mine] = await Promise.all([
      fetch(`/api/survivor/challenge-board?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/survivor/rewards?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setChallenges(Array.isArray(board?.challenges) ? board.challenges : [])
    setRewards(Array.isArray(mine?.rewards) ? mine.rewards : [])
  }, [leagueId])
  useEffect(() => { void load() }, [load])
  const live = (challenges ?? []).filter((c) => c.status !== 'complete')
  const recent = (challenges ?? []).filter((c) => c.status === 'complete').slice(0, 5)
  return (
    <section className="mt-6 survivor-panel p-4" data-testid="survivor-challenge-board">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--survivor-torch)]">{m.heading}</h2>
      {challenges && !live.length && !recent.length ? <p className="mt-2 text-[13px] text-white/50">{m.empty}</p> : null}
      <ul className="mt-3 space-y-3">
        {[...live, ...recent].map((c) => <ChallengeItem key={c.id} c={c} leagueId={leagueId} onDone={() => void load()} />)}
      </ul>
      <h3 className="mt-5 text-[11px] font-bold uppercase tracking-wider text-white/60">{m.rewards}</h3>
      {rewards && !rewards.length ? <p className="mt-1 text-[13px] text-white/50">{m.noRewards}</p> : null}
      <ul className="mt-2 space-y-2" data-testid="survivor-my-rewards">
        {(rewards ?? []).slice(0, 12).map((r) => (
          <li key={r.rewardId} className="text-[13px] text-white/80">
            {r.text}
            {r.status === 'awaiting_choice' && r.holder && r.targets?.length ? <RewardChoice r={r} leagueId={leagueId} onDone={() => void load()} /> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
