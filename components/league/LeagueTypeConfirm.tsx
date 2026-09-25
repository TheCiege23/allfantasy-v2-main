'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LEAGUE_CONCEPT_OPTIONS,
  PIRATE_BASE_FORMAT_OPTIONS,
  isPirateBaseFormat,
  leagueConceptLabel,
  pirateBaseFormatLabel,
  type LeagueConceptType,
  type PirateBaseFormat,
} from '@/lib/league/leagueConceptOptions'
import { cn } from '@/lib/utils'
import {
  LEAGUE_TYPE_DECIDES_GRADES,
  LEAGUE_TYPE_GRADES_EXPLAINER,
  leagueTypeSourceText,
  type LeagueTypeBasis,
} from '@/lib/league/leagueTypeGrading'

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
  confirmation: {
    type: string
    confirmedAt: string
    buyIn: number | null
    baseFormat?: string | null
  } | null
  rankableType: string | null
  /** What trade grades use right now — absent from an older API response. */
  gradedAs?: LeagueTypeBasis
  canConfirm: boolean
}

/*
 * ⚠ THE OPTIONS ARE THE SHARED LIST, NOT A LOCAL SIX. This card used to carry its
 * own hard-coded subset, so a league confirmed as Devy, Keeper or Pirate in the
 * /core header showed here with no option selected — and re-saving a Pirate
 * league from a list with no follow-up would send it without the base the API
 * requires. One list, one follow-up, in both pickers.
 */
const HINTS: Partial<Record<LeagueConceptType, string>> = {
  redraft: 'Fresh draft each year',
  dynasty: 'Rosters carry over',
  keeper: 'Keep a few players each year',
  best_ball: 'Lineups set themselves',
  guillotine: 'Lowest score eliminated weekly',
  survivor: 'Last manager standing',
  survivor_guillotine: 'Tribes, weekly chops, no trades',
  tournament: 'Many leagues, one bracket',
  devy: 'Dynasty with college players',
  c2c: 'College and pro rosters both score',
  efl: 'Priced as a dynasty league',
  zombie: 'Teams beaten by the horde join it',
  pirate: 'Winners steal from losers',
  salary_cap: 'Contracts and a cap',
  big_brother: 'Weekly evictions and votes',
}

export function LeagueTypeConfirm({
  leagueId,
  className,
  alwaysShow,
}: {
  leagueId: string
  className?: string
  /** Skip the "not worth asking" self-hide — for a settings page the commissioner chose to open. */
  alwaysShow?: boolean
}) {
  const [state, setState] = useState<State | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  /** Only meaningful when `choice` is Pirate — the save waits for it. */
  const [pirateBase, setPirateBase] = useState<PirateBaseFormat | null>(null)
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
      setChoice(data.confirmation?.type ?? data.gradedAs?.type ?? data.suggestion.suggested ?? null)
      const base = data.confirmation?.baseFormat
      setPirateBase(isPirateBaseFormat(base) ? base : null)
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

  const needsPirateBase = choice === 'pirate' && pirateBase === null

  const save = async () => {
    if (!choice || needsPirateBase) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/league-type`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: choice,
          buyIn: buyIn.trim() === '' ? null : Number(buyIn),
          ...(choice === 'pirate' ? { baseFormat: pirateBase } : {}),
        }),
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
  // An ordinary league nobody needs to label: show nothing at all — unless the
  // commissioner navigated here deliberately (alwaysShow), which is its own signal.
  if (!state.confirmation && !worthAsking && !alwaysShow) return null

  const confirmed = state.confirmation != null
  const confirmedBaseLabel =
    state.confirmation?.type === 'pirate' ? pirateBaseFormatLabel(state.confirmation?.baseFormat) : null

  return (
    <section
      className={cn(
        'rounded-2xl border border-[#2a3746] bg-[#141c27]/70 p-4 text-[#e6edf3]',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-[0.16em] text-[#9fb4c7]">
          {confirmed ? 'League type' : 'What kind of league is this?'}
        </h3>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]',
            confirmed
              ? 'border-[#56d98a]/40 text-[#56d98a]'
              : 'border-[#3fd0e8]/40 text-[#3fd0e8]',
          )}
        >
          {confirmed ? 'Confirmed' : 'Decides your trade grades'}
        </span>
      </header>

      {confirmed ? (
        <p className="mt-3 text-sm text-[#a3b2c2]">
          Set to{' '}
          <strong className="text-[#e6edf3]">
            {leagueConceptLabel(state.confirmation?.type)}
            {confirmedBaseLabel ? ` · ${confirmedBaseLabel}` : ''}
          </strong>
          {state.confirmation?.buyIn != null ? ` · $${state.confirmation.buyIn} buy-in` : ''}. Every
          trade here is graded as this type. Change it below if that&rsquo;s wrong.
        </p>
      ) : (
        <>
          {/*
            🛑 THE ASK LEADS WITH WHAT IT DECIDES (2026-09-25). This card spoke only of rankings, and
            the league type also chooses the chart every trade in the league is graded on — the
            thing a manager actually sees. Said first, with where today's answer came from.
          */}
          <p className="mt-3 text-sm font-bold text-[#e6edf3]">{LEAGUE_TYPE_DECIDES_GRADES}</p>
          <p className="mt-1 text-sm text-[#a3b2c2]">{LEAGUE_TYPE_GRADES_EXPLAINER}</p>
          <p className="mt-2 text-sm text-[#a3b2c2]">
            {state.leagueName ? `“${state.leagueName}” ` : 'This league '}is graded as{' '}
            <strong className="text-[#e6edf3]">
              {state.gradedAs ? state.gradedAs.label : (state.storedType ?? 'redraft')}
            </strong>
            {state.gradedAs ? ` — ${leagueTypeSourceText(state.gradedAs)}` : ''}. Sleeper can&rsquo;t
            describe formats like zombie or tournament leagues, so confirm it here.
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
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="League format"
          >
            {LEAGUE_CONCEPT_OPTIONS.map((t) => (
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
                {HINTS[t.id] ? (
                  <span className="block text-[11px] text-[#74869a]">{HINTS[t.id]}</span>
                ) : null}
              </button>
            ))}
          </div>

          {choice === 'pirate' ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              role="radiogroup"
              aria-label="Do rosters carry over?"
            >
              <span className="text-xs text-[#a3b2c2]">Rosters carry over?</span>
              {PIRATE_BASE_FORMAT_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={pirateBase === b.id}
                  onClick={() => setPirateBase(b.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-xs font-bold text-[#e6edf3] transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3fd0e8]',
                    pirateBase === b.id
                      ? 'border-[#3fd0e8] bg-[#3fd0e8]/10'
                      : 'border-[#2a3746] hover:border-[#3d5064]',
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          ) : null}

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
            disabled={saving || !choice || needsPirateBase}
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
