'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Ask to join" requests for a PRIVATE AllFantasy league, on its Commissioner Hub.
 *
 * A private league is listed in Find a League with safe fields only, and nobody joins it from there
 * without the commissioner (lib/public-discovery/privateLeagueRequests.ts). This is where they say
 * yes or no, and where they can take the league off Find a League entirely. An invite link they
 * share still lets its holder straight in — that is unchanged.
 *
 * Reads and writes /api/find-league/leagues/[id]/request (GET / PATCH). Renders nothing for a league
 * that is not listed and has no requests, so a public or invite-only league never sees it.
 */

type JoinRequest = {
  id: string
  status: 'pending' | 'accepted'
  message: string | null
  createdAt: string
  name: string
  username: string | null
}

type RequestsState = { listed: boolean; hidden: boolean; requests: JoinRequest[] }

export function JoinRequestsCard({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const url = `/api/find-league/leagues/${encodeURIComponent(leagueId)}/request`
  const [state, setState] = useState<RequestsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as Partial<RequestsState>
      setState({
        listed: Boolean(body.listed),
        hidden: Boolean(body.hidden),
        requests: Array.isArray(body.requests) ? body.requests : [],
      })
    } catch {
      setState(null)
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(done)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('That did not save. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  const pending = state.requests.filter((r) => r.status === 'pending')
  if (!state.listed && !state.hidden && pending.length === 0) return null

  return (
    <section id="ch-join-requests" className="af-tw af-tw-panel" data-testid="join-requests-card">
      <h2>{pending.length > 0 ? t('Requests to join') : t('Private league in Find a League')}</h2>
      {state.listed ? (
        <p>
          {t('Players can find this private league in Find a League and ask to join. Nobody joins from there without your approval, and only members see rosters and chat.')}
        </p>
      ) : state.hidden ? (
        <p>{t('Hidden from Find a League. Only people you invite can join.')}</p>
      ) : null}
      {state.listed || state.hidden ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() =>
              void patch(
                { listing: state.listed ? 'hide' : 'show' },
                state.listed ? t('Hidden from Find a League.') : t('Back in Find a League.'),
              )
            }
            data-testid="join-requests-toggle-listing"
          >
            {state.listed ? t('Hide from Find a League') : t('Show in Find a League')}
          </button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="space-y-3" data-testid="join-requests-list">
          {pending.map((r) => (
            <div key={r.id} className="space-y-2 rounded-lg border border-[var(--line)] p-3" data-testid={`join-request-${r.id}`}>
              <p>
                <strong>{r.name}</strong>
                {r.username ? ` @${r.username}` : null}
                {r.message ? ` — “${r.message}”` : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="af-btn"
                  disabled={busy}
                  onClick={() => void patch({ requestId: r.id, action: 'approve' }, t('Approved. They can take their seat now.'))}
                  data-testid={`join-request-approve-${r.id}`}
                >
                  {t('Approve')}
                </button>
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => void patch({ requestId: r.id, action: 'decline' }, t('Declined. They were told kindly.'))}
                  data-testid={`join-request-decline-${r.id}`}
                >
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
