'use client'

/**
 * "On your phone? Prove it with a team code" — how an ESPN commissioner confirms their team without
 * the SWID cookie, which no mobile browser can hand over.
 *
 * The code comes from `POST /api/import-espn { mode: 'team_code' }` (an HMAC of this user and this
 * league — see `lib/league-import/espn/espnTeamCode.ts`). The person sets it as their ESPN team's
 * abbreviation, then taps Check, which reads the league once and says whether it is there yet. Only
 * when it is do we hand back to the import screen, which re-runs its preview: the commissioner gate
 * then finds the code on its own and the normal commissioner import unlocks. Nothing here is
 * authorization — the gate re-proves it on every preview and import.
 *
 * ⚠ IT CHECKS BEFORE IT HANDS BACK ON PURPOSE. Re-running the preview resets the "Who's the
 * commissioner?" answer, so doing that on every tap would throw someone back a step each time ESPN
 * had not caught up yet. A "not there yet" answer keeps them exactly where they are.
 */

import { useCallback, useEffect, useState } from 'react'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-espn.css'

type CodeState =
  | { k: 'loading' }
  | { k: 'ready'; code: string }
  | { k: 'unavailable'; message: string }

type CheckState =
  | { k: 'idle' }
  | { k: 'checking' }
  | { k: 'missing'; message: string }
  | { k: 'private' }
  | { k: 'found'; teamName: string | null }

type TeamCodeResponse = {
  ok?: boolean
  code?: string
  found?: boolean
  teamName?: string | null
  reason?: string
  message?: string
  error?: string
}

async function postTeamCode(leagueInput: string, check: boolean): Promise<TeamCodeResponse> {
  const res = await fetch('/api/import-espn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'team_code', leagueId: leagueInput, ...(check ? { check: true } : {}) }),
  })
  const data = (await res.json().catch(() => null)) as TeamCodeResponse | null
  if (!res.ok || !data || data.ok !== true) {
    return { ok: false, error: data?.error || 'Could not reach AllFantasy. Check your connection and try again.' }
  }
  return data
}

export function EspnTeamCodeVerify({
  leagueInput,
  onVerified,
}: {
  /** The league being imported — the preview's source id. */
  leagueInput: string
  /** The code is on their team: re-run the preview so the gate can see it. */
  onVerified: () => void
}) {
  const [codeState, setCodeState] = useState<CodeState>({ k: 'loading' })
  const [check, setCheck] = useState<CheckState>({ k: 'idle' })

  useEffect(() => {
    let live = true
    setCodeState({ k: 'loading' })
    setCheck({ k: 'idle' })
    void postTeamCode(leagueInput, false).then((data) => {
      if (!live) return
      if (data.ok && data.code) setCodeState({ k: 'ready', code: data.code })
      else setCodeState({ k: 'unavailable', message: data.error || 'Team codes are not available right now.' })
    })
    return () => {
      live = false
    }
  }, [leagueInput])

  const runCheck = useCallback(async () => {
    if (codeState.k !== 'ready') return
    setCheck({ k: 'checking' })
    const data = await postTeamCode(leagueInput, true)
    if (!data.ok) {
      setCheck({ k: 'missing', message: data.error || 'Could not check right now. Try again in a moment.' })
      return
    }
    if (data.found) {
      setCheck({ k: 'found', teamName: data.teamName ?? null })
      onVerified()
      return
    }
    if (data.reason === 'private') {
      setCheck({ k: 'private' })
      return
    }
    setCheck({
      k: 'missing',
      message: `We don't see ${codeState.code} on any team in this league yet. ESPN can take a minute to update. Make sure you saved it, then check again.`,
    })
  }, [codeState, leagueInput, onVerified])

  if (codeState.k === 'unavailable') return null

  return (
    <div className="af-espn-code" data-testid="espn-team-code" data-check={check.k}>
      <p className="af-espn-code-lead">
        <strong>On your phone?</strong> Confirm your team with a code instead. No cookies needed.
      </p>
      <ol className="af-espn-code-steps">
        <li>In the ESPN Fantasy app or on espn.com, open your team and edit its team info.</li>
        <li>
          Change your team&rsquo;s abbreviation to{' '}
          <span className="af-espn-code-value" data-testid="espn-team-code-value">
            {codeState.k === 'ready' ? codeState.code : '····'}
          </span>{' '}
          and save.
        </li>
        <li>Come back here and tap Check. After your league is imported, you can change it back.</li>
      </ol>
      <button
        type="button"
        className="af-btn af-espn-code-btn"
        onClick={() => void runCheck()}
        disabled={codeState.k !== 'ready' || check.k === 'checking' || check.k === 'found'}
        data-testid="espn-team-code-check"
      >
        {check.k === 'checking' ? 'Checking…' : check.k === 'found' ? 'Found it' : 'I set it — check'}
      </button>
      {check.k === 'missing' ? (
        <p className="af-espn-code-msg" role="status">
          {check.message}
        </p>
      ) : null}
      {check.k === 'private' ? (
        <div className="af-espn-code-private" role="status" data-testid="espn-team-code-private">
          <p className="af-espn-code-msg">
            <strong>Your league is private,</strong> so ESPN won&rsquo;t show it to us from a phone. Make it
            public, then check again:
          </p>
          <ol className="af-espn-code-steps">
            <li>On espn.com, open your league and go to LM Tools &rarr; League Settings &rarr; Basic Settings.</li>
            <li>Set &ldquo;Make League Viewable to Public&rdquo; to Yes and save.</li>
            <li>Tap Check again.</li>
          </ol>
          <p className="af-espn-code-note">
            Keep it public. If it goes back to private, scores and rosters stop updating here until someone
            connects ESPN from a computer. Rather keep it private? Connect ESPN from a computer instead.
          </p>
        </div>
      ) : null}
      {check.k === 'found' ? (
        <p className="af-espn-code-msg" data-ok="true" role="status">
          Confirmed{check.teamName ? `: ${check.teamName}` : ''}. Loading your league&hellip;
        </p>
      ) : null}
    </div>
  )
}
