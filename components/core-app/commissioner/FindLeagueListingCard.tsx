'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueVibePicker } from './LeagueVibePicker'

/**
 * "List this league in Find a League", on the Commissioner Hub of a native league.
 *
 * Before this the only way to list a league was a button on the old league page's Draft tab, and
 * new leagues default to Private — measured 2026-10-30: 19 native leagues held 161 open seats
 * between them and one of the 32 was listed. This puts the decision where a commissioner already
 * is, with the number that makes it worth taking: how many seats are still open.
 *
 * Reads and writes /api/commissioner/leagues/[id]/league-finder, the same route the Draft tab
 * uses; `listed` there is what discovery actually shows, not whether a listing row exists.
 * Hidden when the league is full and not listed — there is nobody to recruit.
 */

type FinderState = {
  listed: boolean
  inviteReady: boolean
  openSeats: number
  leagueSize: number
  seatsHeld: number
}

export function FindLeagueListingCard({
  leagueId,
  variant = 'hub',
}: {
  leagueId: string
  /** 'welcome' is the "your league is ready" sheet right after creation: same control, sheet styling. */
  variant?: 'hub' | 'welcome'
}) {
  const { t } = useOptionalLanguage()
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/league-finder`
  const [state, setState] = useState<FinderState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as Partial<FinderState>
      setState({
        listed: Boolean(body.listed),
        inviteReady: Boolean(body.inviteReady),
        openSeats: Math.max(0, Number(body.openSeats ?? 0)),
        leagueSize: Math.max(0, Number(body.leagueSize ?? 0)),
        seatsHeld: Math.max(0, Number(body.seatsHeld ?? 0)),
      })
    } catch {
      // A card that cannot load says nothing rather than a wrong number; the hub carries on.
      setState(null)
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async () => {
    if (!state) return
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, { method: state.listed ? 'DELETE' : 'POST', credentials: 'include' })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(
        state.listed
          ? t('Removed from Find a League. Your invite link still works.')
          : t('Listed. Players at your level can now find and join this league.'),
      )
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('That did not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  if (!state.listed && state.openSeats === 0) return null

  const seats =
    state.openSeats === 1
      ? t('1 open seat')
      : `${state.openSeats} ${t('open seats')}`

  const welcome = variant === 'welcome'
  const Heading = welcome ? 'h3' : 'h2'

  return (
    <section
      id={welcome ? undefined : 'ch-find-league'}
      className={welcome ? 'space-y-2 text-sm' : 'af-tw af-tw-panel'}
      data-testid="find-league-listing-card"
    >
      <Heading className={welcome ? 'text-base font-black' : undefined}>
        {state.listed ? t('Listed in Find a League') : t('Fill your open seats')}
      </Heading>
      <p>
        <strong data-testid="find-league-listing-seats">{seats}</strong>
        {state.leagueSize > 0 ? ` · ${state.seatsHeld}/${state.leagueSize} ${t('managers')}` : null}
      </p>
      <p>
        {state.listed
          ? t('Players looking for a league can find this one and join with your invite link. Remove it once you are full.')
          : t('List this league in Find a League so players at your level can find it and take a seat. You can remove it any time.')}
      </p>
      {!state.inviteReady && !state.listed ? (
        <p data-testid="find-league-listing-needs-invite">
          {t('This league needs an invite link before it can be listed. Turn one on in league settings.')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={
            welcome
              ? 'min-h-12 touch-manipulation rounded-xl border border-[color:var(--border-subtle)] px-4 font-bold disabled:opacity-50'
              : 'af-btn'
          }
          onClick={() => void toggle()}
          disabled={busy || (!state.listed && !state.inviteReady)}
          data-testid="find-league-listing-toggle"
        >
          {busy ? '…' : state.listed ? t('Remove from Find a League') : t('List my league')}
        </button>
        {state.listed ? (
          <Link href="/find-league" className="underline" data-testid="find-league-listing-view">
            {t('See Find a League')}
          </Link>
        ) : null}
      </div>
      {state.listed && !welcome ? <LeagueVibePicker leagueId={leagueId} /> : null}
      <p role="status">{message}</p>
    </section>
  )
}
