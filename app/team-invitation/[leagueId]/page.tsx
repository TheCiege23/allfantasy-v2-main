'use client'

import { use, useEffect, useState } from 'react'

export default function TeamInvitationPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = use(params)
  const [invitation, setInvitation] = useState<{ acceptedAt: string | null; league: { name: string | null } } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/team-coowners`
  useEffect(() => {
    fetch(endpoint, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}))
      if (response.status === 401) { setNeedsSignIn(true); return }
      if (!response.ok) throw new Error(body.error ?? 'Could not load invitation')
      setInvitation(body.invitation ?? null)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load invitation')).finally(() => setLoading(false))
  }, [endpoint])
  async function accept() {
    setError('')
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept' }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Could not accept invitation')
      window.location.href = `/league/${encodeURIComponent(leagueId)}`
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not accept invitation') }
  }
  return <main className="mx-auto max-w-xl space-y-4 p-8 text-white">
    <h1 className="text-2xl font-bold">Team co-owner invitation</h1>
    {loading ? <p>Loading invitation…</p> : needsSignIn ? <p>Sign in to see your invitation. <a className="text-teal-300 underline" href={`/login?callbackUrl=${encodeURIComponent(`/team-invitation/${leagueId}`)}`}>Sign in</a></p> : invitation ? <>
      <p>You were invited to help manage a team in {invitation.league.name ?? 'this league'}.</p>
      <p>This invitation does not grant commissioner access.</p>
      {invitation.acceptedAt ? <a href={`/league/${encodeURIComponent(leagueId)}`} className="text-teal-300 underline">Open league</a> : <button onClick={() => void accept()} className="rounded bg-teal-700 px-4 py-2">Accept invitation</button>}
    </> : !error && <p>No invitation was found for your account.</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </main>
}
