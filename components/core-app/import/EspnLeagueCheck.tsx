'use client'

/**
 * The guided ESPN import's "Test connection" — the step between typing a league and importing it.
 *
 * The user pastes a league ID or the whole ESPN URL (ImportV4 owns that box); this component reads
 * it with one light request through `POST /api/import-espn { mode: 'test' }` and says what it found
 * BEFORE anything is imported or saved:
 *
 *   public   → "Sunday Funday · 10 teams · public". Importing still needs ESPN connected once,
 *              because that is how we confirm which team is yours — so it says that, plainly.
 *   private  → moves the user to the cookie step automatically instead of showing an error.
 *   expired  → names the saved cookies as the problem, not the league.
 *   missing  → names the id and the seasons we tried.
 *
 * It renders the connect panel's HEADING state through `onStatus`, so ImportV4 can label the
 * cookie step "This league is private" rather than a generic "Connect ESPN".
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-espn.css'

export type EspnLeagueCheckStatus =
  | { k: 'idle' }
  | { k: 'testing' }
  | {
      k: 'ok'
      access: 'public' | 'private'
      leagueName: string
      teamCount: number
      season: number
      viewerTeamName: string | null
      viewerTeamFound: boolean | null
      needsCookiesToImport: boolean
    }
  | { k: 'needs_cookies' | 'cookies_rejected' | 'not_found' | 'invalid_input' | 'unavailable' | 'error'; message: string }

type TestResponse =
  | {
      ok: true
      access: 'public' | 'private'
      leagueName: string
      teamCount: number
      season: number
      viewerTeamName: string | null
      viewerTeamFound: boolean | null
      needsCookiesToImport: boolean
    }
  | { ok: false; reason: Exclude<EspnLeagueCheckStatus['k'], 'idle' | 'testing' | 'ok' | 'error'>; message: string }

export type EspnLeagueCheckProps = {
  /** What is in the league box right now. */
  leagueInput: string
  /** Re-test when the connection changes (cookies saved / removed). */
  espnConnected: boolean | null
  onStatus?: (status: EspnLeagueCheckStatus) => void
}

export async function requestEspnLeagueTest(leagueInput: string, cookies?: { swid: string; espnS2: string }) {
  const res = await fetch('/api/import-espn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'test', leagueId: leagueInput, ...(cookies ? { swid: cookies.swid, espnS2: cookies.espnS2 } : {}) }),
  })
  /* An answer carries `ok`; anything else (a 400 for malformed cookies, a 401, a 429) carries `error`. */
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!data || typeof data.ok !== 'boolean') {
    const message = typeof data?.error === 'string' && data.error ? data.error : 'Could not test that league right now.'
    return { ok: false as const, reason: 'error' as const, message }
  }
  return data as unknown as TestResponse
}

export function EspnLeagueCheck({ leagueInput, espnConnected, onStatus }: EspnLeagueCheckProps) {
  const [status, setStatus] = useState<EspnLeagueCheckStatus>({ k: 'idle' })
  const lastTested = useRef<string | null>(null)

  const update = useCallback(
    (next: EspnLeagueCheckStatus) => {
      setStatus(next)
      onStatus?.(next)
    },
    [onStatus],
  )

  const run = useCallback(async () => {
    const input = leagueInput.trim()
    if (!input) {
      update({ k: 'invalid_input', message: 'Paste your ESPN league ID or the league’s URL first.' })
      return
    }
    lastTested.current = input
    update({ k: 'testing' })
    try {
      const data = await requestEspnLeagueTest(input)
      if (data.ok) {
        update({
          k: 'ok',
          access: data.access,
          leagueName: data.leagueName,
          teamCount: data.teamCount,
          season: data.season,
          viewerTeamName: data.viewerTeamName,
          viewerTeamFound: data.viewerTeamFound,
          needsCookiesToImport: data.needsCookiesToImport,
        })
      } else {
        update({ k: data.reason, message: data.message })
      }
    } catch {
      update({ k: 'error', message: 'Could not reach AllFantasy to test that league. Check your connection and try again.' })
    }
  }, [leagueInput, update])

  /* A changed box invalidates the old answer — never show league A's result under league B's id. */
  useEffect(() => {
    if (lastTested.current != null && leagueInput.trim() !== lastTested.current) {
      lastTested.current = null
      update({ k: 'idle' })
    }
  }, [leagueInput, update])

  /* Cookies just saved or removed: the answer may have changed, so ask again. */
  const prevConnected = useRef(espnConnected)
  useEffect(() => {
    if (prevConnected.current !== espnConnected && lastTested.current) void run()
    prevConnected.current = espnConnected
  }, [espnConnected, run])

  const testing = status.k === 'testing'

  return (
    <div className="af-espn-check" data-status={status.k} data-testid="espn-league-check">
      <button
        type="button"
        className="af-btn af-btn--ghost af-espn-check-btn"
        onClick={() => void run()}
        disabled={testing || !leagueInput.trim()}
        data-testid="espn-test-connection"
      >
        {testing ? 'Testing…' : 'Test connection'}
      </button>

      {status.k === 'ok' ? (
        <div className="af-espn-check-result" role="status">
          <span className="af-espn-badge af-num">{status.access === 'public' ? 'Public' : 'Private'}</span>
          <span className="af-espn-check-league">
            <strong>{status.leagueName}</strong>
            <span className="af-num">
              {' '}
              · {status.teamCount} {status.teamCount === 1 ? 'team' : 'teams'} · {status.season}
            </span>
          </span>
          <span className="af-espn-check-note">
            {status.viewerTeamFound === true && status.viewerTeamName
              ? `Found your team: ${status.viewerTeamName}. You're ready to import.`
              : status.viewerTeamFound === false
                ? "Your connected ESPN account has no team in this league. Reconnect with the account that does."
                : status.access === 'public'
                  ? "Found it. Press Connect above and pick your team — no ESPN sign-in needed. Commissioners connect ESPN below to get the commissioner tools."
                  : "Connected. You're ready to import."}
          </span>
        </div>
      ) : null}

      {status.k === 'needs_cookies' ? (
        <p className="af-espn-check-private" role="status">
          <strong>This league is private.</strong> {status.message}
        </p>
      ) : null}

      {status.k === 'cookies_rejected' ||
      status.k === 'not_found' ||
      status.k === 'invalid_input' ||
      status.k === 'unavailable' ||
      status.k === 'error' ? (
        <p className="af-espn-msg af-espn-msg--error" role="alert">
          {status.message}
        </p>
      ) : null}
    </div>
  )
}

export default EspnLeagueCheck
