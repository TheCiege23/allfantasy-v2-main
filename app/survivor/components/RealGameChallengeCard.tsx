'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RealGameBoard, RealGameChallengeView } from '@/lib/survivor/survivorRealGameChallenges'

type Lang = RealGameBoard['lang']

const TEXT = {
  en: {
    kicker: 'Real-game challenge',
    locks: 'Locks at kickoff',
    change: 'You can change your pick until then.',
    picked: 'Your pick is in.',
    none: 'No pick yet.',
    hidden: 'Everyone’s picks show at kickoff.',
    locked: 'Picks are locked. It settles from the final score.',
    pick: (n: number) => `${n} pick${n === 1 ? '' : 's'}`,
    yours: ' · your pick',
    past: 'Past real-game challenges',
    called: ' · you called it',
    missed: ' · you missed',
    voided: 'void',
    tie: 'tie',
    paid: (names: string[]) => `Winners: ${names.join(', ')}`,
    nobody: 'No prize paid.',
    empty: 'The next real-game challenge opens when the next week starts.',
    failed: 'Your pick was not saved.',
  },
  es: {
    kicker: 'Reto de partido real',
    locks: 'Se cierra al inicio',
    change: 'Puedes cambiar tu elección hasta entonces.',
    picked: 'Tu elección está registrada.',
    none: 'Aún no has elegido.',
    hidden: 'Las elecciones de todos se muestran al inicio del partido.',
    locked: 'Las elecciones están cerradas. Se resuelve con el marcador final.',
    pick: (n: number) => `${n} ${n === 1 ? 'elección' : 'elecciones'}`,
    yours: ' · tu elección',
    past: 'Retos de partidos reales anteriores',
    called: ' · acertaste',
    missed: ' · fallaste',
    voided: 'anulado',
    tie: 'empate',
    paid: (names: string[]) => `Ganadores: ${names.join(', ')}`,
    nobody: 'Sin premio.',
    empty: 'El próximo reto de partido real se abre cuando empiece la próxima semana.',
    failed: 'Tu elección no se guardó.',
  },
} as const

function lockLabel(iso: string | null, lang: Lang): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang === 'es' ? 'es' : undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function Picks({ item, lang }: { item: RealGameChallengeView; lang: Lang }) {
  const t = TEXT[lang]
  const total = item.options.reduce((sum, option) => sum + (option.picks ?? 0), 0)
  return (
    <ul className="mt-3 space-y-2">
      {item.options.map(option => {
        const share = total ? Math.round(((option.picks ?? 0) / total) * 100) : 0
        const isAnswer = item.answer?.id === option.id
        return (
          <li key={option.id} className={`rounded-lg border px-3 py-2 text-[13px] ${isAnswer ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-black/20'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-white">{option.label}{isAnswer ? ' ✓' : ''}{item.myPick === option.id ? t.yours : ''}</span>
              <span className="font-mono text-white/60">{t.pick(option.picks ?? 0)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className={`h-1.5 rounded-full ${isAnswer ? 'bg-emerald-400' : 'bg-amber-400/70'}`} style={{ width: `${share}%` }} /></div>
          </li>
        )
      })}
    </ul>
  )
}

/** Pick the winner of a featured real game before kickoff; the stored final settles it. */
export function RealGameChallengeCard({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<RealGameBoard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/real-game-challenge?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      if (res.ok) setBoard((await res.json()) as RealGameBoard)
    } catch { /* the card stays empty; the page still works */ }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  const lang: Lang = board?.lang === 'es' ? 'es' : 'en'
  const t = TEXT[lang]
  const pick = async (challengeId: string, optionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/survivor/real-game-challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, challengeId, optionId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : t.failed)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.failed)
    } finally { setBusy(false) }
  }

  // Nothing to show until the system has opened at least one challenge for this league.
  if (!board || (!board.current.length && !board.past.length)) return null
  return (
    <section className="survivor-panel mt-6 rounded-2xl p-4 md:p-5" data-testid="real-game-challenge-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">{t.kicker}</p>
      {board.current.length ? board.current.map(item => (
        <div key={item.id} className="mt-3 first:mt-1">
          <h2 className="text-lg font-bold text-white">{item.title}</h2>
          <p className="mt-1 text-[13px] text-white/60">{item.description}</p>
          {item.status === 'open' ? (
            <>
              <p className="mt-2 text-[12px] text-white/50">{t.locks} ({lockLabel(item.locksAt, lang)}). {t.change}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.options.map(option => (
                  <button key={option.id} type="button" disabled={busy} onClick={() => void pick(item.id, option.id)} aria-pressed={item.myPick === option.id}
                    className={`min-h-[44px] rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-40 ${item.myPick === option.id ? 'border-amber-300 bg-amber-400 text-black' : 'border-white/20 text-white'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-white/50">{item.myPick ? t.picked : t.none} {t.hidden}</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[12px] text-white/50">{t.locked}</p>
              <Picks item={item} lang={lang} />
            </>
          )}
        </div>
      )) : <p className="mt-1 text-[13px] text-white/60">{t.empty}</p>}
      {error ? <p role="alert" className="mt-2 text-[12px] text-red-200">{error}</p> : null}

      {board.past.length ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">{t.past}</h3>
          {board.past.slice(0, 8).map(past => (
            <details key={past.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-white/85">
                {past.title} · {past.outcome === 'void' ? t.voided : past.outcome === 'tie' ? t.tie : past.answer?.label ?? ''}
                {past.outcome === 'win' && past.myPick ? (past.myPick === past.answer?.id ? t.called : t.missed) : ''}
              </summary>
              <Picks item={past} lang={lang} />
              {past.resultSummary ? <p className="mt-2 text-[12px] text-white/70">{past.resultSummary}</p> : null}
              <p className="mt-1 text-[12px] text-white/60">{past.winners.length ? t.paid(past.winners) : t.nobody}</p>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  )
}
