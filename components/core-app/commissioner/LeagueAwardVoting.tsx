'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'

type Ballot = {
  id: string; href: string; name: string; closesAt: string; closed: boolean; mine: string | null
  winner: string | null; outcome: string; totalVotes: number
  options: { id: string; label: string; count: number }[]
}

function localDate(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function LeagueAwardVoting({
  leagueId, ballots, selectedId, canManage, canVote, native,
}: {
  leagueId: string; ballots: Ballot[]; selectedId: string | null; canManage: boolean; canVote: boolean; native: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [connection, setConnection] = useState('')
  const request = useRef<{ input: string; id: string } | null>(null)
  const endpoint = `/api/shared/chat/threads/${encodeURIComponent(`league:${leagueId}`)}/polls`
  const root = `/league/${encodeURIComponent(leagueId)}/awards`
  const selected = ballots.find((ballot) => ballot.id === selectedId)
  async function send(payload: Record<string, unknown>) {
    setBusy(true)
    setStatus('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not complete this action.')
      return data as { href?: string; leagueId?: string; token?: string; path?: string }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not complete this action.')
      return null
    } finally {
      setBusy(false)
    }
  }
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const deadline = new Date(String(fields.get('closeAt') || ''))
    if (!Number.isFinite(deadline.getTime())) return setStatus('Choose a closing date.')
    const options = {
      name: String(fields.get('name') || ''),
      choices: String(fields.get('choices') || '').split(/\r?\n/).map((text) => text.trim()).filter(Boolean),
      closeAt: deadline.toISOString(),
    }
    const input = JSON.stringify(options)
    if (request.current?.input !== input) request.current = { input, id: crypto.randomUUID() }
    const result = await send({ kind: 'award-publish', ...options, requestId: request.current.id })
    if (result?.href) router.push(result.href)
  }
  async function connect() {
    const data = await send({ kind: 'award-sheet-key' })
    if (data?.token && data.path) {
      setConnection(JSON.stringify({ leagueId: data.leagueId, url: new URL(data.path, window.location.origin).href, token: data.token }))
    }
  }
  async function act(kind: string, ballotId: string, optionId?: string) {
    if (await send({ kind, ballotId, optionId })) {
      setStatus(kind === 'award-close' ? 'Voting closed.' : 'Vote saved.')
      router.refresh()
    }
  }
  return (
    <>
      {status && <p role="status">{status}</p>}
      {selected ? (
        <section className="grid gap-3 rounded-lg border border-current p-4">
          <Link href={root}>← All ballots</Link>
          <h2 className="text-xl font-semibold">{selected.name}</h2>
          <p>{selected.closed ? selected.winner ? `Winner: ${selected.winner}` : selected.outcome
            : `Closes ${new Date(selected.closesAt).toLocaleString()}`} · {selected.totalVotes} votes</p>
          {selected.options.map((option) => (
            <button type="button" key={option.id} className="rounded border border-current px-3 py-2 text-left"
              aria-pressed={selected.mine === option.id}
              disabled={busy || selected.closed || !canVote}
              onClick={() => void act('award-vote', selected.id, option.id)}>
              {option.label} · {option.count}{selected.mine === option.id ? ' · Your vote' : ''}
            </button>
          ))}
          {canManage && !selected.closed && (
            <button type="button" disabled={busy} onClick={() => {
              if (window.confirm('Close this ballot and finalize the result?')) void act('award-close', selected.id)
            }}>Close voting</button>
          )}
        </section>
      ) : (
        <>
          {ballots.length ? (
            <ul className="grid gap-3">
              {ballots.map((ballot) => (
                <li key={ballot.id}><Link href={ballot.href}>{ballot.name}</Link> · {ballot.outcome} · {ballot.totalVotes} votes</li>
              ))}
            </ul>
          ) : <p>No award ballots yet.</p>}
          {canManage && <>
            <form onSubmit={publish} className="grid gap-3 rounded-lg border border-current p-4">
              <h2 className="text-xl font-semibold">New award ballot</h2>
              <label className="grid gap-1">Award name<input name="name" required maxLength={120} className="rounded border border-current p-2" /></label>
              <label className="grid gap-1">Choices, one per line<textarea name="choices" required rows={4} maxLength={1212} className="rounded border border-current p-2" /></label>
              <label className="grid gap-1">Closes at<input name="closeAt" type="datetime-local" required
                defaultValue={localDate(new Date(Date.now() + 7 * 86_400_000))} className="rounded border border-current p-2" /></label>
              <p>{native ? 'Publishing queues a private DM with the choices for eligible managers.' : 'Publishing shares the ballot in AllFantasy league chat.'}</p>
              <button type="submit" disabled={busy}>Publish ballot</button>
            </form>
            <details>
              <summary>Connect a Google Sheet</summary>
              <p>Add the award sync script to the tracker’s Apps Script project. Run connectAfAwardVoting and paste this league’s connection.</p>
              <button type="button" disabled={busy} onClick={() => void connect()}>Generate connection</button>
              {connection && <textarea className="w-full rounded border border-current p-2" aria-label="Award sheet connection"
                readOnly value={connection} onFocus={(event) => event.currentTarget.select()} />}
            </details>
          </>}
        </>
      )}
    </>
  )
}
