'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueVibePicker } from './LeagueVibePicker'

/**
 * Find a League for a league that plays on another platform, on its Commissioner Hub.
 *
 * Listing needs the import to have shown this person is the commissioner
 * (lib/public-discovery/externalListing.ts); when it didn't, the card says so instead of
 * offering a button that would be refused. Players can't join here — their seats are on the
 * other platform — so they ask, and the commissioner answers each request with their invite.
 *
 * Reads and writes /api/commissioner/leagues/[id]/external-listing.
 */

type SpotRequest = {
  id: string
  status: 'pending' | 'accepted'
  message: string | null
  responseNote: string | null
  createdAt: string
  name: string
  username: string | null
}

type ListingState = {
  verification: 'provider' | 'attestation' | null
  platform: string
  listing: { listed: boolean; openSpots: number; note: string | null }
  requests: SpotRequest[]
}

export function ExternalListingCard({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/external-listing`
  const [state, setState] = useState<ListingState | null>(null)
  const [openSpots, setOpenSpots] = useState('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [replies, setReplies] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as ListingState
      setState(body)
      if (body.listing.listed) {
        setOpenSpots(String(body.listing.openSpots))
        setNote(body.listing.note ?? '')
      }
    } catch {
      setState(null)
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (listed: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listed, openSpots: Number(openSpots), note }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(listed ? t('Listed. Players can find it and ask for a spot.') : t('Removed from Find a League.'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('That did not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const answer = async (requestId: string, action: 'accept' | 'decline') => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action, note: replies[requestId] ?? '' }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(action === 'accept' ? t('Sent. They have your invite.') : t('Declined. They were told kindly.'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('That did not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null

  const pending = state.requests.filter((r) => r.status === 'pending')

  return (
    <section id="ch-find-league" className="af-tw af-tw-panel" data-testid="external-listing-card">
      <h2>{state.listing.listed ? t('Listed in Find a League') : t('Find players for your league')}</h2>
      {!state.verification ? (
        <p data-testid="external-listing-unverified">
          {t('Only the commissioner can list a league, and your import did not show that you are. Re-import it from your')}{' '}
          {state.platform} {t('commissioner account to list it.')}
        </p>
      ) : (
        <>
          <p>
            {t('Players find it in Find a League and ask for a spot. You answer with your')} {state.platform}{' '}
            {t('invite — nobody joins without you.')}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs">{t('Open spots')}</span>
              <input
                type="number"
                min={1}
                max={32}
                value={openSpots}
                onChange={(e) => setOpenSpots(e.target.value)}
                className="w-20 rounded-lg border px-2 py-2"
                data-testid="external-listing-spots"
              />
            </label>
            <label className="block min-w-0 flex-1">
              <span className="block text-xs">{t('Note for players (optional)')}</span>
              <input
                type="text"
                maxLength={280}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('Active chat, trades welcome, $50 on FanCred…')}
                className="w-full rounded-lg border px-2 py-2"
                data-testid="external-listing-note"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="af-btn" disabled={busy} onClick={() => void save(true)} data-testid="external-listing-save">
              {state.listing.listed ? t('Update listing') : t('List my league')}
            </button>
            {state.listing.listed ? (
              <button type="button" className="underline" disabled={busy} onClick={() => void save(false)} data-testid="external-listing-remove">
                {t('Remove from Find a League')}
              </button>
            ) : null}
          </div>
          {state.listing.listed ? <LeagueVibePicker leagueId={leagueId} /> : null}
        </>
      )}

      {pending.length > 0 ? (
        <div className="space-y-3" data-testid="external-listing-requests">
          <h3>
            {pending.length} {pending.length === 1 ? t('player wants a spot') : t('players want a spot')}
          </h3>
          {pending.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border p-3" data-testid={`external-listing-request-${r.id}`}>
              <p>
                <strong>{r.name}</strong>
                {r.message ? ` — “${r.message}”` : null}
              </p>
              <input
                type="text"
                maxLength={500}
                value={replies[r.id] ?? ''}
                onChange={(e) => setReplies((prev) => ({ ...prev, [r.id]: e.target.value }))}
                placeholder={`${t('Your')} ${state.platform} ${t('invite link, or a note')}`}
                aria-label={t('Reply')}
                className="w-full rounded-lg border px-2 py-2"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="af-btn" disabled={busy} onClick={() => void answer(r.id, 'accept')}>
                  {t('Accept and send invite')}
                </button>
                <button type="button" className="underline" disabled={busy} onClick={() => void answer(r.id, 'decline')}>
                  {t('Decline')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
