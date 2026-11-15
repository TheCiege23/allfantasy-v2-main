'use client'

/**
 * The small AllFantasy window the "Send to AllFantasy" bookmark opens from a Yahoo league page.
 *
 * It tells the Yahoo page it is ready, takes ONE page from it, and sends that page to the same route a
 * paste uses (`/api/leagues/import/yahoo-snapshot`) — so every server-side check, limit and rollout
 * gate applies exactly as it does to a paste. See lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet.ts
 * for the hand-off and why it is shaped this way.
 *
 * 🛑 ONLY YAHOO'S ORIGIN, ONLY THE WINDOW THAT OPENED US, ONLY ONCE PER LOAD. Anything else is ignored
 * without a word. Clicking the bookmark again reloads this window, which is a fresh "once".
 */
import { useEffect, useRef, useState } from 'react'
import {
  parseYahooPageMessage,
  YAHOO_FOOTBALL_ORIGIN,
  YAHOO_READY_MESSAGE,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet'
import type { YahooSnapshotChecklist } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'

const PAGE_LABEL: Record<string, string> = {
  settings: 'League settings',
  standings: 'Standings',
  draft: 'Draft results',
  roster: 'Roster',
}

type State =
  | { k: 'waiting' }
  | { k: 'orphan' }
  | { k: 'reading' }
  | { k: 'done'; page: string; team?: string; checklist: YahooSnapshotChecklist }
  | { k: 'error'; message: string }

export function YahooSnapshotReceiver() {
  const [state, setState] = useState<State>({ k: 'waiting' })
  const handled = useRef(false)

  useEffect(() => {
    const opener = window.opener as Window | null
    if (!opener) {
      setState({ k: 'orphan' })
      return
    }

    // This load's id: the bookmark echoes it, so a reply meant for an earlier load of this window is ignored.
    const rid = Math.random().toString(36).slice(2) + Date.now().toString(36)

    const onMessage = async (event: MessageEvent) => {
      if (handled.current || event.source !== opener) return
      const parsed = parseYahooPageMessage(event, rid)
      if (!parsed.ok) return
      handled.current = true
      setState({ k: 'reading' })
      try {
        const form = new FormData()
        form.set('league', parsed.url)
        form.set('text', parsed.text)
        const res = await fetch('/api/leagues/import/yahoo-snapshot', { method: 'POST', body: form })
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body.checklist) {
          setState({ k: 'error', message: body.error ?? 'We could not read that page. Try the bookmark again.' })
          return
        }
        setState({ k: 'done', page: body.page, team: body.team, checklist: body.checklist })
      } catch {
        setState({ k: 'error', message: 'The page did not reach AllFantasy. Check your connection and click the bookmark again.' })
      }
    }
    window.addEventListener('message', onMessage)

    // Say "ready" until the page arrives — the opener may attach its listener a moment after opening us.
    const sayReady = () => {
      if (!handled.current) opener.postMessage({ type: YAHOO_READY_MESSAGE, rid }, YAHOO_FOOTBALL_ORIGIN)
    }
    sayReady()
    const timer = window.setInterval(sayReady, 500)
    const stop = window.setTimeout(() => window.clearInterval(timer), 20_000)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [])

  return (
    <main className="af-im-ys-recv">
      <section className="af-im-fx" aria-live="polite">
        {state.k === 'waiting' ? <p className="af-im-fx-p">Waiting for your Yahoo page…</p> : null}
        {state.k === 'reading' ? <p className="af-im-fx-p">Reading your Yahoo page…</p> : null}
        {state.k === 'orphan' ? (
          <p className="af-im-fx-p">
            This window opens from the <b>Send to AllFantasy</b> bookmark on a Yahoo league page. Set it up from
            Import → &quot;Yahoo league? Import it by copy-paste&quot;.
          </p>
        ) : null}
        {state.k === 'error' ? (
          <p className="af-im-fx-err" role="alert">
            {state.message}
          </p>
        ) : null}
        {state.k === 'done' ? <Done state={state} /> : null}
      </section>
    </main>
  )
}

function Done({ state }: { state: Extract<State, { k: 'done' }> }) {
  const c = state.checklist
  const rosters = c.teams.filter((t) => t.hasRoster).length
  const items: Array<[string, boolean]> = [
    ['League settings', c.settings],
    ['Standings', c.standings],
    ['Draft results', c.draft],
  ]
  return (
    <>
      <p className="af-im-ys-ok" role="status">
        Got it: {state.page === 'roster' && state.team ? `${state.team}'s roster` : PAGE_LABEL[state.page] ?? 'page'}.
      </p>
      <ul className="af-im-ys-recv-list">
        {items.map(([label, done]) => (
          <li key={label}>
            <span className={done ? 'af-im-ys-mark af-im-ys-mark--done' : 'af-im-ys-mark'} aria-hidden>
              {done ? '✓' : ''}
            </span>
            {label}
          </li>
        ))}
        {c.teams.length > 0 ? (
          <li>
            <span className={rosters === c.teams.length ? 'af-im-ys-mark af-im-ys-mark--done' : 'af-im-ys-mark'} aria-hidden>
              {rosters === c.teams.length ? '✓' : ''}
            </span>
            Rosters · {rosters} of {c.teams.length}
          </li>
        ) : null}
      </ul>
      <p className="af-im-fx-note">
        {c.ready
          ? 'You can import now, or send more pages first: go back to Yahoo and click the bookmark on each one.'
          : `Next: go back to Yahoo, open your ${c.missing.join(' and ').toLowerCase()} page, and click the bookmark again.`}
      </p>
      {c.ready ? (
        <p className="af-im-fx-p">
          <a className="af-im-fx-go af-im-ys-recv-go" href={`/import?yahooLeague=${encodeURIComponent(c.leagueId)}`} target="_blank" rel="noopener">
            Review &amp; import →
          </a>
        </p>
      ) : null}
    </>
  )
}
