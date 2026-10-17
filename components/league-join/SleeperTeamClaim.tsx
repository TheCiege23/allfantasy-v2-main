'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * "Claim your Sleeper team" after joining an imported Sleeper league as a member.
 *
 * Pick your team → get a code → put it in your Sleeper team name for that league → Verify. We read
 * Sleeper's public league users and check your team's manager carries the code — only the person
 * signed in to that Sleeper account can change it, so that is the proof (see
 * lib/league-join/sleeperOwnershipClaim.ts). Everything rides POST /api/leagues/join actions.
 */

type Team = { externalId: string; teamName: string | null; ownerName: string | null; avatarUrl: string | null }

async function call(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch('/api/leagues/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> }
}

export function SleeperTeamClaim({ leagueId, onClaimed }: { leagueId: string; onClaimed?: () => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    void call({ action: 'sleeper_claim_teams', leagueId }).then(({ data }) => {
      if (!alive) return
      setTeams(Array.isArray(data.teams) ? (data.teams as Team[]) : [])
    })
    return () => {
      alive = false
    }
  }, [leagueId])

  const getCode = useCallback(async () => {
    if (!picked) return
    setBusy(true)
    setError(null)
    const { data } = await call({ action: 'sleeper_claim_start', leagueId, teamExternalId: picked })
    setBusy(false)
    if (typeof data.code === 'string' && data.ok) setCode(data.code)
    else setError(typeof data.error === 'string' ? data.error : 'Could not start the claim.')
  }, [leagueId, picked])

  const verify = useCallback(async () => {
    if (!picked) return
    setBusy(true)
    setError(null)
    const { data } = await call({ action: 'sleeper_claim_verify', leagueId, teamExternalId: picked })
    setBusy(false)
    if (data.ok) {
      setDone(true)
      onClaimed?.()
      return
    }
    const seen = typeof data.seenTeamName === 'string' ? data.seenTeamName : null
    setError(
      data.code === 'code_not_found'
        ? `We see your Sleeper team name as “${seen || '(none)'}”. Add ${code} to it and save. Sleeper can take a few minutes to show a new name — try Verify again shortly.`
        : typeof data.error === 'string'
          ? data.error
          : 'Could not verify yet.',
    )
    if (data.code === 'no_code' || data.code === 'too_many_attempts') setCode(null)
  }, [code, leagueId, onClaimed, picked])

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4" data-testid="sleeper-claim-done">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          It&apos;s yours. Your team is claimed.
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          You can change your Sleeper team name back now.
        </p>
      </div>
    )
  }

  if (teams === null) {
    return <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading teams…</p>
  }
  if (teams.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }} data-testid="sleeper-claim-none">
        Every team in this league is already claimed.
      </p>
    )
  }

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)' }} data-testid="sleeper-claim">
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
        Claim your team
      </p>
      {!code ? (
        <>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Pick your team. We&apos;ll give you a short code to put in your Sleeper team name — that&apos;s how we
            know it&apos;s really you.
          </p>
          <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Your team">
            {teams.map((t) => (
              <button
                key={t.externalId}
                type="button"
                role="radio"
                aria-checked={picked === t.externalId}
                onClick={() => setPicked(t.externalId)}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${picked === t.externalId ? 'border-cyan-400 bg-cyan-400/10' : ''}`}
                style={picked === t.externalId ? { color: 'var(--text)' } : { borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                <span className="font-medium">{t.teamName || 'Unnamed team'}</span>
                {t.ownerName ? <span style={{ color: 'var(--muted)' }}> · {t.ownerName}</span> : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void getCode()}
            disabled={!picked || busy}
            className="mt-3 w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? 'Getting your code…' : 'Get my code'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-center font-mono text-3xl font-bold tracking-widest" style={{ color: 'var(--text)' }} data-testid="sleeper-claim-code">
            {code}
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--muted)' }}>
            <li>Open this league in the Sleeper app.</li>
            <li>Go to your team → edit your team name.</li>
            <li>Add <b style={{ color: 'var(--text)' }}>{code}</b> anywhere in the name and save.</li>
            <li>Come back and tap Verify — Sleeper can take a few minutes to show the new name. You can change it back afterwards.</li>
          </ol>
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy}
            className="mt-3 w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? 'Checking Sleeper…' : 'Verify'}
          </button>
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            The code works for 30 minutes.
          </p>
        </>
      )}
      {error ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--destructive)' }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default SleeperTeamClaim
