'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { controlClassSm } from './settings-ui'

type Invite = {
  id: string
  recipientLabel: string
  status: 'SENDING' | 'ACCEPTED' | 'DELAYED' | 'DELIVERED' | 'FAILED'
  createdAt: string
}

const labels: Record<Invite['status'], string> = {
  SENDING: 'Send unconfirmed',
  ACCEPTED: 'Accepted by provider',
  DELAYED: 'Delivery delayed',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
}
const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-40'

async function sendRequest(url: string, method = 'GET', payload?: object) {
  const response = await fetch(url, {
    method, cache: 'no-store',
    ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? 'Unable to load the invite result.')
  return data
}

export function SeatInvitePanel({ base, teamId, open }: { base: string; teamId: string; open: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const history = base + '/invite/seat-history'
  const load = useCallback(async () => {
    const result = await sendRequest(history + '?leagueTeamId=' + encodeURIComponent(teamId))
    setInvites(result.invites)
  }, [history, teamId])

  useEffect(() => {
    if (expanded) void load().catch(error => setStatus(error.message))
  }, [expanded, load])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setStatus('')
    try {
      const result = await sendRequest(base + '/invite/send', 'POST', {
        type: 'email', leagueTeamId: teamId, email: values.get('email'), message: values.get('message'),
      })
      setStatus(result.sent ? 'The email provider accepted the invite.' : result.error ?? 'Send status is unconfirmed.')
      if (result.sent) form.reset()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to send the invite.')
    } finally {
      await load().catch(() => {})
      setBusy(false)
    }
  }

  async function refresh(inviteId: string) {
    setBusy(true)
    setStatus('')
    try {
      const result = await sendRequest(history, 'PATCH', { inviteId })
      setInvites(current => current?.map(invite => invite.id === inviteId ? result.invite : invite) ?? null)
      if (result.message) setStatus(result.message)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to check delivery.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="space-y-3 border-t border-white/10 pt-3">
    <button type="button" className={button} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Seat invites</button>
    {expanded && <>
      {open && <form className="grid max-w-lg gap-2" onSubmit={send}>
        <p className="text-xs text-white/70">Recipients choose an available team when they join.</p>
        <label>Invite email<input className={controlClassSm + ' w-full'} name="email" type="email" maxLength={254} required disabled={busy} /></label>
        <label>Personal note<textarea className={controlClassSm + ' w-full'} name="message" rows={2} maxLength={320} disabled={busy} /></label>
        <button className={button + ' justify-self-start bg-teal-800'} disabled={busy}>Send seat invite</button>
      </form>}
      {status && <p className="text-xs text-white/85" role="status">{status}</p>}
      {invites === null && !status && <p className="text-xs text-white/70">Loading invite history…</p>}
      {invites?.length === 0 && <p className="text-xs text-white/70">No tracked invites for this seat.</p>}
      {!!invites?.length && <ul aria-label="Seat invite history" className="grid gap-2">
        {invites.map(invite => <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" key={invite.id}>
          <time dateTime={invite.createdAt}>{new Date(invite.createdAt).toLocaleString()}</time>
          <span>{invite.recipientLabel}</span>
          <strong>{labels[invite.status] ?? 'Status unknown'}</strong>
          {(invite.status === 'ACCEPTED' || invite.status === 'DELAYED') &&
            <button type="button" className={button} disabled={busy} onClick={() => void refresh(invite.id)}>Check delivery</button>}
        </li>)}
      </ul>}
    </>}
  </section>
}
