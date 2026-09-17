'use client'

import { useState } from 'react'

/**
 * The @everyone composer every commissioner hub carries — the format hubs and the
 * all-leagues Commissioner Hub (the old hub's broadcast dialog, restyled inline).
 *
 * `leagueIds` must come from `listSendableLeagueIds`, the rule the broadcast route
 * applies, so the composer never offers a league the send would refuse.
 */
export function HubBroadcast({
  label,
  leagueIds,
  inputId = 'afh-broadcast',
}: {
  label: string
  leagueIds: string[]
  inputId?: string
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<{ tone: 'good' | 'bad' | null; note: string }>({ tone: null, note: '' })
  const [sending, setSending] = useState(false)

  if (leagueIds.length === 0) {
    return (
      <div className="afh-compose">
        <div className="afh-label">{label}</div>
        <p className="afh-compose-note">
          Broadcasts go to leagues AllFantasy runs where you’re the commissioner or a co-commissioner, and
          none of these is one.
        </p>
      </div>
    )
  }

  async function send() {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setState({ tone: null, note: 'Sending…' })
    try {
      const res = await fetch('/api/commissioner/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds, message }),
      })
      const body = (await res.json().catch(() => null)) as
        | { results?: { sent: boolean }[]; error?: string }
        | null
      if (!res.ok) {
        setState({ tone: 'bad', note: body?.error ? `Not sent: ${body.error}.` : 'Not sent. Try again in a moment.' })
        return
      }
      const sent = (body?.results ?? []).filter((r) => r.sent).length
      setState({
        tone: sent > 0 ? 'good' : 'bad',
        note:
          sent === leagueIds.length
            ? `Sent to all ${sent} ${sent === 1 ? 'league' : 'leagues'}.`
            : `Sent to ${sent} of ${leagueIds.length} leagues. The rest refused it.`,
      })
      if (sent > 0) setText('')
    } catch {
      setState({ tone: 'bad', note: 'Not sent — the connection dropped. Your message is still here.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="afh-compose">
      <label className="afh-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="afh-compose-row">
        <input
          id={inputId}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder={`Message ${leagueIds.length === 1 ? 'your league' : `all ${leagueIds.length} leagues you commission`}…`}
        />
        <button type="button" className="afh-btn afh-btn--sm" onClick={() => void send()} disabled={sending || !text.trim()}>
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
      <p className="afh-compose-note" data-tone={state.tone ?? undefined} aria-live="polite">
        {state.note || 'Posts as @everyone in each league chat and notifies its members.'}
      </p>
    </div>
  )
}

/** The title row's "Send @everyone": takes the reader to the composer and puts the cursor in it. */
export function FocusComposerButton({ inputId = 'afh-broadcast' }: { inputId?: string }) {
  return (
    <button
      type="button"
      className="afh-btn"
      onClick={() => {
        const el = document.getElementById(inputId)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(el as HTMLInputElement).focus({ preventScroll: true })
      }}
    >
      Send @everyone
    </button>
  )
}
