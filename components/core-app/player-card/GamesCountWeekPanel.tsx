'use client'

import { useCallback, useEffect, useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLocale } from '@/lib/core-app/messages/coreLocale'
import type { GamesCountState } from '@/lib/redraft/gamesCountService'

/**
 * "Which games count" on the player card (lib/redraft/gamesCount.ts): the player's games this week, which
 * of them count, and — for the manager who starts him — a way to pick games (best-N) or lock one in
 * (lock-in).
 *
 * ⚠ IT RENDERS NOTHING UNLESS THE SERVER SAYS THERE IS SOMETHING TO SHOW. The route answers 409 for a
 * league that counts every game, and 403/404 for a viewer who does not roster him, so the card looks
 * exactly as before everywhere the setting is off. It lives here, on the card every matchup and roster
 * row opens, rather than in the lineup screen.
 */

type ApiState = GamesCountState

function dayLabel(day: string, language: string): string {
  const d = new Date(`${day}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(coreLocale(language).intlLocale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function GamesCountWeekPanel({ leagueId, playerIds }: { leagueId: string; playerIds: Array<string | null | undefined> }) {
  const { t, tInterpolate, language } = useOptionalLanguage()
  const ids = [...new Set(playerIds.map((x) => String(x ?? '').trim()).filter(Boolean))]
  const idsKey = ids.join('|')
  const [state, setState] = useState<ApiState | null>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState(null)
    setDraft(null)
    setError(null)
    if (!leagueId || !idsKey) return
    const qs = new URLSearchParams({ leagueId })
    for (const id of idsKey.split('|')) qs.append('playerId', id)
    fetch(`/api/redraft/games-count?${qs.toString()}`, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as ApiState) : null))
      .then((data) => {
        if (!cancelled) setState(data)
      })
      .catch(() => {
        if (!cancelled) setState(null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, idsKey])

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (!state) return
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/redraft/games-count', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leagueId: state.leagueId, playerId: state.playerId, week: state.week, ...body }),
        })
        const data = (await res.json().catch(() => null)) as (ApiState & { error?: string }) | null
        if (!res.ok || !data?.ok) {
          setError(data?.error || t('gamesCount.player.failed'))
          return
        }
        setState(data)
        setDraft(null)
      } catch {
        setError(t('gamesCount.player.failed'))
      } finally {
        setBusy(false)
      }
    },
    [state, t],
  )

  if (!state || !state.started) return null
  const setting = state.setting
  if (setting.mode === 'all') return null
  const n = setting.mode === 'best_n' ? setting.n : 1
  const canAct = !state.weekFinal && !busy
  const picks = draft ?? state.choice.pickedGameIds
  const locked = state.choice.lockedGameId

  return (
    <section className="af-pc-games-count" data-testid="games-count-week-panel">
      <div className="af-pc-label">{t('gamesCount.player.title')}</div>
      <p className="af-pc-basis">
        {setting.mode === 'best_n' ? tInterpolate('gamesCount.player.ruleBestN', { n }) : t('gamesCount.player.ruleLockIn')}
        {' · '}
        {tInterpolate('gamesCount.player.total', { points: state.points })}
      </p>
      {state.games.length === 0 ? <p className="af-pc-basis">{t('gamesCount.player.noGames')}</p> : null}
      <ul className="af-pc-games-count-list">
        {state.games.map((g) => {
          const picked = picks.includes(g.gameId)
          return (
            <li key={g.gameId} data-testid={`games-count-game-${g.gameId}`} data-counted={g.counted ? 'true' : 'false'}>
              <span>{dayLabel(g.day, language)}</span>
              <span>{tInterpolate('gamesCount.player.pts', { points: g.points })}</span>
              {!g.eligible ? <span>{t('gamesCount.player.notStarted')}</span> : null}
              {g.counted ? <strong>{t('gamesCount.player.counts')}</strong> : null}
              {setting.mode === 'best_n' && g.eligible ? (
                <label>
                  <input
                    type="checkbox"
                    checked={picked}
                    disabled={!canAct || (!picked && picks.length >= n)}
                    onChange={() => setDraft(picked ? picks.filter((id) => id !== g.gameId) : [...picks, g.gameId])}
                  />{' '}
                  {t('gamesCount.player.picked')}
                </label>
              ) : null}
              {setting.mode === 'lock_in' && locked === g.gameId ? <strong>{t('gamesCount.player.lockedIn')}</strong> : null}
              {setting.mode === 'lock_in' && !locked && g.eligible && g.finished ? (
                <button
                  type="button"
                  disabled={!canAct}
                  onClick={() => {
                    if (typeof window !== 'undefined' && !window.confirm(tInterpolate('gamesCount.player.lockConfirm', { points: g.points }))) return
                    void post({ action: 'lock', gameId: g.gameId })
                  }}
                >
                  {t('gamesCount.player.lockIn')}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {setting.mode === 'best_n' && state.games.some((g) => g.eligible) ? (
        <div className="af-pc-games-count-actions">
          <button type="button" disabled={!canAct || !draft || draft.length === 0} onClick={() => void post({ action: 'pick', gameIds: draft })}>
            {t('gamesCount.player.savePicks')}
          </button>
          <button type="button" disabled={!canAct || state.choice.pickedGameIds.length === 0} onClick={() => void post({ action: 'clear_picks' })}>
            {tInterpolate('gamesCount.player.useBest', { n })}
          </button>
        </div>
      ) : null}
      {state.weekFinal ? <p className="af-pc-basis">{t('gamesCount.player.weekFinal')}</p> : null}
      {error ? <p className="af-pc-basis" role="alert">{error}</p> : null}
    </section>
  )
}
