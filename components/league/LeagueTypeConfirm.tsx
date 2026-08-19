'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Ask the commissioner what kind of league this actually is.
 *
 * ⚠ THIS EXISTS BECAUSE SLEEPER CANNOT SAY. It models guillotine and nothing
 * else — no zombie leagues, no tournaments — so commissioners build those by
 * hand and the import sees a plain redraft league. "KBI Smoke Black" is a
 * tournament shell stored as redraft.
 *
 * ⚠ IT SHOWS THE REASONING, NOT JUST A GUESS. A prompt that asserts "this is a
 * tournament" invites a reflexive yes. Showing why — the name matched, a buy-in
 * was in the title — lets someone notice when we are wrong, which on a
 * name-based guess is often.
 *
 * ⚠ COLOURS ARE ARBITRARY HEX, NOT `text-white` / `bg-black` / `text-gray-*`.
 * globals.css rewrites those utilities under `html[data-mode="light"]
 * .mode-readable`, so a component authored with them renders differently, and
 * sometimes unreadably, depending on where it is mounted.
 */

type Suggestion = {
  suggested: string | null
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  detectedBuyIn: number | null
  looksNonCompetitive: boolean
}

type State = {
  leagueId: string
  leagueName: string | null
  storedType: string | null
  suggestion: Suggestion
  confirmation: { type: string; confirmedAt: string; buyIn: number | null } | null
  rankableType: string | null
  canConfirm: boolean
}

const TYPES = [
  { id: 'redraft', label: 'Redraft', hint: 'Fresh draft each year' },
  { id: 'dynasty', label: 'Dynasty', hint: 'Rosters carry over' },
  { id: 'guillotine', label: 'Guillotine', hint: 'Lowest score eliminated weekly' },
  { id: 'zombie', label: 'Zombie', hint: 'Teams beaten by the horde join it' },
  { id: 'tournament', label: 'Tournament', hint: 'Many leagues, one bracket' },
  { id: 'survivor', label: 'Survivor', hint: 'Last manager standing' },
]

export function LeagueTypeConfirm({ leagueId, className }: { leagueId: string; className?: string }) {
  const [state, setState] = useState<State | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [buyIn, setBuyIn] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${leagueId}/league-type`, { cache: 'no-store' })
      if (!res.ok) return
      const data: State = await res.json()
      setState(data)
      /*
       * Prefill from the suggestion so the common case is one click. The buy-in
       * read out of the league name stays editable — a "$20" in a title is a
       * hint, and awarding money credit on a hint is how a rank gets inflated.
       */
      setChoice(data.confirmation?.type ?? data.suggestion.suggested ?? null)
      setBuyIn(
        data.confirmation?.buyIn != null
          ? String(data.confirmation.buyIn)
          : data.suggestion.detectedBuyIn != null
            ? String(data.suggestion.detectedBuyIn)
            : '',
      )
    } catch {
      // A failed load leaves the card hidden rather than showing a broken shell.
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!choice) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/league-type`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: choice, buyIn: buyIn.trim() === '' ? null : Number(buyIn) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Could not save')
        return
      }
      setState(data)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null

  const worthAsking =
    state.suggestion.suggested &&
    state.suggestion.suggested !== 'redraft' &&
    !state.suggestion.looksNonCompetitive
  // An ordinary league nobody needs to label: show nothing at all.
  if (!state.confirmation && !worthAsking) return null

  const confirmed = state.confirmation != null

  return (
    <section
      className={cn(
        'rounded-2xl border border-[#2a3746] bg-[#141c27]/70 p-4 text-[#e6edf3]',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-[0.16em] text-[#9fb4c7]">
          {confirmed ? 'League format' : 'Is this a specialty league?'}
        </h3>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]',
            confirmed
              ? 'border-[#56d98a]/40 text-[#56d98a]'
              : 'border-[#3fd0e8]/40 text-[#3fd0e8]',
          )}
        >
          {confirmed ? 'Confirmed' : 'Counts toward rankings'}
        </span>
      </header>

      {confirmed ? (
        <p className="mt-3 text-sm text-[#a3b2c2]">
          Set to <strong className="text-[#e6edf3]">{state.confirmation?.type}</strong>
          {state.confirmation?.buyIn != null ? ` · $${state.confirmation.buyIn} buy-in` : ''}. Change
          it below if that&rsquo;s wrong.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-[#a3b2c2]">
            {state.leagueName ? `“${state.leagueName}” ` : 'This league '}imported as{' '}
            <strong className="text-[#e6edf3]">{state.storedType ?? 'redraft'}</strong>. Sleeper
            can&rsquo;t describe formats like zombie or tournament leagues, so we&rsquo;re guessing
            from the name — and until someone confirms, it scores as an ordinary league.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[#74869a]">
            {state.suggestion.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </>
      )}

      {state.canConfirm ? (
        <>
          <div
            className="mt-4 grid gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="League format"
          >
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={choice === t.id}
                onClick={() => setChoice(t.id)}
                className={cn(
                  'rounded-xl border p-2 text-left transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3fd0e8]',
                  choice === t.id
                    ? 'border-[#3fd0e8] bg-[#3fd0e8]/10'
                    : 'border-[#2a3746] hover:border-[#3d5064]',
                )}
              >
                <span className="block text-sm font-bold text-[#e6edf3]">{t.label}</span>
                <span className="block text-[11px] text-[#74869a]">{t.hint}</span>
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-[#a3b2c2]">
            <span>Buy-in (optional)</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value)}
              placeholder="0"
              className="w-24 rounded-lg border border-[#2a3746] bg-[#0c121b] px-2 py-1 text-[#e6edf3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3fd0e8]"
            />
          </label>

          {error ? <p className="mt-2 text-xs text-[#f58a85]">{error}</p> : null}

          <button
            type="button"
            onClick={save}
            disabled={saving || !choice}
            className="mt-3 rounded-xl bg-[#3fd0e8] px-4 py-2 text-sm font-black text-[#0c121b] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3fd0e8]"
          >
            {saving ? 'Saving…' : confirmed ? 'Update format' : 'Confirm format'}
          </button>
        </>
      ) : (
        // Showing buttons that will 403 is worse than explaining who can act.
        <p className="mt-3 text-xs text-[#74869a]">Your commissioner can confirm this.</p>
      )}
    </section>
  )
}

export default LeagueTypeConfirm
