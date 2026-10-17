'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Remove a league from the viewer's My Leagues — the Core home for `DELETE /api/league/[id]`,
 * whose only other button lived on the retired `/dashboard`.
 *
 * ⚠ IT DELETES THE VIEWER'S ROW AND WRITES A TOMBSTONE, NOTHING ELSE. The league on the provider,
 * other members' copies and their history are untouched, and the tombstone is what stops the next
 * import or sync from quietly bringing it back. The confirm says so, because "remove" next to a
 * league reads like "delete the league" to anyone who has not read the route.
 */
export default function RemoveLeagueButton({
  leagueId,
  leagueName,
  platformLabel,
}: {
  leagueId: string
  leagueName: string
  platformLabel: string
}) {
  const router = useRouter()
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    const ok = window.confirm(
      `Remove "${leagueName}" from your AllFantasy leagues?\n\nThis does not touch the league on ${platformLabel}, and other members keep their copy. You can import it again at any time.`,
    )
    if (!ok) return
    setRemoving(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || body?.ok !== true) throw new Error(body?.error || 'The league could not be removed.')
      router.push('/core')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The league could not be removed.')
      setRemoving(false)
    }
  }

  return (
    <>
      <button type="button" className="af-btn af-sy-alert-cta" data-variant="danger" disabled={removing} onClick={remove}>
        {removing ? 'Removing…' : 'Remove from My Leagues'}
      </button>
      {error ? (
        <p role="alert" className="af-sy-alert-error">
          {error}
        </p>
      ) : null}
    </>
  )
}
