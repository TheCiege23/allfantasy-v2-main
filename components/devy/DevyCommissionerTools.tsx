'use client'

/**
 * PROMPT 3: Commissioner tools — recalc, force promote, revoke, overrides, reopen window, regenerate pools, repair duplicate, audit.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

/** "manual_map_pending" → "Manual map pending". */
const overrideActionLabel = (action: string) => {
  const words = action.replace(/[_-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Needs review'
}

interface OverrideRow {
  id: string
  devyPlayerId: string
  /** From the overrides route (2026-11-23); absent from an older route. */
  playerName?: string | null
  proPlayerId: string | null
  action: string
  notes: string | null
  createdAt: string
}

interface Props {
  leagueId: string
}

export function DevyCommissionerTools({ leagueId }: Props) {
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    async function fetchOverrides() {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/admin/overrides`, {
          cache: 'no-store',
        })
        if (!active) return
        if (res.ok) {
          const data = await res.json()
          setOverrides(data.overrides ?? [])
        }
      } catch {
        if (active) setOverrides([])
      }
    }
    fetchOverrides()
    return () => { active = false }
  }, [leagueId])

  const post = async (
    path: string,
    body?: object
  ): Promise<{ ok: boolean; error?: string; duplicateCount?: number }> => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/admin/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ type: 'err', text: (data as { error?: string }).error ?? 'Request failed' })
        return { ok: false }
      }
      setMessage({ type: 'ok', text: (data as { message?: string }).message ?? 'Done' })
      return data as { ok: boolean; duplicateCount?: number }
    } catch {
      setMessage({ type: 'err', text: 'Request failed' })
      return { ok: false }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--chip)] p-4">
      <h3 className="text-base font-semibold text-[var(--text)]">Devy commissioner tools</h3>
      {message && (
        <p
          className={`text-sm ${message.type === 'ok' ? 'text-[var(--good)]' : 'text-[var(--warn)]'}`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={() => post('automation', {
            seasonYear: new Date().getFullYear(),
            enableAutoPromotion: true,
            enableExpiration: false,
          })}
        >
          Sync lifecycle
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={() => post('recalc')}
        >
          Recalc devy status
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={() => post('reopen-window')}
        >
          Reopen promotion window
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={() => post('regenerate-rookie-pool')}
        >
          Regenerate rookie pool
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={() => post('regenerate-devy-pool')}
        >
          Regenerate devy pool
        </button>
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--chip)] disabled:opacity-50"
          onClick={async () => {
            const result = await post('repair-duplicate-rights')
            if (result.ok && result.duplicateCount != null) {
              setMessage({
                type: 'ok',
                text: `Scan complete. ${result.duplicateCount} duplicate(s) found.`,
              })
            }
          }}
        >
          Repair duplicate rights
        </button>
      </div>

      <div>
        <h4 className="text-sm font-medium text-[var(--text)]">Ambiguous mapping overrides</h4>
        {overrides.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">No pending overrides.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between rounded bg-[var(--chip)] px-2 py-1">
                <span className="text-[var(--text)]">{o.playerName ?? 'A devy player'} · {overrideActionLabel(o.action)}</span>
                {o.notes ? <span className="text-[var(--muted)]">{o.notes}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href={`/league/${leagueId}?tab=Settings&devy=audit`}
        className="block text-sm text-[var(--text2)] hover:text-[var(--text)]"
      >
        View audit log →
      </Link>
    </div>
  )
}
